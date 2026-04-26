from fastapi.testclient import TestClient

from app.adapters.base import AdapterError
from app.catalog import ModelCatalog
from app.main import app, state


client = TestClient(app)


def _reset_runtime_state():
    state.adapters.clear()
    state.adapter_tasks.clear()
    state.adapter_errors.clear()
    if hasattr(state, "model_statuses"):
        state.model_statuses.clear()
    if hasattr(state, "model_status_details"):
        state.model_status_details.clear()
    if hasattr(state, "loaded_model_id"):
        state.loaded_model_id = None
    if hasattr(state, "runtime_model_id"):
        state.runtime_model_id = None


def test_catalog_loads_models():
    catalog = ModelCatalog(state.catalog.models_dir)
    ids = {model.id for model in catalog.list(include_disabled=True)}
    assert "mock-audio" in ids
    assert "qwen2-5-omni-3b" in ids


def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["ok"] is True


def test_models_endpoint():
    _reset_runtime_state()
    response = client.get("/api/models")
    assert response.status_code == 200
    models = response.json()["models"]
    assert any(model["id"] == "qwen2-5-omni-3b" for model in models)
    assert not any(model["id"] == "mock-audio" for model in models)
    qwen = next(model for model in models if model["id"] == "qwen2-5-omni-3b")
    assert qwen["status"] == "not_loaded"
    assert state.adapters == {}
    assert state.adapter_tasks == {}


def test_startup_does_not_autoload_default_model():
    _reset_runtime_state()
    with TestClient(app) as local_client:
        response = local_client.get("/api/runtime")
    assert response.status_code == 200
    assert response.json()["status"] == "not_loaded"
    assert state.adapters == {}
    assert state.adapter_tasks == {}


def test_create_session_rejects_unloaded_model():
    _reset_runtime_state()
    response = client.post("/api/sessions", json={"model_id": "mock-audio", "persona_prompt": "test"})
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "model_not_loaded"


def test_explicit_load_allows_session_creation():
    _reset_runtime_state()
    load_response = client.post("/api/models/mock-audio/load")
    assert load_response.status_code == 200
    assert load_response.json()["status"] == "ready"

    response = client.post("/api/sessions", json={"model_id": "mock-audio", "persona_prompt": "test"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["session_id"].startswith("sess_")
    assert payload["model_id"] == "mock-audio"


def test_mock_adapter_returns_response():
    _reset_runtime_state()
    load_response = client.post("/api/models/mock-audio/load")
    assert load_response.status_code == 200
    session = client.post("/api/sessions", json={"model_id": "mock-audio", "persona_prompt": "test"}).json()
    response = client.post(
        f"/api/sessions/{session['session_id']}/turns",
        files={"audio": ("sample.wav", b"not-a-real-wav-but-mock-does-not-read-it", "audio/wav")},
        data={"options": "{}"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "completed"
    assert payload["text"].startswith("Mock response")
    assert payload["audio_url"]


def test_session_operations_reject_after_model_unload():
    _reset_runtime_state()
    assert client.post("/api/models/mock-audio/load").status_code == 200
    session = client.post("/api/sessions", json={"model_id": "mock-audio", "persona_prompt": "test"}).json()
    assert client.delete("/api/models/mock-audio/load").status_code == 200

    interrupt = client.post(f"/api/sessions/{session['session_id']}/interrupt")
    assert interrupt.status_code == 409
    assert interrupt.json()["detail"]["code"] == "model_not_loaded"

    turn = client.post(
        f"/api/sessions/{session['session_id']}/turns",
        files={"audio": ("sample.wav", b"not-a-real-wav-but-mock-does-not-read-it", "audio/wav")},
        data={"options": "{}"},
    )
    assert turn.status_code == 409
    assert turn.json()["detail"]["code"] == "model_not_loaded"

    close = client.delete(f"/api/sessions/{session['session_id']}")
    assert close.status_code == 409
    assert close.json()["detail"]["code"] == "model_not_loaded"
    assert state.sessions.get(session["session_id"]).active is True


def test_loading_another_model_unloads_previous_runtime():
    _reset_runtime_state()
    first = client.post("/api/models/mock-audio/load")
    assert first.status_code == 200
    previous = state.adapters["mock-audio"]
    assert previous.config is not None

    second = client.post("/api/models/qwen2-5-omni-3b/load")
    assert second.status_code == 200

    assert "mock-audio" not in state.adapters
    assert previous.config is None
    runtime = client.get("/api/runtime").json()
    assert runtime["model_id"] == "qwen2-5-omni-3b"
    assert runtime["status"] == "failed"


def test_adapter_errors_are_structured():
    _reset_runtime_state()
    load_response = client.post("/api/models/qwen2-5-omni-3b/load")
    assert load_response.status_code == 200
    payload = load_response.json()
    assert payload["status"] == "failed"
    assert payload["detail"]

    response = client.post("/api/sessions", json={"model_id": "qwen2-5-omni-3b", "persona_prompt": "test"})
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["code"] == "model_not_loaded"
    assert detail["detail"]["status"] == "failed"


def test_tts_generation_returns_audio_url_and_reuses_loaded_runtime():
    _reset_runtime_state()
    load_response = client.post("/api/models/synthetic-local-tts/load")
    assert load_response.status_code == 200
    assert load_response.json()["status"] == "ready"
    adapter = state.adapters["synthetic-local-tts"]

    response = client.post(
        "/api/tts",
        json={"model_id": "synthetic-local-tts", "text": "Привет", "voice": "synthetic-local", "options": {"speed": 1.0}},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["turn_id"].startswith("turn_")
    assert payload["status"] == "completed"
    assert payload["audio_url"] == f"/api/tts/{payload['turn_id']}/audio"
    assert payload["text"] == "Привет"
    assert payload["latency_ms"] >= 0
    assert payload["events"]
    assert payload["metrics"]["total_ms"] >= 0
    assert payload["warnings"] == []

    audio_response = client.get(payload["audio_url"])
    assert audio_response.status_code == 200
    assert audio_response.content.startswith(b"RIFF")

    second = client.post("/api/tts", json={"model_id": "synthetic-local-tts", "text": "Еще раз"})
    assert second.status_code == 200
    assert state.adapters["synthetic-local-tts"] is adapter


def test_tts_generation_rejects_unloaded_tts_model_without_lazy_load():
    _reset_runtime_state()
    response = client.post("/api/tts", json={"model_id": "synthetic-local-tts", "text": "Привет"})

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "model_not_loaded"
    assert "synthetic-local-tts" not in state.adapters


def test_tts_generation_rejects_unknown_model():
    _reset_runtime_state()
    response = client.post("/api/tts", json={"model_id": "missing-model", "text": "Привет"})

    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "unknown_model"


def test_tts_generation_rejects_empty_text():
    _reset_runtime_state()
    assert client.post("/api/models/synthetic-local-tts/load").status_code == 200

    response = client.post("/api/tts", json={"model_id": "synthetic-local-tts", "text": "   "})

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "empty_tts_text"


def test_tts_generation_rejects_non_tts_model():
    _reset_runtime_state()
    assert client.post("/api/models/mock-audio/load").status_code == 200

    response = client.post("/api/tts", json={"model_id": "mock-audio", "text": "Привет"})

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "model_not_tts"


def test_tts_generation_reports_failed_runtime(monkeypatch):
    _reset_runtime_state()
    assert client.post("/api/models/synthetic-local-tts/load").status_code == 200
    adapter = state.adapters["synthetic-local-tts"]

    async def fail_generation(turn):
        raise AdapterError("model_runtime_error", "Synthetic TTS failed", {"phase": "generate"})

    monkeypatch.setattr(adapter, "process_audio_file_or_chunk", fail_generation)
    response = client.post("/api/tts", json={"model_id": "synthetic-local-tts", "text": "Привет"})

    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "model_runtime_error"
