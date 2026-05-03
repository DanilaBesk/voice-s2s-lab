from __future__ import annotations

import asyncio
from pathlib import Path

from app.adapters.base import AdapterError, AdapterHealth, AdapterResult, AudioTurn, SessionConfig
from app.catalog import ModelCatalogEntry
from app.events import EventLog, Timer


REPO_ROOT = Path(__file__).resolve().parents[3]


class SileroTtsAdapter:
    def __init__(self) -> None:
        self.config: ModelCatalogEntry | None = None
        self.model = None
        self.model_path: Path | None = None
        self.sessions: set[str] = set()
        self.last_health = AdapterHealth(status="not_installed", detail="Adapter has not been prepared")

    async def prepare(self, config: ModelCatalogEntry) -> AdapterHealth:
        self.config = config
        model_path = _resolve_path(str(config.config.get("model_path", "")))
        if model_path is None or not model_path.exists():
            self.last_health = AdapterHealth(status="not_installed", detail=f"Silero model file is missing: {model_path or 'model_path not configured'}")
            return self.last_health
        try:
            from torch import package

            importer = package.PackageImporter(str(model_path))
            model = importer.load_pickle("tts_models", "model")
            model.to(str(config.config.get("device", "cpu")))
        except Exception as exc:
            self.last_health = AdapterHealth(status="failed", detail=f"Silero model failed to load: {type(exc).__name__}: {exc}")
            return self.last_health

        self.model_path = model_path
        self.model = model
        self.last_health = AdapterHealth(status="ready", detail=f"Silero CIS model is ready: {model_path.name}")
        return self.last_health

    async def warmup(self) -> AdapterHealth:
        if self.config is None:
            self.last_health = AdapterHealth(status="error", detail="Adapter config was not prepared")
        return self.last_health

    async def unload(self) -> None:
        self.config = None
        self.model = None
        self.model_path = None
        self.sessions.clear()
        self.last_health = AdapterHealth(status="not_loaded", detail="Silero TTS runtime is not loaded")

    async def start_session(self, session_config: SessionConfig) -> None:
        self.sessions.add(session_config.session_id)

    async def process_audio_file_or_chunk(self, turn: AudioTurn) -> AdapterResult:
        if self.last_health.status != "ready":
            raise AdapterError("model_not_ready", "Silero TTS adapter is not ready", {"status": self.last_health.status, "detail": self.last_health.detail})
        return await asyncio.to_thread(self._generate_sync, turn)

    async def interrupt(self, session_id: str) -> None:
        return None

    async def close(self, session_id: str) -> None:
        self.sessions.discard(session_id)

    def _generate_sync(self, turn: AudioTurn) -> AdapterResult:
        if self.config is None or self.model is None:
            raise AdapterError("model_not_ready", "Silero TTS adapter is not ready")

        text = str(turn.options.get("text") or turn.persona_prompt or "").strip()
        if not text:
            raise AdapterError("empty_tts_text", "TTS text is empty")

        voice = str(turn.options.get("voice") or self.config.voices[0].id)
        speaker = str(self.config.config.get("speaker_map", {}).get(voice, voice))
        sample_rate = int(self.config.output_sample_rate)
        timer = Timer()
        event_log = EventLog()
        turn.output_path.parent.mkdir(parents=True, exist_ok=True)
        event_log.add("adapter.started", "Silero TTS turn started", session_id=turn.session_id, turn_id=turn.turn_id, voice=voice)
        try:
            import soundfile as sf

            audio = self.model.apply_tts(text=text, speaker=speaker, sample_rate=sample_rate)
            if hasattr(audio, "detach"):
                audio = audio.detach().cpu().numpy()
            sf.write(str(turn.output_path), audio, sample_rate)
        except Exception as exc:
            raise AdapterError("model_runtime_error", "Silero TTS generation failed", {"error": f"{type(exc).__name__}: {exc}", "speaker": speaker}) from exc

        if not turn.output_path.exists():
            raise AdapterError("no_audio_output", "Silero TTS completed without writing output audio")
        event_log.add("adapter.completed", "Silero TTS turn completed", output=str(turn.output_path))
        return AdapterResult(
            text=text,
            output_path=turn.output_path,
            events=event_log.as_list(),
            metrics={"adapter_ms": timer.elapsed_ms(), "output_sample_rate": sample_rate, "speaker": speaker},
        )


def _resolve_path(value: str) -> Path | None:
    if not value:
        return None
    path = Path(value).expanduser()
    if path.is_absolute():
        return path
    return REPO_ROOT / path
