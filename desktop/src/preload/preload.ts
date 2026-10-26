// Preload: stellt dem Renderer die schmale window.vd-API bereit (contextIsolation + sandbox).
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { VdApi } from '../shared/types';
import { IPC } from '../shared/types';

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: VdApi = {
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  saveSettings: (patch) => ipcRenderer.invoke(IPC.settingsSave, patch),
  getCreds: () => ipcRenderer.invoke(IPC.credsGet),
  saveCreds: (patch) => ipcRenderer.invoke(IPC.credsSave, patch),
  testIntegration: (kind) => ipcRenderer.invoke(IPC.integrationTest, kind),
  listOllamaModels: (url) => ipcRenderer.invoke(IPC.ollamaModels, url),
  modelStatus: () => ipcRenderer.invoke(IPC.modelStatus),
  downloadModel: (model) => ipcRenderer.invoke(IPC.modelDownload, model),
  onModelProgress: (cb) => subscribe(IPC.modelProgress, cb),
  setCapture: (enabled) => ipcRenderer.invoke(IPC.captureSet, enabled),
  onCaptureState: (cb) => subscribe(IPC.captureState, cb),
  sendChunk: (chunk) => ipcRenderer.send(IPC.captureChunk, chunk),
  onSegment: (cb) => subscribe(IPC.segment, cb),
  onQueue: (cb) => subscribe(IPC.queue, cb),
  listSessions: () => ipcRenderer.invoke(IPC.sessionsList),
  getSession: (id) => ipcRenderer.invoke(IPC.sessionsGet, id),
  renameSession: (id, title) => ipcRenderer.invoke(IPC.sessionsRename, id, title),
  deleteSession: (id) => ipcRenderer.invoke(IPC.sessionsDelete, id),
  retryFailed: (id) => ipcRenderer.invoke(IPC.sessionsRetry, id),
  exportSession: (id) => ipcRenderer.invoke(IPC.sessionsExport, id),
  copySession: (id) => ipcRenderer.invoke(IPC.sessionsCopy, id),
  summarizeSession: (id) => ipcRenderer.invoke(IPC.sessionsSummarize, id),
  sendSessionWebhook: (id) => ipcRenderer.invoke(IPC.sessionsSendWebhook, id),
  testWebhook: (url) => ipcRenderer.invoke(IPC.webhookTest, url),
  onSessionUpdated: (cb) => subscribe(IPC.sessionUpdated, cb),
  syncCatalog: (shop) => ipcRenderer.invoke(IPC.catalogSync, shop),
  catalogCounts: () => ipcRenderer.invoke(IPC.catalogCounts),
  searchCatalog: (shop, query, limit) => ipcRenderer.invoke(IPC.catalogSearch, shop, query, limit),
  syncShopwareIds: () => ipcRenderer.invoke(IPC.shopwareSyncIds),
  orderFromAudio: (pcm) => ipcRenderer.invoke(IPC.orderFromAudio, pcm),
  orderFromText: (text) => ipcRenderer.invoke(IPC.orderFromText, text),
  listOrders: () => ipcRenderer.invoke(IPC.ordersList),
  updateOrderFields: (id, fields) => ipcRenderer.invoke(IPC.ordersUpdateFields, id, fields),
  deleteOrder: (id) => ipcRenderer.invoke(IPC.ordersDelete, id),
  deleteAllOrders: () => ipcRenderer.invoke(IPC.ordersDeleteAll),
  markOrderSent: (id, target, info) => ipcRenderer.invoke(IPC.ordersMarkSent, id, target, info),
  previewOrder: (target, fields) => ipcRenderer.invoke(IPC.orderPreview, target, fields),
  confirmOrder: (target, fields, preview, transcriptId) =>
    ipcRenderer.invoke(IPC.orderConfirm, target, fields, preview, transcriptId),
  pushOrderToSheets: (fields, transcriptId) =>
    ipcRenderer.invoke(IPC.orderSheetsPush, fields, transcriptId),
  saveCsv: (csv) => ipcRenderer.invoke(IPC.saveCsv, csv),
  copyText: (text) => ipcRenderer.invoke(IPC.copyText, text),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
};

contextBridge.exposeInMainWorld('vd', api);
