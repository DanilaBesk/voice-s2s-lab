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
uv run --extra tts python ../scripts/install-tts-models.py --models piper-ru-ru-denis-medium piper-ru-ru-dmitri-medium utrobin-vits-low-ru-multispeaker
```

The manifest is `backend/app/tts-assets.yaml`. Model weights remain outside git under `data/models/...`.

## Research Asset Command

Download-only TTS research candidates are declared separately from runnable UI/API models:

```bash
cd backend
uv run --extra tts python ../scripts/install-tts-research-models.py --all
uv run --extra tts python ../scripts/install-tts-research-models.py --all --verify
```

The research manifest is `backend/app/tts-research-assets.yaml`. These assets are local evaluation inputs only; they must not appear in `/api/models` until an adapter can really load, unload, and generate audio from them.

The UI exposes these downloaded assets through `GET /api/tts-research-assets` in a separate TTS-mode `Research models` block. This makes Qwen/Kokoro/F5/Silero/RHVoice visible on the site without presenting them as runnable catalog entries.

Downloaded research assets after the 2026-05-03 interruption:

| Research ID | Source | License | Local size | Runtime status |
| --- | --- | --- | --- | --- |
| `qwen3-tts-0-6b-base` | `Qwen/Qwen3-TTS-12Hz-0.6B-Base` | Apache-2.0 | 2.3G | download-only, no adapter |
| `kokoro-82m` | `hexgrad/Kokoro-82M` | Apache-2.0 | 339M | download-only, no adapter |
| `f5-tts-russian-mlx-4bit` | `ink-splatters/f5-tts-russian-mlx` | MIT | 222M | download-only, no adapter |
| `silero-v5-cis-base` | `models.silero.ai` direct files | MIT for CIS branch | 175M | download-only, no adapter |
| `rhvoice-russian-core-and-voices` | RHVoice GitHub source zips | GPL-2.0 / voice-specific | 14M | download-only, no adapter |

`qwen3-tts-1-7b-base` / `Qwen/Qwen3-TTS-12Hz-1.7B-Base` is intentionally excluded and its partial local snapshot was removed by user request because it is too large for this pass. Only the smaller 0.6B Qwen3-TTS candidate remains declared.

## Enabled Models

| Model ID | Tier | Voices | License | Runtime |
| --- | --- | --- | --- | --- |
| `piper-ru-ru-denis-medium` | small, 63 MB | Denis, male | MIT repo; dataset CC0 | `piper_tts` subprocess, ONNX + JSON |
| `piper-ru-ru-dmitri-medium` | small, 63 MB | Dmitri, male | MIT repo; dataset CC0 | `piper_tts` subprocess, ONNX + JSON |
| `utrobin-vits-low-ru-multispeaker` | small, 60 MB | speaker 0 female, speaker 1 male | Apache-2.0 | `transformers_vits_tts` |
| `vosk-tts-ru-0-9-multi` | around 1GB request, 747 MiB zip | F01/F02/F03 female, M01/M02 male | Apache-2.0 | `vosk_tts` / onnxruntime |
| `vosk-tts-ru-0-8-multi` | around 1GB request, 767 MiB zip | F01/F02/F03 female, M01/M02 male | Apache-2.0 | `vosk_tts` / onnxruntime |

The visible TTS catalog includes the small Russian-specialized models requested for comparison plus the existing 1GB Vosk quality baseline. Every enabled entry is declared in `backend/app/tts-assets.yaml` and must load before generation.

There is no strict enabled 500MB Russian male+female model in the current catalog. The researched 500MB-class candidates either have noncommercial licensing, incomplete runtime boundaries, or only one gender. They are documented as exclusions rather than exposed as fake runtime entries.

## Quality Notes

The 60 MB Utrobin VITS low model can sound better than the larger 160 MB Utrobin VITS high model despite being smaller. The local configs show that low uses `hidden_size=96`, `num_hidden_layers=6`, `flow_size=96`, 16 kHz output config, two speakers, and stochastic duration prediction. High uses `hidden_size=192`, `num_hidden_layers=8`, `flow_size=192`, also 16 kHz output config, the same two speakers, but deterministic duration prediction. Larger parameter count therefore did not buy more voices or higher configured sample rate; perceived quality is likely dominated by the training split, duration/prosody behavior, noise/overfit tradeoffs, and vocoder/data quality.

`mlx-community/whisper-large-asr-4bit` was checked separately. It is an Apache-2.0 Whisper automatic-speech-recognition model, not a text-to-speech model, so it is not a candidate for the TTS selector.

## Excluded Candidates

| Candidate | Reason |
| --- | --- |
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
| `Qwen/Qwen3-TTS-12Hz-1.7B-Base` | Apache-2.0 but too large for the current local pass; the smaller 0.6B Qwen3-TTS candidate is kept instead. |

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

Evidence recorded on 2026-05-03:

| Command | Evidence |
| --- | --- |
| `uv run --with huggingface-hub ... list_models(... pipeline_tag="text-to-speech" ...)` | Rechecked small Russian TTS candidates by recency/popularity/license tags. Selected Piper Denis/Dmitri and Utrobin VITS Low because they are Russian-specialized, small, available through existing runtime adapters, and permissively usable. |
| `cd backend && uv run --extra tts python ../scripts/install-tts-models.py --all` | Confirmed all declared assets are present: Piper Denis, Piper Dmitri, Utrobin VITS Low, Vosk 0.9, and Vosk 0.8. |
| `cd backend && uv run python -m pytest -q` | 30 passed, 6 skipped. Includes research manifest coverage and Qwen3 1.7B exclusion guard. |
| `cd backend && VOICE_S2S_RUN_REAL_TTS_TEST=true uv run --extra tts python -m pytest tests/test_tts_real_smoke.py -q` | 5 passed. Real local model load and WAV generation for Piper Denis, Piper Dmitri, Utrobin VITS Low, Vosk 0.8, and Vosk 0.9. |
| `cd frontend && npm test -- --run` | 13 passed. |
| `cd frontend && npm run build` | Production frontend build succeeds. |
| `cd frontend && npm run test:e2e` | 5 passed. Covers small Russian TTS entries, 1GB Vosk entries, explicit start/generate/switch/stop flow, load errors, and excludes downloaded model assets from source-code persistence scanning. |
| HTTP smoke against `http://127.0.0.1:18001` | `/api/models` returned `piper-ru-ru-denis-medium`, `piper-ru-ru-dmitri-medium`, `utrobin-vits-low-ru-multispeaker`, `vosk-tts-ru-0-8-multi`, and `vosk-tts-ru-0-9-multi` as TTS. All enabled voices returned RIFF WAV audio; `failures []`. |
| Browser check at `http://127.0.0.1:5174/` | TTS dropdown showed `63 MB` Piper Denis/Dmitri, `100MB` Utrobin VITS Low, and both `1GB` Vosk models. |
| `ps -axo pid,command | rg 'Qwen3-TTS-12Hz-1.7B\|snapshot_download\|install-tts-research-models\|huggingface'` | Confirmed no Qwen3 1.7B or Hugging Face snapshot download process remained after interruption. |
| `test ! -e data/models/research/huggingface/Qwen__Qwen3-TTS-12Hz-1.7B-Base && echo missing` | Confirmed the Qwen3 1.7B local snapshot directory was removed. |
| `cd backend && uv run --extra tts python ../scripts/install-tts-research-models.py --all --verify` | Confirmed Qwen3 0.6B, Kokoro, F5 Russian MLX 4-bit, Silero, and RHVoice research assets are present and complete. |
| `find data/models/research -maxdepth 4 \( -name '*.incomplete' -o -name '*.lock' \) -print` | No incomplete or lock files found under downloaded research assets. |
| `du -sh data/models/research/...` | Confirmed local research sizes: Qwen3 0.6B `2.3G`, Kokoro `339M`, F5 MLX `222M`, Silero `175M`, RHVoice `14M`. |
