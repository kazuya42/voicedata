// Lokaler Artikel-Katalog: nach Shop-Verbindung werden alle Artikel (Nummer, Name, Preis, Steuersatz)
// lokal gecacht und stehen für Autocomplete/Vorschau offline zur Verfügung.
// Plattformneutral: die Speicherung steckt in einem austauschbaren Backend –
// Mobil (iOS/Android) registriert SQLite (catalogSqlite.ts), die Desktop-App eine JSON-Datei,
// Web nutzt den In-Memory-Standard.
import { CatalogProduct, CatalogShop } from './types';

export type CatalogBackend = {
  replace(shop: CatalogShop, products: CatalogProduct[]): void;
  count(shop: CatalogShop): number;
  // Leere Suche: erste `limit` Artikel alphabetisch (für "Alle anzeigen").
  // Sonst Treffer in Nummer oder Name; exakte Nummer zuerst, dann Nummern-Präfix, dann Name.
  search(shop: CatalogShop, query: string, limit: number): CatalogProduct[];
  findByNumber(shop: CatalogShop, number: string): CatalogProduct | null;
};

// In-Memory-Backend; onChange erhält nach jeder Änderung den kompletten Bestand (zum Persistieren).
export function createMemoryCatalog(
  initial: CatalogProduct[] = [],
  onChange?: (all: CatalogProduct[]) => void,
): CatalogBackend {
  let store = initial;
  const ofShop = (shop: CatalogShop) => store.filter((p) => p.shop === shop);
  return {
    replace(shop, products) {
      store = store.filter((p) => p.shop !== shop).concat(products);
      onChange?.(store);
    },
    count: (shop) => ofShop(shop).length,
    search(shop, query, limit) {
      const items = ofShop(shop);
      const q = query.trim().toLowerCase();
      if (!q) return [...items].sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit);
      const rank = (p: CatalogProduct) => {
        const n = p.number.toLowerCase();
        return n === q ? 0 : n.startsWith(q) ? 1 : 2;
      };
      return items
        .filter((p) => p.number.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
        .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
        .slice(0, limit);
    },
    findByNumber(shop, number) {
      const n = number.trim();
      return (n && store.find((p) => p.shop === shop && p.number === n)) || null;
    },
  };
}

let backend: CatalogBackend = createMemoryCatalog();

export function setCatalogBackend(b: CatalogBackend): void {
  backend = b;
}

export function replaceCatalog(shop: CatalogShop, products: CatalogProduct[]): void {
  backend.replace(shop, products);
}

export function catalogCount(shop: CatalogShop): number {
  return backend.count(shop);
}

export function searchCatalog(
  shop: CatalogShop,
  query: string,
  limit: number = 8,
): CatalogProduct[] {
  return backend.search(shop, query || '', limit);
}

export function findByNumber(shop: CatalogShop, number: string): CatalogProduct | null {
  return backend.findByNumber(shop, number || '');
}
