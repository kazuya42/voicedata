// OpenAI-Transkription mit gpt-transcribe (whisper-1 wird am 2027-02-26 abgeschaltet).
import { fetchWithRetry, parseApiError } from '../../../../src/lib/http';
import { encodeWav16 } from '../../shared/audio';
import type { Engine } from './types';

const OPENAI_BASE = 'https://api.openai.com/v1';
const MODEL = 'gpt-transcribe';

export function createOpenAIEngine(apiKey: string): Engine {
  return {
    async transcribe(pcm, opts) {
      const form = new FormData();
      form.append('model', MODEL);
      form.append('file', new Blob([encodeWav16(pcm)], { type: 'audio/wav' }), 'chunk.wav');
      if (opts.language !== 'auto') form.append('languages[]', opts.language);
      // Die API lehnt Prompts mit <, >, CR oder LF komplett ab.
      const prompt = (opts.prompt ?? '').replace(/[<>\r\n]/g, ' ').trim();
      if (prompt) form.append('prompt', prompt);
      const res = await fetchWithRetry(
        `${OPENAI_BASE}/audio/transcriptions`,
        { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form },
        { timeoutMs: 60_000, retries: 1 },
      );
      if (!res.ok) throw await parseApiError(res, 'OpenAI Transkription');
      const json = (await res.json()) as { text?: string };
      return (json.text ?? '').trim();
    },
  };
}

export async function testOpenAI(apiKey: string): Promise<void> {
  const res = await fetchWithRetry(
    `${OPENAI_BASE}/models/${MODEL}`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
    { retries: 1 },
  );
  if (!res.ok) throw await parseApiError(res, 'OpenAI');
}
