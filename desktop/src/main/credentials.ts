// Zugangsdaten aller Integrationen, verschlüsselt mit Electrons safeStorage (macOS-Schlüsselbund)
// in einer Datei im App-Datenordner. Entspricht dem SecureStore der Mobil-App.
import fs from 'node:fs';
import path from 'node:path';
import { app, safeStorage } from 'electron';
import { CRED_KEYS } from '../../../src/lib/types';
import type { Creds, DesktopCredKey } from '../shared/types';
import { writeFileAtomic } from './fsutil';

const ALL_KEYS: DesktopCredKey[] = [...CRED_KEYS, 'openrouterKey'];

const credsFile = () => path.join(app.getPath('userData'), 'credentials.bin');
// Frühere Versionen speicherten nur den OpenAI-Key einzeln.
const legacyKeyFile = () => path.join(app.getPath('userData'), 'openai-key.bin');

function empty(): Creds {
  return Object.fromEntries(ALL_KEYS.map((k) => [k, ''])) as Creds;
}

export function getCreds(): Creds {
  const creds = empty();
  if (!safeStorage.isEncryptionAvailable()) return creds;
  try {
    const raw = JSON.parse(safeStorage.decryptString(fs.readFileSync(credsFile()))) as Record<
      string,
      unknown
    >;
    for (const k of ALL_KEYS) if (typeof raw[k] === 'string') creds[k] = raw[k] as string;
  } catch {
    // Noch keine Datei oder nicht lesbar → leere Zugangsdaten.
  }
  if (!creds.openaiKey && fs.existsSync(legacyKeyFile())) {
    try {
      creds.openaiKey = safeStorage.decryptString(fs.readFileSync(legacyKeyFile()));
      write(creds);
      fs.rmSync(legacyKeyFile(), { force: true });
    } catch {
      // Alte Datei unlesbar → ignorieren.
    }
  }
  return creds;
}

function write(creds: Creds): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'Sichere Ablage nicht verfügbar – Zugangsdaten können nicht gespeichert werden.',
    );
  }
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  writeFileAtomic(credsFile(), safeStorage.encryptString(JSON.stringify(creds)));
}

// Werte werden getrimmt; '' löscht einen Eintrag.
export function saveCreds(patch: Partial<Creds>): Creds {
  const creds = getCreds();
  for (const k of ALL_KEYS) {
    const v = patch[k];
    if (typeof v === 'string') creds[k] = v.trim();
  }
  write(creds);
  return creds;
}
