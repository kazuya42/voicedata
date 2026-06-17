// Lokale Transkript-Ablage (Text + Felder + Status), persistent über App-Neustarts.
// Bewusst AsyncStorage statt SQLite: kleine Datenmenge, funktioniert identisch auf iOS/Android/Web.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ParsedFields, TargetSystem, Transcript } from './types';

const KEY = '@vd_transcripts';

async function load(): Promise<Transcript[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Transcript[]) : [];
  } catch {
    return [];
  }
}

async function persist(list: Transcript[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
}

export async function listTranscripts(): Promise<Transcript[]> {
  const list = await load();
  return list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function saveTranscript(
  transcriptText: string,
  fields: ParsedFields,
): Promise<Transcript> {
  const t: Transcript = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    transcriptText,
    fields,
    status: 'draft',
  };
  const list = await load();
  list.push(t);
  await persist(list);
  return t;
}

export async function updateTranscriptFields(id: string, fields: ParsedFields): Promise<void> {
  const list = await load();
  const t = list.find((x) => x.id === id);
  if (!t) return;
  t.fields = fields;
  await persist(list);
}

export async function markTranscriptSent(
  id: string,
  target: TargetSystem,
  resultInfo: string,
): Promise<void> {
  const list = await load();
  const t = list.find((x) => x.id === id);
  if (!t) return;
  t.status = 'sent';
  t.sentTarget = target;
  t.sentAt = new Date().toISOString();
  t.resultInfo = resultInfo;
  await persist(list);
}

export async function deleteTranscript(id: string): Promise<void> {
  const list = await load();
  await persist(list.filter((x) => x.id !== id));
}

export async function deleteAllTranscripts(): Promise<void> {
  await persist([]);
}
