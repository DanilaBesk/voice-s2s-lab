from __future__ import annotations

import asyncio
from pathlib import Path

from app.adapters.base import AdapterError, AdapterHealth, AdapterResult, AudioTurn, SessionConfig
from app.catalog import ModelCatalogEntry
from app.events import EventLog, Timer
from app.tts_assets import _resolve_repo_path


class VoskTtsAdapter:
    def __init__(self) -> None:
        self.config: ModelCatalogEntry | None = None
        self.model_path: Path | None = None
        self.model = None
        self.synth = None
        self.sessions: set[str] = set()
        self.last_health = AdapterHealth(status="not_installed", detail="Adapter has not been prepared")

    async def prepare(self, config: ModelCatalogEntry) -> AdapterHealth:
        self.config = config
        model_path = _resolve_repo_path(str(config.config.get("model_path", "")))
        required = ["model.onnx", "dictionary", "config.json"]
        missing = [name for name in required if not (model_path / name).exists()]
        if missing:
            self.last_health = AdapterHealth(
                status="not_installed",
                detail=f"Vosk TTS local model is missing {', '.join(missing)} in {model_path}. Run scripts/install-tts-models.py --models {config.id}.",
            )
            return self.last_health
        try:
            from vosk_tts import Model, Synth
        except Exception as exc:
            self.last_health = AdapterHealth(
                status="not_installed",
                detail=f"Vosk TTS dependencies are missing: {type(exc).__name__}: {exc}. Run uv sync --extra tts.",
            )
            return self.last_health
        try:
            self.model = Model(model_path=model_path)
            self.synth = Synth(self.model)
            self.model_path = model_path
            self.last_health = AdapterHealth(status="ready", detail=f"Vosk TTS model is ready: {model_path.name}")
            return self.last_health
        except Exception as exc:
            self.last_health = AdapterHealth(status="failed", detail=f"Vosk TTS model failed to load from {model_path}: {type(exc).__name__}: {exc}")
            return self.last_health

    async def warmup(self) -> AdapterHealth:
        if self.config is None:
            return AdapterHealth(status="error", detail="Adapter config was not prepared")
        return self.last_health

    async def unload(self) -> None:
        self.config = None
        self.model_path = None
        self.model = None
        self.synth = None
        self.sessions.clear()
        self.last_health = AdapterHealth(status="not_loaded", detail="Vosk TTS runtime is not loaded")

    async def start_session(self, session_config: SessionConfig) -> None:
        self.sessions.add(session_config.session_id)

    async def process_audio_file_or_chunk(self, turn: AudioTurn) -> AdapterResult:
        if self.last_health.status != "ready":
            raise AdapterError("model_not_ready", "Vosk TTS adapter is not ready", {"status": self.last_health.status, "detail": self.last_health.detail})
        return await asyncio.to_thread(self._generate_sync, turn)

    async def interrupt(self, session_id: str) -> None:
        return None

    async def close(self, session_id: str) -> None:
        self.sessions.discard(session_id)

    def _generate_sync(self, turn: AudioTurn) -> AdapterResult:
        if self.config is None or self.synth is None:
            raise AdapterError("model_not_ready", "Vosk TTS adapter is not ready")
        text = str(turn.options.get("text") or turn.persona_prompt or "").strip()
        if not text:
            raise AdapterError("empty_tts_text", "TTS text is empty")
        voice = str(turn.options.get("voice") or self.config.voices[0].id)
        speaker_map = self.config.config.get("speaker_map", {})
        speaker_id = int(speaker_map.get(voice, 0))

        timer = Timer()
        event_log = EventLog()
        event_log.add("adapter.started", "Vosk TTS turn started", session_id=turn.session_id, turn_id=turn.turn_id, voice=voice)
        try:
            turn.output_path.parent.mkdir(parents=True, exist_ok=True)
            self.synth.synth(text, str(turn.output_path), speaker_id=speaker_id)
        except Exception as exc:
            raise AdapterError("model_runtime_error", "Vosk TTS generation failed", {"error": f"{type(exc).__name__}: {exc}"}) from exc
        event_log.add("adapter.completed", "Vosk TTS turn completed", output=str(turn.output_path))
        return AdapterResult(
            text=text,
            output_path=turn.output_path,
            events=event_log.as_list(),
            metrics={"adapter_ms": timer.elapsed_ms(), "output_sample_rate": self.config.output_sample_rate, "speaker_id": speaker_id},
        )
