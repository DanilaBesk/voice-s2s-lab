# TTS Research And Evidence

This document is the GRACE-style acceptance and runtime evidence for `voice-s2s-lab-y9s.6`. There were no existing canonical GRACE files in this repository, so this file and the README are the documentation surface for the TTS research decision. It is not a task tracker.

## Accepted Runtime Contract

The implemented TTS mode uses the same explicit model lifecycle as the S2S path:

- catalog discovery: `GET /api/models`
- runtime state: `GET /api/runtime`
- explicit start/load: `POST /api/models/{id}/load`
- explicit stop/unload: `DELETE /api/models/{id}/load`
- TTS generation: `POST /api/tts`
- generated audio fetch: `GET /api/tts/{turn_id}/audio`

Selecting a model in the frontend is not a load operation. Users start the selected model explicitly, can stop it explicitly, and can see selected-vs-loaded state and generation errors. TTS generation is expected to fail visibly if no compatible TTS model is loaded.

## Recommended Default

Use Piper Russian medium voices as the default local TTS path when GPL-3.0-or-later runtime obligations are acceptable or the Piper runtime is distributed and isolated separately from this project.

Piper is the best small local ONNX candidate in the current shortlist because it supports CPU execution, uses simple ONNX plus JSON assets, has Russian medium voices, and does not require committing weights to this repository. The catalog currently includes:

- `piper-ru-ru-denis-medium` with voice `ru_RU-denis-medium`
- `piper-ru-ru-dmitri-medium` with voice `ru_RU-dmitri-medium`

The model files are intentionally absent from git and must be placed manually under:

```text
data/models/piper/ru_RU-denis-medium.onnx
data/models/piper/ru_RU-denis-medium.onnx.json
data/models/piper/ru_RU-dmitri-medium.onnx
data/models/piper/ru_RU-dmitri-medium.onnx.json
```

Each ONNX file is about 63,201,294 bytes, plus a small JSON config. The model cards for these Piper voices are CC0, while the Piper runtime source used here must be treated as GPL-3.0-or-later unless the packaging strategy changes.

## Research Shortlist

| Candidate | Fit | Size/runtime notes | License and distribution risk | Sources |
| --- | --- | --- | --- | --- |
| Piper `ru_RU-denis-medium`, `ru_RU-dmitri-medium` | Recommended small local Russian default | CPU default; ONNX plus JSON; each Russian medium ONNX is about 63,201,294 bytes | Voice model cards are CC0; runtime is GPL-3.0-or-later, so packaging must respect copyleft obligations or isolate the runtime | [piper1-gpl](https://github.com/OHF-Voice/piper1-gpl), [piper-tts PyPI](https://pypi.org/project/piper-tts/), [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices) |
| Silero Russian | Strong Russian quality candidate | `v5_5_ru` is about 138.68 MiB; Russian voices include stress/homograph support; CIS base is about 87 MiB but lower quality and less Russian-specific | Dedicated Russian models are non-commercial/share-alike; CIS base is MIT but is not the same quality target | [silero-models](https://github.com/snakers4/silero-models), [silero PyPI](https://pypi.org/project/silero/) |
| RHVoice | Small offline Russian-first fallback | Offline/statistical engine, useful when footprint and Russian-first operation matter more than modern neural quality | GPLv2 runtime, so distribution obligations must be planned before bundling | [RHVoice](https://github.com/RHVoice/RHVoice) |
| Coqui XTTS-v2 | Excluded for this project shape | Russian support, but model footprint is around the GB range and the original Python TTS stack conflicts with the backend's Python `>=3.12` target | Model license is non-commercial; not suitable as a default local distributable path here | [XTTS-v2 model](https://huggingface.co/coqui/XTTS-v2), [Coqui TTS](https://github.com/coqui-ai/TTS) |
| Meta MMS Russian | Excluded | Russian TTS model exists, but it is not a small default path for this local runtime | `cc-by-nc` model license blocks commercial/default distribution assumptions | [facebook/mms-tts-rus](https://huggingface.co/facebook/mms-tts-rus) |
| Raw VITS checkpoints | Excluded | Framework/checkpoint dependent; integration cost is higher than Piper for this app | License and preprocessing vary by checkpoint | Project-specific checkpoint review required before use |
| Qwen3-TTS | Excluded from the small local default | Permissive candidate, but model footprint is around 2.5 GB and does not match the small local Russian TTS target | License is less problematic than non-commercial models, but size/runtime cost is out of scope for the default | [Qwen3-TTS model family](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base) |

## Adding Or Testing A TTS Model

1. Add or update a YAML catalog entry under `backend/app/models/` with `type: text_to_audio`, `tts` or `text_to_audio` capabilities, adapter name, sample rates, and install notes.
2. Put external model assets under `data/models/...`; do not commit model weights.
3. Add an adapter under `backend/app/adapters/` and register it in `backend/app/adapters/__init__.py`.
4. Keep model load explicit. Selecting a model in the UI must not download, load, or warm up the model.
5. Verify the API lifecycle manually or through tests:

```bash
curl http://127.0.0.1:18000/api/models
curl http://127.0.0.1:18000/api/runtime
curl -X POST http://127.0.0.1:18000/api/models/piper-ru-ru-denis-medium/load
curl -X POST http://127.0.0.1:18000/api/tts \
  -H 'Content-Type: application/json' \
  -d '{"model_id":"piper-ru-ru-denis-medium","text":"Привет. Это тест русской озвучки."}'
curl -X DELETE http://127.0.0.1:18000/api/models/piper-ru-ru-denis-medium/load
```

For automated tests, use the disabled `synthetic-local-tts` fixture through mocked or test-safe runtime paths. It produces deterministic WAV output and does not require model weights.

## Verification Evidence

Evidence recorded for the TTS documentation scope on 2026-04-26:

| Command | Evidence |
| --- | --- |
| `git ls-files data docs README.md backend/app/models/piper-russian-tts.yaml` | Only `README.md` was tracked before this documentation change among the queried docs/data paths; no model weights under `data/` were tracked. |
| `find data -maxdepth 4 -type f -print` | No model weight files were present in the local `data/` tree during documentation. |
| `npm run test:e2e` from `frontend/` | The mocked TTS lifecycle e2e suite includes a persistence guard that checks host, port, name, and client references for this path. |
| `rg -n "@app\\.(get|post|delete)|api/(models|runtime|tts)|tts" backend/app/main.py backend/app/catalog.py backend/app/adapters/__init__.py` | Confirmed the documented runtime endpoints and TTS capability/catalog wiring. |
| `cd backend && uv run --extra dev python -m compileall app` | Backend Python sources compile successfully. |
| `cd backend && uv run --extra dev python -m pytest tests/test_tts_catalog_adapter.py` | TTS catalog/adapter tests pass. |
| `cd frontend && npm run test -- --run src` | Frontend unit tests pass for the implemented S2S/TTS UI. |
| `cd frontend && npm run build` | Frontend production build succeeds after the documentation update. |

This project currently has no configured persistence host, port, or name. The TTS implementation and its e2e evidence use mocked API/runtime paths rather than a production, development, or test persistence service.
