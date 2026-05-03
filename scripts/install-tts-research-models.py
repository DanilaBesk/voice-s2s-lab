#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import shutil
import sys
import tempfile
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "backend" / "app" / "tts-research-assets.yaml"


@dataclass(frozen=True)
class UrlAsset:
    url: str
    path: str
    size_bytes: int | None = None
    sha256: str | None = None


@dataclass(frozen=True)
class ResearchModel:
    model_id: str
    install_dir: str
    source: str
    hf_repo: str | None
    allow_patterns: tuple[str, ...]
    assets: tuple[UrlAsset, ...]
    notes: str

    def resolved_install_dir(self) -> Path:
        path = Path(self.install_dir).expanduser()
        return path if path.is_absolute() else ROOT / path


def main() -> int:
    parser = argparse.ArgumentParser(description="Install declared download-only TTS research model assets.")
    parser.add_argument("--all", action="store_true", help="Install every model from backend/app/tts-research-assets.yaml.")
    parser.add_argument("--models", nargs="+", help="Install only these research model ids.")
    parser.add_argument("--force", action="store_true", help="Re-download even when files already exist.")
    parser.add_argument("--dry-run", action="store_true", help="Print planned work without downloading.")
    parser.add_argument("--verify", action="store_true", help="Verify declared assets are present and complete without downloading.")
    args = parser.parse_args()

    if not args.all and not args.models:
        parser.error("Pass --all or --models <model-id> [...]")

    models = load_manifest()
    selected = list(models.values()) if args.all else [models[model_id] for model_id in args.models or []]
    for model in selected:
        if args.verify:
            verify_model(model)
        else:
            install_model(model, force=args.force, dry_run=args.dry_run)
    return 0


def load_manifest() -> dict[str, ResearchModel]:
    with MANIFEST.open("r", encoding="utf-8") as handle:
        payload: dict[str, Any] = yaml.safe_load(handle) or {}
    models: dict[str, ResearchModel] = {}
    for raw in payload.get("models", []):
        model_id = str(raw["id"])
        models[model_id] = ResearchModel(
            model_id=model_id,
            install_dir=str(raw["install_dir"]),
            source=str(raw["source"]),
            hf_repo=raw.get("hf_repo"),
            allow_patterns=tuple(str(pattern) for pattern in raw.get("allow_patterns", [])),
            assets=tuple(UrlAsset(**asset) for asset in raw.get("assets", [])),
            notes=str(raw.get("notes", "")),
        )
    return models


def install_model(model: ResearchModel, *, force: bool, dry_run: bool) -> None:
    install_dir = model.resolved_install_dir()
    print(f"==> {model.model_id}")
    print(f"    {model.notes}")
    if model.source == "huggingface":
        install_huggingface_snapshot(model, install_dir, force=force, dry_run=dry_run)
        return
    if model.source == "url":
        for asset in model.assets:
            install_url_asset(asset, install_dir, force=force, dry_run=dry_run)
        return
    raise ValueError(f"Unsupported research model source for {model.model_id}: {model.source}")


def verify_model(model: ResearchModel) -> None:
    install_dir = model.resolved_install_dir()
    print(f"==> {model.model_id}")
    if model.source == "huggingface":
        missing = []
        incomplete = list(install_dir.rglob("*.incomplete")) + list(install_dir.rglob("*.lock"))
        for pattern in model.allow_patterns:
            matches = [path for path in install_dir.glob(pattern) if path.is_file()]
            if not matches:
                missing.append(pattern)
        if missing or incomplete:
            for pattern in missing:
                print(f"    missing {pattern}")
            for path in incomplete:
                print(f"    incomplete {path}")
            raise RuntimeError(f"Research model is incomplete: {model.model_id}")
        print(f"    ok snapshot {install_dir}")
        return
    if model.source == "url":
        for asset in model.assets:
            destination = install_dir / asset.path
            if not destination.exists():
                raise RuntimeError(f"Missing research asset for {model.model_id}: {destination}")
            if not _valid_size(destination, asset):
                raise RuntimeError(f"Unexpected size for {destination}: got {destination.stat().st_size}, expected {asset.size_bytes}")
            if not _valid_sha256(destination, asset):
                raise RuntimeError(f"Unexpected sha256 for {destination}: got {_sha256(destination)}, expected {asset.sha256}")
            print(f"    ok {destination}")
        return
    raise ValueError(f"Unsupported research model source for {model.model_id}: {model.source}")


def install_huggingface_snapshot(model: ResearchModel, install_dir: Path, *, force: bool, dry_run: bool) -> None:
    if not model.hf_repo:
        raise ValueError(f"Hugging Face model is missing hf_repo: {model.model_id}")
    marker = install_dir / ".snapshot_complete"
    print(f"    snapshot {model.hf_repo} -> {install_dir}")
    for pattern in model.allow_patterns:
        print(f"      include {pattern}")
    if dry_run:
        return
    if marker.exists() and not force:
        print(f"    ok snapshot {install_dir}")
        return
    try:
        from huggingface_hub import snapshot_download
    except Exception as exc:
        raise RuntimeError("huggingface_hub is required. Run from backend with: uv run --extra tts python ../scripts/install-tts-research-models.py ...") from exc
    if force and install_dir.exists():
        shutil.rmtree(install_dir)
    install_dir.mkdir(parents=True, exist_ok=True)
    snapshot_download(
        repo_id=model.hf_repo,
        local_dir=install_dir,
        allow_patterns=list(model.allow_patterns) or None,
        local_dir_use_symlinks=False,
    )
    marker.write_text(model.hf_repo, encoding="utf-8")


def install_url_asset(asset: UrlAsset, install_dir: Path, *, force: bool, dry_run: bool) -> None:
    destination = install_dir / asset.path
    if destination.exists() and not force and _valid_size(destination, asset):
        print(f"    ok {destination}")
        return
    print(f"    download {asset.url} -> {destination}")
    if dry_run:
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    tmp = destination.with_suffix(destination.suffix + ".tmp")
    try:
        with urllib.request.urlopen(asset.url, timeout=180) as response, tmp.open("wb") as handle:
            shutil.copyfileobj(response, handle)
        tmp.replace(destination)
    finally:
        if tmp.exists():
            tmp.unlink()
    if not _valid_size(destination, asset):
        raise RuntimeError(f"Unexpected size for {destination}: got {destination.stat().st_size}, expected {asset.size_bytes}")
    if not _valid_sha256(destination, asset):
        raise RuntimeError(f"Unexpected sha256 for {destination}: got {_sha256(destination)}, expected {asset.sha256}")


def _valid_size(path: Path, asset: UrlAsset) -> bool:
    return asset.size_bytes is None or path.stat().st_size == asset.size_bytes


def _valid_sha256(path: Path, asset: UrlAsset) -> bool:
    return asset.sha256 is None or _sha256(path) == asset.sha256


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
