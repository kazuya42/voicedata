// Direkte OpenAI-Anbindung: Whisper-Transkription + GPT-Feldextraktion.
// Ersetzt die n8n-Nodes „Whisper" und „GPT-4o (Extract)" (Prompt 1:1 übernommen).
import { Platform } from 'react-native';
import { ParsedFields, emptyFields } from './types';

const OPENAI_BASE = 'https://api.openai.com/v1';

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

async function openaiError(response: Response): Promise<Error> {
  let msg = `OpenAI HTTP ${response.status}`;
  try {
    const j = await response.json();
    if (j?.error?.message) msg += `: ${j.error.message}`;
  } catch {}
  return new Error(msg);
}

// Audio-Datei (m4a/webm) zu Whisper hochladen, Transkript-Text zurückgeben
export async function transcribeAudio(uri: string, apiKey: string): Promise<string> {
  const formData = new FormData();
  formData.append('model', 'whisper-1');
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    formData.append('file', blob, 'audio_recording.webm');
  } else {
    formData.append('file', {
      uri,
      name: 'audio_recording.m4a',
      type: 'audio/mp4',
    } as any);
  }
  const response = await fetch(`${OPENAI_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });
  if (!response.ok) throw await openaiError(response);
  const json = await response.json();
  if (!json.text) throw new Error('Whisper lieferte keinen Text.');
  return json.text as string;
}

// Transkript-Text per GPT in strukturierte Bestellfelder umwandeln
export async function extractFields(text: string, apiKey: string): Promise<ParsedFields> {
  const response = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
    }),
  });
  if (!response.ok) throw await openaiError(response);
  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error('GPT lieferte keine Antwort.');
  const raw = JSON.parse(content);
  const base = emptyFields();
  return {
    ...base,
    ...raw,
    quantity: Math.max(1, parseInt(String(raw.quantity ?? 1), 10) || 1),
  };
}

// Schneller Verbindungstest für den Settings-Screen
export async function testOpenAI(apiKey: string): Promise<void> {
  const response = await fetch(`${OPENAI_BASE}/models/gpt-4o-mini`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw await openaiError(response);
}
