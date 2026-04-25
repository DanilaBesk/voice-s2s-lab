from app.adapters.base import AudioAdapter
from app.adapters.mock_audio import MockAudioAdapter
from app.adapters.qwen_omni_audio import QwenOmniAudioAdapter

ADAPTER_REGISTRY: dict[str, type[AudioAdapter]] = {
    "mock_audio": MockAudioAdapter,
    "qwen_omni_audio": QwenOmniAudioAdapter,
}

__all__ = ["ADAPTER_REGISTRY"]
