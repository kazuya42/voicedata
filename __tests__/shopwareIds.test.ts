import { parseShopwareIds, DEFAULT_SHOPWARE_IDS } from '../src/lib/shopware';

describe('parseShopwareIds', () => {
  test('leerer/ungültiger Input -> {}', () => {
    expect(parseShopwareIds('')).toEqual({});
    expect(parseShopwareIds(undefined)).toEqual({});
    expect(parseShopwareIds('kein json')).toEqual({});
    expect(parseShopwareIds('123')).toEqual({});
  });

  test('übernimmt nur bekannte String-Schlüssel', () => {
    const json = JSON.stringify({
      currencyId: 'abc',
      languageId: 'def',
      unbekannt: 'wird-ignoriert',
      salesChannelId: 123, // falscher Typ -> ignoriert
    });
    expect(parseShopwareIds(json)).toEqual({ currencyId: 'abc', languageId: 'def' });
  });

  test('trimmt Werte und ignoriert leere', () => {
    const json = JSON.stringify({ currencyId: '  xyz  ', languageId: '   ' });
    expect(parseShopwareIds(json)).toEqual({ currencyId: 'xyz' });
  });

  test('alle Default-Schlüssel sind parsebar', () => {
    const json = JSON.stringify(DEFAULT_SHOPWARE_IDS);
    expect(parseShopwareIds(json)).toEqual(DEFAULT_SHOPWARE_IDS);
  });
});
