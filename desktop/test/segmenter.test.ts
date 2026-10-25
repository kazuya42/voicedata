import { describe, expect, test } from 'vitest';
import { ChunkSegmenter } from '../src/shared/segmenter';
import type { AudioChunk } from '../src/shared/types';

const RATE = 16000;
const BLOCK_MS = 100;
const BLOCK = (RATE * BLOCK_MS) / 1000;

const tone = (ms: number) => {
  const out = new Float32Array((RATE * ms) / 1000);
  for (let i = 0; i < out.length; i++) out[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / RATE);
  return out;
};
const silence = (ms: number) => new Float32Array((RATE * ms) / 1000);

// Speist Audio in 100-ms-Blöcken ein, wie es die Live-Pipeline tut.
function feed(seg: ChunkSegmenter, pcm: Float32Array, clock: { now: number }) {
  for (let i = 0; i < pcm.length; i += BLOCK) {
    clock.now += BLOCK_MS;
    seg.push(pcm.subarray(i, i + BLOCK), clock.now);
  }
}

function setup() {
  const chunks: AudioChunk[] = [];
  const seg = new ChunkSegmenter('mic', (c) => chunks.push(c));
  return { chunks, seg, clock: { now: 1_000_000 } };
}

describe('ChunkSegmenter', () => {
  test('cuts nothing before the minimum length even after a pause', () => {
    const { chunks, seg, clock } = setup();
    feed(seg, tone(3000), clock);
    feed(seg, silence(1000), clock);
    expect(chunks).toHaveLength(0);
  });

  test('cuts at the first 700 ms pause once 5 s are buffered', () => {
    const { chunks, seg, clock } = setup();
    feed(seg, tone(6000), clock);
    feed(seg, silence(1000), clock);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].pcm.length).toBe(RATE * 6.7);
    expect(chunks[0].channel).toBe('mic');
    expect(chunks[0].endedAt - chunks[0].startedAt).toBe(6700);
  });

  test('forces a cut at 20 s of continuous speech and keeps the rest until flush', () => {
    const { chunks, seg, clock } = setup();
    feed(seg, tone(25000), clock);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].pcm.length).toBe(RATE * 20);
    seg.flush();
    expect(chunks).toHaveLength(2);
    expect(chunks[1].pcm.length).toBe(RATE * 5);
    expect(chunks[1].startedAt).toBe(chunks[0].endedAt);
  });

  test('drops pure silence', () => {
    const { chunks, seg, clock } = setup();
    feed(seg, silence(8000), clock);
    seg.flush();
    expect(chunks).toHaveLength(0);
  });

  test('drops chunks with less than 300 ms of voice', () => {
    const { chunks, seg, clock } = setup();
    feed(seg, silence(3000), clock);
    feed(seg, tone(200), clock);
    feed(seg, silence(2800), clock);
    seg.flush();
    expect(chunks).toHaveLength(0);
  });
});
