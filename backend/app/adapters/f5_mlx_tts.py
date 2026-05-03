from __future__ import annotations

from io import BytesIO
import pkgutil
from pathlib import Path
from typing import Any
import wave

from app.adapters.base import AdapterError, AdapterHealth, AdapterResult, AudioTurn, SessionConfig
from app.catalog import ModelCatalogEntry
from app.events import EventLog, Timer
from app.tts_assets import _resolve_repo_path


SAMPLE_RATE = 24_000
HOP_LENGTH = 256
FRAMES_PER_SEC = SAMPLE_RATE / HOP_LENGTH
TARGET_RMS = 0.1
DEFAULT_REF_TEXT = "Some call me nature, others call me mother nature."


class F5MlxTtsAdapter:
    def __init__(self) -> None:
        self.config: ModelCatalogEntry | None = None
        self.model_dir: Path | None = None
        self.vocoder_model_dir: Path | None = None
        self.model = None
        self.sessions: set[str] = set()
        self.last_health = AdapterHealth(status="not_installed", detail="Adapter has not been prepared")
        self._mx = None
        self._convert_char_to_pinyin = None

    async def prepare(self, config: ModelCatalogEntry) -> AdapterHealth:
        self.config = config
        model_dir = _resolve_repo_path(str(config.config.get("model_dir", "")))
        vocoder_model_dir = _resolve_repo_path(str(config.config.get("vocoder_model_dir", "")))
        required_files = config.config.get("required_files") or ["model_4b.safetensors", "vocab.txt"]
        required_vocoder_files = config.config.get("required_vocoder_files") or ["config.yaml", "model.safetensors"]
        missing = [str(model_dir / name) for name in required_files if not (model_dir / name).exists()]
        missing.extend(str(vocoder_model_dir / name) for name in required_vocoder_files if not (vocoder_model_dir / name).exists())
        if missing:
            self.last_health = AdapterHealth(
                status="not_installed",
                detail=f"F5 MLX local snapshot is missing {', '.join(missing)}. Run scripts/install-tts-models.py --models {config.id}.",
            )
            return self.last_health

        try:
            import mlx.core as mx
            from f5_tts_mlx.utils import convert_char_to_pinyin
        except Exception as exc:
            self.last_health = AdapterHealth(
                status="not_installed",
                detail=f"F5 MLX dependencies are missing: {type(exc).__name__}: {exc}. Run uv sync --extra f5-mlx.",
            )
            return self.last_health

        try:
            self.model = _load_f5_mlx_model(
                model_dir=model_dir,
                model_file=str(config.config.get("model_file", "model_4b.safetensors")),
                vocoder_model_dir=vocoder_model_dir,
                quantization_bits=int(config.config.get("quantization_bits", 4)),
            )
        except Exception as exc:
            self.last_health = AdapterHealth(status="failed", detail=f"F5 MLX model failed to load from {model_dir}: {type(exc).__name__}: {exc}")
            return self.last_health

        self.model_dir = model_dir
        self.vocoder_model_dir = vocoder_model_dir
        self._mx = mx
        self._convert_char_to_pinyin = convert_char_to_pinyin
        self.last_health = AdapterHealth(status="ready", detail=f"F5 MLX snapshot is ready: {model_dir.name}")
        return self.last_health

    async def warmup(self) -> AdapterHealth:
        if self.config is None:
            return AdapterHealth(status="error", detail="Adapter config was not prepared")
        return self.last_health

    async def unload(self) -> None:
        self.config = None
        self.model_dir = None
        self.vocoder_model_dir = None
        self.model = None
        self.sessions.clear()
        if self._mx is not None and hasattr(self._mx, "clear_cache"):
            try:
                self._mx.clear_cache()
            except Exception:
                pass
        elif self._mx is not None and hasattr(self._mx, "metal"):
            try:
                self._mx.metal.clear_cache()
            except Exception:
                pass
        self._mx = None
        self._convert_char_to_pinyin = None
        self.last_health = AdapterHealth(status="not_loaded", detail="F5 MLX TTS runtime is not loaded")

    async def start_session(self, session_config: SessionConfig) -> None:
        self.sessions.add(session_config.session_id)

    async def process_audio_file_or_chunk(self, turn: AudioTurn) -> AdapterResult:
        if self.last_health.status != "ready":
            raise AdapterError("model_not_ready", "F5 MLX TTS adapter is not ready", {"status": self.last_health.status, "detail": self.last_health.detail})
        return self._generate_sync(turn)

    async def interrupt(self, session_id: str) -> None:
        return None

    async def close(self, session_id: str) -> None:
        self.sessions.discard(session_id)

    def _generate_sync(self, turn: AudioTurn) -> AdapterResult:
        if self.config is None or self.model is None or self._mx is None or self._convert_char_to_pinyin is None:
            raise AdapterError("model_not_ready", "F5 MLX TTS adapter is not ready")
        import numpy as np

        text = str(turn.options.get("text") or turn.persona_prompt or "").strip()
        if not text:
            raise AdapterError("empty_tts_text", "TTS text is empty")

        ref_audio, ref_text = self._load_reference_audio(turn.options)
        duration_s = _duration_seconds(text, ref_text, self.config.config, turn.options)
        duration_frames = int(duration_s * FRAMES_PER_SEC)
        steps = int(turn.options.get("steps") or self.config.config.get("steps", 8))
        method = str(turn.options.get("method") or self.config.config.get("method", "rk4"))
        cfg_strength = float(turn.options.get("cfg_strength") or self.config.config.get("cfg_strength", 2.0))
        speed = float(turn.options.get("speed") or self.config.config.get("speed", 1.0))
        sway_sampling_coef = float(turn.options.get("sway_sampling_coef") or self.config.config.get("sway_sampling_coef", -1.0))
        seed = turn.options.get("seed", self.config.config.get("seed"))
        seed = int(seed) if seed is not None else None

        timer = Timer()
        event_log = EventLog()
        event_log.add("adapter.started", "F5 MLX TTS turn started", session_id=turn.session_id, turn_id=turn.turn_id)

        try:
            ref_audio_mx = self._mx.array(ref_audio)
            rms = self._mx.sqrt(self._mx.mean(self._mx.square(ref_audio_mx)))
            if float(rms.item()) < TARGET_RMS:
                ref_audio_mx = ref_audio_mx * TARGET_RMS / rms
            model_text = self._convert_char_to_pinyin([ref_text + " " + text])
            wave_out, _ = self.model.sample(
                self._mx.expand_dims(ref_audio_mx, axis=0),
                text=model_text,
                duration=duration_frames,
                steps=steps,
                method=method,
                speed=speed,
                cfg_strength=cfg_strength,
                sway_sampling_coef=sway_sampling_coef,
                seed=seed,
            )
            wave_out = wave_out[ref_audio_mx.shape[0] :]
            self._mx.eval(wave_out)
        except Exception as exc:
            raise AdapterError("model_runtime_error", "F5 MLX TTS generation failed", {"error": f"{type(exc).__name__}: {exc}"}) from exc

        _write_float_wav(turn.output_path, np.array(wave_out), SAMPLE_RATE)
        if not turn.output_path.exists():
            raise AdapterError("no_audio_output", "F5 MLX TTS completed without writing output audio")

        event_log.add("adapter.completed", "F5 MLX TTS turn completed", output=str(turn.output_path))
        return AdapterResult(
            text=text,
            output_path=turn.output_path,
            events=event_log.as_list(),
            metrics={"adapter_ms": timer.elapsed_ms(), "output_sample_rate": SAMPLE_RATE, "duration_s": duration_s, "steps": steps},
        )

    def _load_reference_audio(self, options: dict[str, Any]) -> tuple[np.ndarray, str]:
        if self.config is None:
            raise AdapterError("model_not_ready", "F5 MLX TTS adapter is not ready")
        import numpy as np

        ref_text = str(options.get("ref_text") or self.config.config.get("ref_text") or DEFAULT_REF_TEXT)
        ref_audio_path = options.get("ref_audio_path") or self.config.config.get("ref_audio_path")
        try:
            import soundfile as sf
        except Exception as exc:
            raise AdapterError("dependency_missing", "soundfile is required for F5 MLX reference audio", {"error": f"{type(exc).__name__}: {exc}"}) from exc

        try:
            if ref_audio_path:
                path = _resolve_repo_path(str(ref_audio_path))
                audio, sample_rate = sf.read(str(path), always_2d=False)
            else:
                data = pkgutil.get_data("f5_tts_mlx", "tests/test_en_1_ref_short.wav")
                if data is None:
                    raise FileNotFoundError("f5_tts_mlx default reference audio is unavailable")
                audio, sample_rate = sf.read(BytesIO(data), always_2d=False)
            if sample_rate != SAMPLE_RATE:
                raise ValueError(f"Reference audio must be {SAMPLE_RATE} Hz, got {sample_rate}")
            audio = np.asarray(audio, dtype=np.float32)
            if audio.ndim == 2:
                audio = audio.mean(axis=1)
            return audio, ref_text
        except AdapterError:
            raise
        except Exception as exc:
            raise AdapterError("reference_audio_error", "F5 MLX reference audio could not be loaded", {"error": f"{type(exc).__name__}: {exc}"}) from exc


def _load_f5_mlx_model(*, model_dir: Path, model_file: str, vocoder_model_dir: Path, quantization_bits: int):
    import mlx.core as mx
    import mlx.nn as nn
    from f5_tts_mlx.cfm import F5TTS
    from f5_tts_mlx.dit import DiT
    from vocos_mlx import Vocos

    vocab_path = model_dir / "vocab.txt"
    vocab = {value: index for index, value in enumerate(vocab_path.read_text(encoding="utf-8").split("\n"))}
    if not vocab:
        raise ValueError(f"Could not load vocab from {vocab_path}")

    vocos = Vocos.from_pretrained(str(vocoder_model_dir))
    f5tts = F5TTS(
        transformer=DiT(
            dim=1024,
            depth=22,
            heads=16,
            ff_mult=2,
            text_dim=512,
            conv_layers=4,
            text_num_embeds=len(vocab) - 1,
            text_mask_padding=True,
        ),
        vocab_char_map=vocab,
        vocoder=vocos.decode,
        duration_predictor=None,
    )
    nn.quantize(
        f5tts,
        bits=quantization_bits,
        class_predicate=lambda _path, module: isinstance(module, nn.Linear) and module.weight.shape[1] % 64 == 0,
    )
    weights = mx.load(str(model_dir / model_file), format="safetensors")
    f5tts.load_weights(list(weights.items()))
    mx.eval(f5tts.parameters())
    return f5tts


def _duration_seconds(text: str, ref_text: str, config: dict[str, Any], options: dict[str, Any]) -> float:
    if options.get("duration_s") is not None:
        return float(options["duration_s"])
    base = float(config.get("duration_s", 2.8))
    max_duration = float(config.get("max_duration_s", 8.0))
    speed = float(options.get("speed") or config.get("speed", 1.0))
    ref_units = max(len(ref_text.encode("utf-8")), 1)
    text_units = max(len(text.encode("utf-8")), 1)
    estimated = base + (base / ref_units * text_units / speed)
    return max(1.0, min(max_duration, estimated))


def _write_float_wav(path: Path, samples: Any, sample_rate: int) -> None:
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
