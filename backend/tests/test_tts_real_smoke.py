import os
from pathlib import Path

import pytest

from app.adapters import ADAPTER_REGISTRY
from app.adapters.base import AudioTurn, SessionConfig
from app.main import state
from app.sessions import new_id


pytestmark = pytest.mark.skipif(
    os.getenv("VOICE_S2S_RUN_REAL_TTS_TEST", "false").lower() not in {"1", "true", "yes", "on"},
    reason="Set VOICE_S2S_RUN_REAL_TTS_TEST=true after running scripts/install-tts-models.py to run real local TTS smoke tests.",
)


@pytest.mark.asyncio
@pytest.mark.parametrize("model_id", ["vosk-tts-ru-0-8-multi", "vosk-tts-ru-0-9-multi"])
async def test_enabled_vosk_real_tts_load_and_generate_all_voices(model_id: str, tmp_path: Path) -> None:
    entry = state.catalog.get(model_id)
    adapter = ADAPTER_REGISTRY[entry.adapter]()

    health = await adapter.prepare(entry)
    assert health.status == "ready", health.detail

    for voice in entry.voices:
        session_id = new_id("real_tts_sess")
        turn_id = new_id("real_tts_turn")
        output_path = tmp_path / f"{model_id}-{voice.id}.wav"

        await adapter.start_session(SessionConfig(session_id=session_id, persona_prompt=""))
        result = await adapter.process_audio_file_or_chunk(
            AudioTurn(
                session_id=session_id,
                turn_id=turn_id,
                input_path=tmp_path / "input.txt",
                output_path=output_path,
                mime_type="text/plain",
                persona_prompt="",
                options={"text": "привет. это проверка локальной русской озвучки.", "voice": voice.id},
            )
        )

        assert result.output_path == output_path
        assert output_path.exists()
        assert output_path.read_bytes().startswith(b"RIFF")
        assert output_path.stat().st_size > 44
        assert result.metrics["speaker_id"] == entry.config["speaker_map"][voice.id]
