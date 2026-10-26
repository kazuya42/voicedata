// Artikel-Katalog der Desktop-App: In-Memory-Backend aus der Mobil-Logik, persistiert als JSON
// im App-Datenordner (statt SQLite – keine nativen Module nötig).
import fs from 'node:fs';
import path from 'node:path';
import { createMemoryCatalog, setCatalogBackend } from '../../../src/lib/catalog';
import type { CatalogProduct } from '../../../src/lib/types';
import { writeFileAtomic } from './fsutil';

export function initCatalog(dir: string): void {
  const file = path.join(dir, 'catalog.json');
  let initial: CatalogProduct[] = [];
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(raw)) initial = raw as CatalogProduct[];
  } catch {
    // Noch nicht synchronisiert oder beschädigt → leerer Katalog (neu synchronisieren).
  }
  setCatalogBackend(
    createMemoryCatalog(initial, (all) => {
      fs.mkdirSync(dir, { recursive: true });
      writeFileAtomic(file, JSON.stringify(all));
    }),
  );
}
