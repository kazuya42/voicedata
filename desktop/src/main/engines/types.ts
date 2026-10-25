import type { Language } from '../../shared/types';

export interface Engine {
  // pcm: 16 kHz mono. prompt: Kontext aus dem vorherigen Segment (nur OpenAI nutzt ihn).
  transcribe(pcm: Float32Array, opts: { language: Language; prompt?: string }): Promise<string>;
}
