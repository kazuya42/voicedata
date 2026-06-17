// Lokale Ziele ohne Server: CSV, E-Mail-Text, Google-Sheets-Zeile.
// Port der bisherigen n8n-Code-Nodes „CSV erstellen", „Email erstellen", „Google Sheets".
import { ParsedFields, TextPreview } from './types';

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
