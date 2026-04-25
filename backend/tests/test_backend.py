from fastapi.testclient import TestClient

from app.catalog import ModelCatalog
from app.main import app, state


client = TestClient(app)


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
    response = client.get("/api/models")
    assert response.status_code == 200
    models = response.json()["models"]
    assert any(model["id"] == "qwen2-5-omni-3b" for model in models)
    assert not any(model["id"] == "mock-audio" for model in models)


def test_session_can_be_created():
    response = client.post("/api/sessions", json={"model_id": "mock-audio", "persona_prompt": "test"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["session_id"].startswith("sess_")
    assert payload["model_id"] == "mock-audio"


def test_mock_adapter_returns_response():
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


def test_adapter_errors_are_structured():
    session = client.post("/api/sessions", json={"model_id": "qwen2-5-omni-3b", "persona_prompt": "test"}).json()
    response = client.post(
        f"/api/sessions/{session['session_id']}/turns",
        files={"audio": ("sample.wav", b"not-a-real-wav", "audio/wav")},
        data={"options": "{}"},
    )
    assert response.status_code == 502
    detail = response.json()["detail"]
    assert detail["code"] == "model_not_ready"
    assert "status" in detail["detail"]
