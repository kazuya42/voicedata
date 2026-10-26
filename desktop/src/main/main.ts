// VoiceData Desktop – Main-Prozess: Fenster, Menüleisten-Icon, Hintergrundbetrieb, IPC.
// Die Audioaufnahme läuft im (ggf. versteckten) Renderer; der Aufnahmestatus gehört dem Main-Prozess.
import fs from 'node:fs';
import path from 'node:path';
import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  clipboard,
  desktopCapturer,
  dialog,
  ipcMain,
  nativeImage,
  session,
  shell,
  systemPreferences,
} from 'electron';
import { catalogCount, searchCatalog } from '../../../src/lib/catalog';
import { extractFields } from '../../../src/lib/extract';
import { listOllamaModels } from '../../../src/lib/llm';
import type {
  CatalogShop,
  ParsedFields,
  PreviewData,
  TargetSystem,
  Transcript,
} from '../../../src/lib/types';
import type {
  AudioChunk,
  CaptureState,
  Creds,
  IntegrationTest,
  LocalModel,
  Session,
  SettingsPatch,
} from '../shared/types';
import { IPC } from '../shared/types';
import { initCatalog } from './catalogStore';
import { getCreds, saveCreds } from './credentials';
import { getEngine } from './engines';
import { MeetingFinalizer } from './finalize';
import {
  confirmOrder,
  previewOrder,
  pushOrderToSheets,
  syncCatalog,
  syncShopwareInstanceIds,
  testIntegration,
} from './integrations';
import { downloadModel, modelStatus } from './models';
import { OrderStore } from './orders';
import { TranscriptionQueue } from './queue';
import { SessionStore, toMarkdown } from './sessions';
import { getLlmConfig, getSettings, saveSettings } from './settings';
import { buildPayload, sendWebhook, validateWebhookUrl } from './webhook';

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let store: SessionStore;
let queue: TranscriptionQueue;
let finalizer: MeetingFinalizer;
let orders: OrderStore;
let closeTimer: NodeJS.Timeout | undefined;

const send = (channel: string, payload: unknown) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

function showWindow(): void {
  if (!win) return;
  win.show();
  win.focus();
}

function createWindow(show = true): BrowserWindow {
  const w = new BrowserWindow({
    width: 900,
    height: 700,
    show,
    title: 'VoiceData Desktop',
    backgroundColor: '#0F172A',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      // Die Aufnahme-Pipeline lebt in diesem Renderer und muss auch versteckt weiterlaufen.
      backgroundThrottling: false,
    },
  });
  w.loadFile(path.join(__dirname, '..', 'static', 'index.html'));
  // Schließen (Button / Cmd+W) versteckt nur – die App läuft in der Menüleiste weiter.
  w.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    w.hide();
  });
  // window.close() aus dem Renderer umgeht 'close' und zerstört das Fenster – dann versteckt
  // neu erzeugen, damit die Aufnahme weiterläuft.
  w.on('closed', () => {
    if (isQuitting) return;
    win = createWindow(false);
    win.webContents.once('did-finish-load', broadcastCapture);
  });
  // Renderer abgestürzt → neu laden und Aufnahme wieder aufnehmen.
  w.webContents.on('render-process-gone', () => {
    if (isQuitting) return;
    w.webContents.once('did-finish-load', broadcastCapture);
    w.reload();
  });
  return w;
}

function updateTray(): void {
  if (!tray) return;
  const enabled = getSettings().captureEnabled;
  tray.setTitle(enabled ? '● VD' : 'VD');
  tray.setToolTip(enabled ? 'VoiceData – Aufnahme läuft' : 'VoiceData – Aufnahme aus');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Meeting-Aufnahme',
        type: 'checkbox',
        checked: enabled,
        click: (item) => {
          setCapture(item.checked).catch((e: Error) => {
            updateTray();
            showWindow();
            dialog.showErrorBox('Aufnahme nicht möglich', e.message);
          });
        },
      },
      { label: 'Fenster öffnen', click: showWindow },
      { type: 'separator' },
      { label: 'Beenden', click: () => app.quit() },
    ]),
  );
}

function broadcastCapture(): void {
  const s = getSettings();
  const state: CaptureState = {
    enabled: s.captureEnabled,
    mic: s.captureEnabled && s.captureMic,
    system: s.captureEnabled && s.captureSystem,
  };
  send(IPC.captureState, state);
  updateTray();
}

async function setCapture(enabled: boolean): Promise<void> {
  clearInterval(closeTimer);
  if (enabled) {
    const s = getSettings();
    getEngine(s); // wirft bei fehlendem Key/Modell → Aufnahme bleibt aus
    if (!s.captureMic && !s.captureSystem) {
      throw new Error('Weder Mikrofon noch Systemaudio ausgewählt');
    }
    let micAllowed = s.captureMic;
    if (s.captureMic && process.platform === 'darwin') {
      micAllowed = await systemPreferences.askForMediaAccess('microphone');
    }
    if (s.captureMic && !micAllowed && !s.captureSystem) {
      throw new Error('Mikrofon-Zugriff verweigert');
    }
    saveSettings({ captureEnabled: true, captureMic: micAllowed });
    if (s.captureMic && !micAllowed) {
      // Mikrofon verweigert, Systemaudio läuft weiter – Einstellung bleibt sichtbar korrigiert.
      dialog.showErrorBox(
        'Mikrofon-Zugriff verweigert',
        'Es wird nur der Systemton aufgenommen. Zugriff in Systemeinstellungen › Datenschutz & Sicherheit › Mikrofon erlauben.',
      );
    }
    broadcastCapture();
    return;
  }
  saveSettings({ captureEnabled: false });
  broadcastCapture();
  // Renderer schickt nach dem Ausschalten noch die letzten Chunks (flush) –
  // Session erst schließen, wenn diese angekommen und transkribiert sind.
  const disabledAt = Date.now();
  closeTimer = setInterval(() => {
    const id = store.currentId;
    if (id && (Date.now() - disabledAt <= 2000 || queue.hasPending(id))) return;
    if (id) store.closeOpen();
    clearInterval(closeTimer);
  }, 1000);
}

function registerIpc(): void {
  ipcMain.handle(IPC.settingsGet, () => getSettings());
  ipcMain.handle(IPC.settingsSave, (_e, patch: SettingsPatch) => {
    // captureEnabled wird ausschließlich über setCapture gesteuert.
    const { captureEnabled: _ignored, ...rest } = patch;
    if (rest.webhookUrl) rest.webhookUrl = validateWebhookUrl(rest.webhookUrl);
    if (rest.webhookEnabled && !(rest.webhookUrl ?? getSettings().webhookUrl)) {
      throw new Error('Für n8n bitte eine Webhook-URL eintragen');
    }
    return saveSettings(rest);
  });
  ipcMain.handle(IPC.credsGet, () => getCreds());
  ipcMain.handle(IPC.credsSave, (_e, patch: Partial<Creds>) => saveCreds(patch));
  ipcMain.handle(IPC.integrationTest, (_e, kind: IntegrationTest) => testIntegration(kind));
  ipcMain.handle(IPC.ollamaModels, (_e, url: string) => listOllamaModels(url));
  ipcMain.handle(IPC.modelStatus, () => modelStatus());
  ipcMain.handle(IPC.modelDownload, (_e, model: LocalModel) =>
    downloadModel(model, (received, total) => send(IPC.modelProgress, { model, received, total })),
  );
  ipcMain.handle(IPC.captureSet, (_e, enabled: boolean) => setCapture(enabled));
  ipcMain.on(IPC.captureChunk, (_e, chunk: AudioChunk) => queue.enqueue(chunk));
  ipcMain.handle(IPC.sessionsList, () => store.list());
  ipcMain.handle(IPC.sessionsGet, (_e, id: string) => store.get(id));
  ipcMain.handle(IPC.sessionsRename, (_e, id: string, title: string) => store.rename(id, title));
  ipcMain.handle(IPC.sessionsDelete, (_e, id: string) => store.delete(id));
  ipcMain.handle(IPC.sessionsRetry, (_e, id: string) => queue.retryFailed(id));
  ipcMain.handle(IPC.sessionsCopy, (_e, id: string) => {
    const s = store.get(id);
    if (s) clipboard.writeText(toMarkdown(s));
  });
  ipcMain.handle(IPC.sessionsExport, async (_e, id: string) => {
    const s = store.get(id);
    if (!s || !win) return false;
    const res = await dialog.showSaveDialog(win, {
      defaultPath: `${s.title.replace(/[/\\:*?"<>|]/g, '-')}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (res.canceled || !res.filePath) return false;
    fs.writeFileSync(res.filePath, toMarkdown(s));
    return true;
  });
  ipcMain.handle(IPC.sessionsSummarize, (_e, id: string) => finalizer.summarize(id));
  ipcMain.handle(IPC.sessionsSendWebhook, (_e, id: string) => finalizer.sendWebhook(id));
  ipcMain.handle(IPC.webhookTest, (_e, url: string) => {
    const now = Date.now();
    const sample: Session = {
      id: 'test',
      title: 'VoiceData Test-Meeting',
      startedAt: now - 60_000,
      endedAt: now,
      segments: [
        {
          id: 'test-1',
          channel: 'system',
          startedAt: now - 50_000,
          endedAt: now - 45_000,
          voicedMs: 4000,
          text: 'Dies ist ein Test des VoiceData-Webhooks.',
          status: 'ok',
        },
      ],
    };
    return sendWebhook(url, buildPayload(sample, 'test'));
  });
  registerOrderIpc();
}

// Diktat bzw. Meeting-Text → Bestellfelder (KI) → als Entwurf speichern.
async function createOrder(text: string): Promise<Transcript> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Kein Text erkannt – bitte erneut diktieren.');
  const fields = await extractFields(trimmed, getLlmConfig());
  return orders.save(trimmed, fields);
}

function registerOrderIpc(): void {
  ipcMain.handle(IPC.catalogSync, (_e, shop: CatalogShop) => syncCatalog(shop));
  ipcMain.handle(IPC.catalogCounts, () => ({
    shopware: catalogCount('shopware'),
    shopify: catalogCount('shopify'),
    tiktok_shop: catalogCount('tiktok_shop'),
  }));
  ipcMain.handle(IPC.catalogSearch, (_e, shop: CatalogShop, query: string, limit: number) =>
    searchCatalog(shop, query, limit),
  );
  ipcMain.handle(IPC.shopwareSyncIds, () => syncShopwareInstanceIds());
  ipcMain.handle(IPC.orderFromAudio, async (_e, pcm: Float32Array) => {
    const settings = getSettings();
    const text = await getEngine(settings).transcribe(pcm, { language: settings.language });
    return createOrder(text);
  });
  ipcMain.handle(IPC.orderFromText, (_e, text: string) => createOrder(text));
  ipcMain.handle(IPC.ordersList, () => orders.list());
  ipcMain.handle(IPC.ordersUpdateFields, (_e, id: string, fields: ParsedFields) =>
    orders.updateFields(id, fields),
  );
  ipcMain.handle(IPC.ordersDelete, (_e, id: string) => orders.delete(id));
  ipcMain.handle(IPC.ordersDeleteAll, () => orders.deleteAll());
  ipcMain.handle(IPC.ordersMarkSent, (_e, id: string, target: TargetSystem, info: string) =>
    orders.markSent(id, target, info),
  );
  ipcMain.handle(IPC.orderPreview, (_e, target: TargetSystem, fields: ParsedFields) =>
    previewOrder(target, fields),
  );
  ipcMain.handle(
    IPC.orderConfirm,
    async (
      _e,
      target: TargetSystem,
      fields: ParsedFields,
      preview: PreviewData,
      transcriptId: string | null,
    ) => {
      const message = await confirmOrder(target, fields, preview);
      if (transcriptId) orders.markSent(transcriptId, target, message);
      return message;
    },
  );
  ipcMain.handle(
    IPC.orderSheetsPush,
    async (_e, fields: ParsedFields, transcriptId: string | null) => {
      const message = await pushOrderToSheets(fields);
      if (transcriptId) orders.markSent(transcriptId, 'google_sheets', message);
      return message;
    },
  );
  ipcMain.handle(IPC.saveCsv, async (_e, csv: string) => {
    if (!win) return false;
    const res = await dialog.showSaveDialog(win, {
      defaultPath: 'voicedata_export.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (res.canceled || !res.filePath) return false;
    fs.writeFileSync(res.filePath, csv, 'utf8');
    return true;
  });
  ipcMain.handle(IPC.copyText, (_e, text: string) => clipboard.writeText(text));
  // Nur Mail-Entwürfe und Webseiten (Google Sheet) öffnen – keine beliebigen Protokolle.
  ipcMain.handle(IPC.openExternal, (_e, url: string) => {
    if (!/^(mailto:|https:\/\/)/i.test(url)) throw new Error('Link wird nicht unterstützt');
    return shell.openExternal(url);
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(() => {
    const userData = app.getPath('userData');
    initCatalog(userData);
    orders = new OrderStore(userData);
    store = new SessionStore(path.join(userData, 'sessions'), (id) => {
      void finalizer.onClosed(id);
    });
    queue = new TranscriptionQueue(store, getSettings, send);
    finalizer = new MeetingFinalizer(store, queue, send);

    // Systemton (Loopback) für getDisplayMedia – ab Electron 39 nativ, macOS ≥ 14.2 via CoreAudio Tap.
    session.defaultSession.setDisplayMediaRequestHandler(async (_req, callback) => {
      try {
        const [source] = await desktopCapturer.getSources({ types: ['screen'] });
        if (source) callback({ video: source, audio: 'loopback' });
        else callback({});
      } catch {
        callback({});
      }
    });
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
      callback(
        (permission === 'media' || permission === 'display-capture') && wc === win?.webContents,
      );
    });

    registerIpc();
    win = createWindow();
    tray = new Tray(nativeImage.createEmpty());
    updateTray();

    // Nach Neustart automatisch weiter aufnehmen, falls die Funktion aktiv war.
    win.webContents.once('did-finish-load', () => {
      if (!getSettings().captureEnabled) return;
      setCapture(true).catch((e: Error) => {
        saveSettings({ captureEnabled: false });
        broadcastCapture();
        showWindow();
        dialog.showErrorBox('Aufnahme konnte nicht fortgesetzt werden', e.message);
      });
    });

    setInterval(() => store.closeIfIdle(Date.now(), (id) => queue.hasPending(id)), 30_000);
  });

  app.on('activate', showWindow);
  // Kein automatisches Beenden ohne Fenster – Beenden nur über das Menüleisten-Icon.
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => {
    isQuitting = true;
    if (!queue) return;
    queue.drainToDisk();
    store.closeOpen(false);
  });
}
