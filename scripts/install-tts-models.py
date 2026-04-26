#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from app.tts_assets import TtsAsset, TtsAssetManifest  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Install declared local TTS model assets.")
    parser.add_argument("--all", action="store_true", help="Install every model from backend/app/tts-assets.yaml.")
    parser.add_argument("--models", nargs="+", help="Install only these model ids.")
    parser.add_argument("--force", action="store_true", help="Re-download/re-extract even when files already exist.")
    parser.add_argument("--dry-run", action="store_true", help="Print planned work without downloading.")
    args = parser.parse_args()

    if not args.all and not args.models:
        parser.error("Pass --all or --models <model-id> [...]")

    manifest = TtsAssetManifest.load_default()
    selected = manifest.selected(None if args.all else args.models)

    for model in selected:
        print(f"==> {model.model_id}")
        install_dir = model.resolved_install_dir()
        install_dir.mkdir(parents=True, exist_ok=True)
        for asset in model.assets:
            install_asset(asset, install_dir, force=args.force, dry_run=args.dry_run)
    return 0


def install_asset(asset: TtsAsset, install_dir: Path, *, force: bool, dry_run: bool) -> None:
    destination = install_dir / asset.path
    if asset.archive_root and (install_dir / asset.archive_root).exists() and not force:
        print(f"    ok extracted {install_dir / asset.archive_root}")
        return
    if destination.exists() and not force and _valid_size(destination, asset):
        print(f"    ok {destination}")
    else:
        print(f"    download {asset.hf_file or asset.url} -> {destination}")
        if dry_run:
            return
        destination.parent.mkdir(parents=True, exist_ok=True)
        if asset.hf_repo and asset.hf_file:
            download_hf_file(asset, destination)
        elif asset.url:
            download_url(asset.url, destination)
        else:
            raise ValueError(f"Asset has neither hf_repo/hf_file nor url: {asset.path}")
        verify_asset(destination, asset)

    if asset.archive_root:
        print(f"    extract {destination.name}")
        if not dry_run:
            with zipfile.ZipFile(destination) as archive:
                archive.extractall(install_dir)
            verify_archive_root(install_dir / asset.archive_root)


def download_hf_file(asset: TtsAsset, destination: Path) -> None:
    try:
        from huggingface_hub import hf_hub_download
    except Exception as exc:
        raise RuntimeError("huggingface_hub is required. Run from backend with: uv run --extra tts python ../scripts/install-tts-models.py ...") from exc
    with tempfile.TemporaryDirectory() as tmp:
        downloaded = Path(hf_hub_download(asset.hf_repo or "", asset.hf_file or "", cache_dir=tmp))
        shutil.copyfile(downloaded, destination)


def download_url(url: str, destination: Path) -> None:
    tmp_path = destination.with_suffix(destination.suffix + ".tmp")
    try:
        with urllib.request.urlopen(url, timeout=60) as response, tmp_path.open("wb") as handle:
            shutil.copyfileobj(response, handle)
        tmp_path.replace(destination)
    finally:
        if tmp_path.exists():
            tmp_path.unlink()


def verify_asset(path: Path, asset: TtsAsset) -> None:
    if not path.exists():
        raise RuntimeError(f"Download did not create {path}")
    if not _valid_size(path, asset):
        raise RuntimeError(f"Unexpected size for {path}: got {path.stat().st_size}, expected {asset.size_bytes}")
    if asset.sha256 and _digest(path, "sha256") != asset.sha256:
        raise RuntimeError(f"SHA-256 mismatch for {path}")
    if asset.md5 and _digest(path, "md5") != asset.md5:
        raise RuntimeError(f"MD5 mismatch for {path}")


def verify_archive_root(path: Path) -> None:
    required = ["model.onnx", "dictionary", "config.json"]
    missing = [name for name in required if not (path / name).exists()]
    if missing:
        raise RuntimeError(f"Extracted archive is missing {', '.join(missing)} in {path}")


def _valid_size(path: Path, asset: TtsAsset) -> bool:
    return asset.size_bytes is None or path.stat().st_size == asset.size_bytes


def _digest(path: Path, algorithm: str) -> str:
    digest = hashlib.new(algorithm)
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
