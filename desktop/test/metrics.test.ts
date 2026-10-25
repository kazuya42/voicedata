import { describe, expect, test } from 'vitest';
import { computeMetrics } from '../src/shared/metrics';
import type { Segment } from '../src/shared/types';

const T0 = 1_800_000_000_000;
let n = 0;
const seg = (
  channel: Segment['channel'],
  startS: number,
  endS: number,
  text: string,
  extra: Partial<Segment> = {},
): Segment => ({
  id: `s${n++}`,
  channel,
  startedAt: T0 + startS * 1000,
  endedAt: T0 + endS * 1000,
  text,
  status: 'ok',
  ...extra,
});

describe('computeMetrics', () => {
  test('talk time uses detected speech, not chunk length', () => {
    const m = computeMetrics([
      seg('mic', 0, 20, 'eins zwei', { voicedMs: 5000 }),
      seg('system', 20, 40, 'drei vier', { voicedMs: 15000 }),
    ]);
    expect(m.talkSeconds).toEqual({ me: 5, them: 15 });
    expect(m.talkRatio.me).toBeCloseTo(0.25);
    expect(m.talkRatio.them).toBeCloseTo(0.75);
    expect(m.durationSeconds).toBe(40);
  });

  test('falls back to chunk length for segments without voicedMs', () => {
    expect(computeMetrics([seg('mic', 0, 12, 'hallo')]).talkSeconds.me).toBe(12);
  });

  test('pace is words per minute of own speech, capped and zero for too little speech', () => {
    const words = (k: number) => Array.from({ length: k }, () => 'wort').join(' ');
    expect(computeMetrics([seg('mic', 0, 60, words(130), { voicedMs: 60_000 })]).paceWpm.me).toBe(
      130,
    );
    expect(computeMetrics([seg('mic', 0, 60, words(900), { voicedMs: 60_000 })]).paceWpm.me).toBe(
      250,
    );
    expect(computeMetrics([seg('mic', 0, 3, words(10), { voicedMs: 3000 })]).paceWpm.me).toBe(0);
  });

  test('counts questions per side and ignores failed segments', () => {
    const m = computeMetrics([
      seg('mic', 0, 5, 'Passt Freitag?'),
      seg('system', 5, 10, 'Ja. Und dir?'),
      seg('system', 10, 15, 'Wirklich?', { status: 'failed', text: '' }),
    ]);
    expect(m.questionsAsked).toEqual({ me: 1, them: 1 });
    expect(m.wordCount).toEqual({ me: 2, them: 3 });
  });

  test('longest monologue joins segments with gaps under 2 s', () => {
    const m = computeMetrics([
      seg('mic', 0, 20, 'a'),
      seg('mic', 21, 40, 'b'),
      seg('mic', 50, 55, 'c'),
    ]);
    expect(m.longestMonologueSeconds.me).toBe(40);
  });

  test('empty meeting yields zeros', () => {
    const m = computeMetrics([]);
    expect(m.durationSeconds).toBe(0);
    expect(m.talkRatio).toEqual({ me: 0, them: 0 });
  });
});
