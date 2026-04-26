from pathlib import Path
import subprocess
import sys

import pytest
from fastapi.testclient import TestClient

from app.adapters import ADAPTER_REGISTRY
from app.adapters.base import AudioTurn, SessionConfig
from app.catalog import ModelCatalog
from app.main import app
from app.tts_assets import TtsAssetManifest


MODELS_DIR = Path(__file__).parents[1] / "app" / "models"
REPO_ROOT = Path(__file__).parents[2]
client = TestClient(app)


def test_catalog_exposes_russian_tts_entries_with_voice_metadata() -> None:
    catalog = ModelCatalog(MODELS_DIR)

    denis = catalog.get("piper-ru-ru-denis-medium")
    dmitri = catalog.get("piper-ru-ru-dmitri-medium")
    vits_low = catalog.get("utrobin-vits-low-ru-multispeaker")
    vits_high = catalog.get("utrobin-vits-high-ru-multispeaker")
    vosk_multi = catalog.get("vosk-tts-ru-0-9-multi")

    assert denis.type == "text_to_audio"
    assert denis.capabilities == ["text_to_audio", "tts"]
    assert denis.voices[0].id == "ru_RU-denis-medium"
    assert denis.voices[0].language == "ru-RU"
    assert denis.voices[0].gender == "male"

    assert dmitri.type == "text_to_audio"
    assert dmitri.capabilities == ["text_to_audio", "tts"]
    assert dmitri.voices[0].id == "ru_RU-dmitri-medium"
    assert dmitri.voices[0].language == "ru-RU"

    assert {voice.id: voice.gender for voice in vits_low.voices} == {"speaker-0": "female", "speaker-1": "male"}
    assert vits_low.adapter == "transformers_vits_tts"
    assert vits_low.tier == "around-100mb"

    assert {voice.id: voice.gender for voice in vits_high.voices} == {"speaker-0": "female", "speaker-1": "male"}
    assert vits_high.adapter == "transformers_vits_tts"
    assert vits_high.tier == "around-250mb"

    assert {voice.gender for voice in vosk_multi.voices} == {"female", "male"}
    assert vosk_multi.adapter == "vosk_tts"
    assert vosk_multi.tier == "around-1gb"


def test_catalog_enabled_tts_entries_are_runnable_and_installable() -> None:
    catalog = ModelCatalog(MODELS_DIR)
    manifest = TtsAssetManifest.load_default()

    enabled_tts = [entry for entry in catalog.list() if entry.type == "text_to_audio"]
    assert enabled_tts

    for entry in enabled_tts:
        public = entry.public_dict()

        assert entry.adapter in {"piper_tts", "transformers_vits_tts", "vosk_tts"}
        assert entry.availability in {"available", "closest_below_requested_tier"}
        assert entry.license in {"MIT", "Apache-2.0"}
        assert manifest.has_model(entry.id)
        assert "Catalog-only" not in entry.install_notes
        assert entry.size_bytes is not None
        assert public["availability"] == entry.availability
        assert public["license"] == entry.license
        assert public["size_bytes"] == entry.size_bytes
        assert "config" not in public

    assert "catalog_only_tts" not in {entry.adapter for entry in catalog.list()}


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
    assert "transformers_vits_tts" in ADAPTER_REGISTRY
    assert "vosk_tts" in ADAPTER_REGISTRY
    assert "synthetic_tts" in ADAPTER_REGISTRY


def test_models_endpoint_includes_enabled_russian_tts_entries() -> None:
    before_adapters = dict(app.state.adapters) if hasattr(app, "state") and hasattr(app.state, "adapters") else None
    response = client.get("/api/models")

    assert response.status_code == 200
    model_ids = {model["id"] for model in response.json()["models"]}
    assert "piper-ru-ru-denis-medium" in model_ids
    assert "piper-ru-ru-dmitri-medium" in model_ids
    assert "piper-ru-ru-irina-medium" not in model_ids
    assert "utrobin-vits-low-ru-multispeaker" in model_ids
    assert "utrobin-vits-high-ru-multispeaker" in model_ids
    assert "vosk-tts-ru-0-9-multi" in model_ids
    assert "silero-ru-v5-5" not in model_ids
    assert "f5-tts-russian-voice-clone" not in model_ids
    assert "synthetic-local-tts" not in model_ids
    if before_adapters is not None:
        assert app.state.adapters == before_adapters


def test_tts_installer_declares_selected_model_without_downloading() -> None:
    result = subprocess.run(
        [
            sys.executable,
            str(REPO_ROOT / "scripts" / "install-tts-models.py"),
            "--models",
            "utrobin-vits-low-ru-multispeaker",
            "--dry-run",
        ],
        cwd=REPO_ROOT / "backend",
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0
    assert "utrobin-vits-low-ru-multispeaker" in result.stdout
    assert "model.safetensors" in result.stdout


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
async def test_transformers_vits_adapter_reports_missing_local_snapshot(tmp_path: Path) -> None:
    catalog = ModelCatalog(MODELS_DIR)
    entry = catalog.get("utrobin-vits-low-ru-multispeaker").model_copy(
        deep=True,
        update={"config": {"model_dir": str(tmp_path / "missing-vits"), "speaker_map": {"speaker-0": 0}}},
    )

    adapter = ADAPTER_REGISTRY["transformers_vits_tts"]()
    health = await adapter.prepare(entry)

    assert health.status == "not_installed"
    assert "install-tts-models" in (health.detail or "")


@pytest.mark.asyncio
async def test_vosk_adapter_reports_missing_local_model_dir(tmp_path: Path) -> None:
    catalog = ModelCatalog(MODELS_DIR)
    entry = catalog.get("vosk-tts-ru-0-9-multi").model_copy(
        deep=True,
        update={"config": {"model_path": str(tmp_path / "missing-vosk")}},
    )

    adapter = ADAPTER_REGISTRY["vosk_tts"]()
    health = await adapter.prepare(entry)

    assert health.status == "not_installed"
    assert "install-tts-models" in (health.detail or "")


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
