from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import yaml
from fastapi.testclient import TestClient

from app.main import app


REPO_ROOT = Path(__file__).parents[2]
MANIFEST = REPO_ROOT / "backend" / "app" / "tts-research-assets.yaml"
client = TestClient(app)


def test_research_manifest_excludes_runnable_qwen3_and_removed_1_7b_asset() -> None:
    payload = yaml.safe_load(MANIFEST.read_text(encoding="utf-8"))
    model_ids = {model["id"] for model in payload["models"]}
    manifest_text = MANIFEST.read_text(encoding="utf-8")

    assert "qwen3-tts-0-6b-base" not in model_ids
    assert "qwen3-tts-1-7b-base" not in model_ids
    assert "Qwen3-TTS-12Hz-1.7B-Base" not in manifest_text


def test_research_installer_declares_download_only_assets_without_downloading() -> None:
    result = subprocess.run(
        [
            sys.executable,
            str(REPO_ROOT / "scripts" / "install-tts-research-models.py"),
            "--models",
            "rhvoice-russian-core-and-voices",
            "--dry-run",
        ],
        cwd=REPO_ROOT / "backend",
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0
    assert "rhvoice-russian-core-and-voices" in result.stdout
    assert "RHVoice-Russian-main.zip" in result.stdout
    assert "f5-tts-russian-mlx-4bit" not in result.stdout
    assert "Qwen/Qwen3-TTS-12Hz-0.6B-Base" not in result.stdout
    assert "Qwen3-TTS-12Hz-1.7B-Base" not in result.stdout


def test_non_russian_kokoro_is_removed_from_research_manifest() -> None:
    payload = yaml.safe_load(MANIFEST.read_text(encoding="utf-8"))
    model_ids = {model["id"] for model in payload["models"]}

    assert "kokoro-82m" not in model_ids
    assert "hexgrad/Kokoro-82M" not in MANIFEST.read_text(encoding="utf-8")


def test_research_assets_endpoint_is_not_exposed_to_the_app() -> None:
    response = client.get("/api/tts-research-assets")

    assert response.status_code == 404
