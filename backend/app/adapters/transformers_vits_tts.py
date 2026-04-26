from __future__ import annotations

import asyncio
from pathlib import Path
import wave

from app.adapters.base import AdapterError, AdapterHealth, AdapterResult, AudioTurn, SessionConfig
from app.catalog import ModelCatalogEntry
from app.events import EventLog, Timer
from app.tts_assets import _resolve_repo_path


class TransformersVitsTtsAdapter:
    def __init__(self) -> None:
        self.config: ModelCatalogEntry | None = None
        self.model_dir: Path | None = None
        self.model = None
        self.tokenizer = None
        self.sessions: set[str] = set()
        self.last_health = AdapterHealth(status="not_installed", detail="Adapter has not been prepared")

    async def prepare(self, config: ModelCatalogEntry) -> AdapterHealth:
        self.config = config
        model_dir = _resolve_repo_path(str(config.config.get("model_dir", "")))
        required_files = config.config.get("required_files") or ["config.json", "model.safetensors", "tokenizer_config.json", "vocab.json"]
        missing = [name for name in required_files if not (model_dir / name).exists()]
        if missing:
            self.last_health = AdapterHealth(
                status="not_installed",
                detail=f"VITS local snapshot is missing {', '.join(missing)} in {model_dir}. Run scripts/install-tts-models.py --models {config.id}.",
            )
            return self.last_health
        try:
            from transformers import AutoTokenizer, VitsModel
            import torch
        except Exception as exc:
            self.last_health = AdapterHealth(
                status="not_installed",
                detail=f"Transformers VITS dependencies are missing: {type(exc).__name__}: {exc}. Run uv sync --extra tts.",
            )
            return self.last_health

        try:
            device = str(config.config.get("device", "cpu"))
            self.tokenizer = AutoTokenizer.from_pretrained(model_dir, local_files_only=True)
            self.model = VitsModel.from_pretrained(model_dir, local_files_only=True).to(device)
            self.model.eval()
            self.model_dir = model_dir
            self._torch = torch
            self.last_health = AdapterHealth(status="ready", detail=f"VITS snapshot is ready: {model_dir.name}")
            return self.last_health
        except Exception as exc:
            self.last_health = AdapterHealth(status="failed", detail=f"VITS model failed to load from {model_dir}: {type(exc).__name__}: {exc}")
            return self.last_health

    async def warmup(self) -> AdapterHealth:
        if self.config is None:
            return AdapterHealth(status="error", detail="Adapter config was not prepared")
        return self.last_health

    async def unload(self) -> None:
        self.config = None
        self.model_dir = None
        self.model = None
        self.tokenizer = None
        self.sessions.clear()
        self.last_health = AdapterHealth(status="not_loaded", detail="Transformers VITS TTS runtime is not loaded")

    async def start_session(self, session_config: SessionConfig) -> None:
        self.sessions.add(session_config.session_id)

    async def process_audio_file_or_chunk(self, turn: AudioTurn) -> AdapterResult:
        if self.last_health.status != "ready":
            raise AdapterError("model_not_ready", "Transformers VITS TTS adapter is not ready", {"status": self.last_health.status, "detail": self.last_health.detail})
        return await asyncio.to_thread(self._generate_sync, turn)

    async def interrupt(self, session_id: str) -> None:
        return None

    async def close(self, session_id: str) -> None:
        self.sessions.discard(session_id)

    def _generate_sync(self, turn: AudioTurn) -> AdapterResult:
        if self.config is None or self.model is None or self.tokenizer is None:
            raise AdapterError("model_not_ready", "Transformers VITS TTS adapter is not ready")
        text = str(turn.options.get("text") or turn.persona_prompt or "").strip()
        if not text:
            raise AdapterError("empty_tts_text", "TTS text is empty")
        text = text.lower()
        voice = str(turn.options.get("voice") or self.config.voices[0].id)
        speaker_map = self.config.config.get("speaker_map", {})
        speaker_id = int(speaker_map.get(voice, speaker_map.get("speaker-0", 0)))
        device = str(self.config.config.get("device", "cpu"))

        timer = Timer()
        event_log = EventLog()
        event_log.add("adapter.started", "Transformers VITS TTS turn started", session_id=turn.session_id, turn_id=turn.turn_id, voice=voice)
        try:
            inputs = self.tokenizer(text, return_tensors="pt")
            inputs = {key: value.to(device) for key, value in inputs.items()}
            with self._torch.no_grad():
                output = self.model(**inputs, speaker_id=speaker_id).waveform.detach().cpu().numpy()[0]
        except Exception as exc:
            raise AdapterError("model_runtime_error", "Transformers VITS TTS generation failed", {"error": f"{type(exc).__name__}: {exc}"}) from exc

        sampling_rate = int(getattr(self.model.config, "sampling_rate", self.config.output_sample_rate))
        _write_float_wav(turn.output_path, output, sampling_rate)
        event_log.add("adapter.completed", "Transformers VITS TTS turn completed", output=str(turn.output_path))
        return AdapterResult(
            text=text,
            output_path=turn.output_path,
            events=event_log.as_list(),
            metrics={"adapter_ms": timer.elapsed_ms(), "output_sample_rate": sampling_rate, "speaker_id": speaker_id},
        )


def _write_float_wav(path: Path, samples, sample_rate: int) -> None:
    import numpy as np

    path.parent.mkdir(parents=True, exist_ok=True)
    samples = np.asarray(samples, dtype=np.float32)
    samples = np.clip(samples, -1.0, 1.0)
    pcm = (samples * 32767.0).astype(np.int16)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(pcm.tobytes())
