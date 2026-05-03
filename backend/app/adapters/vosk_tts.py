from __future__ import annotations

import asyncio
from pathlib import Path
import re
import unicodedata

from app.adapters.base import AdapterError, AdapterHealth, AdapterResult, AudioTurn, SessionConfig
from app.catalog import ModelCatalogEntry
from app.events import EventLog, Timer
from app.tts_assets import _resolve_repo_path

LATIN_TOKEN_RE = re.compile(r"[A-Za-z]+")
DIGIT_TOKEN_RE = re.compile(r"\d+")
UNSUPPORTED_VOSK_TEXT_RE = re.compile(r"[^А-Яа-яЁё ,.?!;:\"()\\-]+")

LATIN_LETTER_NAMES = {
    "a": "эй",
    "b": "би",
    "c": "си",
    "d": "ди",
    "e": "и",
    "f": "эф",
    "g": "джи",
    "h": "эйч",
    "i": "ай",
    "j": "джей",
    "k": "кей",
    "l": "эл",
    "m": "эм",
    "n": "эн",
    "o": "оу",
    "p": "пи",
    "q": "кью",
    "r": "ар",
    "s": "эс",
    "t": "ти",
    "u": "ю",
    "v": "ви",
    "w": "дабл ю",
    "x": "икс",
    "y": "уай",
    "z": "зет",
}

LATIN_TRANSLITERATION = (
    ("sch", "щ"),
    ("sh", "ш"),
    ("ch", "ч"),
    ("yo", "е"),
    ("yu", "ю"),
    ("ya", "я"),
    ("zh", "ж"),
    ("kh", "х"),
    ("ts", "ц"),
    ("th", "с"),
)

LATIN_CHAR_TRANSLITERATION = {
    "a": "а",
    "b": "б",
    "c": "к",
    "d": "д",
    "e": "е",
    "f": "ф",
    "g": "г",
    "h": "х",
    "i": "и",
    "j": "дж",
    "k": "к",
    "l": "л",
    "m": "м",
    "n": "н",
    "o": "о",
    "p": "п",
    "q": "к",
    "r": "р",
    "s": "с",
    "t": "т",
    "u": "у",
    "v": "в",
    "w": "в",
    "x": "кс",
    "y": "и",
    "z": "з",
}

DIGIT_WORDS = {
    "0": "ноль",
    "1": "один",
    "2": "два",
    "3": "три",
    "4": "четыре",
    "5": "пять",
    "6": "шесть",
    "7": "семь",
    "8": "восемь",
    "9": "девять",
}


class VoskTtsAdapter:
    def __init__(self) -> None:
        self.config: ModelCatalogEntry | None = None
        self.model_path: Path | None = None
        self.model = None
        self.synth = None
        self.sessions: set[str] = set()
        self.last_health = AdapterHealth(status="not_installed", detail="Adapter has not been prepared")

    async def prepare(self, config: ModelCatalogEntry) -> AdapterHealth:
        self.config = config
        model_path = _resolve_repo_path(str(config.config.get("model_path", "")))
        required = ["model.onnx", "dictionary", "config.json"]
        missing = [name for name in required if not (model_path / name).exists()]
        if missing:
            self.last_health = AdapterHealth(
                status="not_installed",
                detail=f"Vosk TTS local model is missing {', '.join(missing)} in {model_path}. Run scripts/install-tts-models.py --models {config.id}.",
            )
            return self.last_health
        try:
            from vosk_tts import Model, Synth
        except Exception as exc:
            self.last_health = AdapterHealth(
                status="not_installed",
                detail=f"Vosk TTS dependencies are missing: {type(exc).__name__}: {exc}. Run uv sync --extra tts.",
            )
            return self.last_health
        try:
            self.model = Model(model_path=model_path)
            self.synth = Synth(self.model)
            self.model_path = model_path
            self.last_health = AdapterHealth(status="ready", detail=f"Vosk TTS model is ready: {model_path.name}")
            return self.last_health
        except Exception as exc:
            self.last_health = AdapterHealth(status="failed", detail=f"Vosk TTS model failed to load from {model_path}: {type(exc).__name__}: {exc}")
            return self.last_health

    async def warmup(self) -> AdapterHealth:
        if self.config is None:
            return AdapterHealth(status="error", detail="Adapter config was not prepared")
        return self.last_health

    async def unload(self) -> None:
        self.config = None
        self.model_path = None
        self.model = None
        self.synth = None
        self.sessions.clear()
        self.last_health = AdapterHealth(status="not_loaded", detail="Vosk TTS runtime is not loaded")

    async def start_session(self, session_config: SessionConfig) -> None:
        self.sessions.add(session_config.session_id)

    async def process_audio_file_or_chunk(self, turn: AudioTurn) -> AdapterResult:
        if self.last_health.status != "ready":
            raise AdapterError("model_not_ready", "Vosk TTS adapter is not ready", {"status": self.last_health.status, "detail": self.last_health.detail})
        return await asyncio.to_thread(self._generate_sync, turn)

    async def interrupt(self, session_id: str) -> None:
        return None

    async def close(self, session_id: str) -> None:
        self.sessions.discard(session_id)

    def _generate_sync(self, turn: AudioTurn) -> AdapterResult:
        config = self.config
        synth = self.synth
        if config is None or synth is None:
            raise AdapterError("model_not_ready", "Vosk TTS adapter is not ready")
        text = unicodedata.normalize("NFC", str(turn.options.get("text") or turn.persona_prompt or "")).strip()
        if not text:
            raise AdapterError("empty_tts_text", "TTS text is empty")
        synth_text = _normalize_for_vosk_synth(text)
        voice = str(turn.options.get("voice") or config.voices[0].id)
        speaker_map = config.config.get("speaker_map", {})
        speaker_id = int(speaker_map.get(voice, 0))

        timer = Timer()
        event_log = EventLog()
        event_log.add("adapter.started", "Vosk TTS turn started", session_id=turn.session_id, turn_id=turn.turn_id, voice=voice)
        try:
            turn.output_path.parent.mkdir(parents=True, exist_ok=True)
            synth.synth(synth_text, str(turn.output_path), speaker_id=speaker_id)
        except Exception as exc:
            raise AdapterError("model_runtime_error", "Vosk TTS generation failed", {"error": f"{type(exc).__name__}: {exc}"}) from exc
        event_log.add("adapter.completed", "Vosk TTS turn completed", output=str(turn.output_path))
        return AdapterResult(
            text=text,
            output_path=turn.output_path,
            events=event_log.as_list(),
            metrics={
                "adapter_ms": timer.elapsed_ms(),
                "output_sample_rate": config.output_sample_rate,
                "speaker_id": speaker_id,
                "text_chars": len(text),
            },
        )


def _normalize_for_vosk_synth(text: str) -> str:
    normalized = unicodedata.normalize("NFC", text)
    normalized = normalized.replace("—", "-").replace("–", "-")
    normalized = normalized.replace("%", " процентов ")
    normalized = normalized.replace("@", " собака ")
    normalized = normalized.replace("+", " плюс ")
    normalized = normalized.replace("&", " и ")
    normalized = DIGIT_TOKEN_RE.sub(lambda match: " ".join(DIGIT_WORDS[digit] for digit in match.group(0)), normalized)
    normalized = LATIN_TOKEN_RE.sub(lambda match: _russianize_latin_token(match.group(0)), normalized)
    normalized = UNSUPPORTED_VOSK_TEXT_RE.sub(" ", normalized)
    return re.sub(r"\s+", " ", normalized).strip()


def _russianize_latin_token(token: str) -> str:
    if token.isupper() and len(token) <= 6:
        return " ".join(LATIN_LETTER_NAMES[letter.lower()] for letter in token)

    lower = token.lower()
    result = ""
    index = 0
    while index < len(lower):
        for source, replacement in LATIN_TRANSLITERATION:
            if lower.startswith(source, index):
                result += replacement
                index += len(source)
                break
        else:
            result += LATIN_CHAR_TRANSLITERATION.get(lower[index], "")
            index += 1
    return result
