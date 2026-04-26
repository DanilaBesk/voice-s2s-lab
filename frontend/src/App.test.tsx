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

const denisModel = {
  id: "piper-ru-ru-denis-medium",
  display_name: "Piper ru_RU Denis medium",
  hf_repo: null,
  source_url: "https://huggingface.co/rhasspy/piper-voices",
  license: "MIT",
  size_bytes: 63_000_000,
  size_label: "63 MB",
  tier: "lightweight",
  availability: "available",
  type: "text_to_audio",
  capabilities: ["text_to_audio", "tts"],
  voices: [{ id: "ru_RU-denis-medium", display_name: "Denis", language: "ru-RU", gender: "male", sample_rate: 22050, notes: "clear narration" }],
  adapter: "piper_tts",
  runtime: "subprocess",
  mode: "turn_based",
  language_notes: "Russian TTS",
  hardware_notes: "CPU",
  install_notes: "Install piper",
  supports_prompt: false,
  supports_streaming: false,
  input_sample_rate: 22050,
  output_sample_rate: 22050,
  status: "not_loaded",
};

const dmitriModel = {
  ...denisModel,
  id: "piper-ru-ru-dmitri-medium",
  display_name: "Piper ru_RU Dmitri medium",
  voices: [{ id: "ru_RU-dmitri-medium", display_name: "Dmitri", language: "ru-RU", gender: "male", sample_rate: 22050 }],
};

const catalogOnlyModel = {
  ...denisModel,
  id: "catalog-only-small-tts",
  display_name: "Catalog-only small TTS",
  hf_repo: "example/catalog-only-small-tts",
  source_url: null,
  license: "Apache-2.0",
  size_bytes: 250_000_000,
  size_label: null,
  tier: "candidate-250mb",
  availability: "catalog_only",
  voices: [
    { id: "catalog-small-female", display_name: "Catalog Female", language: "ru-RU", gender: "female", sample_rate: 24000, notes: "catalog preview" },
    { id: "catalog-small-male", display_name: "Catalog Male", language: "ru-RU", gender: "male", sample_rate: 24000, notes: null },
  ],
  adapter: "catalog_only_tts",
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
        models: [s2sModel, denisModel, dmitriModel, catalogOnlyModel].map((model) => ({
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
      if (modelId === catalogOnlyModel.id) {
        return jsonResponse({ detail: { code: "catalog_only", message: "Catalog-only candidate cannot be loaded yet" } }, 409);
      }
      runtime = options.loadFails ? { model_id: modelId, status: "failed", detail: "Piper runtime missing" } : { model_id: modelId, status: "ready", detail: "Loaded" };
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
    await user.selectOptions(screen.getByRole("combobox", { name: "Модель" }), "piper-ru-ru-dmitri-medium");

    expect(screen.getByLabelText("Выбрана модель")).toHaveTextContent("Piper ru_RU Dmitri medium");
    expect(screen.getByLabelText("Загруженная модель")).toHaveTextContent("-");
    expect(calls.some((call) => call.url.includes("/load"))).toBe(false);
  });

  it("keeps runtime state out of the model dropdown labels", async () => {
    const user = userEvent.setup();
    setupFetch();

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "TTS" }));

    expect(screen.getByRole("option", { name: /Piper ru_RU Denis medium/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /Piper ru_RU Dmitri medium/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /63 MB · мужчина · Piper ru_RU Denis medium · available/ })).toBeVisible();
    expect(screen.queryByRole("option", { name: /готово|not_loaded|ready|failed|loading/i })).not.toBeInTheDocument();
  });

  it("renders expanded catalog metadata and voice details without model-specific branches", async () => {
    const user = userEvent.setup();
    setupFetch();

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "TTS" }));

    expect(screen.getByLabelText("Метаданные модели")).toHaveTextContent("Источник");
    expect(screen.getByLabelText("Метаданные модели")).toHaveTextContent("https://huggingface.co/rhasspy/piper-voices");
    expect(screen.getByLabelText("Метаданные модели")).toHaveTextContent("MIT");
    expect(screen.getByLabelText("Метаданные модели")).toHaveTextContent("63 MB");
    expect(screen.getByLabelText("Метаданные модели")).toHaveTextContent("lightweight");
    expect(screen.getByLabelText("Метаданные модели")).toHaveTextContent("available");
    expect(screen.getByLabelText("Голоса модели")).toHaveTextContent("Denis");
    expect(screen.getByLabelText("Голоса модели")).toHaveTextContent("ru-RU · male · 22050 Hz · clear narration");

    await user.selectOptions(screen.getByRole("combobox", { name: "Модель" }), "catalog-only-small-tts");

    expect(screen.getByLabelText("Метаданные модели")).toHaveTextContent("example/catalog-only-small-tts");
    expect(screen.getByLabelText("Метаданные модели")).toHaveTextContent("Apache-2.0");
    expect(screen.getByLabelText("Метаданные модели")).toHaveTextContent("238 MB");
    expect(screen.getByLabelText("Метаданные модели")).toHaveTextContent("candidate-250mb");
    expect(screen.getByLabelText("Метаданные модели")).toHaveTextContent("catalog_only");
    expect(screen.getByLabelText("Голоса модели")).toHaveTextContent("Catalog Female");
    expect(screen.getByLabelText("Голоса модели")).toHaveTextContent("ru-RU · female · 24000 Hz · catalog preview");
  });

  it("starts and stops models through explicit lifecycle endpoints", async () => {
    const user = userEvent.setup();
    const { calls } = setupFetch();

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "TTS" }));
    await user.click(screen.getByRole("button", { name: /запустить модель/i }));

    expect(calls).toContainEqual(expect.objectContaining({ method: "POST", url: `${API_BASE_URL}/api/models/piper-ru-ru-denis-medium/load` }));
    await waitFor(() => expect(screen.getByLabelText("Загруженная модель")).toHaveTextContent("Piper ru_RU Denis medium"));

    await user.selectOptions(screen.getByRole("combobox", { name: "Модель" }), "piper-ru-ru-dmitri-medium");
    await user.click(screen.getByRole("button", { name: /запустить модель/i }));

    expect(calls).toContainEqual(expect.objectContaining({ method: "DELETE", url: `${API_BASE_URL}/api/models/piper-ru-ru-denis-medium/load` }));
    expect(calls).toContainEqual(expect.objectContaining({ method: "POST", url: `${API_BASE_URL}/api/models/piper-ru-ru-dmitri-medium/load` }));

    await user.click(screen.getByRole("button", { name: /остановить модель/i }));
    expect(calls).toContainEqual(expect.objectContaining({ method: "DELETE", url: `${API_BASE_URL}/api/models/piper-ru-ru-dmitri-medium/load` }));
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

    expect(await screen.findByRole("alert")).toHaveTextContent("Piper runtime missing");
  });

  it("keeps catalog-only load errors visible", async () => {
    const user = userEvent.setup();
    setupFetch();

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "TTS" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Модель" }), "catalog-only-small-tts");
    await user.click(screen.getByRole("button", { name: /запустить модель/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Catalog-only candidate cannot be loaded yet");

    await user.selectOptions(screen.getByRole("combobox", { name: "Модель" }), "piper-ru-ru-denis-medium");
    expect(screen.getByRole("alert")).toHaveTextContent("Catalog-only candidate cannot be loaded yet");
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
    expect(await screen.findByRole("alert")).toHaveTextContent("Piper runtime missing");
  });
});
