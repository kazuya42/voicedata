// Bestellung & Transkripte – die Funktionen der Mobil-App auf dem Desktop:
// Diktat → Transkription → KI-Feldextraktion → Prüfen/Bearbeiten (mit Artikelsuche) →
// Vorschau für das Zielsystem → Bestellen/Übertragen bzw. CSV/E-Mail/Google Sheets.
import { emptyFields, TARGET_LABELS } from '../../../src/lib/types';
import type {
  CatalogProduct,
  CatalogShop,
  HubspotPreview,
  ParsedFields,
  PreviewData,
  ShopPreview,
  TargetSystem,
  TextPreview,
  Transcript,
} from '../../../src/lib/types';
import type { View } from './dom';
import { $, button, el, errorMessage, vd } from './dom';
import { MAX_MEMO_MS, MemoRecorder } from './memo';

const TARGETS: TargetSystem[] = [
  'shopware',
  'shopify',
  'tiktok_shop',
  'hubspot',
  'email',
  'google_sheets',
  'csv',
];
const CATALOG_SHOPS: TargetSystem[] = ['shopware', 'shopify', 'tiktok_shop'];

const TEXT_FIELDS = [
  'customerName',
  'customerEmail',
  'customerStreet',
  'customerZip',
  'customerCity',
  'productName',
  'productNumber',
  'deliveryName',
  'deliveryStreet',
  'deliveryZip',
  'deliveryCity',
] as const;

const PREVIEW_TITLE: Record<PreviewData['type'], string> = {
  shopware_preview: 'Vorschau: Shopware Bestellung',
  shopify_preview: 'Vorschau: Shopify Bestellung',
  tiktok_preview: 'Vorschau: TikTok Shop Bestellung',
  hubspot_preview: 'Vorschau: HubSpot Kontakt + Deal',
  csv: 'Vorschau: CSV Export',
  email: 'Vorschau: E-Mail Entwurf',
  google_sheets: 'Vorschau: Google Sheets Zeile',
};

let target: TargetSystem = 'shopware';
let transcriptId: string | null = null;
let navigate: (view: View) => void = () => {};
const memo = new MemoRecorder();
let memoTimer: number | undefined;

const input = (name: string) => $<HTMLInputElement>(`f-${name}`);

function getFields(): ParsedFields {
  const f = emptyFields();
  for (const k of TEXT_FIELDS) f[k] = input(k).value.trim();
  f.quantity = Math.max(1, parseInt(input('quantity').value, 10) || 1);
  return f;
}

function setFields(f: ParsedFields): void {
  for (const k of TEXT_FIELDS) input(k).value = f[k] || '';
  input('quantity').value = String(f.quantity || 1);
}

// Statusmeldung im Bestell-Bereich (wie die Statuskarte der Mobil-App).
function message(kind: 'info' | 'success' | 'error', text: string): void {
  const box = $('order-message');
  box.className = `message ${kind}`;
  box.textContent = text;
}

function clearMessage(): void {
  $('order-message').className = 'message hidden';
}

function show(part: 'editor' | 'preview' | 'none'): void {
  $('order-editor').classList.toggle('hidden', part !== 'editor');
  $('order-preview').classList.toggle('hidden', part !== 'preview');
}

function renderTargets(): void {
  $('target-buttons').replaceChildren(
    ...TARGETS.map((t) =>
      button(
        TARGET_LABELS[t],
        () => {
          target = t;
          renderTargets();
          $('product-suggestions').classList.add('hidden');
        },
        t === target ? 'chip active' : 'chip',
      ),
    ),
  );
  $('product-search-open').classList.toggle('hidden', !CATALOG_SHOPS.includes(target));
}

// Transkript (neu diktiert, aus Meeting oder aus der Liste) in den Editor laden.
export function openOrder(t: Transcript): void {
  transcriptId = t.id;
  setFields(t.fields);
  $('order-transcript').textContent = t.transcriptText;
  renderTargets();
  show('editor');
  navigate('order');
}

export async function openOrderFromText(text: string): Promise<void> {
  navigate('order');
  message('info', 'Extrahiere Bestelldaten…');
  try {
    openOrder(await vd.orderFromText(text));
    clearMessage();
  } catch (e) {
    message('error', `Fehler bei der Verarbeitung: ${errorMessage(e)}`);
  }
}

// ---------- Diktat ----------
function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

async function toggleMemo(): Promise<void> {
  const btn = $<HTMLButtonElement>('memo-toggle');
  if (!memo.recording) {
    try {
      await memo.start(() => {
        message('info', 'Die Aufnahme wurde nach 5 Minuten automatisch gestoppt.');
        void toggleMemo();
      });
    } catch (e) {
      message('error', `Die Aufnahme konnte nicht gestartet werden: ${errorMessage(e)}`);
      return;
    }
    clearMessage();
    show('none');
    btn.textContent = 'Diktat beenden';
    btn.classList.add('on');
    memoTimer = window.setInterval(() => {
      $('memo-status').textContent =
        `AUFNAHME LÄUFT · ${formatDuration(memo.durationMs)} / ${formatDuration(MAX_MEMO_MS)}`;
    }, 250);
    return;
  }
  clearInterval(memoTimer);
  btn.textContent = 'Diktat starten';
  btn.classList.remove('on');
  btn.disabled = true;
  $('memo-status').textContent = 'Transkribiere und extrahiere Bestelldaten…';
  try {
    const pcm = await memo.stop();
    if (pcm.length < 16000) throw new Error('Aufnahme zu kurz.');
    openOrder(await vd.orderFromAudio(pcm));
  } catch (e) {
    message('error', `Aufnahme gestoppt, aber Verarbeitung fehlgeschlagen: ${errorMessage(e)}`);
  } finally {
    btn.disabled = false;
    $('memo-status').textContent = 'Bereit zur Aufnahme';
  }
}

// ---------- Artikel-Autocomplete und -Suche (lokaler Katalog) ----------
function productRow(p: CatalogProduct, onPick: () => void): HTMLElement {
  const row = button('', onPick, 'suggestion');
  row.append(
    el('span', p.name, 'title'),
    el('span', `${p.number} · ${p.priceGross.toFixed(2)} €`, 'muted'),
  );
  return row;
}

function applyProduct(p: CatalogProduct): void {
  input('productName').value = p.name;
  input('productNumber').value = p.number;
  $('product-suggestions').classList.add('hidden');
  $('product-search').classList.add('hidden');
}

async function suggest(text: string): Promise<void> {
  const box = $('product-suggestions');
  if (!CATALOG_SHOPS.includes(target) || text.trim().length < 2) {
    box.classList.add('hidden');
    return;
  }
  const results = await vd.searchCatalog(target as CatalogShop, text, 8);
  box.replaceChildren(...results.map((p) => productRow(p, () => applyProduct(p))));
  box.classList.toggle('hidden', results.length === 0);
}

async function runProductSearch(): Promise<void> {
  const results = await vd.searchCatalog(
    target as CatalogShop,
    $<HTMLInputElement>('product-search-query').value,
    20,
  );
  const list = $('product-search-results');
  list.replaceChildren(
    ...(results.length
      ? results.map((p) => productRow(p, () => applyProduct(p)))
      : [
          el(
            'div',
            'Keine Treffer. (Artikel vorher in den Einstellungen synchronisieren.)',
            'muted',
          ),
        ]),
  );
}

// ---------- Vorschau ----------
function section(title: string, ...children: (HTMLElement | string)[]): HTMLElement {
  const box = el('div', undefined, 'preview-section');
  box.append(
    el('div', title, 'preview-title'),
    ...children.map((c) => (typeof c === 'string' ? el('div', c) : c)),
  );
  return box;
}

function nameWithBadge(name: string, isNew: boolean): HTMLElement {
  const row = el('div', name || 'Unbekannt', 'preview-strong');
  if (isNew) row.append(el('span', 'NEU', 'badge'));
  return row;
}

function finishSent(text: string): void {
  show('editor');
  message('success', text);
}

async function confirm(fields: ParsedFields, preview: PreviewData): Promise<void> {
  show('none');
  message(
    'info',
    preview.type === 'hubspot_preview' ? 'Übertrage an HubSpot…' : 'Bestellung wird angelegt…',
  );
  try {
    // Felder bleiben erhalten, damit dieselben Daten an weitere Ziele gesendet werden können.
    finishSent(await vd.confirmOrder(target, fields, preview, transcriptId));
  } catch (e) {
    show('editor');
    message('error', `Fehler bei der Übertragung: ${errorMessage(e)}`);
  }
}

function renderPreview(fields: ParsedFields, preview: PreviewData): void {
  $('preview-title').textContent = PREVIEW_TITLE[preview.type];
  const body: HTMLElement[] = [];
  const actions: HTMLElement[] = [
    button(
      preview.type === 'shopware_preview' ||
        preview.type === 'shopify_preview' ||
        preview.type === 'tiktok_preview' ||
        preview.type === 'hubspot_preview'
        ? 'Abbrechen'
        : 'Schließen',
      () => show('editor'),
    ),
  ];

  if (preview.type === 'hubspot_preview') {
    const hp = preview as HubspotPreview;
    body.push(
      section('KONTAKT', nameWithBadge(hp.contact.name, hp.contact.isNew), hp.contact.email),
      section(
        'DEAL',
        el('div', hp.dealName, 'preview-strong'),
        hp.amount != null ? `Betrag: ${hp.amount.toFixed(2)} €` : 'Betrag: –',
      ),
    );
    actions.push(button('Übertragen', () => void confirm(fields, preview), 'primary'));
  } else if (
    preview.type === 'csv' ||
    preview.type === 'email' ||
    preview.type === 'google_sheets'
  ) {
    const tp = preview as TextPreview;
    const label =
      tp.type === 'csv'
        ? 'CSV INHALT'
        : tp.type === 'email'
          ? 'E-MAIL TEXT'
          : 'SPREADSHEET-ZEILE (TAB-GETRENNT)';
    body.push(section(label, el('pre', tp.data, 'preview-pre')));
    actions.push(
      button('Kopieren', async () => {
        await vd.copyText(tp.data);
        message('success', 'Die Daten wurden in die Zwischenablage kopiert.');
      }),
    );
    if (tp.type === 'email') {
      actions.push(
        button(
          'Mail-App öffnen',
          async () => {
            const url = `mailto:?subject=${encodeURIComponent('Voicememo Bestellung')}&body=${encodeURIComponent(tp.data)}`;
            try {
              await vd.openExternal(url);
              if (transcriptId)
                await vd.markOrderSent(transcriptId, 'email', 'E-Mail-Entwurf geöffnet');
              finishSent('E-Mail-Entwurf geöffnet.');
            } catch (e) {
              message('error', `E-Mail-App konnte nicht geöffnet werden: ${errorMessage(e)}`);
            }
          },
          'primary',
        ),
      );
    }
    if (tp.type === 'csv') {
      actions.push(
        button(
          'Speichern…',
          async () => {
            if (await vd.saveCsv(tp.data)) message('success', 'CSV-Datei gespeichert.');
          },
          'primary',
        ),
      );
    }
    if (tp.type === 'google_sheets') {
      if (tp.sheetUrl) {
        actions.push(
          button('Sheet öffnen', async () => {
            await vd.copyText(tp.data);
            await vd.openExternal(tp.sheetUrl ?? '');
            message(
              'info',
              'Zeile kopiert: im Sheet eine Zelle auswählen und einfügen – die Werte verteilen sich auf die Spalten.',
            );
          }),
        );
      }
      actions.push(
        button(
          'In Sheet eintragen',
          async () => {
            show('none');
            message('info', 'Trage Zeile in Google Sheets ein…');
            try {
              finishSent(await vd.pushOrderToSheets(fields, transcriptId));
            } catch (e) {
              show('editor');
              message('error', `Fehler bei der Übertragung: ${errorMessage(e)}`);
            }
          },
          'primary',
        ),
      );
    }
  } else {
    const sp = preview as ShopPreview;
    const c = sp.customer;
    body.push(
      section(
        'KUNDE & ANSCHRIFT',
        nameWithBadge(c.name, c.isNew),
        c.email,
        ...(c.street || c.city ? [`${c.street}, ${c.zip} ${c.city}`] : []),
      ),
      section(
        'LIEFERANSCHRIFT',
        ...(sp.delivery.differs
          ? [
              el('div', sp.delivery.name || c.name, 'preview-strong'),
              `${sp.delivery.street}, ${sp.delivery.zip} ${sp.delivery.city}`,
            ]
          : ['Wie Rechnungsanschrift']),
      ),
      section(
        'PRODUKT (Warenkorb)',
        el('div', `${sp.product.quantity} × ${sp.product.name}`, 'preview-strong'),
        `Art.-Nr. ${sp.product.number || '–'}${sp.product.priceGross != null ? ` · ${sp.product.priceGross.toFixed(2)} €` : ''}`,
        ...(sp.product.found
          ? []
          : [el('div', 'Produkt nicht im Shop gefunden – Artikelnummer prüfen.', 'error')]),
      ),
    );
    const order = button('Bestellen', () => void confirm(fields, preview), 'primary');
    order.disabled = !sp.product.found;
    actions.push(order);
  }

  $('preview-body').replaceChildren(...body);
  $('preview-actions').replaceChildren(...actions);
  show('preview');
}

async function processFields(): Promise<void> {
  const fields = getFields();
  if (transcriptId) await vd.updateOrderFields(transcriptId, fields).catch(() => {});
  message('info', 'Erstelle Vorschau…');
  try {
    const preview = await vd.previewOrder(target, fields);
    clearMessage();
    renderPreview(fields, preview);
  } catch (e) {
    message('error', `Vorschau nicht möglich:\n${errorMessage(e)}`);
  }
}

// ---------- Transkripte ----------
export async function renderOrdersList(): Promise<void> {
  const items = await vd.listOrders();
  const list = $('orders-list');
  $('orders-delete-all').classList.toggle('hidden', items.length === 0);
  if (items.length === 0) {
    list.replaceChildren(
      el(
        'p',
        'Noch keine Transkripte. Diktiere unter „Bestellung“ deine erste Bestellung.',
        'muted',
      ),
    );
    return;
  }
  list.replaceChildren(
    ...items.map((t) => {
      const card = el('div', undefined, 'card');
      const head = el('div', undefined, 'card-head');
      head.append(
        el('div', t.fields.customerName || 'Unbekannter Kunde', 'title'),
        el(
          'span',
          t.status === 'sent'
            ? `✓ ${t.sentTarget ? TARGET_LABELS[t.sentTarget] : 'Gesendet'}`
            : 'ENTWURF',
          t.status === 'sent' ? 'badge sent' : 'badge',
        ),
      );
      const product = [t.fields.quantity > 1 ? `${t.fields.quantity} ×` : '', t.fields.productName]
        .filter(Boolean)
        .join(' ');
      card.append(
        head,
        el('div', product || '–'),
        el('div', new Date(t.createdAt).toLocaleString('de-DE'), 'muted'),
        el('div', t.transcriptText.slice(0, 160), 'preview'),
      );
      const del = button(
        'Löschen',
        async () => {
          if (!window.confirm('Dieses Transkript endgültig löschen?')) return;
          await vd.deleteOrder(t.id);
          if (transcriptId === t.id) transcriptId = null;
          await renderOrdersList();
        },
        'link danger',
      );
      del.addEventListener('click', (e) => e.stopPropagation());
      card.append(del);
      card.addEventListener('click', () => openOrder(t));
      return card;
    }),
  );
}

export function initOrders(showView: (view: View) => void): void {
  navigate = showView;
  renderTargets();
  $('memo-toggle').addEventListener('click', () => void toggleMemo());
  $('order-preview-btn').addEventListener('click', () => void processFields());
  $('order-close').addEventListener('click', () => {
    show('none');
    clearMessage();
  });
  for (const k of ['productName', 'productNumber'] as const) {
    input(k).addEventListener('input', () => void suggest(input(k).value));
  }
  $('product-search-open').addEventListener('click', () => {
    $('product-search').classList.toggle('hidden');
    $<HTMLInputElement>('product-search-query').value =
      input('productName').value || input('productNumber').value;
    void runProductSearch();
  });
  $('product-search-query').addEventListener('input', () => void runProductSearch());
  $('orders-delete-all').addEventListener('click', async () => {
    if (!window.confirm('Wirklich alle Transkripte löschen?')) return;
    await vd.deleteAllOrders();
    transcriptId = null;
    await renderOrdersList();
  });
}
