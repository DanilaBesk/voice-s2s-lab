const configuredBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").trim();

export const API_BASE_URL =
  configuredBaseUrl || (typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:8000");

export type ModelEntry = {
  id: string;
  display_name: string;
  hf_repo?: string | null;
  type: "audio_to_audio" | "pipeline" | "mock";
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

export async function fetchModels(): Promise<ModelEntry[]> {
  const response = await fetch(`${API_BASE_URL}/api/models`);
  if (!response.ok) throw new Error(`Failed to load models: ${response.status}`);
  return (await response.json()).models;
}

export async function createSession(modelId: string, personaPrompt: string): Promise<SessionResponse> {
  const response = await fetch(`${API_BASE_URL}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model_id: modelId, persona_prompt: personaPrompt, mode: "turn_based" }),
  });
  if (!response.ok) throw new Error(await response.text());
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
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function interruptSession(sessionId: string): Promise<void> {
  await fetch(`${API_BASE_URL}/api/sessions/${sessionId}/interrupt`, { method: "POST" });
}
