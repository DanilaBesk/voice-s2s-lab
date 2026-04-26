from __future__ import annotations

from app.adapters.base import AdapterError, AdapterHealth, AdapterResult, AudioTurn, SessionConfig
from app.catalog import ModelCatalogEntry


class CatalogOnlyTtsAdapter:
    def __init__(self) -> None:
        self.entry: ModelCatalogEntry | None = None

    async def prepare(self, config: ModelCatalogEntry) -> AdapterHealth:
        self.entry = config
        detail = config.config.get("load_error") or (
            f"Catalog-only TTS entry '{config.id}' is not installed. {config.install_notes}"
        )
        return AdapterHealth(status="not_installed", detail=detail)

    async def warmup(self) -> AdapterHealth:
        return AdapterHealth(status="not_installed", detail="Catalog-only TTS entry has no runtime adapter loaded.")

    async def unload(self) -> None:
        self.entry = None

    async def start_session(self, session_config: SessionConfig) -> None:
        raise AdapterError("model_not_installed", "Catalog-only TTS entry cannot start a session without a runtime adapter.")

    async def process_audio_file_or_chunk(self, turn: AudioTurn) -> AdapterResult:
        raise AdapterError("model_not_installed", "Catalog-only TTS entry cannot generate audio without a runtime adapter.")

    async def interrupt(self, session_id: str) -> None:
        return None

    async def close(self, session_id: str) -> None:
        return None
