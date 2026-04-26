from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.adapters import ADAPTER_REGISTRY
from app.adapters.base import AudioTurn, SessionConfig
from app.catalog import ModelCatalog
from app.main import app


MODELS_DIR = Path(__file__).parents[1] / "app" / "models"
client = TestClient(app)


def test_catalog_exposes_russian_tts_entries_with_voice_metadata() -> None:
    catalog = ModelCatalog(MODELS_DIR)

    denis = catalog.get("piper-ru-ru-denis-medium")
    dmitri = catalog.get("piper-ru-ru-dmitri-medium")

    assert denis.type == "text_to_audio"
    assert denis.capabilities == ["text_to_audio", "tts"]
    assert denis.voices[0].id == "ru_RU-denis-medium"
    assert denis.voices[0].language == "ru-RU"
    assert denis.voices[0].gender == "male"

    assert dmitri.type == "text_to_audio"
    assert dmitri.capabilities == ["text_to_audio", "tts"]
    assert dmitri.voices[0].id == "ru_RU-dmitri-medium"
    assert dmitri.voices[0].language == "ru-RU"


def test_catalog_preserves_legacy_audio_schema_defaults() -> None:
    catalog = ModelCatalog(MODELS_DIR)
    qwen = catalog.get("qwen2-5-omni-3b")

    assert qwen.type == "audio_to_audio"
    assert qwen.capabilities == ["audio_to_audio"]
    assert qwen.voices == []

    public = qwen.public_dict()
    assert public["capabilities"] == ["audio_to_audio"]
    assert public["voices"] == []
    assert "config" not in public


def test_adapter_registry_resolves_tts_adapters() -> None:
    assert "piper_tts" in ADAPTER_REGISTRY
    assert "synthetic_tts" in ADAPTER_REGISTRY


def test_models_endpoint_includes_enabled_russian_tts_entries() -> None:
    response = client.get("/api/models")

    assert response.status_code == 200
    model_ids = {model["id"] for model in response.json()["models"]}
    assert "piper-ru-ru-denis-medium" in model_ids
    assert "piper-ru-ru-dmitri-medium" in model_ids
    assert "synthetic-local-tts" not in model_ids


@pytest.mark.asyncio
async def test_piper_adapter_reports_not_installed_when_model_files_are_missing(tmp_path: Path) -> None:
    catalog = ModelCatalog(MODELS_DIR)
    entry = catalog.get("piper-ru-ru-denis-medium").model_copy(
        deep=True,
        update={
            "config": {
                "model_path": str(tmp_path / "missing.onnx"),
                "config_path": str(tmp_path / "missing.onnx.json"),
            }
        },
    )

    adapter = ADAPTER_REGISTRY["piper_tts"]()
    health = await adapter.prepare(entry)

    assert health.status == "not_installed"
    assert "model file is missing" in (health.detail or "").lower()


@pytest.mark.asyncio
async def test_piper_adapter_reports_not_installed_when_runtime_is_missing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    catalog = ModelCatalog(MODELS_DIR)
    entry = catalog.get("piper-ru-ru-denis-medium").model_copy(
        deep=True,
        update={
            "config": {
                "model_path": str(tmp_path / "voice.onnx"),
                "config_path": str(tmp_path / "voice.onnx.json"),
            }
        },
    )
    Path(entry.config["model_path"]).write_bytes(b"fake model")
    Path(entry.config["config_path"]).write_text("{}", encoding="utf-8")
    monkeypatch.setenv("PATH", str(tmp_path / "no-piper-bin"))

    adapter = ADAPTER_REGISTRY["piper_tts"]()
    health = await adapter.prepare(entry)

    assert health.status == "not_installed"
    assert "piper" in (health.detail or "").lower()


@pytest.mark.asyncio
async def test_synthetic_tts_adapter_writes_wav_without_model_weights(tmp_path: Path) -> None:
    catalog = ModelCatalog(MODELS_DIR)
    entry = catalog.get("synthetic-local-tts")
    adapter = ADAPTER_REGISTRY["synthetic_tts"]()

    health = await adapter.prepare(entry)
    assert health.status == "ready"
    await adapter.start_session(SessionConfig(session_id="sess_tts", persona_prompt="Скажи привет"))
    result = await adapter.process_audio_file_or_chunk(
        AudioTurn(
            session_id="sess_tts",
            turn_id="turn_tts",
            input_path=tmp_path / "ignored.txt",
            output_path=tmp_path / "speech.wav",
            mime_type="text/plain",
            persona_prompt="Скажи привет",
            options={"text": "Привет"},
        )
    )

    assert result.output_path == tmp_path / "speech.wav"
    assert result.output_path.exists()
    assert result.output_path.read_bytes().startswith(b"RIFF")
    assert result.text == "Привет"
