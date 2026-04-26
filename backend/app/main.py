from __future__ import annotations

import json
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.adapters import ADAPTER_REGISTRY
from app.adapters.base import AdapterError, AudioTurn, SessionConfig
from app.catalog import ModelCatalog, ModelCatalogEntry
from app.config import get_settings
from app.events import EventLog, Timer
from app.sessions import SessionStore, new_id

DEFAULT_PERSONA_PROMPT = (
    "Ты Алекс, живой собеседник в голосовом звонке. Говори по-русски естественно, спокойно, "
    "кратко и практично. Не говори, что ты AI-модель, если тебя прямо об этом не спрашивают. "
    "Отвечай короткими репликами, без длинных монологов, задавай один короткий уточняющий "
    "вопрос, когда это действительно полезно. Держи ответы короче 20 секунд. Предпочитай "
    "прямые ответы, практические примеры и дружелюбный, но не театральный тон. Оставайся "
    "в роли полезного русскоязычного партнера по разговору."
)


class CreateSessionRequest(BaseModel):
    model_id: str
    persona_prompt: str = Field(default=DEFAULT_PERSONA_PROMPT)
    mode: str = "turn_based"


class AppState:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.catalog = ModelCatalog(Path(__file__).parent / "models")
        self.sessions = SessionStore(self.settings.session_dir)
        self.adapters = {}
        self.adapter_tasks: dict[str, asyncio.Task] = {}
        self.adapter_errors: dict[str, str] = {}
        self.model_statuses: dict[str, str] = {}
        self.model_status_details: dict[str, str | None] = {}
        self.loaded_model_id: str | None = None
        self.runtime_model_id: str | None = None
        self._runtime_lock = asyncio.Lock()

    async def adapter_for(self, entry: ModelCatalogEntry):
        if self.loaded_model_id != entry.id or self.model_status(entry.id) != "ready":
            raise AdapterError(
                "model_not_loaded",
                "Model is not loaded. Use POST /api/models/{id}/load before starting sessions.",
                {"model_id": entry.id, "status": self.model_status(entry.id)},
            )
        try:
            return self.adapters[entry.id]
        except KeyError as exc:
            raise AdapterError(
                "model_not_loaded",
                "Model is not loaded. Use POST /api/models/{id}/load before starting sessions.",
                {"model_id": entry.id, "status": "not_loaded"},
            ) from exc

    async def load_model(self, entry: ModelCatalogEntry) -> dict:
        async with self._runtime_lock:
            if self.loaded_model_id == entry.id and self.model_status(entry.id) == "ready":
                return self.runtime_payload(entry.id)
            for model_id in list(self.adapters):
                if model_id != entry.id:
                    await self._unload_model_id(model_id)
            self.runtime_model_id = entry.id
            self.model_statuses[entry.id] = "loading"
            self.model_status_details[entry.id] = None
            self.adapter_errors.pop(entry.id, None)
            try:
                adapter = self.adapters.get(entry.id)
                if adapter is None:
                    if entry.adapter not in ADAPTER_REGISTRY:
                        raise AdapterError("adapter_not_registered", f"Adapter is not registered: {entry.adapter}")
                    adapter = ADAPTER_REGISTRY[entry.adapter]()
                health_status = await adapter.prepare(entry)
                if health_status.status == "ready":
                    self.adapters[entry.id] = adapter
                    self.loaded_model_id = entry.id
                    self.model_statuses[entry.id] = "ready"
                    self.model_status_details[entry.id] = health_status.detail
                    return self.runtime_payload(entry.id)
                await adapter.unload()
                self.adapters.pop(entry.id, None)
                self.loaded_model_id = None
                self.model_statuses[entry.id] = "failed"
                self.model_status_details[entry.id] = health_status.detail or health_status.status
                self.adapter_errors[entry.id] = self.model_status_details[entry.id] or "Model load failed"
                return self.runtime_payload(entry.id)
            except Exception as exc:
                if "adapter" in locals():
                    try:
                        await adapter.unload()
                    except Exception:
                        pass
                self.adapters.pop(entry.id, None)
                self.loaded_model_id = None
                self.model_statuses[entry.id] = "failed"
                self.model_status_details[entry.id] = str(exc)
                self.adapter_errors[entry.id] = str(exc)
                return self.runtime_payload(entry.id)

    async def unload_model(self, entry: ModelCatalogEntry) -> dict:
        async with self._runtime_lock:
            await self._unload_model_id(entry.id)
            return self.runtime_payload(entry.id)

    async def _unload_model_id(self, model_id: str) -> None:
        adapter = self.adapters.pop(model_id, None)
        self.adapter_tasks.pop(model_id, None)
        self.model_statuses[model_id] = "unloading"
        if adapter is not None:
            await adapter.unload()
        if self.loaded_model_id == model_id:
            self.loaded_model_id = None
        if self.runtime_model_id == model_id:
            self.runtime_model_id = None
        self.adapter_errors.pop(model_id, None)
        self.model_statuses[model_id] = "not_loaded"
        self.model_status_details[model_id] = None

    def model_status(self, model_id: str) -> str:
        return self.model_statuses.get(model_id, "not_loaded")

    def model_status_detail(self, model_id: str) -> str | None:
        return self.model_status_details.get(model_id) or self.adapter_errors.get(model_id)

    def runtime_payload(self, model_id: str | None = None) -> dict:
        runtime_model_id = model_id or self.runtime_model_id or self.loaded_model_id
        if runtime_model_id is None:
            return {"model_id": None, "status": "not_loaded", "detail": None}
        return {
            "model_id": runtime_model_id,
            "status": self.model_status(runtime_model_id),
            "detail": self.model_status_detail(runtime_model_id),
        }


state = AppState()


@asynccontextmanager
async def lifespan(app_: FastAPI):
    yield


app = FastAPI(title="Voice S2S Lab", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=state.settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
@app.get("/api/health")
async def health() -> dict:
    return {"ok": True, "version": app.version}


@app.get("/api/models")
async def list_models() -> dict:
    models = []
    for entry in state.catalog.list():
        status = state.model_status(entry.id)
        detail = state.model_status_detail(entry.id)
        models.append(entry.public_dict(status=status, status_detail=detail))
    models.sort(
        key=lambda model: (
            not bool(model.get("default")),
            model.get("status") != "ready",
            model.get("display_name", ""),
        )
    )
    return {"models": models}


@app.get("/api/runtime")
async def get_runtime() -> dict:
    return state.runtime_payload()


@app.post("/api/models/{model_id}/load")
async def load_model(model_id: str) -> dict:
    entry = _get_model(model_id)
    return await state.load_model(entry)


@app.delete("/api/models/{model_id}/load")
async def unload_model(model_id: str) -> dict:
    entry = _get_model(model_id)
    return await state.unload_model(entry)


@app.post("/api/models/{model_id}/warmup")
async def warmup_model(model_id: str) -> dict:
    entry = _get_model(model_id)
    adapter = await _loaded_adapter_for(entry)
    health_status = await adapter.warmup()
    return {"model_id": model_id, "status": health_status.status, "detail": health_status.detail}


@app.post("/api/sessions")
async def create_session(request: CreateSessionRequest) -> dict:
    entry = _get_model(request.model_id)
    adapter = await _loaded_adapter_for(entry)
    session = state.sessions.create(model_id=entry.id, persona_prompt=request.persona_prompt, mode=request.mode)
    await adapter.start_session(SessionConfig(session_id=session.id, persona_prompt=session.persona_prompt, mode=session.mode))
    event_log = EventLog(state.sessions.session_dir(session.id) / "events.jsonl")
    event_log.add("session.created", "Session created", session_id=session.id, model_id=entry.id, mode=request.mode)
    return state.sessions.as_dict(session)


@app.post("/api/sessions/{session_id}/interrupt")
async def interrupt_session(session_id: str) -> dict:
    session = _get_session(session_id)
    entry = _get_model(session.model_id)
    adapter = await _loaded_adapter_for(entry)
    await adapter.interrupt(session_id)
    return {"session_id": session_id, "status": "interrupted"}


@app.delete("/api/sessions/{session_id}")
async def close_session(session_id: str) -> dict:
    session = _get_session(session_id)
    entry = _get_model(session.model_id)
    adapter = await _loaded_adapter_for(entry)
    session = state.sessions.close(session_id)
    await adapter.close(session_id)
    return {"session_id": session_id, "active": False}


@app.post("/api/sessions/{session_id}/turns")
async def submit_turn(
    session_id: str,
    audio: Annotated[UploadFile, File()],
    options: Annotated[str | None, Form()] = None,
) -> dict:
    timer = Timer()
    session = _get_session(session_id)
    entry = _get_model(session.model_id)
    adapter = await _loaded_adapter_for(entry)
    turn_id = new_id("turn")
    suffix = _suffix_for(audio.filename, audio.content_type)
    paths = state.sessions.turn_paths(session_id, turn_id, suffix)
    event_log = EventLog(paths["events"])
    event_log.add("turn.received", "Audio turn received", session_id=session_id, turn_id=turn_id, mime_type=audio.content_type)
    body = await audio.read()
    paths["input"].write_bytes(body)
    event_log.add("audio.saved", "Input audio saved", bytes=len(body), path=str(paths["input"]))
    try:
        parsed_options = json.loads(options) if options else {}
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail={"code": "invalid_options", "message": str(exc)}) from exc

    try:
        result = await adapter.process_audio_file_or_chunk(
            AudioTurn(
                session_id=session_id,
                turn_id=turn_id,
                input_path=paths["input"],
                output_path=paths["output"],
                mime_type=audio.content_type or "application/octet-stream",
                persona_prompt=session.persona_prompt,
                options=parsed_options,
            )
        )
    except AdapterError as exc:
        event_log.add("adapter.failed", exc.message, code=exc.code, detail=exc.detail)
        raise HTTPException(status_code=502, detail=exc.as_dict()) from exc

    for adapter_event in result.events:
        event_log.add(adapter_event["type"], adapter_event["message"], **adapter_event.get("data", {}))
    total_ms = timer.elapsed_ms()
    event_log.add("turn.completed", "Turn completed", total_ms=total_ms)
    return {
        "turn_id": turn_id,
        "session_id": session_id,
        "status": "completed",
        "audio_url": f"/api/sessions/{session_id}/turns/{turn_id}/audio" if result.output_path else None,
        "text": result.text,
        "latency_ms": total_ms,
        "events": event_log.as_list(),
        "metrics": {**result.metrics, "upload_bytes": len(body), "total_ms": total_ms},
        "warnings": result.warnings,
    }


@app.get("/api/sessions/{session_id}/turns/{turn_id}/audio")
async def get_turn_audio(session_id: str, turn_id: str):
    _get_session(session_id)
    output_path = state.sessions.session_dir(session_id) / "output" / f"{turn_id}.wav"
    if not output_path.exists():
        raise HTTPException(status_code=404, detail={"code": "audio_not_found", "message": "Output audio not found"})
    return FileResponse(output_path, media_type="audio/wav", filename=f"{turn_id}.wav")


def _get_model(model_id: str) -> ModelCatalogEntry:
    try:
        return state.catalog.get(model_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail={"code": "unknown_model", "message": str(exc)}) from exc


async def _loaded_adapter_for(entry: ModelCatalogEntry):
    try:
        return await state.adapter_for(entry)
    except AdapterError as exc:
        status_code = 409 if exc.code == "model_not_loaded" else 502
        raise HTTPException(status_code=status_code, detail=exc.as_dict()) from exc


def _get_session(session_id: str):
    try:
        return state.sessions.get(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail={"code": "unknown_session", "message": str(exc)}) from exc


def _suffix_for(filename: str | None, content_type: str | None) -> str:
    if filename and "." in filename:
        return "." + filename.rsplit(".", 1)[1].lower()
    if content_type == "audio/wav":
        return ".wav"
    if content_type == "audio/webm":
        return ".webm"
    return ".bin"
