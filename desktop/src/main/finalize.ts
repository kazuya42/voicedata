// Nachbearbeitung eines beendeten Meetings: Zusammenfassung (OpenAI) und optional n8n-Webhook.
// Ergebnisse/Fehler landen in der Session-Datei, damit sie im Archiv sichtbar und wiederholbar sind.
import { setTimeout as sleep } from 'node:timers/promises';
import { IPC } from '../shared/types';
import type { WebhookResult } from '../shared/types';
import type { TranscriptionQueue } from './queue';
import type { SessionStore } from './sessions';
import { assertLlmReady } from '../../../src/lib/llm';
import { getLlmConfig, getSettings } from './settings';
import { generateSummary } from './summary';
import { buildPayload, sendWebhook } from './webhook';

// Sehr kurze „Meetings“ (z. B. nur Hintergrundgeräusche) nicht automatisch zusammenfassen.
const MIN_WORDS_FOR_AUTO_SUMMARY = 30;
const DRAIN_TIMEOUT_MS = 10 * 60_000;

export class MeetingFinalizer {
  constructor(
    private readonly store: SessionStore,
    private readonly queue: TranscriptionQueue,
    private readonly emit: (channel: string, payload: unknown) => void,
  ) {}

  // Automatisch nach Meeting-Ende; Fehler werden in der Session vermerkt, nie geworfen.
  async onClosed(sessionId: string): Promise<void> {
    // Erst warten, bis alle Chunks dieses Meetings transkribiert sind.
    const deadline = Date.now() + DRAIN_TIMEOUT_MS;
    while (this.queue.hasPending(sessionId) && Date.now() < deadline) {
      await sleep(1000);
    }
    const settings = getSettings();
    const session = this.store.get(sessionId);
    if (!session) return;
    const words = session.segments
      .filter((s) => s.status === 'ok')
      .reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0);
    if (settings.autoSummary && words >= MIN_WORDS_FOR_AUTO_SUMMARY) {
      // Ohne eingerichtete KI (Key/Modell) still überspringen; manuell bleibt es möglich.
      let ready = true;
      try {
        assertLlmReady(getLlmConfig());
      } catch {
        ready = false;
      }
      if (ready) await this.summarize(sessionId).catch(() => {});
    }
    if (settings.webhookEnabled && settings.webhookUrl) {
      await this.sendWebhook(sessionId);
    }
  }

  // Manuell (Button) oder automatisch; wirft bei Fehler, Fehlertext steht zusätzlich in der Session.
  async summarize(sessionId: string): Promise<void> {
    const llm = getLlmConfig();
    assertLlmReady(llm);
    const session = this.store.get(sessionId);
    if (!session) throw new Error('Meeting nicht gefunden');
    try {
      const summary = await generateSummary(session, llm);
      this.store.update(sessionId, (s) => {
        s.summary = summary;
        delete s.summaryError;
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.store.update(sessionId, (s) => {
        s.summaryError = message;
      });
      throw e;
    } finally {
      this.emit(IPC.sessionUpdated, { sessionId });
    }
  }

  async sendWebhook(sessionId: string): Promise<WebhookResult> {
    const url = getSettings().webhookUrl;
    if (!url) throw new Error('Keine Webhook-URL eingetragen');
    const session = this.store.get(sessionId);
    if (!session) throw new Error('Meeting nicht gefunden');
    const result = await sendWebhook(url, buildPayload(session, 'meeting.completed'));
    this.store.update(sessionId, (s) => {
      s.webhook = result;
    });
    this.emit(IPC.sessionUpdated, { sessionId });
    return result;
  }
}
