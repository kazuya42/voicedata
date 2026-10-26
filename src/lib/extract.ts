// Feldextraktion: Transkript → strukturierte Bestellfelder per KI (OpenAI, OpenRouter oder Ollama).
// Plattformneutral (keine React-Native-Importe), damit Mobil- und Desktop-App denselben Prompt nutzen.
// Prompt 1:1 aus dem früheren n8n-Node „GPT-4o (Extract)" übernommen.
import { ParsedFields, emptyFields } from './types';
import { LlmConfig, chatCompletion, parseJsonContent } from './llm';

const EXTRACTION_SYSTEM_PROMPT = `Du bist ein präziser Extraktions-Assistent für Voicememos. Gib AUSNAHMSLOS nur gültiges JSON zurück:
{
  "customerName": "Max Mustermann",
  "customerEmail": "max.mustermann@gmx.de",
  "customerStreet": "Hauptstraße 12",
  "customerZip": "12345",
  "customerCity": "Musterstadt",
  "productName": "Schrauben",
  "productNumber": "SW10001",
  "quantity": 1,
  "deliveryName": "",
  "deliveryStreet": "",
  "deliveryZip": "",
  "deliveryCity": ""
}

REGELN FÜR E-MAILS:
1. Analysiere den Text sorgfältig auf gesprochene/buchstabierte E-Mails. Diese werden oft mit 'at' oder 'klammeraffe' für '@' und 'punkt' für '.' gesprochen (z.B. 'in at iljanarowska.de' -> 'in@iljanarowska.de', 'info klammeraffe gmx punkt de' -> 'info@gmx.de'). Rekonstruiere diese gesprochene E-Mail exakt!
2. Benutze NIEMALS die Endung '@dummy.com', wenn im Voicememo eine E-Mail-Adresse gesprochen oder buchstabiert wird.
3. Nur wenn im gesamten Voicememo absolut KEINE E-Mail vorkommt, generiere eine Dummy-E-Mail im Format 'vorname.nachname@dummy.com' basierend auf dem Namen.
4. Wenn Strasse, PLZ oder Ort fehlen, lasse diese Felder leer ("").
5. Nur wenn im Voicememo eine ABWEICHENDE Lieferadresse genannt wird (z.B. "liefern an", "Lieferadresse ist"), fülle deliveryName/deliveryStreet/deliveryZip/deliveryCity. Sonst lasse diese vier Felder leer ("").`;

// Transkript-Feldextraktion ist idempotent (kein Schreib-Seiteneffekt) -> Retry ist unkritisch.
export async function extractFields(text: string, llm: LlmConfig): Promise<ParsedFields> {
  const content = await chatCompletion(llm, EXTRACTION_SYSTEM_PROMPT, text, { json: true });
  const raw = parseJsonContent(content) as Partial<Record<keyof ParsedFields, unknown>>;
  const base = emptyFields();
  // Modelle liefern z. B. PLZ gelegentlich als Zahl → alles außer null/undefined als Text übernehmen.
  const str = (k: Exclude<keyof ParsedFields, 'quantity'>) =>
    raw[k] == null ? base[k] : String(raw[k]);
  return {
    customerName: str('customerName'),
    customerEmail: str('customerEmail'),
    customerStreet: str('customerStreet'),
    customerZip: str('customerZip'),
    customerCity: str('customerCity'),
    productName: str('productName'),
    productNumber: str('productNumber'),
    quantity: Math.max(1, parseInt(String(raw.quantity ?? 1), 10) || 1),
    deliveryName: str('deliveryName'),
    deliveryStreet: str('deliveryStreet'),
    deliveryZip: str('deliveryZip'),
    deliveryCity: str('deliveryCity'),
  };
}
