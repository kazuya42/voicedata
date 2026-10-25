import type { Settings } from '../../shared/types';
import { getOpenaiKey } from '../settings';
import { modelPath, modelStatus } from '../models';
import { createLocalEngine } from './local';
import { createOpenAIEngine } from './openai';
import type { Engine } from './types';

export function getEngine(settings: Settings): Engine {
  if (settings.engine === 'openai') {
    const key = getOpenaiKey();
    if (!key) throw new Error('OpenAI-Key fehlt');
    return createOpenAIEngine(key);
  }
  if (!modelStatus()[settings.localModel]) {
    throw new Error(`Whisper-Modell „${settings.localModel}“ ist nicht heruntergeladen`);
  }
  return createLocalEngine(modelPath(settings.localModel));
}
