# TTS Research And Evidence

This document is the acceptance and runtime evidence for the Russian TTS catalog. It is not a task tracker.

## Runtime Contract

The UI and `/api/models` must expose only installable runtime entries. Metadata-only or blocked candidates are not selectable and must not appear as working models.

The implemented lifecycle is:

- catalog discovery: `GET /api/models`
- runtime state: `GET /api/runtime`
- explicit start/load: `POST /api/models/{id}/load`
- explicit stop/unload: `DELETE /api/models/{id}/load`
- TTS generation: `POST /api/tts`
- generated audio fetch: `GET /api/tts/{turn_id}/audio`

Selecting a model in the frontend is not a load operation. The user starts the selected model explicitly. Generation remains disabled until the selected model is loaded and ready.

## Install Command

Install model assets declaratively from the manifest:

```bash
cd backend
uv sync --extra dev --extra tts
uv run --extra tts python ../scripts/install-tts-models.py --all
```

Install a subset:

```bash
cd backend
uv run --extra tts python ../scripts/install-tts-models.py --models vosk-tts-ru-0-9-multi vosk-tts-ru-0-8-multi
```

The manifest is `backend/app/tts-assets.yaml`. Model weights remain outside git under `data/models/...`.

## Enabled Models

| Model ID | Tier | Voices | License | Runtime |
| --- | --- | --- | --- | --- |
| `vosk-tts-ru-0-9-multi` | around 1GB request, 747 MiB zip | F01/F02/F03 female, M01/M02 male | Apache-2.0 | `vosk_tts` / onnxruntime |
| `vosk-tts-ru-0-8-multi` | around 1GB request, 767 MiB zip | F01/F02/F03 female, M01/M02 male | Apache-2.0 | `vosk_tts` / onnxruntime |

The visible TTS catalog is intentionally narrowed to these 1GB-class models for the current quality pass. Smaller Piper and Utrobin VITS entries remain declared for audit/history, but they are disabled and are not returned from `/api/models`.

There is no strict enabled 500MB Russian male+female model in the current catalog. The researched 500MB-class candidates either have noncommercial licensing, incomplete runtime boundaries, or only one gender. They are documented as exclusions rather than exposed as fake runtime entries.

## Quality Notes

The 60 MB Utrobin VITS low model can sound better than the larger 160 MB Utrobin VITS high model despite being smaller. The local configs show that low uses `hidden_size=96`, `num_hidden_layers=6`, `flow_size=96`, 16 kHz output config, two speakers, and stochastic duration prediction. High uses `hidden_size=192`, `num_hidden_layers=8`, `flow_size=192`, also 16 kHz output config, the same two speakers, but deterministic duration prediction. Larger parameter count therefore did not buy more voices or higher configured sample rate; perceived quality is likely dominated by the training split, duration/prosody behavior, noise/overfit tradeoffs, and vocoder/data quality.

`mlx-community/whisper-large-asr-4bit` was checked separately. It is an Apache-2.0 Whisper automatic-speech-recognition model, not a text-to-speech model, so it is not a candidate for the TTS selector.

## Excluded Candidates

| Candidate | Reason |
| --- | --- |
| `piper-ru-ru-denis-medium` / `piper-ru-ru-dmitri-medium` | Runnable and permissively licensed, but excluded from the visible quality pass because the user chose to keep only the better 1GB-class models. |
| `utrobin-vits-low-ru-multispeaker` | Runnable and Apache-2.0, but excluded from the visible quality pass after comparison with the 1GB Vosk candidates. |
| `utrobin-vits-high-ru-multispeaker` | Runnable and Apache-2.0, but sounded worse than the smaller low VITS candidate in local evaluation and is excluded from the visible quality pass. |
| `mlx-community/whisper-large-asr-4bit` | ASR/STT Whisper model, not TTS. |
| `piper-ru-ru-irina-medium` | The rhasspy model card lists the source dataset license as unknown. |
| `piper-ru-ru-ruslan-medium` | Noncommercial/share-alike source licensing. |
| `silero-ru-v5-5` | Requires a separate runtime implementation and license/distribution review before it can be a real runnable entry. |
| `bene-ges/tts_ru_ipa_fastpitch_ruslan` plus HiFiGAN | Around 500MB-class pipeline, but CC-BY-NC and male-only. |
| `frappuccino/vits2_ru_natasha` | MIT and female, but not male+female and needs a separate VITS2 runtime path. |
| `facebook/tts_transformer-ru-cv7_css10` | Older Fairseq model with unresolved license status. |
| `Misha24-10/F5-TTS_RUSSIAN` and similar F5 models | Noncommercial and reference-voice based; not a fixed male/female local voice catalog entry. |
| `facebook/mms-tts-rus` / `indicnode/mms-tts-rus` | CC-BY-NC. |

## Sources

- [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices): MIT repo metadata, updated 2026-04-07, Russian Piper ONNX assets.
- [utrobin low](https://huggingface.co/utrobinmv/tts_ru_free_hf_vits_low_multispeaker): Apache-2.0, Transformers VITS, two speakers, updated 2025-08-25.
- [utrobin high](https://huggingface.co/utrobinmv/tts_ru_free_hf_vits_high_multispeaker): Apache-2.0, Transformers VITS, two speakers, updated 2024-05-25.
- [alphacep/vosk-tts-ru-multi](https://huggingface.co/alphacep/vosk-tts-ru-multi): Apache-2.0, three female and two male voices; Vosk model list provides `vosk-model-tts-ru-0.9-multi.zip`.
- [mlx-community/whisper-large-asr-4bit](https://huggingface.co/mlx-community/whisper-large-asr-4bit): Apache-2.0 ASR/STT model; excluded from TTS.

## Verification Evidence

Evidence recorded on 2026-04-26:

| Command | Evidence |
| --- | --- |
| Hugging Face MCP `hub_repo_search` / `hub_repo_details` | Confirmed current license/runtime metadata for Piper, Utrobin, Vosk, F5, MMS, Bene Ges, and other candidates. |
| `uv run --with huggingface-hub ... get_hf_file_metadata` | Confirmed Piper and Utrobin file sizes used in the install manifest. |
| `uv run --with vosk-tts==0.3.61 ... model-list.json` | Confirmed Vosk `vosk-model-tts-ru-0.9-multi.zip`, size `782787154`, md5 `2f8b6dbf64e912f9ee7eda50ba2d3c80`, and current non-obsolete status. |
| `cd backend && uv run python -m pytest -q` | 27 passed, 2 skipped. Includes runnable-only catalog, manifest coverage, missing-asset diagnostics, and installer dry-run declaration. |
| `cd backend && uv run --extra tts python ../scripts/install-tts-models.py --models utrobin-vits-low-ru-multispeaker` | Installed the real Apache-2.0 low VITS male+female model into `data/models/huggingface/utrobinmv__tts_ru_free_hf_vits_low_multispeaker`. |
| `cd backend && VOICE_S2S_RUN_REAL_TTS_TEST=true uv run --extra tts python -m pytest tests/test_tts_real_smoke.py -q` | 1 passed. Real local model load and WAV generation for `utrobin-vits-low-ru-multispeaker`, `speaker-1`. |
| `cd frontend && npm test -- --run` | 13 passed. Covers visible metadata, voice details, and explicit lifecycle behavior. |
| `cd frontend && npm run build` | Production frontend build succeeds. |
| `cd frontend && npm run test:e2e` | 5 passed. Covers dropdown labels, no blocked/noncommercial catalog entries, male/female choices, explicit start/generate/switch/stop flow, and load errors. |
| Browser check at `http://127.0.0.1:5174/` | TTS dropdown showed only `piper-ru-ru-denis-medium`, `piper-ru-ru-dmitri-medium`, `utrobin-vits-low-ru-multispeaker`, `utrobin-vits-high-ru-multispeaker`, and `vosk-tts-ru-0-9-multi`; no `catalog_only_tts` entries were present. |

Evidence recorded on 2026-04-27:

| Command | Evidence |
| --- | --- |
| Hugging Face MCP `hub_repo_details` for `mlx-community/whisper-large-asr-4bit` | Confirmed it is Whisper ASR/STT, not TTS. |
| `uv run --with vosk-tts==0.3.61 ... model-list.json` | Confirmed `vosk-model-tts-ru-0.8-multi.zip`, size `804491027`, md5 `e35bfb41c66df3891accf5453118da67`, and obsolete status; added as an explicitly labeled quality-comparison model. |
| `cd backend && uv run --extra tts python ../scripts/install-tts-models.py --models vosk-tts-ru-0-8-multi` | Installed the real Vosk 0.8 multispeaker model under `data/models/vosk/vosk-model-tts-ru-0.8-multi`. |
| `cd backend && uv run python -m pytest -q` | 28 passed, 3 skipped. |
| `cd backend && VOICE_S2S_RUN_REAL_TTS_TEST=true uv run --extra tts python -m pytest tests/test_tts_real_smoke.py -q` | 2 passed. Real local model load and WAV generation for Vosk 0.8 and 0.9 across F01/F02/F03/M01/M02. |
| `cd frontend && npm test -- --run` | 13 passed. |
| `cd frontend && npm run build` | Production frontend build succeeds. |
| `cd frontend && npm run test:e2e` | 5 passed. Covers only 1GB Vosk options, male/female voices, explicit start/generate/switch/stop flow, and load errors. |
| HTTP smoke against `http://127.0.0.1:18000` | `/api/models` returned only `vosk-tts-ru-0-8-multi` and `vosk-tts-ru-0-9-multi` as TTS. Both models loaded and all ten voice generations returned RIFF WAV audio; `failures []`. |
