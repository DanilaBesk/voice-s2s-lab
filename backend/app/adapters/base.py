from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from app.catalog import ModelCatalogEntry


class AdapterError(Exception):
    def __init__(self, code: str, message: str, detail: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail or {}

    def as_dict(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, "detail": self.detail}


@dataclass
class AdapterHealth:
    status: str
    detail: str | None = None

    @property
    def ready(self) -> bool:
        return self.status == "ready"


@dataclass
class SessionConfig:
    session_id: str
    persona_prompt: str
    mode: str = "turn_based"


@dataclass
class AudioTurn:
    session_id: str
    turn_id: str
    input_path: Path
    output_path: Path
    mime_type: str
    persona_prompt: str
    options: dict[str, Any] = field(default_factory=dict)


@dataclass
class AdapterResult:
    text: str | None
    output_path: Path | None
    output_mime_type: str = "audio/wav"
    events: list[dict[str, Any]] = field(default_factory=list)
    metrics: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


class AudioAdapter(Protocol):
    async def prepare(self, config: ModelCatalogEntry) -> AdapterHealth:
        ...

    async def warmup(self) -> AdapterHealth:
        ...

    async def start_session(self, session_config: SessionConfig) -> None:
        ...

    async def process_audio_file_or_chunk(self, turn: AudioTurn) -> AdapterResult:
        ...

    async def interrupt(self, session_id: str) -> None:
        ...

    async def close(self, session_id: str) -> None:
        ...
