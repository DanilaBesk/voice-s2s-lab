import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

describe("App", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/api/models")) {
          return new Response(
            JSON.stringify({
              models: [
                {
                  id: "qwen2-5-omni-3b",
                  display_name: "Qwen2.5 Omni 3B",
                  hf_repo: "Qwen/Qwen2.5-Omni-3B",
                  type: "audio_to_audio",
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
                  status: "ready",
                },
              ],
            }),
          );
        }
        if (url.endsWith("/api/sessions") && init?.method === "POST") {
          return new Response(
            JSON.stringify({
              session_id: "sess_test",
              model_id: "qwen2-5-omni-3b",
              persona_prompt: "test",
              mode: "turn_based",
              created_at: "now",
              active: true,
            }),
          );
        }
        return new Response("{}", { status: 200 });
      }),
    );
  });

  it("renders one-button call controls for the qwen session", async () => {
    render(<App />);
    expect(await screen.findByLabelText(/модель/i)).toBeVisible();
    expect(await screen.findByRole("option", { name: /qwen2.5 omni 3b/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /начать звонок/i })).toBeVisible();
    expect(screen.queryByRole("button", { name: /hold to talk/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send diagnostic wav/i })).not.toBeInTheDocument();
  });
});
