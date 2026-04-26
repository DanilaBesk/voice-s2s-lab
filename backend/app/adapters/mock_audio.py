from __future__ import annotations

import math
import wave
from pathlib import Path

from app.adapters.base import AdapterHealth, AdapterResult, AudioTurn, SessionConfig
from app.catalog import ModelCatalogEntry
from app.events import EventLog, Timer


class MockAudioAdapter:
    def __init__(self) -> None:
        self.config: ModelCatalogEntry | None = None
        self.sessions: set[str] = set()

    async def prepare(self, config: ModelCatalogEntry) -> AdapterHealth:
        self.config = config
        return AdapterHealth(status="ready", detail="Mock adapter is always available")

    async def warmup(self) -> AdapterHealth:
        return AdapterHealth(status="ready", detail="Mock adapter warmed")

    async def unload(self) -> None:
        self.config = None
        self.sessions.clear()

    async def start_session(self, session_config: SessionConfig) -> None:
        self.sessions.add(session_config.session_id)

    async def process_audio_file_or_chunk(self, turn: AudioTurn) -> AdapterResult:
        timer = Timer()
        event_log = EventLog()
        event_log.add("adapter.started", "Mock turn started", session_id=turn.session_id, turn_id=turn.turn_id)
        sample_rate = self.config.output_sample_rate if self.config else 24_000
        duration_s = float(turn.options.get("mock_duration_s", 1.1))
        self._write_tone(turn.output_path, sample_rate=sample_rate, duration_s=duration_s)
        event_log.add("adapter.completed", "Mock audio generated", output=str(turn.output_path))
        return AdapterResult(
            text="Mock response: audio transport and session routing are working.",
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
        amplitude = 0.22
        frequency = 440.0
        with wave.open(str(path), "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(sample_rate)
            for index in range(frames):
                sample = int(32767 * amplitude * math.sin(2 * math.pi * frequency * index / sample_rate))
                handle.writeframesraw(sample.to_bytes(2, byteorder="little", signed=True))
