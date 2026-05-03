from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from app.adapters.base import AdapterError, AdapterHealth, AdapterResult, AudioTurn, SessionConfig
from app.catalog import ModelCatalogEntry
from app.events import EventLog, Timer


REPO_ROOT = Path(__file__).resolve().parents[3]


class RHVoiceTtsAdapter:
    def __init__(self) -> None:
        self.config: ModelCatalogEntry | None = None
        self.tts: Any | None = None
        self.sessions: set[str] = set()
        self.last_health = AdapterHealth(status="not_installed", detail="Adapter has not been prepared")

    async def prepare(self, config: ModelCatalogEntry) -> AdapterHealth:
        self.config = config
        data_path = _resolve_path(str(config.config.get("data_path", "")))
        required_files = [data_path / name for name in config.config.get("required_files", [])] if data_path else []
        missing_files = [path for path in required_files if not path.exists()]
        if missing_files:
            self.last_health = AdapterHealth(status="not_installed", detail=f"RHVoice assets are missing: {missing_files[0]}")
            return self.last_health

        try:
            from rhvoice_wrapper import TTS
        except Exception as exc:
            self.last_health = AdapterHealth(status="not_installed", detail=f"rhvoice-wrapper is not installed: {type(exc).__name__}: {exc}")
            return self.last_health

        try:
            kwargs: dict[str, Any] = {"threads": int(config.config.get("threads", 1))}
            if "stream" in config.config:
                kwargs["stream"] = bool(config.config["stream"])
            if data_path is not None:
                kwargs["data_path"] = str(data_path)
            if config.config.get("lib_path"):
                kwargs["lib_path"] = str(_resolve_path(str(config.config["lib_path"])))
            self.tts = TTS(**kwargs)
        except Exception as exc:
            self.last_health = AdapterHealth(
                status="not_installed",
                detail=f"RHVoice engine failed to initialize: {type(exc).__name__}: {exc}",
            )
            return self.last_health

        self.last_health = AdapterHealth(status="ready", detail="RHVoice runtime is ready")
        return self.last_health

    async def warmup(self) -> AdapterHealth:
        if self.config is None:
            self.last_health = AdapterHealth(status="error", detail="Adapter config was not prepared")
        return self.last_health

    async def unload(self) -> None:
        if self.tts is not None and hasattr(self.tts, "join"):
            await asyncio.to_thread(self.tts.join)
        self.config = None
        self.tts = None
        self.sessions.clear()
        self.last_health = AdapterHealth(status="not_loaded", detail="RHVoice TTS runtime is not loaded")

    async def start_session(self, session_config: SessionConfig) -> None:
        self.sessions.add(session_config.session_id)

    async def process_audio_file_or_chunk(self, turn: AudioTurn) -> AdapterResult:
        if self.last_health.status != "ready":
            raise AdapterError("model_not_ready", "RHVoice TTS adapter is not ready", {"status": self.last_health.status, "detail": self.last_health.detail})
        return await asyncio.to_thread(self._generate_sync, turn)

    async def interrupt(self, session_id: str) -> None:
        return None

    async def close(self, session_id: str) -> None:
        self.sessions.discard(session_id)

    def _generate_sync(self, turn: AudioTurn) -> AdapterResult:
        if self.config is None or self.tts is None:
            raise AdapterError("model_not_ready", "RHVoice TTS adapter is not ready")

        text = str(turn.options.get("text") or turn.persona_prompt or "").strip()
        if not text:
            raise AdapterError("empty_tts_text", "TTS text is empty")

        voice = str(turn.options.get("voice") or self.config.voices[0].id)
        voice_name = str(self.config.config.get("voice_map", {}).get(voice, voice))
        timer = Timer()
        event_log = EventLog()
        turn.output_path.parent.mkdir(parents=True, exist_ok=True)
        event_log.add("adapter.started", "RHVoice TTS turn started", session_id=turn.session_id, turn_id=turn.turn_id, voice=voice)
        try:
            self.tts.to_file(filename=str(turn.output_path), text=text, voice=voice_name, format_="wav")
        except Exception as exc:
            raise AdapterError("model_runtime_error", "RHVoice TTS generation failed", {"error": f"{type(exc).__name__}: {exc}", "voice": voice_name}) from exc

        if not turn.output_path.exists():
            raise AdapterError("no_audio_output", "RHVoice TTS completed without writing output audio")

        event_log.add("adapter.completed", "RHVoice TTS turn completed", output=str(turn.output_path))
        return AdapterResult(
            text=text,
            output_path=turn.output_path,
            events=event_log.as_list(),
            metrics={"adapter_ms": timer.elapsed_ms(), "output_sample_rate": self.config.output_sample_rate, "voice": voice_name},
        )


def _resolve_path(value: str) -> Path | None:
    if not value:
        return None
    path = Path(value).expanduser()
    if path.is_absolute():
        return path
    return REPO_ROOT / path
