from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST_PATH = Path(__file__).parent / "tts-assets.yaml"


@dataclass(frozen=True)
class TtsAsset:
    path: str
    hf_repo: str | None = None
    hf_file: str | None = None
    url: str | None = None
    size_bytes: int | None = None
    sha256: str | None = None
    md5: str | None = None
    archive_root: str | None = None


@dataclass(frozen=True)
class TtsModelAssets:
    model_id: str
    install_dir: str
    assets: tuple[TtsAsset, ...]
    notes: str | None = None

    def resolved_install_dir(self) -> Path:
        return _resolve_repo_path(self.install_dir)


class TtsAssetManifest:
    def __init__(self, models: dict[str, TtsModelAssets]) -> None:
        self.models = models

    @classmethod
    def load_default(cls) -> "TtsAssetManifest":
        return cls.load(DEFAULT_MANIFEST_PATH)

    @classmethod
    def load(cls, path: Path) -> "TtsAssetManifest":
        with path.open("r", encoding="utf-8") as handle:
            payload = yaml.safe_load(handle) or {}
        models: dict[str, TtsModelAssets] = {}
        for raw in payload.get("models", []):
            model_id = str(raw["id"])
            assets = tuple(TtsAsset(**asset) for asset in raw.get("assets", []))
            models[model_id] = TtsModelAssets(
                model_id=model_id,
                install_dir=str(raw["install_dir"]),
                assets=assets,
                notes=raw.get("notes"),
            )
        return cls(models)

    def has_model(self, model_id: str) -> bool:
        return model_id in self.models

    def get(self, model_id: str) -> TtsModelAssets:
        try:
            return self.models[model_id]
        except KeyError as exc:
            raise KeyError(f"TTS model is not declared in asset manifest: {model_id}") from exc

    def selected(self, model_ids: list[str] | None = None) -> list[TtsModelAssets]:
        if not model_ids:
            return list(self.models.values())
        return [self.get(model_id) for model_id in model_ids]


def _resolve_repo_path(value: str) -> Path:
    path = Path(value).expanduser()
    if path.is_absolute():
        return path
    return REPO_ROOT / path


def required_local_files(model_id: str, config: dict[str, Any]) -> list[Path]:
    if config.get("model_dir"):
        model_dir = _resolve_repo_path(str(config["model_dir"]))
        return [model_dir / name for name in config.get("required_files", [])]
    if config.get("model_path"):
        files = [_resolve_repo_path(str(config["model_path"]))]
        if config.get("config_path"):
            files.append(_resolve_repo_path(str(config["config_path"])))
        return files
    manifest = TtsAssetManifest.load_default()
    if not manifest.has_model(model_id):
        return []
    declared = manifest.get(model_id)
    root = declared.resolved_install_dir()
    return [root / asset.path for asset in declared.assets]
