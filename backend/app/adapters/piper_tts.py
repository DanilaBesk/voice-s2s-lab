from __future__ import annotations

import asyncio
import shutil
import subprocess
from pathlib import Path

from app.adapters.base import AdapterError, AdapterHealth, AdapterResult, AudioTurn, SessionConfig
from app.catalog import ModelCatalogEntry
from app.events import EventLog, Timer


REPO_ROOT = Path(__file__).resolve().parents[3]


class PiperTtsAdapter:
    def __init__(self) -> None:
        self.config: ModelCatalogEntry | None = None
        self.model_path: Path | None = None
        self.config_path: Path | None = None
        self.executable: str | None = None
        self.sessions: set[str] = set()
        self.last_health = AdapterHealth(status="not_installed", detail="Adapter has not been prepared")

    async def prepare(self, config: ModelCatalogEntry) -> AdapterHealth:
        self.config = config
        health = self._check_installation(config)
        self.last_health = health
        return health

    async def warmup(self) -> AdapterHealth:
        if self.config is None:
            self.last_health = AdapterHealth(status="error", detail="Adapter config was not prepared")
            return self.last_health
        self.last_health = self._check_installation(self.config)
        return self.last_health

    async def unload(self) -> None:
        self.config = None
        self.model_path = None
        self.config_path = None
        self.executable = None
        self.sessions.clear()
        self.last_health = AdapterHealth(status="not_loaded", detail="Piper TTS runtime is not loaded")

    async def start_session(self, session_config: SessionConfig) -> None:
        self.sessions.add(session_config.session_id)

    async def process_audio_file_or_chunk(self, turn: AudioTurn) -> AdapterResult:
        if self.last_health.status != "ready":
            raise AdapterError(
                "model_not_ready",
                "Piper TTS adapter is not ready",
                {"status": self.last_health.status, "detail": self.last_health.detail},
            )
        return await asyncio.to_thread(self._generate_sync, turn)

    async def interrupt(self, session_id: str) -> None:
        return None

    async def close(self, session_id: str) -> None:
        self.sessions.discard(session_id)

    def _check_installation(self, config: ModelCatalogEntry) -> AdapterHealth:
        model_path = _resolve_path(str(config.config.get("model_path", "")))
        config_path = _resolve_path(str(config.config.get("config_path", "")))
        if model_path is None or not model_path.exists():
            return AdapterHealth(status="not_installed", detail=f"Piper model file is missing: {model_path or 'model_path not configured'}")
        if config_path is None or not config_path.exists():
            return AdapterHealth(status="not_installed", detail=f"Piper config file is missing: {config_path or 'config_path not configured'}")

        executable_name = str(config.config.get("piper_executable", "piper"))
        executable = shutil.which(executable_name)
        if executable is None:
            return AdapterHealth(status="not_installed", detail=f"Piper runtime is not installed or not on PATH: {executable_name}")

        self.model_path = model_path
        self.config_path = config_path
        self.executable = executable
        return AdapterHealth(status="ready", detail=f"Piper voice is ready: {model_path.name}")

    def _generate_sync(self, turn: AudioTurn) -> AdapterResult:
        if self.config is None or self.model_path is None or self.config_path is None or self.executable is None:
            raise AdapterError("model_not_ready", "Piper TTS adapter is not ready")

        timer = Timer()
        event_log = EventLog()
        text = str(turn.options.get("text") or turn.persona_prompt or "").strip()
        if not text:
            raise AdapterError("empty_tts_text", "TTS text is empty")

        turn.output_path.parent.mkdir(parents=True, exist_ok=True)
        command = [
            self.executable,
            "--model",
            str(self.model_path),
            "--config",
            str(self.config_path),
            "--output_file",
            str(turn.output_path),
        ]
        event_log.add("adapter.started", "Piper TTS turn started", session_id=turn.session_id, turn_id=turn.turn_id)
        try:
            completed = subprocess.run(
                command,
                input=text,
                text=True,
                capture_output=True,
                check=False,
                timeout=float(self.config.config.get("timeout_s", 120)),
            )
        except subprocess.TimeoutExpired as exc:
            raise AdapterError("model_runtime_error", "Piper TTS timed out", {"timeout_s": exc.timeout}) from exc
        except Exception as exc:
            raise AdapterError("model_runtime_error", "Piper TTS failed to start", {"error": f"{type(exc).__name__}: {exc}"}) from exc

        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout or "").strip()
            self.last_health = AdapterHealth(status="failed", detail=detail or f"Piper exited with code {completed.returncode}")
            raise AdapterError("model_runtime_error", "Piper TTS generation failed", {"returncode": completed.returncode, "detail": self.last_health.detail})
        if not turn.output_path.exists():
            raise AdapterError("no_audio_output", "Piper TTS completed without writing output audio")

        event_log.add("adapter.completed", "Piper TTS turn completed", output=str(turn.output_path))
        return AdapterResult(
            text=text,
            output_path=turn.output_path,
            events=event_log.as_list(),
            metrics={"adapter_ms": timer.elapsed_ms(), "output_sample_rate": self.config.output_sample_rate},
        )


def _resolve_path(value: str) -> Path | None:
    if not value:
        return None
    path = Path(value).expanduser()
    if path.is_absolute():
        return path
    return REPO_ROOT / path
