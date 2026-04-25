from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class Event:
    type: str
    message: str
    data: dict[str, Any] = field(default_factory=dict)
    ts: str = field(default_factory=utc_now)

    def as_dict(self) -> dict[str, Any]:
        return {"ts": self.ts, "type": self.type, "message": self.message, "data": self.data}


class EventLog:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path
        self.events: list[Event] = []
        if self.path:
            self.path.parent.mkdir(parents=True, exist_ok=True)

    def add(self, event_type: str, message: str, **data: Any) -> Event:
        event = Event(type=event_type, message=message, data=data)
        self.events.append(event)
        if self.path:
            with self.path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(event.as_dict(), ensure_ascii=False) + "\n")
        return event

    def as_list(self) -> list[dict[str, Any]]:
        return [event.as_dict() for event in self.events]


class Timer:
    def __init__(self) -> None:
        self.started = time.perf_counter()

    def elapsed_ms(self) -> int:
        return round((time.perf_counter() - self.started) * 1000)
