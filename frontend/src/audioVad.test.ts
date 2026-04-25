import { describe, expect, it } from "vitest";
import { UtteranceVad } from "./audioVad";

describe("UtteranceVad", () => {
  it("stays idle on silence", () => {
    const vad = new UtteranceVad();
    const event = vad.process(new Float32Array(2048), 16000);
    expect(event.type).toBe("idle");
  });

  it("detects speech start", () => {
    const vad = new UtteranceVad();
    const input = new Float32Array(2048).fill(0.2);
    const event = vad.process(input, 16000);
    expect(event.type).toBe("speech-start");
  });

  it("flushes an utterance after speech and silence", () => {
    const vad = new UtteranceVad();
    for (let i = 0; i < 3; i += 1) vad.process(new Float32Array(2048).fill(0.2), 16000);
    let event = vad.process(new Float32Array(4096), 16000);
    if (event.type !== "utterance") event = vad.process(new Float32Array(4096), 16000);
    expect(event.type).toBe("utterance");
  });
});
