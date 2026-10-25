// Optional: fertiges Meeting als JSON an einen Webhook senden (n8n „Webhook“-Node, Zapier, Make …).
// Idee übernommen aus call.md (workflow-webhook.service.ts), Payload ohne VideoDB-Felder.
// Bewusst ohne Sperre für private Adressen: selbst gehostetes n8n läuft oft lokal oder im LAN,
// und diese App betreibt keinen eigenen lokalen HTTP-Server, der missbraucht werden könnte.
import { fetchWithRetry } from '../../../src/lib/http';
import type { ConversationMetrics, MeetingSummary, Session, WebhookResult } from '../shared/types';
import { SPEAKER_LABEL } from '../shared/types';
import { computeMetrics } from '../shared/metrics';
import { toMarkdown } from './sessions';

export type WebhookPayload = {
  event: 'meeting.completed' | 'test';
  sentAt: string;
  meeting: {
    id: string;
    title: string;
    startedAt: string;
    endedAt: string | null;
    durationSeconds: number;
  };
  summary: MeetingSummary | null;
  metrics: ConversationMetrics;
  transcript: { speaker: string; channel: 'mic' | 'system'; startedAt: string; text: string }[];
  markdown: string;
};

export function validateWebhookUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('Webhook-URL ist ungültig');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Webhook-URL muss mit http:// oder https:// beginnen');
  }
  if (url.username || url.password) {
    throw new Error('Webhook-URL darf keine Zugangsdaten enthalten');
  }
  return url.toString();
}

export function buildPayload(session: Session, event: WebhookPayload['event']): WebhookPayload {
  const end = session.endedAt;
  return {
    event,
    sentAt: new Date().toISOString(),
    meeting: {
      id: session.id,
      title: session.title,
      startedAt: new Date(session.startedAt).toISOString(),
      endedAt: end === null ? null : new Date(end).toISOString(),
      durationSeconds: Math.round(((end ?? Date.now()) - session.startedAt) / 1000),
    },
    summary: session.summary ?? null,
    metrics: computeMetrics(session.segments),
    transcript: session.segments
      .filter((s) => s.status === 'ok')
      .map((s) => ({
        speaker: SPEAKER_LABEL[s.channel],
        channel: s.channel,
        startedAt: new Date(s.startedAt).toISOString(),
        text: s.text,
      })),
    markdown: toMarkdown(session),
  };
}

// Kein Retry: ein n8n-Workflow mit Seiteneffekten (E-Mail, CRM-Eintrag) darf nicht doppelt laufen.
export async function sendWebhook(rawUrl: string, payload: WebhookPayload): Promise<WebhookResult> {
  const sentAt = Date.now();
  try {
    const res = await fetchWithRetry(
      validateWebhookUrl(rawUrl),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'VoiceData-Desktop/1.0',
          'X-VoiceData-Event': payload.event,
        },
        body: JSON.stringify(payload),
      },
      { timeoutMs: 30_000, retries: 0 },
    );
    return res.ok
      ? { sentAt, ok: true, status: res.status }
      : {
          sentAt,
          ok: false,
          status: res.status,
          error: `HTTP ${res.status} ${res.statusText}`.trim(),
        };
  } catch (e) {
    return { sentAt, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
