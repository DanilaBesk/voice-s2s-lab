from __future__ import annotations

from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field, model_validator


ModelType = Literal["audio_to_audio", "text_to_audio", "pipeline", "mock"]
CapabilityType = Literal["audio_to_audio", "text_to_audio", "tts"]
RuntimeType = Literal["in_process", "subprocess", "docker"]


class VoiceMetadata(BaseModel):
    id: str
    display_name: str
    language: str
    gender: str | None = None
    sample_rate: int | None = None
    notes: str | None = None


class ModelCatalogEntry(BaseModel):
    id: str
    display_name: str
    hf_repo: str | None = None
    type: ModelType
    capabilities: list[CapabilityType] = Field(default_factory=list)
    voices: list[VoiceMetadata] = Field(default_factory=list)
    adapter: str
    runtime: RuntimeType
    mode: Literal["turn_based", "streaming"] = "turn_based"
    language_notes: str
    hardware_notes: str
    install_notes: str
    supports_prompt: bool = True
    supports_streaming: bool = False
    input_sample_rate: int = 16_000
    output_sample_rate: int = 24_000
    enabled: bool = True
    default: bool = False
    config: dict = Field(default_factory=dict)

    @model_validator(mode="after")
    def default_capabilities(self) -> "ModelCatalogEntry":
        if self.capabilities:
            return self
        if self.type == "text_to_audio":
            self.capabilities = ["text_to_audio", "tts"]
        else:
            self.capabilities = ["audio_to_audio"]
        return self

    def public_dict(self, status: str = "not_checked", status_detail: str | None = None) -> dict:
        data = self.model_dump(exclude={"config"})
        data["status"] = status
        data["status_detail"] = status_detail
        return data


class ModelCatalog:
    def __init__(self, models_dir: Path) -> None:
        self.models_dir = models_dir
        self.entries = self._load()

    def _load(self) -> dict[str, ModelCatalogEntry]:
        entries: dict[str, ModelCatalogEntry] = {}
        for path in sorted(self.models_dir.glob("*.yaml")):
            with path.open("r", encoding="utf-8") as handle:
                payload = yaml.safe_load(handle) or {}
            if "model" in payload:
                raw_entries = [payload["model"]]
            else:
                raw_entries = payload.get("models", [])
            for raw in raw_entries:
                entry = ModelCatalogEntry.model_validate(raw)
                if entry.id in entries:
                    raise ValueError(f"Duplicate model id: {entry.id}")
                entries[entry.id] = entry
        if not entries:
            raise ValueError(f"No model YAML files found in {self.models_dir}")
        return entries

    def list(self, include_disabled: bool = False) -> list[ModelCatalogEntry]:
        entries = list(self.entries.values())
        if include_disabled:
            return entries
        return [entry for entry in entries if entry.enabled]

    def get(self, model_id: str) -> ModelCatalogEntry:
        try:
            return self.entries[model_id]
        except KeyError as exc:
            raise KeyError(f"Unknown model id: {model_id}") from exc
