import type { Settings } from '../../shared/types';
import { getCreds } from '../credentials';
import { modelPath, modelStatus } from '../models';
import { createLocalEngine } from './local';
import { createOpenAIEngine } from './openai';
import type { Engine } from './types';

export function getEngine(settings: Settings): Engine {
  if (settings.engine === 'openai') {
    const key = getCreds().openaiKey;
    if (!key) throw new Error('OpenAI-Key fehlt (für die OpenAI-Transkription)');
    return createOpenAIEngine(key);
  }
  if (!modelStatus()[settings.localModel]) {
    throw new Error(`Whisper-Modell „${settings.localModel}“ ist nicht heruntergeladen`);
  }
  return createLocalEngine(modelPath(settings.localModel));
}
