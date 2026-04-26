from app.adapters.base import AudioAdapter
from app.adapters.catalog_only_tts import CatalogOnlyTtsAdapter
from app.adapters.mock_audio import MockAudioAdapter
from app.adapters.piper_tts import PiperTtsAdapter
from app.adapters.qwen_omni_audio import QwenOmniAudioAdapter
from app.adapters.synthetic_tts import SyntheticTtsAdapter

ADAPTER_REGISTRY: dict[str, type[AudioAdapter]] = {
    "mock_audio": MockAudioAdapter,
    "catalog_only_tts": CatalogOnlyTtsAdapter,
    "piper_tts": PiperTtsAdapter,
    "qwen_omni_audio": QwenOmniAudioAdapter,
    "synthetic_tts": SyntheticTtsAdapter,
}

__all__ = ["ADAPTER_REGISTRY"]
