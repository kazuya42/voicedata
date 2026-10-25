// Einstellungen (JSON in userData) + OpenAI-Key (mit safeStorage verschlüsselt, separate Datei).
import fs from 'node:fs';
import path from 'node:path';
import { app, safeStorage } from 'electron';
import type { PublicSettings, Settings, SettingsPatch } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';
import { writeFileAtomic } from './fsutil';

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const keyFile = () => path.join(app.getPath('userData'), 'openai-key.bin');

export function getSettings(): Settings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...raw };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function getOpenaiKey(): string {
  try {
    if (!safeStorage.isEncryptionAvailable()) return '';
    return safeStorage.decryptString(fs.readFileSync(keyFile()));
  } catch {
    return '';
  }
}

export function getPublicSettings(): PublicSettings {
  return { ...getSettings(), hasOpenaiKey: getOpenaiKey() !== '' };
}

export function saveSettings(patch: SettingsPatch): PublicSettings {
  const { openaiKey, ...rest } = patch;
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  writeFileAtomic(settingsFile(), JSON.stringify({ ...getSettings(), ...rest }, null, 2));
  if (openaiKey !== undefined) {
    const key = openaiKey.trim();
    if (key === '') {
      fs.rmSync(keyFile(), { force: true });
    } else {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Sichere Ablage nicht verfügbar – Key kann nicht gespeichert werden.');
      }
      writeFileAtomic(keyFile(), safeStorage.encryptString(key));
    }
  }
  return getPublicSettings();
}
