// Zerlegt einen kontinuierlichen 16-kHz-Audiostrom in Transkriptions-Chunks.
// Schnitt bevorzugt an Sprechpausen (keine zerschnittenen Wörter), spätestens nach maxMs.
// Chunks ohne nennenswerte Sprache werden verworfen (verhindert Whisper-Halluzinationen bei Stille).
import type { AudioChunk, Channel } from './types';
import { TARGET_RATE, rms } from './audio';

export type SegmenterOptions = {
  minMs: number;
  maxMs: number;
  silenceMs: number;
  frameMs: number;
  silenceRms: number;
  minVoicedMs: number;
};

const DEFAULTS: SegmenterOptions = {
  minMs: 5000,
  maxMs: 20000,
  silenceMs: 700,
  frameMs: 100,
  silenceRms: 0.01,
  minVoicedMs: 300,
};

const SAMPLES_PER_MS = TARGET_RATE / 1000;

export class ChunkSegmenter {
  private readonly opts: SegmenterOptions;
  private readonly frameSamples: number;
  private parts: Float32Array[] = [];
  private length = 0;
  private startedAt = 0;
  // RMS-Werte vollständiger Frames des aktuellen Chunks; pending sammelt den angefangenen Frame.
  private frameVoiced: boolean[] = [];
  private pending = new Float32Array(0);

  constructor(
    private readonly channel: Channel,
    private readonly onChunk: (c: AudioChunk) => void,
    opts?: Partial<SegmenterOptions>,
  ) {
    this.opts = { ...DEFAULTS, ...opts };
    this.frameSamples = this.opts.frameMs * SAMPLES_PER_MS;
  }

  push(pcm16k: Float32Array, now: number): void {
    if (pcm16k.length === 0) return;
    if (this.length === 0) this.startedAt = Math.round(now - pcm16k.length / SAMPLES_PER_MS);
    this.parts.push(pcm16k);
    this.length += pcm16k.length;

    const merged = new Float32Array(this.pending.length + pcm16k.length);
    merged.set(this.pending);
    merged.set(pcm16k, this.pending.length);
    let offset = 0;
    while (merged.length - offset >= this.frameSamples) {
      this.frameVoiced.push(
        rms(merged, offset, offset + this.frameSamples) >= this.opts.silenceRms,
      );
      offset += this.frameSamples;
    }
    this.pending = merged.slice(offset);

    const bufferedMs = this.length / SAMPLES_PER_MS;
    if (bufferedMs >= this.opts.maxMs) {
      this.cut();
      return;
    }
    const silenceFrames = Math.ceil(this.opts.silenceMs / this.opts.frameMs);
    if (
      bufferedMs >= this.opts.minMs &&
      this.frameVoiced.length >= silenceFrames &&
      this.frameVoiced.slice(-silenceFrames).every((v) => !v)
    ) {
      this.cut();
    }
  }

  flush(): void {
    if (this.length > 0) this.cut();
  }

  private cut(): void {
    const pcm = new Float32Array(this.length);
    let offset = 0;
    for (const p of this.parts) {
      pcm.set(p, offset);
      offset += p.length;
    }
    const voicedMs = this.frameVoiced.filter(Boolean).length * this.opts.frameMs;
    const startedAt = this.startedAt;
    this.parts = [];
    this.length = 0;
    this.frameVoiced = [];
    this.pending = new Float32Array(0);
    if (voicedMs < this.opts.minVoicedMs) return;
    this.onChunk({
      channel: this.channel,
      startedAt,
      endedAt: startedAt + Math.round(pcm.length / SAMPLES_PER_MS),
      voicedMs,
      pcm,
    });
  }
}
