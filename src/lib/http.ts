// Gemeinsame HTTP-Helfer: einheitliches Fehler-Parsing über alle APIs hinweg
// (OpenAI, Shopware, Shopify, HubSpot) + Fetch mit Timeout und optionalem Retry.
//
// WICHTIG: Retries nur für idempotente Aufrufe (GET/Auth/Suche/Verbindungstests).
// Nicht-idempotente Schreibvorgänge (Bestellung/Kunde anlegen) dürfen NIEMALS
// automatisch wiederholt werden – sonst drohen Doppel-Bestellungen.

// Bestes verfügbares Fehlerdetail aus den unterschiedlichen API-Antwortformaten ziehen.
export async function parseApiError(response: Response, context: string): Promise<Error> {
  let msg = `${context}: HTTP ${response.status}`;
  try {
    const j: any = await response.json();
    const detail =
      j?.error?.message || // OpenAI
      j?.errors?.[0]?.detail || // Shopware (JSON:API)
      j?.errors?.[0]?.title || // Shopware (Fallback)
      (typeof j?.errors === 'string' ? j.errors : undefined) || // Shopify (String)
      j?.message; // HubSpot / generisch
    if (detail) msg += ` – ${detail}`;
  } catch {
    // Body war kein JSON – Status-Code-Meldung genügt.
  }
  return new Error(msg);
}

export type FetchOptions = {
  timeoutMs?: number; // Standard 20s
  retries?: number; // zusätzliche Versuche bei 429/5xx/Netzwerkfehler; Standard 0
  retryDelayMs?: number; // Basis-Delay für exponentiellen Backoff; Standard 500ms
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// fetch mit hartem Timeout (AbortController) und optionalem exponentiellem Backoff.
export async function fetchWithRetry(
  input: string,
  init: RequestInit = {},
  opts: FetchOptions = {},
): Promise<Response> {
  const { timeoutMs = 20_000, retries = 0, retryDelayMs = 500 } = opts;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      // 429/5xx sind wiederholbar, solange noch Versuche übrig sind.
      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        await sleep(retryDelayMs * 2 ** attempt);
        continue;
      }
      return response;
    } catch (err) {
      // Netzwerkfehler oder Timeout-Abbruch.
      lastError = err;
      if (attempt < retries) {
        await sleep(retryDelayMs * 2 ** attempt);
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  const reason = lastError instanceof Error ? lastError.message : 'Netzwerkfehler';
  throw new Error(`Verbindung fehlgeschlagen: ${reason}`);
}
