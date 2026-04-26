from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


@dataclass
class Session:
    id: str
    model_id: str
    persona_prompt: str
    mode: str = "turn_based"
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    active: bool = True


class SessionStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.sessions: dict[str, Session] = {}

    def create(self, model_id: str, persona_prompt: str, mode: str = "turn_based") -> Session:
        session = Session(id=new_id("sess"), model_id=model_id, persona_prompt=persona_prompt, mode=mode)
        self.sessions[session.id] = session
        self.session_dir(session.id).mkdir(parents=True, exist_ok=True)
        return session

    def get(self, session_id: str) -> Session:
        try:
            return self.sessions[session_id]
        except KeyError as exc:
            raise KeyError(f"Unknown session id: {session_id}") from exc

    def close(self, session_id: str) -> Session:
        session = self.get(session_id)
        session.active = False
        return session

    def session_dir(self, session_id: str) -> Path:
        return self.root / session_id

    def turn_paths(self, session_id: str, turn_id: str, suffix: str) -> dict[str, Path]:
        base = self.session_dir(session_id)
        input_dir = base / "input"
        output_dir = base / "output"
        input_dir.mkdir(parents=True, exist_ok=True)
        output_dir.mkdir(parents=True, exist_ok=True)
        return {
            "input": input_dir / f"{turn_id}{suffix}",
            "output": output_dir / f"{turn_id}.wav",
            "events": base / "events.jsonl",
        }

    def tts_turn_paths(self, turn_id: str) -> dict[str, Path]:
        return self.turn_paths("tts", turn_id, ".txt")

    def tts_output_path(self, turn_id: str) -> Path:
        return self.session_dir("tts") / "output" / f"{turn_id}.wav"

    def as_dict(self, session: Session) -> dict[str, Any]:
        return {
            "session_id": session.id,
            "model_id": session.model_id,
            "persona_prompt": session.persona_prompt,
            "mode": session.mode,
            "created_at": session.created_at,
            "active": session.active,
        }
