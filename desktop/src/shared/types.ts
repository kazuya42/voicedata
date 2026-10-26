// Gemeinsame Typen für Main-Prozess, Preload und Renderer der Desktop-App.
import type {
  CatalogProduct,
  CatalogShop,
  CredKey,
  ParsedFields,
  PreviewData,
  TargetSystem,
  Transcript,
} from '../../../src/lib/types';
import type { LlmProvider } from '../../../src/lib/llm';

export type Channel = 'mic' | 'system';
export type EngineId = 'local' | 'openai';
export type LocalModel = 'base' | 'small' | 'large-v3-turbo-q5_0';
export type Language = 'de' | 'en' | 'auto';

export type Settings = {
  engine: EngineId;
  localModel: LocalModel;
  language: Language;
  captureMic: boolean;
  captureSystem: boolean;
  captureEnabled: boolean;
  // KI für Zusammenfassung und Bestelldaten-Extraktion (Transkription ist separat: engine).
  aiProvider: LlmProvider;
  aiModel: string; // leer = Standardmodell des Anbieters
  ollamaUrl: string;
  // Nach Meeting-Ende automatisch zusammenfassen.
  autoSummary: boolean;
  // Optional: fertiges Meeting an einen n8n-Webhook (oder jede andere URL) senden.
  webhookEnabled: boolean;
  webhookUrl: string;
};

export type SettingsPatch = Partial<Settings>;

// Zugangsdaten: alle Integrationen der Mobil-App + OpenRouter-Key (nur Desktop).
export type DesktopCredKey = CredKey | 'openrouterKey';
export type Creds = Record<DesktopCredKey, string>;

// 16 kHz mono PCM; Zeitstempel in Epoch-Millisekunden; voicedMs = Anteil mit Sprache.
export type AudioChunk = {
  channel: Channel;
  startedAt: number;
  endedAt: number;
  voicedMs: number;
  pcm: Float32Array;
};

export type Segment = {
  id: string;
  channel: Channel;
  startedAt: number;
  endedAt: number;
  voicedMs?: number; // fehlt bei Segmenten älterer Versionen → Chunk-Dauer wird verwendet
  text: string;
  status: 'ok' | 'failed';
  error?: string;
  audioFile?: string;
};

export type KeyPoint = { topic: string; points: string[] };

export type MeetingSummary = {
  overview: string;
  keyPoints: KeyPoint[];
  actionItems: string[];
  generatedAt: number;
};

export type WebhookResult = { sentAt: number; ok: boolean; status?: number; error?: string };

export type ConversationMetrics = {
  durationSeconds: number; // Meeting-Dauer (erstes bis letztes Segment)
  talkSeconds: { me: number; them: number };
  talkRatio: { me: number; them: number }; // Anteil an der gesamten Sprechzeit, 0–1
  wordCount: { me: number; them: number };
  paceWpm: { me: number; them: number }; // Wörter pro Minute Sprechzeit
  questionsAsked: { me: number; them: number };
  longestMonologueSeconds: { me: number; them: number };
};

export type Session = {
  id: string;
  title: string;
  startedAt: number;
  endedAt: number | null;
  segments: Segment[];
  summary?: MeetingSummary;
  summaryError?: string;
  webhook?: WebhookResult;
};

export type SessionSummary = {
  id: string;
  title: string;
  startedAt: number;
  endedAt: number | null;
  segmentCount: number;
  failedCount: number;
  preview: string;
};

export type CaptureState = { enabled: boolean; mic: boolean; system: boolean };
export type SegmentEvent = { sessionId: string; segment: Segment };
export type QueueEvent = { pending: number };
export type ModelProgressEvent = { model: LocalModel; received: number; total: number };

export const SPEAKER_LABEL: Record<Channel, string> = { mic: 'Ich', system: 'Teilnehmer' };

export const LOCAL_MODELS: LocalModel[] = ['base', 'small', 'large-v3-turbo-q5_0'];

export const DEFAULT_SETTINGS: Settings = {
  engine: 'local',
  localModel: 'small',
  language: 'de',
  captureMic: true,
  captureSystem: true,
  captureEnabled: false,
  aiProvider: 'openai',
  aiModel: '',
  ollamaUrl: 'http://localhost:11434',
  autoSummary: true,
  webhookEnabled: false,
  webhookUrl: '',
};

// Verbindungstests in den Einstellungen.
export type IntegrationTest = 'openai' | 'ai' | 'shopware' | 'shopify' | 'tiktok_shop' | 'hubspot';

export const IPC = {
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  credsGet: 'creds:get',
  credsSave: 'creds:save',
  integrationTest: 'integration:test',
  ollamaModels: 'ai:ollama-models',
  modelStatus: 'model:status',
  modelDownload: 'model:download',
  modelProgress: 'model:progress',
  captureSet: 'capture:set',
  captureState: 'capture:state',
  captureChunk: 'capture:chunk',
  segment: 'transcript:segment',
  queue: 'transcript:queue',
  sessionsList: 'sessions:list',
  sessionsGet: 'sessions:get',
  sessionsRename: 'sessions:rename',
  sessionsDelete: 'sessions:delete',
  sessionsRetry: 'sessions:retry',
  sessionsExport: 'sessions:export',
  sessionsCopy: 'sessions:copy',
  sessionsSummarize: 'sessions:summarize',
  sessionsSendWebhook: 'sessions:send-webhook',
  sessionUpdated: 'session:updated',
  webhookTest: 'webhook:test',
  catalogSync: 'catalog:sync',
  catalogCounts: 'catalog:counts',
  catalogSearch: 'catalog:search',
  shopwareSyncIds: 'shopware:sync-ids',
  orderFromAudio: 'order:from-audio',
  orderFromText: 'order:from-text',
  ordersList: 'orders:list',
  ordersUpdateFields: 'orders:update-fields',
  ordersDelete: 'orders:delete',
  ordersDeleteAll: 'orders:delete-all',
  ordersMarkSent: 'orders:mark-sent',
  orderPreview: 'order:preview',
  orderConfirm: 'order:confirm',
  orderSheetsPush: 'order:sheets-push',
  saveCsv: 'file:save-csv',
  copyText: 'clipboard:copy',
  openExternal: 'shell:open-external',
} as const;

// API, die das Preload-Skript als window.vd bereitstellt.
export type VdApi = {
  getSettings(): Promise<Settings>;
  saveSettings(patch: SettingsPatch): Promise<Settings>;
  getCreds(): Promise<Creds>;
  saveCreds(patch: Partial<Creds>): Promise<Creds>;
  testIntegration(kind: IntegrationTest): Promise<void>;
  listOllamaModels(url: string): Promise<string[]>;
  modelStatus(): Promise<Record<LocalModel, boolean>>;
  downloadModel(model: LocalModel): Promise<void>;
  onModelProgress(cb: (e: ModelProgressEvent) => void): () => void;
  setCapture(enabled: boolean): Promise<void>;
  onCaptureState(cb: (s: CaptureState) => void): () => void;
  sendChunk(chunk: AudioChunk): void;
  onSegment(cb: (e: SegmentEvent) => void): () => void;
  onQueue(cb: (e: QueueEvent) => void): () => void;
  listSessions(): Promise<SessionSummary[]>;
  getSession(id: string): Promise<Session | null>;
  renameSession(id: string, title: string): Promise<void>;
  deleteSession(id: string): Promise<void>;
  retryFailed(id: string): Promise<void>;
  exportSession(id: string): Promise<boolean>;
  copySession(id: string): Promise<void>;
  summarizeSession(id: string): Promise<void>;
  sendSessionWebhook(id: string): Promise<WebhookResult>;
  testWebhook(url: string): Promise<WebhookResult>;
  onSessionUpdated(cb: (e: { sessionId: string }) => void): () => void;
  // Bestellungen (Funktionen der Mobil-App)
  syncCatalog(shop: CatalogShop): Promise<number>;
  catalogCounts(): Promise<Record<CatalogShop, number>>;
  searchCatalog(shop: CatalogShop, query: string, limit: number): Promise<CatalogProduct[]>;
  syncShopwareIds(): Promise<string>;
  orderFromAudio(pcm: Float32Array): Promise<Transcript>;
  orderFromText(text: string): Promise<Transcript>;
  listOrders(): Promise<Transcript[]>;
  updateOrderFields(id: string, fields: ParsedFields): Promise<void>;
  deleteOrder(id: string): Promise<void>;
  deleteAllOrders(): Promise<void>;
  markOrderSent(id: string, target: TargetSystem, info: string): Promise<void>;
  previewOrder(target: TargetSystem, fields: ParsedFields): Promise<PreviewData>;
  // Legt die Bestellung bzw. HubSpot-Daten an; liefert die Erfolgsmeldung.
  confirmOrder(
    target: TargetSystem,
    fields: ParsedFields,
    preview: PreviewData,
    transcriptId: string | null,
  ): Promise<string>;
  pushOrderToSheets(fields: ParsedFields, transcriptId: string | null): Promise<string>;
  saveCsv(csv: string): Promise<boolean>;
  copyText(text: string): Promise<void>;
  openExternal(url: string): Promise<void>;
};
