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
        models: [s2sModel, vosk08Model, vosk09Model].map((model) => ({
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
      runtime = options.loadFails ? { model_id: modelId, status: "failed", detail: "Vosk runtime missing" } : { model_id: modelId, status: "ready", detail: "Loaded" };
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

    expect(screen.getByRole("option", { name: /Vosk Russian TTS 0.8 Multi/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /Vosk Russian TTS 0.9 Multi/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /1GB · мужчина\+женщина · Vosk Russian TTS 0.8 Multi · available_obsolete/ })).toBeVisible();
    expect(screen.queryByRole("option", { name: /готово|not_loaded|ready|failed|loading/i })).not.toBeInTheDocument();
  });

  it("renders expanded catalog metadata and voice details without model-specific branches", async () => {
    const user = userEvent.setup();
    setupFetch();

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "TTS" }));

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
    await user.click(screen.getByRole("button", { name: /запустить модель/i }));

    expect(calls).toContainEqual(expect.objectContaining({ method: "POST", url: `${API_BASE_URL}/api/models/vosk-tts-ru-0-8-multi/load` }));
    await waitFor(() => expect(screen.getByLabelText("Загруженная модель")).toHaveTextContent("Vosk Russian TTS 0.8 Multi"));

    await user.selectOptions(screen.getByRole("combobox", { name: "Модель" }), "vosk-tts-ru-0-9-multi");
    await user.click(screen.getByRole("button", { name: /запустить модель/i }));

    expect(calls).toContainEqual(expect.objectContaining({ method: "DELETE", url: `${API_BASE_URL}/api/models/vosk-tts-ru-0-8-multi/load` }));
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

    expect(await screen.findByRole("alert")).toHaveTextContent("Vosk runtime missing");
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
    expect(await screen.findByRole("alert")).toHaveTextContent("Vosk runtime missing");
  });
});
