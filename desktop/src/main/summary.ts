// Zusammenfassung nach dem Meeting: Kurzüberblick, Kernpunkte nach Thema, To-dos.
// Prompts übernommen aus call.md (summary-generator.service.ts); statt VideoDB direkt OpenAI-Chat
// mit dem vorhandenen OpenAI-Key. Drei Aufrufe parallel wie im Original.
import { fetchWithRetry, parseApiError } from '../../../src/lib/http';
import type { KeyPoint, MeetingSummary, Session } from '../shared/types';
import { SPEAKER_LABEL } from '../shared/types';
import { formatClock } from '../shared/format';

const CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';

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

async function chat(apiKey: string, system: string, user: string, json: boolean): Promise<string> {
  // Lesender Aufruf ohne Seiteneffekt → ein Retry ist unkritisch.
  const res = await fetchWithRetry(
    CHAT_URL,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    },
    { timeoutMs: 90_000, retries: 1 },
  );
  if (!res.ok) throw await parseApiError(res, 'OpenAI Zusammenfassung');
  const content = (await res.json())?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('OpenAI Zusammenfassung: leere Antwort');
  }
  return content.trim();
}

// Das Modell liefert gelegentlich Markdown-Fences um das JSON.
function parseJson(content: string): unknown {
  return JSON.parse(content.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
}

export function parseKeyPoints(content: string): KeyPoint[] {
  const parsed = parseJson(content) as { key_points?: unknown } | unknown[];
  const list = Array.isArray(parsed) ? parsed : parsed.key_points;
  if (!Array.isArray(list)) throw new Error('Kernpunkte: unerwartetes Antwortformat');
  return list.map((kp: { topic?: unknown; points?: unknown }) => ({
    topic: typeof kp.topic === 'string' && kp.topic.trim() ? kp.topic.trim() : 'Diskussion',
    points: Array.isArray(kp.points)
      ? kp.points.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      : [],
  }));
}

export function parseActionItems(content: string): string[] {
  const parsed = parseJson(content) as { checklist?: unknown } | unknown[];
  const list = Array.isArray(parsed) ? parsed : parsed.checklist;
  if (!Array.isArray(list)) throw new Error('To-dos: unerwartetes Antwortformat');
  return list.filter((i): i is string => typeof i === 'string' && i.trim().length > 0);
}

export async function generateSummary(session: Session, apiKey: string): Promise<MeetingSummary> {
  if (!session.segments.some((s) => s.status === 'ok')) {
    throw new Error('Kein Transkript zum Zusammenfassen vorhanden');
  }
  const user = buildUserPrompt(session);
  const [overview, keyPoints, actionItems] = await Promise.all([
    chat(apiKey, OVERVIEW_PROMPT, user, false),
    chat(apiKey, KEY_POINTS_PROMPT, user, true).then(parseKeyPoints),
    chat(apiKey, ACTION_ITEMS_PROMPT, user, true).then(parseActionItems),
  ]);
  return { overview, keyPoints, actionItems, generatedAt: Date.now() };
}
