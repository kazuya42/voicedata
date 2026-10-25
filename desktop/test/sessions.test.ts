import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { SessionStore, toMarkdown } from '../src/main/sessions';
import type { AudioChunk, Segment } from '../src/shared/types';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-sessions-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const T0 = Date.UTC(2026, 9, 25, 10, 0, 0);
const MIN = 60_000;
const chunk = (startedAt: number, ms = 10_000): AudioChunk => ({
  channel: 'mic',
  startedAt,
  endedAt: startedAt + ms,
  voicedMs: ms,
  pcm: new Float32Array(0),
});
const segment = (id: string, startedAt: number): Segment => ({
  id,
  channel: 'system',
  startedAt,
  endedAt: startedAt + 1000,
  text: id,
  status: 'ok',
});

describe('SessionStore', () => {
  test('chunks within the idle window share a session', () => {
    const store = new SessionStore(dir);
    const a = store.sessionForChunk(chunk(T0));
    const b = store.sessionForChunk(chunk(T0 + MIN));
    expect(b).toBe(a);
  });

  test('a gap over 5 minutes closes the meeting and starts a new one', () => {
    const store = new SessionStore(dir);
    const a = store.sessionForChunk(chunk(T0));
    const b = store.sessionForChunk(chunk(T0 + 10_000 + 6 * MIN));
    expect(b).not.toBe(a);
    expect(store.get(a)?.endedAt).toBe(T0 + 10_000);
    expect(store.get(b)?.endedAt).toBeNull();
  });

  test('segments arriving out of order are stored sorted by start', () => {
    const store = new SessionStore(dir);
    const id = store.sessionForChunk(chunk(T0));
    store.appendSegment(id, segment('late', T0 + 5000));
    store.appendSegment(id, segment('early', T0 + 1000));
    expect(store.get(id)?.segments.map((s) => s.id)).toEqual(['early', 'late']);
  });

  test('sessions left open by a crash are closed on startup', () => {
    const first = new SessionStore(dir);
    const id = first.sessionForChunk(chunk(T0));
    first.appendSegment(id, segment('x', T0 + 2000));
    const reopened = new SessionStore(dir);
    expect(reopened.get(id)?.endedAt).toBe(T0 + 3000);
  });

  test('list skips corrupt files', () => {
    const store = new SessionStore(dir);
    store.sessionForChunk(chunk(T0));
    fs.writeFileSync(path.join(dir, 'broken.json'), '{nope');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(store.list()).toHaveLength(1);
    spy.mockRestore();
  });

  test('delete removes transcript and stored failed audio', () => {
    const store = new SessionStore(dir);
    const id = store.sessionForChunk(chunk(T0));
    const wav = store.saveFailedAudio(id, 'seg', new Float32Array(160));
    expect(fs.existsSync(wav)).toBe(true);
    store.delete(id);
    expect(store.get(id)).toBeNull();
    expect(fs.existsSync(wav)).toBe(false);
    expect(store.list()).toHaveLength(0);
  });

  test('markdown labels speakers and failed segments', () => {
    const store = new SessionStore(dir);
    const id = store.sessionForChunk(chunk(T0));
    store.appendSegment(id, { ...segment('a', T0), channel: 'mic', text: 'Hallo zusammen' });
    store.appendSegment(id, {
      ...segment('b', T0 + 2000),
      status: 'failed',
      text: '',
      error: 'HTTP 401',
    });
    const md = toMarkdown(store.get(id)!);
    expect(md).toContain('Ich:** Hallo zusammen');
    expect(md).toContain('Teilnehmer:** _(Transkription fehlgeschlagen: HTTP 401)_');
  });
});
