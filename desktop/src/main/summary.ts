// Zusammenfassung nach dem Meeting: Kurzüberblick, Kernpunkte nach Thema, To-dos.
// Prompts übernommen aus call.md (summary-generator.service.ts); ausgeführt mit dem in den
// Einstellungen gewählten KI-Anbieter (OpenAI, OpenRouter oder lokal per Ollama).
// Drei Aufrufe parallel wie im Original.
import type { LlmConfig } from '../../../src/lib/llm';
import { chatCompletion, parseJsonContent } from '../../../src/lib/llm';
import type { KeyPoint, MeetingSummary, Session } from '../shared/types';
import { SPEAKER_LABEL } from '../shared/types';
import { formatClock } from '../shared/format';

const LANGUAGE_RULE = `- Write in the same language as the transcript (German transcript → German output).`;

const OVERVIEW_PROMPT = `You are an expert meeting summarizer. Given a meeting transcript, produce a
short narrative summary of what happened in the meeting.

Rules:
- Write a single flowing paragraph. No bullet points, no headers, no numbered lists.
- The summary should read like a brief written by a sharp colleague who sat in on the
  meeting - it tells you what the meeting was about and what the main threads of
  discussion were.
- Mention participants by name if names are spoken, otherwise refer to them by their
  speaker label. Keep it high-level. Do not quote anyone verbatim.
- Do not editorialize or add opinions. Stick to what actually happened.
- Aim for 3-5 sentences. Never exceed 120 words.
- Write in past tense, third person.
${LANGUAGE_RULE}

Respond ONLY with the summary paragraph - no explanation, no headers, no preamble.`;

const KEY_POINTS_PROMPT = `You are an expert meeting summarizer. Given a meeting transcript, produce a
detailed breakdown of the key discussion points from the meeting.

Rules:
- Identify the major topics or themes that were discussed. Group related points under
  a clear, short topic heading.
- Under each topic, write individual points attributed to the person who raised them
  (name if spoken, otherwise speaker label). Use the format: "Name did/said/raised/confirmed..."
- Each point should be one concrete sentence capturing what was said, decided, or
  proposed. No filler, no fluff.
- Stay factual - report what happened, do not add interpretation or recommendations.
- Write in past tense, third person.
- Aim for 2-5 topics, with 2-5 points each. Let the actual content of the meeting
  dictate the count - do not pad or compress artificially.
${LANGUAGE_RULE}

Respond ONLY with a JSON object in this format:
{"key_points": [{"topic": "Topic Name", "points": ["Person said something specific."]}]}`;

const ACTION_ITEMS_PROMPT = `You are an expert meeting analyst. Given a meeting transcript, extract all
action items, follow-ups, open questions, and tasks that need to be handled AFTER the
meeting ends.

Rules:
- Extract concrete, actionable items that emerged from the conversation.
- Include: tasks assigned to people, decisions that need follow-up, questions that were
  left unanswered, commitments made, deadlines mentioned, and next steps discussed.
- Each item should be a clear, actionable statement. Include the responsible person if
  mentioned.
- Good: "John to send the proposal by Friday"
- Bad: "Discussed the project" (not actionable)
- Order by priority/urgency if discernible, otherwise by order mentioned.
- Only include genuine action items from the conversation - do not pad or invent items.
  At most 10 items. If no clear action items were discussed, return an empty array.
${LANGUAGE_RULE}

Respond ONLY with a JSON object in this format:
{"checklist": ["Action item 1", "Action item 2"]}`;

function buildUserPrompt(session: Session): string {
  const lines = session.segments
    .filter((s) => s.status === 'ok')
    .map((s) => `[${formatClock(s.startedAt)}] ${SPEAKER_LABEL[s.channel]}: ${s.text}`);
  return `Meeting Name: ${session.title}
Speakers: "${SPEAKER_LABEL.mic}" is the person who recorded the meeting (their microphone); "${SPEAKER_LABEL.system}" are all other participants (computer audio, possibly several people).

Transcript:
${lines.join('\n')}`;
}

// Kleinere/lokale Modelle halten das Format nicht immer exakt ein (anderer Schlüssel, Objekte statt
// Strings). Akzeptiert: das Array selbst, den erwarteten Schlüssel oder das erste Array im Objekt.
function pickArray(parsed: unknown, key: string): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (Array.isArray(obj[key])) return obj[key];
  return Object.values(obj).find(Array.isArray) ?? null;
}

// String direkt, sonst der erste Text-Wert eines Objekts (z. B. {"task": "…"}).
function itemText(item: unknown): string {
  if (typeof item === 'string') return item.trim();
  if (item && typeof item === 'object') {
    const value = Object.values(item).find((v) => typeof v === 'string');
    return typeof value === 'string' ? value.trim() : '';
  }
  return '';
}

export function parseKeyPoints(content: string): KeyPoint[] {
  const list = pickArray(parseJsonContent(content), 'key_points');
  if (!list) throw new Error('Kernpunkte: unerwartetes Antwortformat');
  return list.map((kp) => {
    const obj = (kp && typeof kp === 'object' ? kp : {}) as { topic?: unknown; points?: unknown };
    const topic =
      typeof obj.topic === 'string' && obj.topic.trim() ? obj.topic.trim() : 'Diskussion';
    const points = pickArray(obj.points ?? obj, 'points') ?? [];
    return { topic, points: points.map(itemText).filter(Boolean) };
  });
}

export function parseActionItems(content: string): string[] {
  const list = pickArray(parseJsonContent(content), 'checklist');
  if (!list) throw new Error('To-dos: unerwartetes Antwortformat');
  return list.map(itemText).filter(Boolean);
}

export async function generateSummary(session: Session, llm: LlmConfig): Promise<MeetingSummary> {
  if (!session.segments.some((s) => s.status === 'ok')) {
    throw new Error('Kein Transkript zum Zusammenfassen vorhanden');
  }
  const user = buildUserPrompt(session);
  const [overview, keyPoints, actionItems] = await Promise.all([
    chatCompletion(llm, OVERVIEW_PROMPT, user, { json: false }),
    chatCompletion(llm, KEY_POINTS_PROMPT, user, { json: true }).then(parseKeyPoints),
    chatCompletion(llm, ACTION_ITEMS_PROMPT, user, { json: true }).then(parseActionItems),
  ]);
  return { overview, keyPoints, actionItems, generatedAt: Date.now() };
}
