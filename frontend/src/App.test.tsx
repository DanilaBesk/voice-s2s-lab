import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_BASE_URL } from "./api";
import { App } from "./App";

type FetchCall = {
  url: string;
  method: string;
  body?: string;
};

const s2sModel = {
  id: "qwen2-5-omni-3b",
  display_name: "Qwen2.5 Omni 3B",
  hf_repo: "Qwen/Qwen2.5-Omni-3B",
  type: "audio_to_audio",
  capabilities: ["audio_to_audio"],
  voices: [],
  adapter: "qwen_omni_audio",
  runtime: "in_process",
  mode: "turn_based",
  language_notes: "Russian target test path",
  hardware_notes: "Apple Silicon MPS preferred",
  install_notes: "uv sync --extra qwen --extra dev",
  supports_prompt: true,
  supports_streaming: true,
  input_sample_rate: 16000,
  output_sample_rate: 24000,
  default: true,
  status: "not_loaded",
};

const piperDenisModel = {
  id: "piper-ru-ru-denis-medium",
  display_name: "Piper Russian Denis Medium",
  hf_repo: "rhasspy/piper-voices",
  source_url: "https://huggingface.co/rhasspy/piper-voices",
  license: "MIT",
  size_bytes: 63_206_117,
  size_label: "63 MB",
  tier: "lightweight",
  availability: "available",
  type: "text_to_audio",
  capabilities: ["text_to_audio", "tts"],
  voices: [{ id: "ru_RU-denis-medium", display_name: "Denis", language: "ru-RU", gender: "male", sample_rate: 22050, notes: "CC0 dataset voice" }],
  adapter: "piper_tts",
  runtime: "subprocess",
  mode: "turn_based",
  language_notes: "Russian Piper TTS",
  hardware_notes: "CPU",
  install_notes: "Install Piper Denis",
  supports_prompt: false,
  supports_streaming: false,
  input_sample_rate: 22050,
  output_sample_rate: 22050,
  status: "not_loaded",
};

const piperDmitriModel = {
  ...piperDenisModel,
  id: "piper-ru-ru-dmitri-medium",
  display_name: "Piper Russian Dmitri Medium",
  size_bytes: 63_206_118,
  voices: [{ id: "ru_RU-dmitri-medium", display_name: "Dmitri", language: "ru-RU", gender: "male", sample_rate: 22050, notes: "CC0 dataset voice" }],
};

const vitsLowModel = {
  id: "utrobin-vits-low-ru-multispeaker",
  display_name: "Utrobin VITS Low Russian Multispeaker",
  hf_repo: "utrobinmv/tts_ru_free_hf_vits_low_multispeaker",
  source_url: "https://huggingface.co/utrobinmv/tts_ru_free_hf_vits_low_multispeaker",
  license: "Apache-2.0",
  size_bytes: 60_360_313,
  size_label: "60 MB",
  tier: "around-100mb",
  availability: "available",
  type: "text_to_audio",
  capabilities: ["text_to_audio", "tts"],
  voices: [
    { id: "speaker-0", display_name: "Speaker 0", language: "ru-RU", gender: "female", sample_rate: 22050, notes: null },
    { id: "speaker-1", display_name: "Speaker 1", language: "ru-RU", gender: "male", sample_rate: 22050, notes: null },
  ],
  adapter: "transformers_vits_tts",
  runtime: "in_process",
  mode: "turn_based",
  language_notes: "Russian VITS TTS",
  hardware_notes: "CPU",
  install_notes: "Install Utrobin low",
  supports_prompt: false,
  supports_streaming: false,
  input_sample_rate: 16000,
  output_sample_rate: 22050,
  status: "not_loaded",
};

const vosk09Model = {
  id: "vosk-tts-ru-0-9-multi",
  display_name: "Vosk Russian TTS 0.9 Multi",
  hf_repo: "alphacep/vosk-tts-ru-multi",
  source_url: "https://alphacephei.com/vosk/models/vosk-model-tts-ru-0.9-multi.zip",
  license: "Apache-2.0",
  size_bytes: 782_787_154,
  size_label: "747 MiB",
  tier: "around-1gb",
  availability: "available",
  type: "text_to_audio",
  capabilities: ["text_to_audio", "tts"],
  voices: [
    { id: "F01", display_name: "F01", language: "ru-RU", gender: "female", sample_rate: 22050, notes: "female" },
    { id: "M01", display_name: "M01", language: "ru-RU", gender: "male", sample_rate: 22050, notes: null },
  ],
  adapter: "vosk_tts",
  runtime: "in_process",
  mode: "turn_based",
  language_notes: "Russian Vosk TTS",
  hardware_notes: "CPU",
  install_notes: "Install Vosk",
  supports_prompt: false,
  supports_streaming: false,
  input_sample_rate: 22050,
  output_sample_rate: 22050,
  status: "not_loaded",
};

const vosk08Model = {
  ...vosk09Model,
  id: "vosk-tts-ru-0-8-multi",
  display_name: "Vosk Russian TTS 0.8 Multi",
  source_url: "https://alphacephei.com/vosk/models/vosk-model-tts-ru-0.8-multi.zip",
  size_bytes: 804_491_027,
  size_label: "767 MiB",
  availability: "available_obsolete",
};

const sileroModel = {
  id: "silero-v5-cis-base",
  display_name: "Silero V5 CIS Russian Base",
  hf_repo: null,
  source_url: "https://models.silero.ai/models/tts/ru/v5_cis_base.pt",
  license: "MIT",
  size_bytes: 91_680_514,
  size_label: "92 MB",
  tier: "around-100mb",
  availability: "available",
  type: "text_to_audio",
  capabilities: ["text_to_audio", "tts"],
  voices: [
    { id: "ru_aigul", display_name: "Aigul", language: "ru-RU", gender: "female", sample_rate: 24000, notes: null },
    { id: "ru_alexandr", display_name: "Alexandr", language: "ru-RU", gender: "male", sample_rate: 24000, notes: null },
  ],
  adapter: "silero_tts",
  runtime: "in_process",
  mode: "turn_based",
  language_notes: "Silero CIS Russian TTS",
  hardware_notes: "CPU",
  install_notes: "Install Silero",
  supports_prompt: false,
  supports_streaming: false,
  input_sample_rate: 16000,
  output_sample_rate: 24000,
  status: "not_loaded",
};

const f5MlxModel = {
  id: "f5-tts-russian-mlx-4bit",
  display_name: "F5 Russian MLX 4-bit",
  hf_repo: "ink-splatters/f5-tts-russian-mlx",
  source_url: "https://huggingface.co/ink-splatters/f5-tts-russian-mlx",
  license: "MIT",
  size_bytes: 232_491_451,
  size_label: "222 MiB",
  tier: "around-250mb",
  availability: "available",
  type: "text_to_audio",
  capabilities: ["text_to_audio", "tts"],
  voices: [{ id: "reference-voice", display_name: "Reference voice", language: "ru-RU", gender: null, sample_rate: 24000, notes: "Uses configured reference audio/text" }],
  adapter: "f5_mlx_tts",
  runtime: "in_process",
  mode: "turn_based",
  language_notes: "Russian F5-TTS MLX adapter",
  hardware_notes: "Apple Silicon MLX",
  install_notes: "Install F5 MLX",
  supports_prompt: true,
  supports_streaming: false,
  input_sample_rate: 24000,
  output_sample_rate: 24000,
  status: "not_loaded",
};

const qwen3TtsModel = {
  id: "qwen3-tts-0-6b-base",
  display_name: "Qwen3-TTS 0.6B Base",
  hf_repo: "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
  source_url: "https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base",
  license: "Apache-2.0",
  size_bytes: 2_512_484_532,
  size_label: "2.3 GiB",
  tier: "around-2gb",
  availability: "available",
  type: "text_to_audio",
  capabilities: ["text_to_audio", "tts"],
  voices: [{ id: "synthetic-reference", display_name: "Synthetic Reference", language: "ru-RU", gender: "neutral", sample_rate: 24000, notes: "Deterministic local reference" }],
  adapter: "qwen3_tts",
  runtime: "in_process",
  mode: "turn_based",
  language_notes: "Russian-capable Qwen3-TTS Base",
  hardware_notes: "CPU smoke runnable",
  install_notes: "Install Qwen3",
  supports_prompt: true,
  supports_streaming: false,
  input_sample_rate: 16000,
  output_sample_rate: 24000,
  status: "not_loaded",
};

const rhvoiceModel = {
  id: "rhvoice-russian-core-and-voices",
  display_name: "RHVoice Russian Core and Voices",
  hf_repo: null,
  source_url: "https://github.com/RHVoice",
  license: "GPL-2.0/voice-specific licenses",
  size_bytes: 32_505_856,
  size_label: "31 MiB",
  tier: "lightweight",
  availability: "available",
  type: "text_to_audio",
  capabilities: ["text_to_audio", "tts"],
  voices: [
    { id: "anna", display_name: "Anna", language: "ru-RU", gender: "female", sample_rate: 24000 },
    { id: "aleksandr", display_name: "Aleksandr", language: "ru-RU", gender: "male", sample_rate: 24000 },
  ],
  adapter: "rhvoice_tts",
  runtime: "in_process",
  mode: "turn_based",
  language_notes: "Native RHVoice Russian runtime",
  hardware_notes: "Requires local RHVoice native dylib",
  install_notes: "Run scripts/install-rhvoice-runtime.py",
  supports_prompt: true,
  supports_streaming: false,
  input_sample_rate: 16000,
  output_sample_rate: 24000,
  status: "not_loaded",
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

function setupFetch(options: { loadFails?: boolean; ttsUnloaded?: boolean } = {}) {
  let runtime = { model_id: null as string | null, status: "not_loaded", detail: null as string | null };
  const calls: FetchCall[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : undefined;
    calls.push({ url, method, body });

    if (url.endsWith("/api/models") && method === "GET") {
      return jsonResponse({
        models: [s2sModel, piperDenisModel, piperDmitriModel, vitsLowModel, f5MlxModel, qwen3TtsModel, rhvoiceModel, sileroModel, vosk08Model, vosk09Model].map((model) => ({
          ...model,
          status: runtime.model_id === model.id ? runtime.status : "not_loaded",
          status_detail: runtime.model_id === model.id ? runtime.detail : null,
        })),
      });
    }

    if (url.endsWith("/api/runtime") && method === "GET") {
      return jsonResponse(runtime);
    }

    const loadMatch = url.match(/\/api\/models\/([^/]+)\/load$/);
    if (loadMatch && method === "POST") {
      const modelId = decodeURIComponent(loadMatch[1]);
      runtime = options.loadFails ? { model_id: modelId, status: "failed", detail: "Runtime missing" } : { model_id: modelId, status: "ready", detail: "Loaded" };
      return jsonResponse(runtime);
    }

    if (loadMatch && method === "DELETE") {
      const modelId = decodeURIComponent(loadMatch[1]);
      if (runtime.model_id === modelId) {
        runtime = { model_id: null, status: "not_loaded", detail: null };
      }
      return jsonResponse({ model_id: modelId, status: "not_loaded", detail: null });
    }

    if (url.endsWith("/api/sessions") && method === "POST") {
      return jsonResponse({
        session_id: "sess_test",
        model_id: "qwen2-5-omni-3b",
        persona_prompt: "test",
        mode: "turn_based",
        created_at: "now",
        active: true,
      });
    }

    if (url.endsWith("/api/tts") && method === "POST") {
      if (options.ttsUnloaded) {
        return jsonResponse({ detail: { code: "model_not_loaded", message: "Model is not loaded" } }, 409);
      }
      return jsonResponse({
        turn_id: "turn_tts",
        status: "completed",
        audio_url: "/api/tts/turn_tts/audio",
        text: "Привет",
        latency_ms: 42,
        events: [],
        metrics: {},
        warnings: [],
      });
    }

    return jsonResponse({});
  });

  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

describe("App", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows distinct S2S and TTS modes and selecting a model does not load it", async () => {
    const user = userEvent.setup();
    const { calls } = setupFetch();

    render(<App />);

    expect(await screen.findByRole("button", { name: "S2S" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "TTS" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Модель" }), "vosk-tts-ru-0-9-multi");

    expect(screen.getByLabelText("Выбрана модель")).toHaveTextContent("Vosk Russian TTS 0.9 Multi");
    expect(screen.getByLabelText("Загруженная модель")).toHaveTextContent("-");
    expect(calls.some((call) => call.url.includes("/load"))).toBe(false);
  });

  it("keeps runtime state out of the model dropdown labels", async () => {
    const user = userEvent.setup();
    setupFetch();

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "TTS" }));

    expect(screen.getByRole("option", { name: /Piper Russian Denis Medium/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /Piper Russian Dmitri Medium/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /Utrobin VITS Low Russian Multispeaker/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /F5 Russian MLX 4-bit/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /Qwen3-TTS 0\.6B Base/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /RHVoice Russian Core and Voices/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /Silero V5 CIS Russian Base/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /Vosk Russian TTS 0.8 Multi/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /Vosk Russian TTS 0.9 Multi/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /63 MB · мужчина · Piper Russian Denis Medium · available/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /100MB · мужчина\+женщина · Utrobin VITS Low Russian Multispeaker · available/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /250MB · референс-голос · F5 Russian MLX 4-bit · available/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /2GB · референс-голос · Qwen3-TTS 0\.6B Base · available/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /31 MiB · мужчина\+женщина · RHVoice Russian Core and Voices · available/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /100MB · мужчина\+женщина · Silero V5 CIS Russian Base · available/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /1GB · мужчина\+женщина · Vosk Russian TTS 0.8 Multi · available_obsolete/ })).toBeVisible();
    expect(screen.queryByRole("option", { name: /готово|not_loaded|ready|failed|loading/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Qwen3-TTS-12Hz-0\.6B-Base/ })).not.toBeInTheDocument();
  });

  it("renders runnable RHVoice as a selectable TTS model", async () => {
    const user = userEvent.setup();
    setupFetch();

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "TTS" }));

    expect(screen.getByRole("option", { name: /RHVoice Russian Core and Voices/ })).toBeVisible();
  });

  it("renders expanded catalog metadata and voice details without model-specific branches", async () => {
    const user = userEvent.setup();
    setupFetch();

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "TTS" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Модель" }), "vosk-tts-ru-0-8-multi");

    expect(screen.getByLabelText("Метаданные модели")).toHaveTextContent("Источник");
    expect(screen.getByLabelText("Метаданные модели")).toHaveTextContent("https://alphacephei.com/vosk/models/vosk-model-tts-ru-0.8-multi.zip");
    expect(screen.getByLabelText("Метаданные модели")).toHaveTextContent("Apache-2.0");
    expect(screen.getByLabelText("Метаданные модели")).toHaveTextContent("767 MiB");
    expect(screen.getByLabelText("Метаданные модели")).toHaveTextContent("around-1gb");
    expect(screen.getByLabelText("Метаданные модели")).toHaveTextContent("available_obsolete");
    expect(screen.getByLabelText("Голоса модели")).toHaveTextContent("F01");
    expect(screen.getByLabelText("Голоса модели")).toHaveTextContent("ru-RU · female · 22050 Hz · female");
  });

  it("starts and stops models through explicit lifecycle endpoints", async () => {
    const user = userEvent.setup();
    const { calls } = setupFetch();

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "TTS" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Модель" }), "piper-ru-ru-denis-medium");
    await user.click(screen.getByRole("button", { name: /запустить модель/i }));

    expect(calls).toContainEqual(expect.objectContaining({ method: "POST", url: `${API_BASE_URL}/api/models/piper-ru-ru-denis-medium/load` }));
    await waitFor(() => expect(screen.getByLabelText("Загруженная модель")).toHaveTextContent("Piper Russian Denis Medium"));

    await user.selectOptions(screen.getByRole("combobox", { name: "Модель" }), "vosk-tts-ru-0-9-multi");
    await user.click(screen.getByRole("button", { name: /запустить модель/i }));

    expect(calls).toContainEqual(expect.objectContaining({ method: "DELETE", url: `${API_BASE_URL}/api/models/piper-ru-ru-denis-medium/load` }));
    expect(calls).toContainEqual(expect.objectContaining({ method: "POST", url: `${API_BASE_URL}/api/models/vosk-tts-ru-0-9-multi/load` }));

    await user.click(screen.getByRole("button", { name: /остановить модель/i }));
    expect(calls).toContainEqual(expect.objectContaining({ method: "DELETE", url: `${API_BASE_URL}/api/models/vosk-tts-ru-0-9-multi/load` }));
  });

  it("keeps TTS generation disabled until runtime is ready and surfaces unloaded errors", async () => {
    const user = userEvent.setup();
    setupFetch({ ttsUnloaded: true });

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "TTS" }));
    expect(screen.getByRole("button", { name: /сгенерировать/i })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /запустить модель/i }));
    await user.type(screen.getByLabelText(/текст/i), "Привет");
    await user.click(screen.getByRole("button", { name: /сгенерировать/i }));

    expect(await screen.findByText(/Model is not loaded/i)).toBeVisible();
  });

  it("shows failed load details", async () => {
    const user = userEvent.setup();
    setupFetch({ loadFails: true });

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "TTS" }));
    await user.click(screen.getByRole("button", { name: /запустить модель/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Runtime missing");
  });

  it("loads the S2S model before creating a session when backend runtime is not ready", async () => {
    const user = userEvent.setup();
    const { calls } = setupFetch({ loadFails: true });

    render(<App />);

    await user.click(await screen.findByRole("button", { name: /начать звонок/i }));

    await waitFor(() => {
      expect(calls).toContainEqual(expect.objectContaining({ method: "POST", url: `${API_BASE_URL}/api/models/qwen2-5-omni-3b/load` }));
    });
    expect(calls.some((call) => call.url.endsWith("/api/sessions"))).toBe(false);
    expect(await screen.findByRole("alert")).toHaveTextContent("Runtime missing");
  });
});
