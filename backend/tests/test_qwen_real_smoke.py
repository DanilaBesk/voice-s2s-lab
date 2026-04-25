import os
import shutil
import subprocess
from pathlib import Path

import pytest

from app.adapters.base import AudioTurn, SessionConfig
from app.main import DEFAULT_PERSONA_PROMPT, state
from app.sessions import new_id


pytestmark = pytest.mark.skipif(
    os.getenv("VOICE_S2S_RUN_REAL_MODEL_TEST", "false").lower() not in {"1", "true", "yes", "on"},
    reason="Set VOICE_S2S_RUN_REAL_MODEL_TEST=true to run the real Qwen Omni smoke test.",
)


def _real_speech_wav(tmp_path: Path) -> Path:
    configured = os.getenv("QWEN_TEST_AUDIO_PATH")
    if configured:
        path = Path(configured)
        if not path.exists():
            pytest.fail(f"QWEN_TEST_AUDIO_PATH does not exist: {path}")
        return path

    say = shutil.which("say")
    ffmpeg = shutil.which("ffmpeg")
    if not say or not ffmpeg:
        pytest.skip("Set QWEN_TEST_AUDIO_PATH to a real Russian speech WAV, or install macOS say and ffmpeg.")

    aiff_path = tmp_path / "qwen-question.aiff"
    wav_path = tmp_path / "qwen-question.wav"
    subprocess.run(
        [say, "-v", "Milena", "-o", str(aiff_path), "Алекс, дай один короткий практический совет по фокусировке во время работы."],
        check=True,
        timeout=30,
    )
    subprocess.run(
        [ffmpeg, "-y", "-i", str(aiff_path), "-ar", "16000", "-ac", "1", str(wav_path)],
        check=True,
        timeout=30,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return wav_path


@pytest.mark.asyncio
async def test_qwen_real_model_warmup_and_turn(tmp_path: Path) -> None:
    entry = state.catalog.get("qwen2-5-omni-3b")
    adapter = await state.adapter_for(entry)
    health = await adapter.warmup()
    assert health.status == "ready", health.detail

    session_id = new_id("real_sess")
    turn_id = new_id("real_turn")
    input_path = _real_speech_wav(tmp_path)
    output_path = tmp_path / "response.wav"

    await adapter.start_session(SessionConfig(session_id=session_id, persona_prompt=DEFAULT_PERSONA_PROMPT))
    result = await adapter.process_audio_file_or_chunk(
        AudioTurn(
            session_id=session_id,
            turn_id=turn_id,
            input_path=input_path,
            output_path=output_path,
            mime_type="audio/wav",
            persona_prompt=DEFAULT_PERSONA_PROMPT,
            options={
                "thinker_max_new_tokens": int(os.getenv("QWEN_TEST_THINKER_MAX_NEW_TOKENS", "8")),
                "talker_max_new_tokens": int(os.getenv("QWEN_TEST_TALKER_MAX_NEW_TOKENS", "24")),
            },
        )
    )

    assert result.output_path is not None
    assert result.output_path.exists()
    assert result.output_path.stat().st_size > 44
    assert result.metrics["adapter_ms"] > 0
