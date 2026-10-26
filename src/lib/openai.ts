// Direkte OpenAI-Anbindung der Mobil-App: Whisper-Transkription + Verbindungstest.
// Die Feldextraktion liegt plattformneutral in extract.ts.
import { Platform } from 'react-native';
import { fetchWithRetry, parseApiError } from './http';

const OPENAI_BASE = 'https://api.openai.com/v1';

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
  const response = await fetchWithRetry(
    `${OPENAI_BASE}/audio/transcriptions`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    },
    { timeoutMs: 60_000, retries: 1 },
  );
  if (!response.ok) throw await parseApiError(response, 'OpenAI Whisper');
  const json = await response.json();
  if (!json.text) throw new Error('Whisper lieferte keinen Text.');
  return json.text as string;
}

// Schneller Verbindungstest für den Settings-Screen
export async function testOpenAI(apiKey: string): Promise<void> {
  const response = await fetchWithRetry(
    `${OPENAI_BASE}/models/gpt-4o-mini`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
    { retries: 1 },
  );
  if (!response.ok) throw await parseApiError(response, 'OpenAI');
}
