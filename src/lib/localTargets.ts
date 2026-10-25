// Lokale Ziele ohne Server: CSV, E-Mail-Text, Google-Sheets-Zeile + direkter Push per Apps Script.
import { ParsedFields, TextPreview } from './types';
import { fetchWithRetry } from './http';

const esc = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"';

export function buildCsv(fields: ParsedFields): TextPreview {
  const header =
    'Kunde,Email,Strasse,PLZ,Ort,Produkt,Menge,LieferEmpfaenger,LieferStrasse,LieferPLZ,LieferOrt';
  const row = [
    fields.customerName,
    fields.customerEmail,
    fields.customerStreet || '',
    fields.customerZip || '',
    fields.customerCity || '',
    fields.productName,
    fields.quantity || 1,
    fields.deliveryName || '',
    fields.deliveryStreet || '',
    fields.deliveryZip || '',
    fields.deliveryCity || '',
  ]
    .map(esc)
    .join(',');
  return { type: 'csv', data: `${header}\n${row}` };
}

export function buildEmailText(fields: ParsedFields): TextPreview {
  let text =
    `Kunde: ${fields.customerName}\n` +
    `Email: ${fields.customerEmail}\n` +
    `Anschrift: ${fields.customerStreet || ''}, ${fields.customerZip || ''} ${fields.customerCity || ''}`;
  if (fields.deliveryName || fields.deliveryStreet || fields.deliveryCity) {
    text += `\nLieferanschrift: ${fields.deliveryName || fields.customerName}, ${fields.deliveryStreet || ''}, ${fields.deliveryZip || ''} ${fields.deliveryCity || ''}`;
  } else {
    text += '\nLieferanschrift: wie Rechnungsanschrift';
  }
  text += `\nProdukt: ${fields.productName}\nMenge: ${fields.quantity || 1}`;
  return { type: 'email', data: text };
}

// Direkter Push an ein Google Apps Script Web App.
// Content-Type text/plain vermeidet CORS-Preflight (Apps Script unterstützt OPTIONS nicht).
export async function pushToGoogleSheets(fields: ParsedFields, scriptUrl: string): Promise<void> {
  if (!scriptUrl) throw new Error('Google Apps Script URL fehlt (Einstellungen → Google Sheets).');
  const body = JSON.stringify({
    customerName: fields.customerName,
    customerEmail: fields.customerEmail,
    customerStreet: fields.customerStreet || '',
    customerZip: fields.customerZip || '',
    customerCity: fields.customerCity || '',
    productName: fields.productName,
    productNumber: fields.productNumber || '',
    quantity: fields.quantity || 1,
    deliveryName: fields.deliveryName || '',
    deliveryStreet: fields.deliveryStreet || '',
    deliveryZip: fields.deliveryZip || '',
    deliveryCity: fields.deliveryCity || '',
  });
  const response = await fetchWithRetry(
    scriptUrl,
    { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body },
    { timeoutMs: 20_000, retries: 1 },
  );
  if (!response.ok) throw new Error(`Google Sheets: HTTP ${response.status}`);
  const json = await response.json();
  if (!json?.ok) throw new Error(`Google Sheets: ${json?.error || 'Unbekannter Fehler'}`);
}

export function buildSheetsRow(fields: ParsedFields, googleSheetId: string): TextPreview {
  const cells = [
    fields.customerName,
    fields.customerEmail,
    fields.customerStreet || '',
    fields.customerZip || '',
    fields.customerCity || '',
    fields.productName,
    fields.productNumber || '',
    fields.quantity || 1,
    fields.deliveryName || '',
    fields.deliveryStreet || '',
    fields.deliveryZip || '',
    fields.deliveryCity || '',
  ];
  const row = cells.map((v) => String(v ?? '').replace(/[\t\n]/g, ' ')).join('\t');
  const sheetUrl = googleSheetId
    ? `https://docs.google.com/spreadsheets/d/${googleSheetId.trim()}/edit`
    : '';
  return { type: 'google_sheets', data: row, sheetUrl };
}
