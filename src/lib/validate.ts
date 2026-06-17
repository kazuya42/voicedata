// Eingabe-Validierung vor dem Versand an externe Systeme.
// Ziel: verständliche deutsche Hinweise statt kryptischer API-Fehler (HTTP 4xx/5xx).
import { ParsedFields, TargetSystem } from './types';

export const isValidEmail = (email: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((email || '').trim());

export const isValidUrl = (url: string): boolean => {
  try {
    const u = new URL((url || '').trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

// Deutsche PLZ: genau 5 Ziffern.
export const isValidGermanZip = (zip: string): boolean => /^\d{5}$/.test((zip || '').trim());

// Ziele, die an ein externes CRM/Shop-System gehen und valide Felder brauchen.
const STRICT_TARGETS: TargetSystem[] = ['shopware', 'shopify', 'hubspot'];

// Prüft die Felder für ein Ziel und liefert eine Liste menschenlesbarer Fehler (leer = ok).
export function validateForTarget(fields: ParsedFields, target: TargetSystem): string[] {
  const errors: string[] = [];
  if (!STRICT_TARGETS.includes(target)) return errors;

  if (!isValidEmail(fields.customerEmail)) {
    errors.push('E-Mail-Adresse fehlt oder ist ungültig.');
  }

  if (target !== 'hubspot') {
    // Shop-Bestellung braucht ein identifizierbares Produkt.
    if (!fields.productName?.trim() && !fields.productNumber?.trim()) {
      errors.push('Produktname oder Artikelnummer wird benötigt.');
    }
    // PLZ ist optional (Dummy-Fallback), aber wenn angegeben, muss sie 5-stellig sein.
    if (fields.customerZip?.trim() && !isValidGermanZip(fields.customerZip)) {
      errors.push('Rechnungs-PLZ muss aus 5 Ziffern bestehen.');
    }
    if (fields.deliveryZip?.trim() && !isValidGermanZip(fields.deliveryZip)) {
      errors.push('Liefer-PLZ muss aus 5 Ziffern bestehen.');
    }
  }

  return errors;
}
