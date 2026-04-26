from __future__ import annotations

import math
import wave
from pathlib import Path

from app.adapters.base import AdapterError, AdapterHealth, AdapterResult, AudioTurn, SessionConfig
from app.catalog import ModelCatalogEntry
from app.events import EventLog, Timer


class SyntheticTtsAdapter:
    def __init__(self) -> None:
        self.config: ModelCatalogEntry | None = None
        self.sessions: set[str] = set()
        self.last_health = AdapterHealth(status="not_installed", detail="Adapter has not been prepared")

    async def prepare(self, config: ModelCatalogEntry) -> AdapterHealth:
        self.config = config
        self.last_health = AdapterHealth(status="ready", detail="Synthetic TTS adapter is always available")
        return self.last_health

    async def warmup(self) -> AdapterHealth:
        if self.config is None:
            self.last_health = AdapterHealth(status="error", detail="Adapter config was not prepared")
        else:
            self.last_health = AdapterHealth(status="ready", detail="Synthetic TTS adapter warmed")
        return self.last_health

    async def unload(self) -> None:
        self.config = None
        self.sessions.clear()
        self.last_health = AdapterHealth(status="not_loaded", detail="Synthetic TTS runtime is not loaded")

    async def start_session(self, session_config: SessionConfig) -> None:
        self.sessions.add(session_config.session_id)

    async def process_audio_file_or_chunk(self, turn: AudioTurn) -> AdapterResult:
        if self.config is None:
            raise AdapterError(
                "model_not_ready",
                "Synthetic TTS adapter is not ready",
                {"status": self.last_health.status, "detail": self.last_health.detail},
            )

        timer = Timer()
        event_log = EventLog()
        text = str(turn.options.get("text") or turn.persona_prompt or "")
        sample_rate = self.config.output_sample_rate if self.config else 22_050
        duration_s = max(0.25, min(2.0, 0.08 * max(1, len(text))))

        event_log.add("adapter.started", "Synthetic TTS turn started", session_id=turn.session_id, turn_id=turn.turn_id)
        self._write_tone(turn.output_path, sample_rate=sample_rate, duration_s=duration_s)
        event_log.add("adapter.completed", "Synthetic TTS WAV generated", output=str(turn.output_path))
        return AdapterResult(
            text=text,
            output_path=turn.output_path,
            events=event_log.as_list(),
            metrics={"adapter_ms": timer.elapsed_ms(), "output_sample_rate": sample_rate},
        )

    async def interrupt(self, session_id: str) -> None:
        return None

    async def close(self, session_id: str) -> None:
        self.sessions.discard(session_id)

    def _write_tone(self, path: Path, sample_rate: int, duration_s: float) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        frames = int(sample_rate * duration_s)
        amplitude = 0.18
        frequency = 523.25
        with wave.open(str(path), "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(sample_rate)
            for index in range(frames):
                sample = int(32767 * amplitude * math.sin(2 * math.pi * frequency * index / sample_rate))
                handle.writeframesraw(sample.to_bytes(2, byteorder="little", signed=True))
