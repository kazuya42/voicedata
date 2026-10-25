import { isValidEmail, isValidUrl, isValidGermanZip, validateForTarget } from '../src/lib/validate';
import { emptyFields, ParsedFields } from '../src/lib/types';

const withFields = (overrides: Partial<ParsedFields>): ParsedFields => ({
  ...emptyFields(),
  ...overrides,
});

describe('Format-Validatoren', () => {
  test('E-Mail', () => {
    expect(isValidEmail('max@example.de')).toBe(true);
    expect(isValidEmail('in@iljanaroska.de')).toBe(true);
    expect(isValidEmail('keine-email')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });

  test('URL', () => {
    expect(isValidUrl('https://shop.de')).toBe(true);
    expect(isValidUrl('http://localhost:8080')).toBe(true);
    expect(isValidUrl('ftp://shop.de')).toBe(false);
    expect(isValidUrl('shop.de')).toBe(false);
  });

  test('Deutsche PLZ', () => {
    expect(isValidGermanZip('12345')).toBe(true);
    expect(isValidGermanZip('1234')).toBe(false);
    expect(isValidGermanZip('123456')).toBe(false);
    expect(isValidGermanZip('abcde')).toBe(false);
  });
});

describe('validateForTarget', () => {
  test('Text-Ziele werden nicht validiert', () => {
    expect(validateForTarget(withFields({ customerEmail: 'mist' }), 'csv')).toEqual([]);
    expect(validateForTarget(withFields({ customerEmail: 'mist' }), 'email')).toEqual([]);
  });

  test('Shop: gültige Bestellung passiert', () => {
    const f = withFields({
      customerEmail: 'max@example.de',
      productName: 'Schrauben',
      customerZip: '12345',
    });
    expect(validateForTarget(f, 'shopware')).toEqual([]);
  });

  test('Shop: ungültige E-Mail wird gemeldet', () => {
    const f = withFields({ customerEmail: 'kaputt', productName: 'X' });
    expect(validateForTarget(f, 'shopify')).toContain('E-Mail-Adresse fehlt oder ist ungültig.');
  });

  test('Shop: fehlendes Produkt wird gemeldet', () => {
    const f = withFields({ customerEmail: 'max@example.de' });
    expect(validateForTarget(f, 'shopware')).toContain(
      'Produktname oder Artikelnummer wird benötigt.',
    );
  });

  test('Shop: ungültige PLZ wird gemeldet, leere PLZ nicht', () => {
    const bad = withFields({ customerEmail: 'a@b.de', productName: 'X', customerZip: '123' });
    expect(validateForTarget(bad, 'shopware')).toContain(
      'Rechnungs-PLZ muss aus 5 Ziffern bestehen.',
    );
    const empty = withFields({ customerEmail: 'a@b.de', productName: 'X', customerZip: '' });
    expect(validateForTarget(empty, 'shopware')).toEqual([]);
  });

  test('HubSpot: braucht E-Mail, aber kein Produkt/PLZ', () => {
    const f = withFields({ customerEmail: 'a@b.de' });
    expect(validateForTarget(f, 'hubspot')).toEqual([]);
  });
});
