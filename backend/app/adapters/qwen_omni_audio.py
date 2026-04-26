from __future__ import annotations

import asyncio
import importlib
import os
import threading
from typing import Any

from app.adapters.base import AdapterError, AdapterHealth, AdapterResult, AudioTurn, SessionConfig
from app.catalog import ModelCatalogEntry
from app.events import EventLog, Timer

QWEN_AUDIO_SYSTEM_PROMPT = (
    "You are Qwen, a virtual human developed by the Qwen Team, Alibaba Group, "
    "capable of perceiving auditory and visual inputs, as well as generating text and speech."
)

QWEN_PERSONA_PREFIX = (
    "Conversation policy for this call. Follow these style instructions as closely as possible "
    "while keeping speech output enabled:\n"
)
QWEN_USE_AUDIO_IN_VIDEO = False


class QwenOmniAudioAdapter:
    def __init__(self) -> None:
        self.config: ModelCatalogEntry | None = None
        self.processor: Any | None = None
        self.model: Any | None = None
        self.torch: Any | None = None
        self.soundfile: Any | None = None
        self.process_mm_info: Any | None = None
        self.device: str = "cpu"
        self.dtype: Any | None = None
        self.sessions: dict[str, SessionConfig] = {}
        self.last_health = AdapterHealth(status="not_installed", detail="Adapter has not been prepared")
        self._warmup_lock = threading.Lock()
        self._inference_lock = threading.Lock()

    async def prepare(self, config: ModelCatalogEntry) -> AdapterHealth:
        self.config = config
        if not _real_model_enabled():
            self.last_health = AdapterHealth(
                status="not_installed",
                detail="Set VOICE_S2S_ENABLE_REAL_MODEL=true and install backend[qwen] to load Qwen Omni runtime.",
            )
            return self.last_health
        return await self.warmup()

    async def warmup(self) -> AdapterHealth:
        if self.config is None:
            self.last_health = AdapterHealth(status="error", detail="Adapter config was not prepared")
            return self.last_health
        if not _real_model_enabled():
            self.last_health = AdapterHealth(
                status="not_installed",
                detail="Real model loading is disabled by VOICE_S2S_ENABLE_REAL_MODEL=false.",
            )
            return self.last_health
        return await asyncio.to_thread(self._warmup_sync)

    async def unload(self) -> None:
        await asyncio.to_thread(self._unload_sync)

    def _unload_sync(self) -> None:
        with self._warmup_lock:
            self.sessions.clear()
            self.processor = None
            self.model = None
            self.soundfile = None
            self.process_mm_info = None
            torch_module = self.torch
            self.torch = None
            self.dtype = None
            self.device = "cpu"
            self.last_health = AdapterHealth(status="not_loaded", detail="Qwen Omni runtime is not loaded")
            if torch_module is not None and hasattr(torch_module, "cuda") and torch_module.cuda.is_available():
                torch_module.cuda.empty_cache()
            if torch_module is not None and hasattr(torch_module, "mps") and hasattr(torch_module.mps, "empty_cache"):
                torch_module.mps.empty_cache()

    def _warmup_sync(self) -> AdapterHealth:
        assert self.config is not None
        with self._warmup_lock:
            if self.model is not None and self.processor is not None:
                return self.last_health
            try:
                self.torch = importlib.import_module("torch")
                self.soundfile = importlib.import_module("soundfile")
                transformers = importlib.import_module("transformers")
                self.process_mm_info = getattr(importlib.import_module("qwen_omni_utils"), "process_mm_info")
            except Exception as exc:
                self.last_health = AdapterHealth(status="not_installed", detail=f"Missing runtime dependency: {exc}")
                return self.last_health

            try:
                os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
                os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", "1800")
                os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
                device = self._resolve_device()
                dtype = self._resolve_dtype(device)
                model_cls = getattr(transformers, "Qwen2_5OmniForConditionalGeneration")
                processor_cls = getattr(transformers, "Qwen2_5OmniProcessor")
                processor = processor_cls.from_pretrained(self.config.hf_repo)
                model = model_cls.from_pretrained(
                    self.config.hf_repo,
                    torch_dtype=dtype,
                    low_cpu_mem_usage=True,
                ).eval()
                if device != "cpu":
                    model = model.to(device)
                self.device = device
                self.dtype = dtype
                self.processor = processor
                self.model = model
            except Exception as exc:
                self.last_health = AdapterHealth(status="error", detail=f"Model load failed: {type(exc).__name__}: {exc}")
                return self.last_health

            self.last_health = AdapterHealth(
                status="ready",
                detail=f"Qwen2.5-Omni-3B loaded on {self.device} with speaker {self._default_speaker()}",
            )
            return self.last_health

    async def start_session(self, session_config: SessionConfig) -> None:
        self.sessions[session_config.session_id] = session_config

    async def process_audio_file_or_chunk(self, turn: AudioTurn) -> AdapterResult:
        if self.last_health.status != "ready":
            raise AdapterError(
                "model_not_ready",
                "Qwen Omni adapter is not ready",
                {"status": self.last_health.status, "detail": self.last_health.detail},
            )
        return await asyncio.to_thread(self._generate_sync, turn)

    def _generate_sync(self, turn: AudioTurn) -> AdapterResult:
        assert self.config and self.processor and self.model and self.torch and self.soundfile and self.process_mm_info
        timer = Timer()
        event_log = EventLog()
        event_log.add("adapter.started", "Qwen Omni turn started", session_id=turn.session_id, turn_id=turn.turn_id)

        try:
            with self._inference_lock:
                conversation = self._build_conversation(turn)
                prompt_text = self.processor.apply_chat_template(conversation, add_generation_prompt=True, tokenize=False)
                audios, images, videos = self.process_mm_info(conversation, use_audio_in_video=QWEN_USE_AUDIO_IN_VIDEO)
                inputs = self.processor(
                    text=prompt_text,
                    audio=audios,
                    images=images,
                    videos=videos,
                    return_tensors="pt",
                    padding=True,
                    use_audio_in_video=QWEN_USE_AUDIO_IN_VIDEO,
                )
                inputs = {key: value.to(self.device) if hasattr(value, "to") else value for key, value in inputs.items()}
                with self.torch.inference_mode():
                    text_ids, audio = self.model.generate(
                        **inputs,
                        return_audio=True,
                        use_audio_in_video=QWEN_USE_AUDIO_IN_VIDEO,
                        speaker=str(turn.options.get("speaker", self._default_speaker())),
                        thinker_max_new_tokens=int(turn.options.get("thinker_max_new_tokens", self._thinker_max_new_tokens())),
                        talker_max_new_tokens=int(turn.options.get("talker_max_new_tokens", self._talker_max_new_tokens())),
                        talker_temperature=float(turn.options.get("talker_temperature", self._talker_temperature())),
                    )
                if audio is None:
                    raise AdapterError("no_audio_output", "Qwen Omni generated no audio output")
                waveform = audio.reshape(-1).detach().cpu().float().numpy()
                self.soundfile.write(str(turn.output_path), waveform, self.config.output_sample_rate)
                decoded = self.processor.batch_decode(
                    text_ids,
                    skip_special_tokens=True,
                    clean_up_tokenization_spaces=False,
                )
        except AdapterError:
            raise
        except Exception as exc:
            raise AdapterError("model_runtime_error", "Qwen Omni inference failed", {"error": f"{type(exc).__name__}: {exc}"}) from exc

        event_log.add("adapter.completed", "Qwen Omni turn completed", output=str(turn.output_path))
        warnings = ["Current lab transport is turn_based; model streaming is not exposed in this UI yet."]
        if turn.persona_prompt.strip():
            warnings.append("Qwen audio output requires a fixed system prompt; the editable persona is applied as a user instruction prefix.")
        return AdapterResult(
            text=self._extract_response_text(decoded[0]) if decoded else None,
            output_path=turn.output_path,
            events=event_log.as_list(),
            metrics={
                "adapter_ms": timer.elapsed_ms(),
                "input_sample_rate": self.config.input_sample_rate,
                "output_sample_rate": self.config.output_sample_rate,
                "device": self.device,
                "speaker": str(turn.options.get("speaker", self._default_speaker())),
            },
            warnings=warnings,
        )

    async def interrupt(self, session_id: str) -> None:
        return None

    async def close(self, session_id: str) -> None:
        self.sessions.pop(session_id, None)

    def _build_conversation(self, turn: AudioTurn) -> list[dict[str, Any]]:
        persona_prompt = turn.persona_prompt.strip() or "Answer in Russian with one short practical spoken reply."
        return [
            {
                "role": "system",
                "content": [{"type": "text", "text": QWEN_AUDIO_SYSTEM_PROMPT}],
            },
            {
                "role": "user",
                "content": [
                    {"type": "audio", "audio": str(turn.input_path)},
                    {"type": "text", "text": f"{QWEN_PERSONA_PREFIX}{persona_prompt}"},
                ],
            },
        ]

    def _resolve_device(self) -> str:
        assert self.config and self.torch
        configured = str(self.config.config.get("device", "auto"))
        if configured != "auto":
            return configured
        if self.torch.cuda.is_available():
            return "cuda"
        if hasattr(self.torch.backends, "mps") and self.torch.backends.mps.is_available():
            return "mps"
        return "cpu"

    def _resolve_dtype(self, device: str):
        assert self.config and self.torch
        configured = str(self.config.config.get("dtype", "auto"))
        if configured == "bfloat16":
            return self.torch.bfloat16
        if configured == "float16":
            return self.torch.float16
        if configured == "float32":
            return self.torch.float32
        if device == "cuda":
            return self.torch.bfloat16
        if device == "mps":
            return self.torch.float16
        return self.torch.float32

    def _default_speaker(self) -> str:
        assert self.config
        return str(self.config.config.get("speaker", "Chelsie"))

    def _thinker_max_new_tokens(self) -> int:
        assert self.config
        return int(self.config.config.get("thinker_max_new_tokens", 256))

    def _talker_max_new_tokens(self) -> int:
        assert self.config
        return int(self.config.config.get("talker_max_new_tokens", 1024))

    def _talker_temperature(self) -> float:
        assert self.config
        return float(self.config.config.get("talker_temperature", 0.6))

    def _extract_response_text(self, decoded_text: str) -> str:
        candidate = decoded_text.strip()
        if "\nassistant\n" in candidate:
            candidate = candidate.rsplit("\nassistant\n", 1)[-1].strip()
        return candidate


def _real_model_enabled() -> bool:
    return os.getenv("VOICE_S2S_ENABLE_REAL_MODEL", "false").lower() in {"1", "true", "yes", "on"}
