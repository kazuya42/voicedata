import { buildCsv, buildSheetsRow } from '../src/lib/localTargets';
import { emptyFields } from '../src/lib/types';

describe('buildCsv', () => {
  test('Header + Datenzeile, Werte sind gequotet', () => {
    const { type, data } = buildCsv({
      ...emptyFields(),
      customerName: 'Max',
      customerEmail: 'max@example.de',
      productName: 'Schrauben',
      quantity: 3,
    });
    expect(type).toBe('csv');
    const [header, row] = data.split('\n');
    expect(header.startsWith('Kunde,Email')).toBe(true);
    expect(row).toContain('"Max"');
    expect(row).toContain('"max@example.de"');
    expect(row).toContain('"3"');
  });

  test('Anführungszeichen im Wert werden verdoppelt (CSV-Escaping)', () => {
    const { data } = buildCsv({ ...emptyFields(), customerName: 'Say "Hi"' });
    expect(data).toContain('"Say ""Hi"""');
  });
});

describe('buildSheetsRow', () => {
  test('Tab-getrennt, Tabs/Newlines in Werten entfernt', () => {
    const { data, sheetUrl } = buildSheetsRow(
      { ...emptyFields(), customerName: 'A\tB', productName: 'C\nD' },
      'SHEET123',
    );
    expect(data).not.toMatch(/\t.*A.*B/);
    expect(data).toContain('A B');
    expect(data).toContain('C D');
    expect(sheetUrl).toBe('https://docs.google.com/spreadsheets/d/SHEET123/edit');
  });

  test('ohne Sheet-ID keine URL', () => {
    const { sheetUrl } = buildSheetsRow(emptyFields(), '');
    expect(sheetUrl).toBe('');
  });
});
