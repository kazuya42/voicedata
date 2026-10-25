import { describe, expect, test } from 'vitest';

import { parseActionItems, parseKeyPoints } from '../src/main/summary';
import { buildPayload, validateWebhookUrl } from '../src/main/webhook';
import { toMarkdown } from '../src/main/sessions';
import type { Session } from '../src/shared/types';

const T0 = Date.UTC(2026, 9, 25, 10, 0, 0);
const session: Session = {
  id: 'm1',
  title: 'Planung',
  startedAt: T0,
  endedAt: T0 + 120_000,
  segments: [
    {
      id: 'a',
      channel: 'mic',
      startedAt: T0,
      endedAt: T0 + 10_000,
      voicedMs: 8000,
      text: 'Können wir Freitag liefern?',
      status: 'ok',
    },
    {
      id: 'b',
      channel: 'system',
      startedAt: T0 + 12_000,
      endedAt: T0 + 20_000,
      text: '',
      status: 'failed',
      error: 'HTTP 500',
    },
  ],
  summary: {
    overview: 'Lieferung besprochen.',
    keyPoints: [{ topic: 'Lieferung', points: ['Ich fragte nach Freitag.'] }],
    actionItems: ['Liefertermin bestätigen'],
    generatedAt: T0 + 130_000,
  },
};

describe('summary response parsing', () => {
  test('accepts fenced JSON and drops empty or non-string entries', () => {
    expect(parseActionItems('```json\n{"checklist": ["A", "", 3, "B"]}\n```')).toEqual(['A', 'B']);
    expect(parseKeyPoints('{"key_points": [{"topic": "", "points": ["x", null]}]}')).toEqual([
      { topic: 'Diskussion', points: ['x'] },
    ]);
  });

  test('accepts a bare array', () => {
    expect(parseActionItems('["Angebot senden"]')).toEqual(['Angebot senden']);
  });

  test('rejects unexpected shapes instead of returning an empty summary', () => {
    expect(() => parseActionItems('{"items": []}')).toThrow('unerwartetes Antwortformat');
    expect(() => parseKeyPoints('kein json')).toThrow();
  });
});

describe('webhook', () => {
  test('url must be http(s) without credentials; local n8n is allowed', () => {
    expect(validateWebhookUrl(' http://localhost:5678/webhook/abc ')).toBe(
      'http://localhost:5678/webhook/abc',
    );
    expect(() => validateWebhookUrl('ftp://x.de/hook')).toThrow('http:// oder https://');
    expect(() => validateWebhookUrl('https://user:pw@x.de/hook')).toThrow('Zugangsdaten');
    expect(() => validateWebhookUrl('nicht-url')).toThrow('ungültig');
  });

  test('payload carries summary, metrics and only transcribed segments', () => {
    const p = buildPayload(session, 'meeting.completed');
    expect(p.meeting).toMatchObject({ id: 'm1', title: 'Planung', durationSeconds: 120 });
    expect(p.summary?.actionItems).toEqual(['Liefertermin bestätigen']);
    expect(p.metrics.questionsAsked.me).toBe(1);
    expect(p.transcript).toEqual([
      {
        speaker: 'Ich',
        channel: 'mic',
        startedAt: new Date(T0).toISOString(),
        text: 'Können wir Freitag liefern?',
      },
    ]);
  });
});

describe('markdown export', () => {
  test('contains summary, to-dos, statistics and transcript in that order', () => {
    const md = toMarkdown(session);
    const order = [
      '## Zusammenfassung',
      '## Kernpunkte',
      '## To-dos',
      '## Gesprächsstatistik',
      '## Transkript',
    ];
    const positions = order.map((h) => md.indexOf(h));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(md).toContain('- [ ] Liefertermin bestätigen');
    expect(md).toContain('| Fragen | 1 | 0 |');
  });

  test('omits summary sections when none exists', () => {
    const md = toMarkdown({ ...session, summary: undefined });
    expect(md).not.toContain('## Zusammenfassung');
    expect(md).toContain('## Transkript');
  });
});
