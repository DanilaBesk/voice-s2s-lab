const configuredBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").trim();

export const API_BASE_URL =
  configuredBaseUrl || (typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:8000");

export type ModelEntry = {
  id: string;
  display_name: string;
  hf_repo?: string | null;
  type: "audio_to_audio" | "text_to_audio" | "pipeline" | "mock";
  capabilities: Array<"audio_to_audio" | "text_to_audio" | "tts">;
  voices: VoiceMetadata[];
  adapter: string;
  runtime: "in_process" | "subprocess" | "docker";
  mode: "turn_based" | "streaming";
  language_notes: string;
  hardware_notes: string;
  install_notes: string;
  supports_prompt: boolean;
  supports_streaming: boolean;
  input_sample_rate: number;
  output_sample_rate: number;
  default?: boolean;
  status: string;
  status_detail?: string | null;
};

export type VoiceMetadata = {
  id: string;
  display_name: string;
  language: string;
  gender?: string | null;
  sample_rate?: number | null;
  notes?: string | null;
};

export type RuntimeResponse = {
  model_id: string | null;
  status: string;
  detail: string | null;
};

export type SessionResponse = {
  session_id: string;
  model_id: string;
  persona_prompt: string;
  mode: string;
  created_at: string;
  active: boolean;
};

export type TurnResponse = {
  turn_id: string;
  session_id: string;
  status: string;
  audio_url: string | null;
  text: string | null;
  latency_ms: number;
  events: Array<{ ts: string; type: string; message: string; data: Record<string, unknown> }>;
  metrics: Record<string, unknown>;
  warnings: string[];
};

export type TtsResponse = Omit<TurnResponse, "session_id">;

export async function fetchModels(): Promise<ModelEntry[]> {
  const response = await fetch(`${API_BASE_URL}/api/models`);
  if (!response.ok) throw new Error(await responseErrorMessage(response));
  return (await response.json()).models;
}

export async function fetchRuntime(): Promise<RuntimeResponse> {
  const response = await fetch(`${API_BASE_URL}/api/runtime`);
  if (!response.ok) throw new Error(await responseErrorMessage(response));
  return response.json();
}

export async function loadModel(modelId: string): Promise<RuntimeResponse> {
  const response = await fetch(`${API_BASE_URL}/api/models/${encodeURIComponent(modelId)}/load`, { method: "POST" });
  if (!response.ok) throw new Error(await responseErrorMessage(response));
  return response.json();
}

export async function unloadModel(modelId: string): Promise<RuntimeResponse> {
  const response = await fetch(`${API_BASE_URL}/api/models/${encodeURIComponent(modelId)}/load`, { method: "DELETE" });
  if (!response.ok) throw new Error(await responseErrorMessage(response));
  return response.json();
}

export async function createSession(modelId: string, personaPrompt: string): Promise<SessionResponse> {
  const response = await fetch(`${API_BASE_URL}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model_id: modelId, persona_prompt: personaPrompt, mode: "turn_based" }),
  });
  if (!response.ok) throw new Error(await responseErrorMessage(response));
  return response.json();
}

export async function submitTurn(sessionId: string, audioBlob: Blob, options: Record<string, unknown> = {}): Promise<TurnResponse> {
  const form = new FormData();
  const filename = audioBlob.type.includes("wav") ? "turn.wav" : "turn.webm";
  form.append("audio", audioBlob, filename);
  form.append("options", JSON.stringify(options));
  const response = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}/turns`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) throw new Error(await responseErrorMessage(response));
  return response.json();
}

export async function generateTts(modelId: string, text: string, voice?: string, options: Record<string, unknown> = {}): Promise<TtsResponse> {
  const response = await fetch(`${API_BASE_URL}/api/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model_id: modelId, text, voice: voice || undefined, options }),
  });
  if (!response.ok) throw new Error(await responseErrorMessage(response));
  return response.json();
}

export async function interruptSession(sessionId: string): Promise<void> {
  await fetch(`${API_BASE_URL}/api/sessions/${sessionId}/interrupt`, { method: "POST" });
}

async function responseErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const payload = await response.json();
      const detail = payload?.detail;
      if (typeof detail === "string") return detail;
      if (detail?.message) return String(detail.message);
      if (detail?.detail) return typeof detail.detail === "string" ? detail.detail : JSON.stringify(detail.detail);
      if (detail?.code) return String(detail.code);
      if (payload?.message) return String(payload.message);
      return JSON.stringify(payload);
    } catch {
      return `${response.status} ${response.statusText}`.trim();
    }
  }
  const text = await response.text();
  return text || `${response.status} ${response.statusText}`.trim();
}
