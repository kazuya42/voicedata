// SQLite-Backend für den Artikel-Katalog auf iOS/Android (expo-sqlite).
// Wird in App.tsx registriert; im Web bleibt der In-Memory-Standard aus catalog.ts aktiv.
import { CatalogBackend } from './catalog';
import { CatalogProduct } from './types';

const COLUMNS = 'shop, externalId, number, name, priceGross, taxRate';

type SqlParam = string | number | null;
type Db = {
  runSync: (sql: string, params?: SqlParam[]) => unknown;
  getAllSync: <T>(sql: string, params?: SqlParam[]) => T[];
  execSync: (sql: string) => void;
};

export function createSqliteCatalog(): CatalogBackend {
  // Lazy require, damit der Web-Bundle das native Modul nicht laden muss
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const db = require('expo-sqlite').openDatabaseSync('voicedata.db') as Db;
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

  return {
    replace(shop, products) {
      const now = new Date().toISOString();
      db.runSync('DELETE FROM products WHERE shop = ?', [shop]);
      for (const p of products) {
        db.runSync(
          'INSERT OR REPLACE INTO products (shop, externalId, number, name, priceGross, taxRate, syncedAt) VALUES (?,?,?,?,?,?,?)',
          [p.shop, p.externalId, p.number, p.name, p.priceGross, p.taxRate, now],
        );
      }
    },
    count(shop) {
      const rows = db.getAllSync<{ c: number }>(
        'SELECT COUNT(*) AS c FROM products WHERE shop = ?',
        [shop],
      );
      return rows[0]?.c ?? 0;
    },
    search(shop, query, limit) {
      const q = query.trim();
      if (!q) {
        return db.getAllSync<CatalogProduct>(
          `SELECT ${COLUMNS} FROM products WHERE shop = ? ORDER BY name LIMIT ?`,
          [shop, limit],
        );
      }
      return db.getAllSync<CatalogProduct>(
        `SELECT ${COLUMNS} FROM products
         WHERE shop = ? AND (number LIKE ? OR name LIKE ?)
         ORDER BY CASE WHEN number = ? THEN 0 WHEN number LIKE ? THEN 1 ELSE 2 END, name
         LIMIT ?`,
        [shop, `%${q}%`, `%${q}%`, q, `${q}%`, limit],
      );
    },
    findByNumber(shop, number) {
      const n = number.trim();
      if (!n) return null;
      const rows = db.getAllSync<CatalogProduct>(
        `SELECT ${COLUMNS} FROM products WHERE shop = ? AND number = ? LIMIT 1`,
        [shop, n],
      );
      return rows[0] || null;
    },
  };
}
