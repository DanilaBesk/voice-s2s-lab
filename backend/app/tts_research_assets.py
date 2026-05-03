from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from app.tts_assets import _resolve_repo_path


DEFAULT_RESEARCH_MANIFEST_PATH = Path(__file__).parent / "tts-research-assets.yaml"


@dataclass(frozen=True)
class ResearchUrlAsset:
    url: str
    path: str
    size_bytes: int | None = None


@dataclass(frozen=True)
class TtsResearchAsset:
    model_id: str
    install_dir: str
    source: str
    license: str | None
    runtime_status: str
    notes: str
    hf_repo: str | None = None
    allow_patterns: tuple[str, ...] = ()
    assets: tuple[ResearchUrlAsset, ...] = ()

    def resolved_install_dir(self) -> Path:
        return _resolve_repo_path(self.install_dir)

    def source_url(self) -> str | None:
        if self.hf_repo:
            return f"https://huggingface.co/{self.hf_repo}"
        if self.assets:
            return self.assets[0].url
        return None

    def public_dict(self) -> dict[str, Any]:
        install_dir = self.resolved_install_dir()
        issues = _integrity_issues(self, install_dir)
        status = "downloaded" if not issues else "incomplete" if install_dir.exists() else "missing"
        return {
            "id": self.model_id,
            "display_name": _display_name(self),
            "source": self.source,
            "source_url": self.source_url(),
            "hf_repo": self.hf_repo,
            "license": self.license,
            "runtime_status": self.runtime_status,
            "status": status,
            "status_detail": "; ".join(issues) if issues else None,
            "install_dir": self.install_dir,
            "local_size_bytes": _directory_size(install_dir) if install_dir.exists() else None,
            "notes": self.notes,
            "runnable": False,
        }


class TtsResearchManifest:
    def __init__(self, models: dict[str, TtsResearchAsset]) -> None:
        self.models = models

    @classmethod
    def load_default(cls) -> "TtsResearchManifest":
        return cls.load(DEFAULT_RESEARCH_MANIFEST_PATH)

    @classmethod
    def load(cls, path: Path) -> "TtsResearchManifest":
        with path.open("r", encoding="utf-8") as handle:
            payload = yaml.safe_load(handle) or {}
        models: dict[str, TtsResearchAsset] = {}
        for raw in payload.get("models", []):
            model_id = str(raw["id"])
            models[model_id] = TtsResearchAsset(
                model_id=model_id,
                install_dir=str(raw["install_dir"]),
                source=str(raw["source"]),
                license=raw.get("license"),
                runtime_status=str(raw.get("runtime_status", "download_only_no_adapter")),
                notes=str(raw.get("notes", "")),
                hf_repo=raw.get("hf_repo"),
                allow_patterns=tuple(str(pattern) for pattern in raw.get("allow_patterns", [])),
                assets=tuple(ResearchUrlAsset(**asset) for asset in raw.get("assets", [])),
            )
        return cls(models)

    def public_list(self) -> list[dict[str, Any]]:
        return [model.public_dict() for model in self.models.values()]


def _integrity_issues(model: TtsResearchAsset, install_dir: Path) -> list[str]:
    if not install_dir.exists():
        return [f"missing install dir {install_dir}"]
    incomplete = list(install_dir.rglob("*.incomplete")) + list(install_dir.rglob("*.lock"))
    issues = [f"incomplete download marker {path.relative_to(install_dir)}" for path in incomplete]
    if model.source == "huggingface":
        for pattern in model.allow_patterns:
            if not any(path.is_file() for path in install_dir.glob(pattern)):
                issues.append(f"missing {pattern}")
    if model.source == "url":
        for asset in model.assets:
            destination = install_dir / asset.path
            if not destination.exists():
                issues.append(f"missing {asset.path}")
            elif asset.size_bytes is not None and destination.stat().st_size != asset.size_bytes:
                issues.append(f"unexpected size {asset.path}")
    return issues


def _directory_size(path: Path) -> int:
    total = 0
    for item in path.rglob("*"):
        if item.is_file():
            total += item.stat().st_size
    return total


def _display_name(model: TtsResearchAsset) -> str:
    if model.hf_repo:
        return model.hf_repo.split("/", 1)[1]
    return model.model_id.replace("-", " ").title()
