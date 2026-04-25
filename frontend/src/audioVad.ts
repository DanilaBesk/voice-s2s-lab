export type VadEvent =
  | { type: "speech-start"; level: number }
  | { type: "idle"; level: number }
  | { type: "utterance"; level: number; samples: Float32Array };

const START_THRESHOLD = 0.02;
const END_THRESHOLD = 0.01;
const MIN_SPEECH_MS = 250;
const SILENCE_MS = 500;

export class UtteranceVad {
  private speaking = false;
  private collected: number[] = [];
  private speechMs = 0;
  private silenceMs = 0;

  process(chunk: Float32Array, sampleRate: number): VadEvent {
    const level = rms(chunk);
    const chunkMs = (chunk.length / sampleRate) * 1000;

    if (!this.speaking) {
      if (level >= START_THRESHOLD) {
        this.speaking = true;
        this.collected.push(...chunk);
        this.speechMs = chunkMs;
        this.silenceMs = 0;
        return { type: "speech-start", level };
      }
      return { type: "idle", level };
    }

    this.collected.push(...chunk);
    if (level >= END_THRESHOLD) {
      this.speechMs += chunkMs;
      this.silenceMs = 0;
      return { type: "idle", level };
    }

    this.silenceMs += chunkMs;
    if (this.speechMs >= MIN_SPEECH_MS && this.silenceMs >= SILENCE_MS) {
      const samples = Float32Array.from(this.collected);
      this.reset();
      return { type: "utterance", level, samples };
    }

    return { type: "idle", level };
  }

  flushPending(): Float32Array | null {
    if (this.collected.length === 0 || this.speechMs < MIN_SPEECH_MS) {
      this.reset();
      return null;
    }
    const samples = Float32Array.from(this.collected);
    this.reset();
    return samples;
  }

  reset() {
    this.speaking = false;
    this.collected = [];
    this.speechMs = 0;
    this.silenceMs = 0;
  }
}

function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let total = 0;
  for (const sample of samples) total += sample * sample;
  return Math.sqrt(total / samples.length);
}
