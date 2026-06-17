// Lokaler Artikel-Katalog: nach Shop-Verbindung werden alle Artikel (Nummer, Name, Preis, Steuersatz)
// in SQLite gecacht und stehen für Autocomplete/Vorschau offline zur Verfügung.
// Web: kein SQLite (und ohnehin keine Shop-Ziele wegen CORS) -> In-Memory-Fallback.
import { Platform } from 'react-native';
import { CatalogProduct, CatalogShop } from './types';

type Db = {
  runSync: (sql: string, params?: any[]) => unknown;
  getAllSync: <T>(sql: string, params?: any[]) => T[];
  execSync: (sql: string) => void;
};

let db: Db | null = null;
let memStore: CatalogProduct[] = [];

function getDb(): Db | null {
  if (Platform.OS === 'web') return null;
  if (!db) {
    // Lazy require, damit der Web-Bundle das native Modul nicht laden muss
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const SQLite = require('expo-sqlite');
    db = SQLite.openDatabaseSync('voicedata.db') as Db;
    db.execSync(`
      CREATE TABLE IF NOT EXISTS products (
        shop TEXT NOT NULL,
        externalId TEXT NOT NULL,
        number TEXT NOT NULL,
        name TEXT NOT NULL,
        priceGross REAL NOT NULL DEFAULT 0,
        taxRate REAL,
        syncedAt TEXT NOT NULL,
        PRIMARY KEY (shop, externalId)
      );
      CREATE INDEX IF NOT EXISTS idx_products_number ON products(shop, number);
      CREATE INDEX IF NOT EXISTS idx_products_name ON products(shop, name);
    `);
  }
  return db;
}

export function replaceCatalog(shop: CatalogShop, products: CatalogProduct[]): void {
  const d = getDb();
  const now = new Date().toISOString();
  if (!d) {
    memStore = memStore.filter((p) => p.shop !== shop).concat(products);
    return;
  }
  d.runSync('DELETE FROM products WHERE shop = ?', [shop]);
  for (const p of products) {
    d.runSync(
      'INSERT OR REPLACE INTO products (shop, externalId, number, name, priceGross, taxRate, syncedAt) VALUES (?,?,?,?,?,?,?)',
      [p.shop, p.externalId, p.number, p.name, p.priceGross, p.taxRate, now],
    );
  }
}

export function catalogCount(shop: CatalogShop): number {
  const d = getDb();
  if (!d) return memStore.filter((p) => p.shop === shop).length;
  const rows = d.getAllSync<{ c: number }>('SELECT COUNT(*) AS c FROM products WHERE shop = ?', [
    shop,
  ]);
  return rows[0]?.c ?? 0;
}

export function searchCatalog(
  shop: CatalogShop,
  query: string,
  limit: number = 8,
): CatalogProduct[] {
  const q = (query || '').trim();
  if (!q) return [];
  const d = getDb();
  if (!d) {
    const lq = q.toLowerCase();
    return memStore
      .filter(
        (p) =>
          p.shop === shop &&
          (p.number.toLowerCase().includes(lq) || p.name.toLowerCase().includes(lq)),
      )
      .slice(0, limit);
  }
  return d.getAllSync<CatalogProduct>(
    `SELECT shop, externalId, number, name, priceGross, taxRate FROM products
     WHERE shop = ? AND (number LIKE ? OR name LIKE ?)
     ORDER BY CASE WHEN number = ? THEN 0 WHEN number LIKE ? THEN 1 ELSE 2 END, name
     LIMIT ?`,
    [shop, `%${q}%`, `%${q}%`, q, `${q}%`, limit],
  );
}

export function findByNumber(shop: CatalogShop, number: string): CatalogProduct | null {
  const n = (number || '').trim();
  if (!n) return null;
  const d = getDb();
  if (!d) return memStore.find((p) => p.shop === shop && p.number === n) || null;
  const rows = d.getAllSync<CatalogProduct>(
    'SELECT shop, externalId, number, name, priceGross, taxRate FROM products WHERE shop = ? AND number = ? LIMIT 1',
    [shop, n],
  );
  return rows[0] || null;
}
