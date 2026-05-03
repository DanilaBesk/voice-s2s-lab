from app.adapters.base import AudioAdapter
from app.adapters.f5_mlx_tts import F5MlxTtsAdapter
from app.adapters.mock_audio import MockAudioAdapter
from app.adapters.piper_tts import PiperTtsAdapter
from app.adapters.qwen_omni_audio import QwenOmniAudioAdapter
from app.adapters.qwen3_tts import Qwen3TtsAdapter
from app.adapters.rhvoice_tts import RHVoiceTtsAdapter
from app.adapters.silero_tts import SileroTtsAdapter
from app.adapters.synthetic_tts import SyntheticTtsAdapter
from app.adapters.transformers_vits_tts import TransformersVitsTtsAdapter
from app.adapters.vosk_tts import VoskTtsAdapter

ADAPTER_REGISTRY: dict[str, type[AudioAdapter]] = {
    "mock_audio": MockAudioAdapter,
    "f5_mlx_tts": F5MlxTtsAdapter,
    "piper_tts": PiperTtsAdapter,
    "qwen_omni_audio": QwenOmniAudioAdapter,
    "qwen3_tts": Qwen3TtsAdapter,
    "rhvoice_tts": RHVoiceTtsAdapter,
    "silero_tts": SileroTtsAdapter,
    "synthetic_tts": SyntheticTtsAdapter,
    "transformers_vits_tts": TransformersVitsTtsAdapter,
    "vosk_tts": VoskTtsAdapter,
}

__all__ = ["ADAPTER_REGISTRY"]
