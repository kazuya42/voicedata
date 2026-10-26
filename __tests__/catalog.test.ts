import { createMemoryCatalog } from '../src/lib/catalog';
import { CatalogProduct } from '../src/lib/types';

const p = (shop: CatalogProduct['shop'], number: string, name: string): CatalogProduct => ({
  shop,
  externalId: `${shop}-${number}`,
  number,
  name,
  priceGross: 10,
  taxRate: 19,
});

describe('createMemoryCatalog', () => {
  test('ranks exact number, then number prefix, then name matches', () => {
    const c = createMemoryCatalog([
      p('shopware', 'X-SW100', 'Zubehör SW100'),
      p('shopware', 'SW1001', 'Bolzen'),
      p('shopware', 'SW100', 'Schrauben'),
    ]);
    expect(c.search('shopware', 'sw100', 10).map((x) => x.number)).toEqual([
      'SW100',
      'SW1001',
      'X-SW100',
    ]);
  });

  test('empty query lists alphabetically, limited and per shop', () => {
    const c = createMemoryCatalog([
      p('shopify', 'A', 'Zange'),
      p('shopify', 'B', 'Anker'),
      p('shopware', 'C', 'Bohrer'),
    ]);
    expect(c.search('shopify', '  ', 1).map((x) => x.name)).toEqual(['Anker']);
    expect(c.count('shopify')).toBe(2);
  });

  test('replace swaps only the given shop and reports the full store', () => {
    const onChange = jest.fn();
    const c = createMemoryCatalog(
      [p('shopware', '1', 'Alt'), p('shopify', '2', 'Bleibt')],
      onChange,
    );
    c.replace('shopware', [p('shopware', '3', 'Neu')]);
    expect(c.findByNumber('shopware', '1')).toBeNull();
    expect(c.findByNumber('shopware', ' 3 ')?.name).toBe('Neu');
    expect(c.findByNumber('shopify', '2')?.name).toBe('Bleibt');
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ number: '3' })]),
    );
    expect(onChange.mock.calls[0][0]).toHaveLength(2);
  });
});
