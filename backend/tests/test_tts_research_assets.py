from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import yaml


REPO_ROOT = Path(__file__).parents[2]
MANIFEST = REPO_ROOT / "backend" / "app" / "tts-research-assets.yaml"


def test_research_manifest_excludes_removed_qwen3_1_7b_asset() -> None:
    payload = yaml.safe_load(MANIFEST.read_text(encoding="utf-8"))
    model_ids = {model["id"] for model in payload["models"]}
    manifest_text = MANIFEST.read_text(encoding="utf-8")

    assert "qwen3-tts-0-6b-base" in model_ids
    assert "qwen3-tts-1-7b-base" not in model_ids
    assert "Qwen3-TTS-12Hz-1.7B-Base" not in manifest_text


def test_research_installer_declares_download_only_assets_without_downloading() -> None:
    result = subprocess.run(
        [
            sys.executable,
            str(REPO_ROOT / "scripts" / "install-tts-research-models.py"),
            "--models",
            "qwen3-tts-0-6b-base",
            "--dry-run",
        ],
        cwd=REPO_ROOT / "backend",
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0
    assert "qwen3-tts-0-6b-base" in result.stdout
    assert "Qwen/Qwen3-TTS-12Hz-0.6B-Base" in result.stdout
    assert "Qwen3-TTS-12Hz-1.7B-Base" not in result.stdout
