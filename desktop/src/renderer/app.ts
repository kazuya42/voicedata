// Renderer-UI (Vanilla TS): Live-Transkript, Meeting-Archiv, Einstellungen.
// Bestellung/Transkripte (Funktionen der Mobil-App) liegen in orders.ts, Zugangsdaten in credsForm.ts.
import type {
  CaptureState,
  EngineId,
  Language,
  LocalModel,
  Segment,
  Session,
  Settings,
} from '../shared/types';
import { SPEAKER_LABEL } from '../shared/types';
import { formatClock } from '../shared/format';
import { computeMetrics } from '../shared/metrics';
import { CaptureController } from './capture';
import { collectAiSettings, collectCreds, initCredsForm, loadCredsForm } from './credsForm';
import type { View } from './dom';
import { $, VIEWS, el, errorMessage, showBanner, vd } from './dom';
import { initOrders, openOrderFromText, renderOrdersList } from './orders';

// ---------- Navigation ----------
function showView(view: View): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>('nav button')) {
    btn.classList.toggle('active', btn.dataset.view === view);
  }
  for (const v of VIEWS) {
    $(`view-${v}`).classList.toggle('hidden', v !== view);
  }
  if (view === 'meetings') void renderSessions();
  if (view === 'orders') void renderOrdersList();
  if (view === 'settings') void loadSettingsForm();
}
for (const btn of document.querySelectorAll<HTMLButtonElement>('nav button')) {
  btn.addEventListener('click', () => showView(btn.dataset.view as View));
}
initOrders(showView);
initCredsForm();

// ---------- Transkript-Zeilen ----------
function segmentRow(seg: Segment): HTMLElement {
  const row = document.createElement('p');
  row.className = `row ${seg.channel}${seg.status === 'failed' ? ' failed' : ''}`;
  row.dataset.id = seg.id;
  row.dataset.start = String(seg.startedAt);
  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = `[${formatClock(seg.startedAt)}]`;
  const speaker = document.createElement('span');
  speaker.className = 'speaker';
  speaker.textContent = `${SPEAKER_LABEL[seg.channel]}:`;
  const text = document.createElement('span');
  text.textContent =
    seg.status === 'ok' ? seg.text : `(Transkription fehlgeschlagen: ${seg.error ?? 'unbekannt'})`;
  row.append(time, speaker, text);
  return row;
}

// Einfügen sortiert nach Startzeit; vorhandene Zeile (Retry) wird ersetzt.
function upsertRow(list: HTMLElement, seg: Segment): void {
  const row = segmentRow(seg);
  const existing = list.querySelector<HTMLElement>(`[data-id="${CSS.escape(seg.id)}"]`);
  if (existing) {
    existing.replaceWith(row);
    return;
  }
  const after = Array.from(list.children).find(
    (c) => Number((c as HTMLElement).dataset.start) > seg.startedAt,
  );
  list.insertBefore(row, after ?? null);
}

// ---------- Live ----------
const liveList = $('live-list');
let liveSessionId: string | null = null;
let liveAutoScroll = true;
liveList.addEventListener('scroll', () => {
  liveAutoScroll = liveList.scrollHeight - liveList.scrollTop - liveList.clientHeight < 40;
});

function showLiveSegment(sessionId: string, seg: Segment): void {
  if (sessionId !== liveSessionId) {
    liveSessionId = sessionId;
    liveList.replaceChildren();
  }
  upsertRow(liveList, seg);
  if (liveAutoScroll) liveList.scrollTop = liveList.scrollHeight;
}

let captureEnabled = false;
let captureInfo = '';
function renderCaptureStatus(): void {
  const toggle = $<HTMLButtonElement>('capture-toggle');
  toggle.textContent = captureEnabled ? 'Meeting-Aufnahme stoppen' : 'Meeting-Aufnahme starten';
  toggle.classList.toggle('on', captureEnabled);
  $('capture-status').textContent = captureEnabled ? `Aufnahme läuft${captureInfo}` : 'Aus';
}

const capture = new CaptureController((message) => showBanner(message));

async function applyCaptureState(state: CaptureState): Promise<void> {
  captureEnabled = state.enabled;
  captureInfo = '';
  renderCaptureStatus();
  if (!state.enabled) {
    await capture.stop();
    return;
  }
  const result = await capture.start({ mic: state.mic, system: state.system });
  if (result.errors.length) showBanner(result.errors.join('\n'));
  if (!result.mic && !result.system) {
    await vd.setCapture(false).catch(() => {});
    return;
  }
  captureInfo =
    (state.mic ? ` · Mikrofon ${result.mic ? '✓' : '✗'}` : '') +
    (state.system ? ` · Systemaudio ${result.system ? '✓' : '✗'}` : '');
  renderCaptureStatus();
}

vd.onCaptureState((state) => {
  applyCaptureState(state).catch((e) => showBanner(errorMessage(e)));
});

$('capture-toggle').addEventListener('click', async () => {
  try {
    await vd.setCapture(!captureEnabled);
  } catch (e) {
    const msg = errorMessage(e);
    showBanner(msg);
    if (msg.includes('OpenAI-Key') || msg.includes('Modell')) showView('settings');
  }
});

vd.onQueue(({ pending }) => {
  $('queue-status').textContent = pending > 0 ? `Warteschlange: ${pending}` : '';
});

vd.onSegment(({ sessionId, segment }) => {
  showLiveSegment(sessionId, segment);
  if (!$('view-meetings').classList.contains('hidden')) {
    if (detailId === sessionId) upsertRow($('detail-list'), segment);
    else if (detailId === null) void renderSessions();
  }
});

// ---------- Meetings ----------
let detailId: string | null = null;

const formatDuration = (from: number, to: number | null) =>
  to === null ? 'läuft' : `${Math.max(1, Math.round((to - from) / 60_000))} min`;

async function renderSessions(): Promise<void> {
  detailId = null;
  $('session-detail').classList.add('hidden');
  const list = $('sessions-list');
  list.classList.remove('hidden');
  const sessions = await vd.listSessions();
  if (sessions.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'Noch keine Meetings aufgenommen.';
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(
    ...sessions.map((s) => {
      const card = document.createElement('div');
      card.className = 'card';
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = s.title;
      const meta = document.createElement('div');
      meta.className = 'muted';
      meta.textContent = `${new Date(s.startedAt).toLocaleString('de-DE')} · ${formatDuration(s.startedAt, s.endedAt)} · ${s.segmentCount} Abschnitte${s.failedCount ? ` · ${s.failedCount} fehlgeschlagen` : ''}`;
      const preview = document.createElement('div');
      preview.className = 'preview';
      preview.textContent = s.preview;
      card.append(title, meta, preview);
      card.addEventListener('click', () => void openDetail(s.id));
      return card;
    }),
  );
}

async function openDetail(id: string): Promise<void> {
  const session: Session | null = await vd.getSession(id);
  if (!session) {
    await renderSessions();
    return;
  }
  detailId = id;
  $('sessions-list').classList.add('hidden');
  $('session-detail').classList.remove('hidden');
  $<HTMLInputElement>('detail-title').value = session.title;
  $('detail-meta').textContent =
    `${new Date(session.startedAt).toLocaleString('de-DE')} · ${formatDuration(session.startedAt, session.endedAt)}`;
  $('detail-retry').classList.toggle(
    'hidden',
    !session.segments.some((s) => s.status === 'failed'),
  );
  $('detail-summarize').textContent = session.summary
    ? 'Zusammenfassung neu erstellen'
    : 'Zusammenfassung erstellen';
  const { webhookEnabled } = await vd.getSettings();
  $('detail-webhook').classList.toggle('hidden', !webhookEnabled);
  renderInsights(session);
  const list = $('detail-list');
  list.replaceChildren(...session.segments.map(segmentRow));
}

const percent = (ratio: number) => `${Math.round(ratio * 100)} %`;

// Zusammenfassung, Gesprächsstatistik und Webhook-Status (aus call.md übernommene Auswertungen).
function renderInsights(session: Session): void {
  const box = $('detail-insights');
  const parts: HTMLElement[] = [];

  if (session.summary) {
    const { overview, keyPoints, actionItems } = session.summary;
    parts.push(el('h3', 'Zusammenfassung'), el('p', overview));
    if (keyPoints.length) {
      parts.push(el('h3', 'Kernpunkte'));
      for (const kp of keyPoints) {
        const ul = el('ul');
        ul.append(...kp.points.map((p) => el('li', p)));
        parts.push(el('h4', kp.topic), ul);
      }
    }
    if (actionItems.length) {
      const ul = el('ul');
      ul.append(...actionItems.map((a) => el('li', a)));
      parts.push(el('h3', 'To-dos'), ul);
    }
  } else if (session.summaryError) {
    parts.push(el('p', `Zusammenfassung fehlgeschlagen: ${session.summaryError}`, 'error'));
  }

  const m = computeMetrics(session.segments);
  if (m.wordCount.me + m.wordCount.them > 0) {
    const table = el('table', undefined, 'metrics');
    const rows: [string, string, string][] = [
      ['', SPEAKER_LABEL.mic, SPEAKER_LABEL.system],
      ['Sprechanteil', percent(m.talkRatio.me), percent(m.talkRatio.them)],
      ['Sprechzeit', `${m.talkSeconds.me} s`, `${m.talkSeconds.them} s`],
      ['Wörter', String(m.wordCount.me), String(m.wordCount.them)],
      ['Tempo (Wörter/min)', String(m.paceWpm.me), String(m.paceWpm.them)],
      ['Fragen', String(m.questionsAsked.me), String(m.questionsAsked.them)],
      [
        'Längster Monolog',
        `${m.longestMonologueSeconds.me} s`,
        `${m.longestMonologueSeconds.them} s`,
      ],
    ];
    for (const [i, cells] of rows.entries()) {
      const tr = el('tr');
      tr.append(...cells.map((c) => el(i === 0 ? 'th' : 'td', c)));
      table.append(tr);
    }
    parts.push(el('h3', 'Gesprächsstatistik'), table);
  }

  if (session.webhook) {
    const w = session.webhook;
    parts.push(
      el(
        'p',
        w.ok
          ? `n8n: gesendet ${formatClock(w.sentAt)} (HTTP ${w.status})`
          : `n8n: Senden fehlgeschlagen ${formatClock(w.sentAt)} – ${w.error}`,
        w.ok ? 'muted' : 'error',
      ),
    );
  }
  box.replaceChildren(...parts);
}

vd.onSessionUpdated(({ sessionId }) => {
  if ($('view-meetings').classList.contains('hidden')) return;
  if (detailId === sessionId) void openDetail(sessionId);
  else if (detailId === null) void renderSessions();
});

$('detail-summarize').addEventListener('click', async () => {
  if (!detailId) return;
  const btn = $<HTMLButtonElement>('detail-summarize');
  btn.disabled = true;
  btn.textContent = 'Erstelle Zusammenfassung…';
  try {
    await vd.summarizeSession(detailId);
  } catch (e) {
    showBanner(errorMessage(e));
  } finally {
    btn.disabled = false;
    if (detailId) await openDetail(detailId);
  }
});

// Meeting-Transkript → Bestelldaten (z. B. telefonische Bestellung als Meeting aufgenommen).
$('detail-order').addEventListener('click', async () => {
  if (!detailId) return;
  const session = await vd.getSession(detailId);
  const text = session?.segments
    .filter((s) => s.status === 'ok')
    .map((s) => `${SPEAKER_LABEL[s.channel]}: ${s.text}`)
    .join('\n');
  if (!text) {
    showBanner('Dieses Meeting hat noch kein Transkript.');
    return;
  }
  const btn = $<HTMLButtonElement>('detail-order');
  btn.disabled = true;
  btn.textContent = 'Extrahiere Bestelldaten…';
  try {
    await openOrderFromText(text);
  } catch (e) {
    showBanner(errorMessage(e));
  } finally {
    btn.disabled = false;
    btn.textContent = 'Als Bestellung übernehmen';
  }
});

$('detail-webhook').addEventListener('click', async () => {
  if (!detailId) return;
  try {
    const r = await vd.sendSessionWebhook(detailId);
    showBanner(r.ok ? `An n8n gesendet (HTTP ${r.status}).` : `n8n: ${r.error}`);
  } catch (e) {
    showBanner(errorMessage(e));
  }
});

$('detail-back').addEventListener('click', () => void renderSessions());
$<HTMLInputElement>('detail-title').addEventListener('change', async (e) => {
  if (detailId) await vd.renameSession(detailId, (e.target as HTMLInputElement).value);
});
$('detail-copy').addEventListener('click', async () => {
  if (!detailId) return;
  await vd.copySession(detailId);
  showBanner('Transkript in die Zwischenablage kopiert.');
});
$('detail-export').addEventListener('click', async () => {
  if (!detailId) return;
  try {
    if (await vd.exportSession(detailId)) showBanner('Markdown-Datei gespeichert.');
  } catch (e) {
    showBanner(errorMessage(e));
  }
});
$('detail-retry').addEventListener('click', async () => {
  if (!detailId) return;
  await vd.retryFailed(detailId);
  showBanner('Fehlgeschlagene Abschnitte werden erneut transkribiert…');
});
$('detail-delete').addEventListener('click', async () => {
  if (!detailId || !confirm('Dieses Meeting endgültig löschen?')) return;
  await vd.deleteSession(detailId);
  if (liveSessionId === detailId) {
    liveSessionId = null;
    liveList.replaceChildren();
  }
  await renderSessions();
});

// ---------- Einstellungen ----------
let settings: Settings;
let downloading: LocalModel | null = null;

async function renderModelState(): Promise<void> {
  const model = $<HTMLSelectElement>('local-model').value as LocalModel;
  const status = await vd.modelStatus();
  const btn = $<HTMLButtonElement>('model-download');
  if (downloading === model) return; // Fortschritt kommt per Event
  $('model-state').textContent = status[model] ? 'heruntergeladen' : 'nicht heruntergeladen';
  btn.classList.toggle('hidden', status[model]);
  btn.disabled = downloading !== null;
}

async function loadSettingsForm(): Promise<void> {
  settings = await vd.getSettings();
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name="engine"]')) {
    r.checked = r.value === settings.engine;
  }
  $<HTMLSelectElement>('local-model').value = settings.localModel;
  $<HTMLSelectElement>('language').value = settings.language;
  $<HTMLInputElement>('capture-mic').checked = settings.captureMic;
  $<HTMLInputElement>('capture-system').checked = settings.captureSystem;
  $<HTMLInputElement>('auto-summary').checked = settings.autoSummary;
  $<HTMLInputElement>('webhook-enabled').checked = settings.webhookEnabled;
  $<HTMLInputElement>('webhook-url').value = settings.webhookUrl;
  await Promise.all([renderModelState(), loadCredsForm(settings)]);
}

$('local-model').addEventListener('change', () => void renderModelState());

$('model-download').addEventListener('click', async () => {
  const model = $<HTMLSelectElement>('local-model').value as LocalModel;
  downloading = model;
  $<HTMLButtonElement>('model-download').disabled = true;
  $('model-state').textContent = 'Download startet…';
  try {
    await vd.downloadModel(model);
  } catch (e) {
    showBanner(errorMessage(e));
  } finally {
    downloading = null;
    await renderModelState();
  }
});

vd.onModelProgress(({ model, received, total }) => {
  if (model !== $<HTMLSelectElement>('local-model').value) return;
  $('model-state').textContent = `Download: ${Math.floor((received / total) * 100)} %`;
});

$('settings-save').addEventListener('click', async () => {
  const engine = document.querySelector<HTMLInputElement>('input[name="engine"]:checked')?.value as
    | EngineId
    | undefined;
  const captureMic = $<HTMLInputElement>('capture-mic').checked;
  const captureSystem = $<HTMLInputElement>('capture-system').checked;
  const sourcesChanged =
    captureMic !== settings.captureMic || captureSystem !== settings.captureSystem;
  try {
    settings = await vd.saveSettings({
      engine: engine ?? settings.engine,
      localModel: $<HTMLSelectElement>('local-model').value as LocalModel,
      language: $<HTMLSelectElement>('language').value as Language,
      captureMic,
      captureSystem,
      ...collectAiSettings(),
      autoSummary: $<HTMLInputElement>('auto-summary').checked,
      webhookEnabled: $<HTMLInputElement>('webhook-enabled').checked,
      webhookUrl: $<HTMLInputElement>('webhook-url').value.trim(),
    });
    // Zugangsdaten mitspeichern (wie „Alles speichern“ in der Mobil-App).
    await vd.saveCreds(collectCreds());
    // Quellen-Änderung während laufender Aufnahme sofort anwenden.
    if (captureEnabled && sourcesChanged) {
      await vd.setCapture(false);
      await vd.setCapture(true);
    }
    await loadSettingsForm();
    showBanner('Einstellungen gespeichert.');
  } catch (e) {
    showBanner(errorMessage(e));
  }
});

$('webhook-test').addEventListener('click', async () => {
  const url = $<HTMLInputElement>('webhook-url').value.trim();
  if (!url) {
    showBanner('Bitte zuerst eine Webhook-URL eintragen.');
    return;
  }
  try {
    const r = await vd.testWebhook(url);
    showBanner(
      r.ok ? `Webhook erreichbar (HTTP ${r.status}).` : `Webhook-Test fehlgeschlagen: ${r.error}`,
    );
  } catch (e) {
    showBanner(errorMessage(e));
  }
});

// ---------- Start ----------
async function init(): Promise<void> {
  settings = await vd.getSettings();
  // Laufendes Meeting (z. B. nach Fenster-Neuladen) im Live-Bereich anzeigen.
  const open = (await vd.listSessions()).find((s) => s.endedAt === null);
  if (open) {
    const session = await vd.getSession(open.id);
    if (session) for (const seg of session.segments) showLiveSegment(session.id, seg);
  }
  renderCaptureStatus();
}

init().catch((e) => showBanner(errorMessage(e)));
