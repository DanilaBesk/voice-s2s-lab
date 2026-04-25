import { describe, expect, it } from "vitest";
import { encodePcmToWav, resampleLinear } from "./audioUtils";

describe("audioUtils", () => {
  it("keeps samples when sample rate is unchanged", () => {
    const input = new Float32Array([0, 0.5, -0.5]);
    expect(Array.from(resampleLinear(input, 16000, 16000))).toEqual(Array.from(input));
  });

  it("resamples to a different sample rate", () => {
    const input = new Float32Array([0, 1, 0, -1]);
    const output = resampleLinear(input, 4, 8);
    expect(output.length).toBe(8);
  });

  it("encodes wav output", async () => {
    const wav = encodePcmToWav(new Float32Array([0, 0.25, -0.25]), 16000);
    expect(wav.type).toBe("audio/wav");
    expect(wav.size).toBeGreaterThan(44);
  });
});
