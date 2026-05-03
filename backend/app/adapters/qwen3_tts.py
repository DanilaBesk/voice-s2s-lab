from __future__ import annotations

import asyncio
import math
from pathlib import Path
import struct
import threading
import wave
from typing import Any

from app.adapters.base import AdapterError, AdapterHealth, AdapterResult, AudioTurn, SessionConfig
from app.catalog import ModelCatalogEntry
from app.events import EventLog, Timer
from app.tts_assets import _resolve_repo_path

DEFAULT_QWEN3_MAX_NEW_TOKENS = 80


class Qwen3TtsAdapter:
    def __init__(self) -> None:
        self.config: ModelCatalogEntry | None = None
        self.model_dir: Path | None = None
        self.model: Any | None = None
        self.soundfile: Any | None = None
        self.torch: Any | None = None
        self.sessions: set[str] = set()
        self.last_health = AdapterHealth(status="not_installed", detail="Adapter has not been prepared")
        self._model_lock = threading.Lock()
        self._generation_lock = threading.Lock()

    async def prepare(self, config: ModelCatalogEntry) -> AdapterHealth:
        self.config = config
        model_dir = _resolve_repo_path(str(config.config.get("model_dir", "")))
        required_files = config.config.get(
            "required_files",
            ["config.json", "generation_config.json", "model.safetensors", "speech_tokenizer/model.safetensors", "tokenizer_config.json"],
        )
        missing = [name for name in required_files if not (model_dir / name).exists()]
        if missing:
            self.last_health = AdapterHealth(
                status="not_installed",
                detail=f"Qwen3 TTS local snapshot is missing {', '.join(missing)} in {model_dir}. Run scripts/install-tts-models.py --models {config.id}.",
            )
            return self.last_health
        try:
            import soundfile
            import torch
            from qwen_tts import Qwen3TTSModel
        except Exception as exc:
            self.last_health = AdapterHealth(
                status="not_installed",
                detail=f"Qwen3 TTS dependencies are missing or incompatible: {type(exc).__name__}: {exc}. Run uv sync --extra tts.",
            )
            return self.last_health

        try:
            dtype = _resolve_dtype(torch, str(config.config.get("dtype", "auto")), str(config.config.get("device", "cpu")))
            model = Qwen3TTSModel.from_pretrained(str(model_dir), dtype=dtype)
            self.config = config
            self.model_dir = model_dir
            self.model = model
            self.soundfile = soundfile
            self.torch = torch
            self.last_health = AdapterHealth(status="ready", detail=f"Qwen3 TTS snapshot is ready: {model_dir.name}")
            return self.last_health
        except Exception as exc:
            self.last_health = AdapterHealth(status="failed", detail=f"Qwen3 TTS model failed to load from {model_dir}: {type(exc).__name__}: {exc}")
            self.model = None
            self.soundfile = None
            self.torch = None
            return self.last_health

    async def warmup(self) -> AdapterHealth:
        if self.config is None:
            return AdapterHealth(status="error", detail="Adapter config was not prepared")
        return self.last_health

    async def unload(self) -> None:
        with self._model_lock:
            self.config = None
            self.model_dir = None
            self.model = None
            self.soundfile = None
            if self.torch is not None and hasattr(self.torch, "cuda") and self.torch.cuda.is_available():
                self.torch.cuda.empty_cache()
            self.torch = None
            self.sessions.clear()
            self.last_health = AdapterHealth(status="not_loaded", detail="Qwen3 TTS runtime is not loaded")

    async def start_session(self, session_config: SessionConfig) -> None:
        self.sessions.add(session_config.session_id)

    async def process_audio_file_or_chunk(self, turn: AudioTurn) -> AdapterResult:
        if self.last_health.status != "ready":
            raise AdapterError("model_not_ready", "Qwen3 TTS adapter is not ready", {"status": self.last_health.status, "detail": self.last_health.detail})
        return await asyncio.to_thread(self._generate_sync, turn)

    async def interrupt(self, session_id: str) -> None:
        return None

    async def close(self, session_id: str) -> None:
        self.sessions.discard(session_id)

    def _generate_sync(self, turn: AudioTurn) -> AdapterResult:
        config = self.config
        model = self.model
        soundfile = self.soundfile
        if config is None or model is None or soundfile is None:
            raise AdapterError("model_not_ready", "Qwen3 TTS adapter is not ready")
        text = str(turn.options.get("text") or turn.persona_prompt or "").strip()
        if not text:
            raise AdapterError("empty_tts_text", "TTS text is empty")
        voice = str(turn.options.get("voice") or config.voices[0].id)
        language = str(turn.options.get("language") or config.config.get("language", "Russian"))
        max_new_tokens = _bounded_max_new_tokens(turn.options.get("max_new_tokens"), config.config.get("max_new_tokens"))
        ref_audio, ref_text, x_vector_only = self._reference_prompt(turn, voice, config)

        timer = Timer()
        event_log = EventLog()
        event_log.add("adapter.started", "Qwen3 TTS turn started", session_id=turn.session_id, turn_id=turn.turn_id, voice=voice)
        try:
            with self._generation_lock:
                wavs, sample_rate = model.generate_voice_clone(
                    text=text,
                    language=language,
                    ref_audio=ref_audio,
                    ref_text=ref_text,
                    x_vector_only_mode=x_vector_only,
                    non_streaming_mode=bool(config.config.get("non_streaming_mode", True)),
                    max_new_tokens=max_new_tokens,
                )
            if not wavs:
                raise AdapterError("no_audio_output", "Qwen3 TTS generated no audio output")
            turn.output_path.parent.mkdir(parents=True, exist_ok=True)
            soundfile.write(str(turn.output_path), wavs[0], int(sample_rate))
        except AdapterError:
            raise
        except Exception as exc:
            raise AdapterError("model_runtime_error", "Qwen3 TTS generation failed", {"error": f"{type(exc).__name__}: {exc}", "voice": voice}) from exc

        event_log.add("adapter.completed", "Qwen3 TTS turn completed", output=str(turn.output_path))
        return AdapterResult(
            text=text,
            output_path=turn.output_path,
            events=event_log.as_list(),
            metrics={"adapter_ms": timer.elapsed_ms(), "output_sample_rate": int(sample_rate), "voice": voice, "max_new_tokens": max_new_tokens},
            warnings=["Qwen3-TTS 0.6B Base requires a voice-clone reference; this catalog entry uses a deterministic local reference for runnable smoke coverage."],
        )

    def _reference_prompt(self, turn: AudioTurn, voice: str, config: ModelCatalogEntry) -> tuple[str, str, bool]:
        if turn.options.get("ref_audio_path"):
            return str(_resolve_repo_path(str(turn.options["ref_audio_path"]))), str(turn.options.get("ref_text") or ""), bool(turn.options.get("x_vector_only_mode", True))
        configured = config.config.get("reference_voices", {}).get(voice, {})
        if configured.get("ref_audio_path"):
            return str(_resolve_repo_path(str(configured["ref_audio_path"]))), str(configured.get("ref_text") or ""), bool(configured.get("x_vector_only_mode", True))
        ref_path = _ensure_sine_reference(_resolve_repo_path(str(config.config.get("generated_reference_path", ".local/qwen3-tts/reference.wav"))))
        return str(ref_path), "", True


def _resolve_dtype(torch: Any, configured: str, device: str) -> Any:
    if configured == "bfloat16":
        return torch.bfloat16
    if configured == "float16":
        return torch.float16
    if configured == "float32":
        return torch.float32
    if device == "cuda":
        return torch.bfloat16
    return torch.float32


def _bounded_max_new_tokens(requested: Any, configured: Any) -> int:
    configured_limit = _positive_int(configured, DEFAULT_QWEN3_MAX_NEW_TOKENS)
    requested_limit = _positive_int(requested, configured_limit)
    return min(requested_limit, configured_limit)


def _positive_int(value: Any, fallback: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return fallback
    return parsed if parsed > 0 else fallback


def _ensure_sine_reference(path: Path) -> Path:
    if path.exists():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    sample_rate = 24_000
    frames = []
    for index in range(sample_rate):
        value = int(0.2 * 32767 * math.sin(2 * math.pi * 220 * index / sample_rate))
        frames.append(struct.pack("<h", value))
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(b"".join(frames))
    return path
