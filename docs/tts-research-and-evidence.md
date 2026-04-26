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

## Recommended Runtime Split

Use Piper Russian medium voices as the default runnable local TTS path when GPL-3.0-or-later runtime obligations are acceptable or the Piper runtime is distributed and isolated separately from this project.

Piper is still the best small runnable local ONNX path because it supports CPU execution, uses simple ONNX plus JSON assets, has Russian medium voices, and does not require committing weights to this repository. The catalog currently includes two runnable Piper entries:

- `piper-ru-ru-denis-medium` with voice `ru_RU-denis-medium`
- `piper-ru-ru-dmitri-medium` with voice `ru_RU-dmitri-medium`

The expanded catalog also exposes researched candidates as metadata-only `catalog_only_tts` entries. These entries are selectable in the UI, but explicit load returns a visible not-installed or policy-blocked diagnostic until a runtime adapter, local assets, and license/runtime boundaries are implemented. Selection never downloads, loads, or warms model weights.

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
| Piper `ru_RU-denis-medium`, `ru_RU-dmitri-medium` | Runnable small local Russian default | CPU default; ONNX plus JSON; each Russian medium ONNX is about 63,201,294 bytes | Voice model cards are CC0; runtime is GPL-3.0-or-later, so packaging must respect copyleft obligations or isolate the runtime | [piper1-gpl](https://github.com/OHF-Voice/piper1-gpl), [piper-tts PyPI](https://pypi.org/project/piper-tts/), [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices) |
| Piper `ru_RU-irina-medium`, `ru_RU-ruslan-medium` | Extra lightweight female/male Piper candidates | ONNX files are about 63,201,294 bytes per voice; same expected CPU Piper runtime | Irina remains license/provenance risk; Ruslan is noncommercial/share-alike, so both stay catalog-only | [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices) |
| Silero Russian v5.5 | Compact multi-voice quality candidate | About 145,420,684 bytes; voices include `baya`, `kseniya`, `xenia`, `aidar`, `eugene` | Runtime/license boundary needs implementation review before enabling; catalog-only now | [silero-models](https://github.com/snakers4/silero-models), [silero PyPI](https://pypi.org/project/silero/) |
| Utrobin VITS low multispeaker | Best low-risk around-100MB male/female candidate | HF metadata: created 2024-04-28, updated 2025-08-25; ONNX about 50.8 MB, safetensors about 60.4 MB; speaker `0` female and `1` male | Apache-2.0; needs a VITS runtime adapter and local assets | [utrobin low](https://huggingface.co/utrobinmv/tts_ru_free_hf_vits_low_multispeaker) |
| Utrobin VITS high multispeaker | Closest practical around-250MB male/female candidate | HF metadata: created/updated 2024-05-25; safetensors about 159.7 MB; speaker `0` female and `1` male | Apache-2.0; below the requested 250MB tier but the best verified fit found | [utrobin high](https://huggingface.co/utrobinmv/tts_ru_free_hf_vits_high_multispeaker) |
| Bene Ges FastPitch Ruslan plus HiFiGAN | True around-500MB male pipeline | FastPitch is about 183.3 MB and HiFiGAN about 339.2 MB, together about 522.5 MB; NeMo runtime | Noncommercial; requires paired acoustic model plus vocoder, so catalog-only | [FastPitch](https://huggingface.co/bene-ges/tts_ru_ipa_fastpitch_ruslan), [HiFiGAN](https://huggingface.co/bene-ges/tts_ru_hifigan_ruslan) |
| Frappuccino VITS2 Natasha | Female 500MB-tier gap filler | ONNX is about 156.6 MB; PyTorch checkpoint is about 565.5 MB | MIT; practical ONNX runtime is below 500MB, but it covers the female side of the tier | [frappuccino/vits2_ru_natasha](https://huggingface.co/frappuccino/vits2_ru_natasha) |
| Misha24-10 F5-TTS Russian | Modern around-1GB voice-clone candidate | HF metadata: created 2025-05-19, updated 2026-01-13; inference safetensors about 1.348 GB; 193 likes in the MCP pass | CC-BY-NC-4.0; gender depends on user-provided reference audio, so reference consent and upload boundaries are required before runtime | [Misha24-10/F5-TTS_RUSSIAN](https://huggingface.co/Misha24-10/F5-TTS_RUSSIAN) |
| Facebook TTS Transformer Russian CV7 CSS10 | 1GB-class legacy fallback | Older Fairseq candidate retained only as catalog-only license-blocked metadata | License status unresolved; not a runnable candidate | [facebook/tts_transformer-ru-cv7_css10](https://huggingface.co/facebook/tts_transformer-ru-cv7_css10) |

## Research Exclusions

- `hotstone228/F5-TTS-Russian`: similar 1.348GB F5 class, but weaker Hub metadata for this pass and noncommercial share-alike terms.
- `NeuroDonu/RU-XTTS-DonuModel`: about 5.6GB and outside the requested size tiers.
- `joefox/tts_vits_ru_hf` and `imperialwool/silero-model-v3-ru`: compact alternatives, but less clear or less favorable than the Utrobin/Piper choices for this catalog.
- standalone `bene-ges` FastPitch or HiFiGAN alone: not a full TTS pipeline unless paired.

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
| Hugging Face MCP `hub_repo_search` / `hub_repo_details` | Confirmed modern Russian TTS sources and popularity metadata, including `rhasspy/piper-voices`, `Misha24-10/F5-TTS_RUSSIAN`, `facebook/mms-tts-rus`, `utrobinmv/tts_ru_free_hf_vits_low_multispeaker`, `utrobinmv/tts_ru_free_hf_vits_high_multispeaker`, `frappuccino/vits2_ru_natasha`, and Bene Ges NeMo candidates. |
| HF resolve `HEAD` checks for model assets | Confirmed representative asset sizes: Piper Russian ONNX files about 63,201,294 bytes; Utrobin low ONNX/safetensors about 50.8/60.4 MB; Utrobin high about 159.7 MB; Frappuccino Natasha ONNX/PyTorch about 156.6/565.5 MB; Bene Ges FastPitch+HiFiGAN about 522.5 MB; Misha F5 inference safetensors about 1.348 GB. |
| `cd backend && uv run python -m pytest -q` | Backend tests pass: 25 passed, 1 skipped. Covers expanded catalog metadata, `catalog_only_tts`, API model exposure, load failure diagnostics, and existing runtime behavior. |
| `cd frontend && npm test -- --run` | Frontend unit tests pass: 14 passed. Covers generic metadata rendering, voice details, runtime-free option labels, and load-error persistence. |
| `cd frontend && npm run test:e2e` | Playwright tests pass: 6 passed. Covers expanded catalog rendering, selection without loading, male/female/multispeaker voices, catalog-only load failure, generation only after explicit start, unload-on-switch, stop/unload, repeated-start guard, and no DB/user/dev persistence touch. |
| `cd frontend && npm run build` | Frontend production build succeeds. |

This project currently has no configured persistence host, port, or name. The TTS implementation and its e2e evidence use mocked API/runtime paths rather than a production, development, or test persistence service.
