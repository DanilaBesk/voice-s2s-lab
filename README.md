# Voice S2S Lab

Local engineering console for testing speech-to-speech models with a browser UI and Python backend.

The current real model target is `Qwen/Qwen2.5-Omni-3B`. The shipped adapter is still `turn_based`: the browser keeps a call open, automatically segments microphone speech by pauses, sends each utterance to the backend, and plays the returned transcript/audio. Streaming-capable model metadata is preserved in the catalog so a future runner can expose low-latency token/audio transport without rewriting the UI.

## Quick Start: macOS Host Runtime

```bash
cp .env.example .env
cd backend
uv sync --extra dev --extra qwen
HF_HUB_CACHE=../data/models/huggingface \
HF_HUB_DISABLE_XET=1 \
HF_HUB_DOWNLOAD_TIMEOUT=1800 \
PYTORCH_ENABLE_MPS_FALLBACK=1 \
VOICE_S2S_ENABLE_REAL_MODEL=true \
uv run --extra dev --extra qwen uvicorn app.main:app --host 127.0.0.1 --port 18000
```

In another terminal:

```bash
cd frontend
npm install
VITE_API_BASE_URL=http://127.0.0.1:18000 npm run dev -- --host 127.0.0.1 --port 5174
```

Open:

- Frontend: http://127.0.0.1:5174
- Backend health: http://127.0.0.1:18000/health

This is the recommended path on Apple Silicon because the host Python runtime can use MPS. Docker is kept as an alternative launcher, but on macOS it does not provide MPS and is usually a worse memory/runtime fit for this model.

## Linux GPU Server Path

For a dedicated Linux server with an NVIDIA GPU, use the production deployment path instead of the macOS dev flow:

```bash
cp .env.linux.example .env
./scripts/deploy-linux-gpu.sh
```

This path:

- builds a backend image intended for Linux CUDA hosts,
- serves the frontend as static assets behind nginx,
- proxies `/api` and `/health` through the frontend container,
- persists model snapshots under `data/models` and session WAV/log files under `.local/sessions`.

Runbook: [docs/linux-gpu-deploy.md](docs/linux-gpu-deploy.md)

## Docker Alternative

```bash
cp .env.example .env
docker compose up --build
```

Use Docker for a reproducible local stack, not for the lowest memory usage on macOS.

## Model Cache

Downloaded model files are stored under:

```text
data/models
```

For the current Qwen path, prefer `HF_HUB_CACHE=../data/models/huggingface` over `HF_HOME` so manual snapshot downloads and runtime warmup use the same cache location.

TTS model weights are also kept outside git. Piper Russian voices are expected at:

```text
data/models/piper/ru_RU-denis-medium.onnx
data/models/piper/ru_RU-denis-medium.onnx.json
data/models/piper/ru_RU-dmitri-medium.onnx
data/models/piper/ru_RU-dmitri-medium.onnx.json
```

The backend never downloads these files automatically. See [docs/tts-research-and-evidence.md](docs/tts-research-and-evidence.md) for the researched model shortlist, license risks, install notes, and runtime evidence.

## Adding A Model

1. Add `backend/app/models/<model-id>.yaml`.
2. Add an adapter class under `backend/app/adapters/`.
3. Register it in `backend/app/adapters/__init__.py`.

The frontend reads `/api/models` and should not need model-specific branching.

## Current Runtime Surface

- `qwen2-5-omni-3b`: the only enabled real speech-to-speech target.
- `piper-ru-ru-denis-medium`: enabled local Russian text-to-speech target; requires external Piper runtime plus ONNX/JSON files under `data/models/piper`.
- `piper-ru-ru-dmitri-medium`: enabled local Russian text-to-speech target; requires external Piper runtime plus ONNX/JSON files under `data/models/piper`.
- `synthetic-local-tts`: disabled catalog fixture for deterministic backend/frontend tests; it is not a production voice and does not use model weights.
- `mock-audio`: disabled catalog entry kept only for backend transport unit tests; it is not exposed in the UI.

The editable persona prompt in the UI is for behavior testing. For Qwen audio output, the adapter must keep Qwen's required system prompt fixed and applies the editable persona as a user-instruction prefix.

The active API surface includes explicit model lifecycle endpoints for both S2S and TTS:

- `GET /api/models`
- `GET /api/runtime`
- `POST /api/models/{id}/load`
- `DELETE /api/models/{id}/load`
- `POST /api/tts`
- `GET /api/tts/{turn_id}/audio`

## Verification Commands

```bash
cd backend && uv run --extra dev --extra qwen pytest
cd frontend && npm run test -- --run src && npm run build
cd frontend && npm run test:e2e
cd backend && \
  HF_HUB_CACHE=../data/models/huggingface \
  HF_HUB_DISABLE_XET=1 \
  HF_HUB_DOWNLOAD_TIMEOUT=1800 \
  PYTORCH_ENABLE_MPS_FALLBACK=1 \
  VOICE_S2S_ENABLE_REAL_MODEL=true \
  VOICE_S2S_RUN_REAL_MODEL_TEST=true \
  QWEN_TEST_AUDIO_PATH=/tmp/qwen-question.wav \
  uv run --extra dev --extra qwen pytest tests/test_qwen_real_smoke.py -s
```
