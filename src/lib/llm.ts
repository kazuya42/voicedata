// Einheitlicher Chat-Client für die KI-Funktionen (Feldextraktion, Meeting-Zusammenfassung).
// OpenAI, OpenRouter und Ollama sprechen alle die OpenAI-kompatible /chat/completions-API;
// unterschiedlich sind nur Basis-URL, Authentifizierung und Modellnamen.
import { fetchWithRetry, parseApiError } from './http';

export type LlmProvider = 'openai' | 'openrouter' | 'ollama';

export type LlmConfig = {
  provider: LlmProvider;
  apiKey: string; // bei Ollama leer
  model: string; // leer = Standardmodell des Anbieters
  ollamaUrl?: string; // Standard http://localhost:11434
};

export const LLM_PROVIDER_LABEL: Record<LlmProvider, string> = {
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  ollama: 'Ollama',
};

// Ollama hat kein sinnvolles Standardmodell – dort muss ein installiertes Modell gewählt werden.
export const DEFAULT_LLM_MODEL: Record<LlmProvider, string> = {
  openai: 'gpt-4o-mini',
  openrouter: 'openai/gpt-4o-mini',
  ollama: '',
};

export const DEFAULT_OLLAMA_URL = 'http://localhost:11434';

function baseUrl(cfg: LlmConfig): string {
  if (cfg.provider === 'openai') return 'https://api.openai.com/v1';
  if (cfg.provider === 'openrouter') return 'https://openrouter.ai/api/v1';
  return `${(cfg.ollamaUrl || DEFAULT_OLLAMA_URL).trim().replace(/\/+$/, '')}/v1`;
}

function headers(cfg: LlmConfig): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.provider !== 'ollama') h.Authorization = `Bearer ${cfg.apiKey}`;
  // Optionale App-Kennung für die OpenRouter-Statistik.
  if (cfg.provider === 'openrouter') h['X-Title'] = 'VoiceData';
  return h;
}

// Wirft eine verständliche Meldung, wenn Key oder Modell fehlen.
export function assertLlmReady(cfg: LlmConfig): void {
  const label = LLM_PROVIDER_LABEL[cfg.provider];
  if (cfg.provider !== 'ollama' && !cfg.apiKey)
    throw new Error(`${label}-Key fehlt (Einstellungen).`);
  if (!(cfg.model || DEFAULT_LLM_MODEL[cfg.provider])) {
    throw new Error(`${label}: kein Modell ausgewählt (Einstellungen).`);
  }
}

export async function chatCompletion(
  cfg: LlmConfig,
  system: string,
  user: string,
  opts: { json: boolean; temperature?: number },
): Promise<string> {
  assertLlmReady(cfg);
  const label = LLM_PROVIDER_LABEL[cfg.provider];
  // Lesender Aufruf ohne Seiteneffekt → ein Retry ist unkritisch. Lokale Modelle brauchen
  // beim ersten Aufruf (Modell laden) deutlich länger.
  const response = await fetchWithRetry(
    `${baseUrl(cfg)}/chat/completions`,
    {
      method: 'POST',
      headers: headers(cfg),
      body: JSON.stringify({
        model: cfg.model || DEFAULT_LLM_MODEL[cfg.provider],
        temperature: opts.temperature ?? 0.2,
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    },
    { timeoutMs: cfg.provider === 'ollama' ? 300_000 : 90_000, retries: 1 },
  );
  if (!response.ok) throw await parseApiError(response, label);
  const json = await response.json();
  const content: unknown = json?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error(`${label}: leere Antwort`);
  return content.trim();
}

// Verbindungstest: OpenAI prüft das Modell, OpenRouter den Key, Ollama ob das Modell installiert ist.
export async function testLlm(cfg: LlmConfig): Promise<void> {
  assertLlmReady(cfg);
  const label = LLM_PROVIDER_LABEL[cfg.provider];
  const model = cfg.model || DEFAULT_LLM_MODEL[cfg.provider];
  if (cfg.provider === 'ollama') {
    const models = await listOllamaModels(cfg.ollamaUrl);
    if (!models.includes(model)) {
      throw new Error(`Ollama: Modell „${model}“ ist nicht installiert (ollama pull ${model}).`);
    }
    return;
  }
  const url =
    cfg.provider === 'openai'
      ? `${baseUrl(cfg)}/models/${encodeURIComponent(model)}`
      : `${baseUrl(cfg)}/key`;
  const response = await fetchWithRetry(url, { headers: headers(cfg) }, { retries: 1 });
  if (!response.ok) throw await parseApiError(response, label);
}

// Installierte Ollama-Modelle (für die Auswahl in den Einstellungen).
export async function listOllamaModels(ollamaUrl?: string): Promise<string[]> {
  const root = (ollamaUrl || DEFAULT_OLLAMA_URL).trim().replace(/\/+$/, '');
  let response: Response;
  try {
    response = await fetchWithRetry(`${root}/api/tags`, {}, { timeoutMs: 5000 });
  } catch {
    throw new Error(`Ollama nicht erreichbar unter ${root} – läuft Ollama?`);
  }
  if (!response.ok) throw await parseApiError(response, 'Ollama');
  const json = await response.json();
  const models: unknown = json?.models;
  if (!Array.isArray(models)) return [];
  return models
    .map((m: { name?: unknown }) => (typeof m?.name === 'string' ? m.name : ''))
    .filter(Boolean);
}

// Modelle liefern JSON gelegentlich in Markdown-Fences.
export function parseJsonContent(content: string): unknown {
  return JSON.parse(content.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
}
