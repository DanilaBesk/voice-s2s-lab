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

    async def adapter_for(self, entry: ModelCatalogEntry):
        if entry.adapter not in ADAPTER_REGISTRY:
            raise AdapterError("adapter_not_registered", f"Adapter is not registered: {entry.adapter}")
        if entry.id not in self.adapters:
            await self._ensure_adapter_loaded(entry)
        return self.adapters[entry.id]

    def schedule_warmup(self, entry: ModelCatalogEntry) -> None:
        if entry.id in self.adapters:
            return
        task = self.adapter_tasks.get(entry.id)
        if task and not task.done():
            return
        self.adapter_tasks[entry.id] = self._spawn_adapter_task(entry)

    async def _ensure_adapter_loaded(self, entry: ModelCatalogEntry) -> None:
        if entry.id in self.adapters:
            return
        task = self.adapter_tasks.get(entry.id)
        if task is None or task.done():
            task = self._spawn_adapter_task(entry)
            self.adapter_tasks[entry.id] = task
        await task

    def _spawn_adapter_task(self, entry: ModelCatalogEntry) -> asyncio.Task:
        task = asyncio.create_task(self._load_adapter(entry))
        task.add_done_callback(lambda done: done.exception())
        return task

    async def _load_adapter(self, entry: ModelCatalogEntry) -> None:
        try:
            adapter = self.adapters.get(entry.id)
            if adapter is None:
                adapter = ADAPTER_REGISTRY[entry.adapter]()
            await adapter.prepare(entry)
            self.adapters[entry.id] = adapter
            self.adapter_errors.pop(entry.id, None)
        except Exception as exc:
            self.adapter_errors[entry.id] = str(exc)
            raise


state = AppState()


@asynccontextmanager
async def lifespan(app_: FastAPI):
    for entry in state.catalog.list():
        if entry.default:
            state.schedule_warmup(entry)
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
        try:
            adapter = state.adapters.get(entry.id)
            if adapter is None:
                if entry.default:
                    state.schedule_warmup(entry)
                task = state.adapter_tasks.get(entry.id)
                if task and not task.done():
                    status = "loading"
                    detail = "Model warmup is running in the background."
                elif entry.id in state.adapter_errors:
                    status = "error"
                    detail = state.adapter_errors[entry.id]
                else:
                    status = "not_checked"
                    detail = None
            else:
                health_status = getattr(adapter, "last_health", None)
                status = health_status.status if health_status else "not_checked"
                detail = health_status.detail if health_status else None
        except AdapterError as exc:
            status = "error"
            detail = exc.message
        models.append(entry.public_dict(status=status, status_detail=detail))
    models.sort(
        key=lambda model: (
            not bool(model.get("default")),
            model.get("status") != "ready",
            model.get("display_name", ""),
        )
    )
    return {"models": models}


@app.post("/api/models/{model_id}/warmup")
async def warmup_model(model_id: str) -> dict:
    entry = _get_model(model_id)
    adapter = await state.adapter_for(entry)
    health_status = await adapter.warmup()
    return {"model_id": model_id, "status": health_status.status, "detail": health_status.detail}


@app.post("/api/sessions")
async def create_session(request: CreateSessionRequest) -> dict:
    entry = _get_model(request.model_id)
    adapter = await state.adapter_for(entry)
    session = state.sessions.create(model_id=entry.id, persona_prompt=request.persona_prompt, mode=request.mode)
    await adapter.start_session(SessionConfig(session_id=session.id, persona_prompt=session.persona_prompt, mode=session.mode))
    event_log = EventLog(state.sessions.session_dir(session.id) / "events.jsonl")
    event_log.add("session.created", "Session created", session_id=session.id, model_id=entry.id, mode=request.mode)
    return state.sessions.as_dict(session)


@app.post("/api/sessions/{session_id}/interrupt")
async def interrupt_session(session_id: str) -> dict:
    session = _get_session(session_id)
    entry = _get_model(session.model_id)
    adapter = await state.adapter_for(entry)
    await adapter.interrupt(session_id)
    return {"session_id": session_id, "status": "interrupted"}


@app.delete("/api/sessions/{session_id}")
async def close_session(session_id: str) -> dict:
    session = state.sessions.close(session_id)
    entry = _get_model(session.model_id)
    adapter = await state.adapter_for(entry)
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
    adapter = await state.adapter_for(entry)
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
