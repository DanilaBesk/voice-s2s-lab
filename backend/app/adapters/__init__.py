from app.adapters.base import AudioAdapter
from app.adapters.mock_audio import MockAudioAdapter
from app.adapters.piper_tts import PiperTtsAdapter
from app.adapters.qwen_omni_audio import QwenOmniAudioAdapter
from app.adapters.silero_tts import SileroTtsAdapter
from app.adapters.synthetic_tts import SyntheticTtsAdapter
from app.adapters.transformers_vits_tts import TransformersVitsTtsAdapter
from app.adapters.vosk_tts import VoskTtsAdapter

ADAPTER_REGISTRY: dict[str, type[AudioAdapter]] = {
    "mock_audio": MockAudioAdapter,
    "piper_tts": PiperTtsAdapter,
    "qwen_omni_audio": QwenOmniAudioAdapter,
    "silero_tts": SileroTtsAdapter,
    "synthetic_tts": SyntheticTtsAdapter,
    "transformers_vits_tts": TransformersVitsTtsAdapter,
    "vosk_tts": VoskTtsAdapter,
}

__all__ = ["ADAPTER_REGISTRY"]
