// Einstellungen (JSON in userData). Zugangsdaten liegen getrennt und verschlüsselt (credentials.ts).
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { LlmConfig } from '../../../src/lib/llm';
import type { Settings, SettingsPatch } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';
import { getCreds } from './credentials';
import { writeFileAtomic } from './fsutil';

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

export function getSettings(): Settings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...raw };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(patch: SettingsPatch): Settings {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  const next = { ...getSettings(), ...patch };
  writeFileAtomic(settingsFile(), JSON.stringify(next, null, 2));
  return next;
}

// KI-Anbieter für Zusammenfassung und Bestelldaten-Extraktion aus Einstellungen + Zugangsdaten.
export function getLlmConfig(): LlmConfig {
  const s = getSettings();
  const creds = getCreds();
  return {
    provider: s.aiProvider,
    apiKey: s.aiProvider === 'openrouter' ? creds.openrouterKey : creds.openaiKey,
    model: s.aiModel,
    ollamaUrl: s.ollamaUrl,
  };
}
