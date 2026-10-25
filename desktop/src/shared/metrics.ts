// Gesprächs-Kennzahlen eines Meetings – reine Statistik, kein LLM.
// Logik übernommen aus call.md (conversation-metrics.service.ts), angepasst an VoiceData:
// „me“ = Mikrofon (Ich), „them“ = Systemton (Teilnehmer); Sprechzeit aus den Sprach-Frames
// des Segmenters statt aus der Chunk-Länge, weil Chunks Pausen bis zum Schnitt enthalten.
import type { Channel, ConversationMetrics, Segment } from './types';

const MONOLOGUE_GAP_MS = 2000; // kürzere Lücken gelten als durchgehendes Sprechen
const MIN_PACE_SECONDS = 5; // darunter keine belastbare Sprechgeschwindigkeit
const MAX_WPM = 250;

const SIDE: Record<Channel, 'me' | 'them'> = { mic: 'me', system: 'them' };

function longestStreakMs(segments: Segment[]): number {
  let longest = 0;
  let streakStart = 0;
  let streakEnd = -Infinity;
  for (const s of segments) {
    if (s.startedAt - streakEnd >= MONOLOGUE_GAP_MS) streakStart = s.startedAt;
    streakEnd = Math.max(streakEnd, s.endedAt);
    longest = Math.max(longest, streakEnd - streakStart);
  }
  return longest;
}

export function computeMetrics(segments: Segment[]): ConversationMetrics {
  const ok = segments.filter((s) => s.status === 'ok').sort((a, b) => a.startedAt - b.startedAt);
  const bySide = {
    me: ok.filter((s) => SIDE[s.channel] === 'me'),
    them: ok.filter((s) => SIDE[s.channel] === 'them'),
  };

  const talkMs = { me: 0, them: 0 };
  const words = { me: 0, them: 0 };
  const questions = { me: 0, them: 0 };
  for (const s of ok) {
    const side = SIDE[s.channel];
    talkMs[side] += s.voicedMs ?? s.endedAt - s.startedAt;
    words[side] += s.text.split(/\s+/).filter((w) => w.length > 0).length;
    if (s.text.includes('?')) questions[side]++;
  }
  const totalTalk = talkMs.me + talkMs.them;
  const pace = (side: 'me' | 'them') =>
    talkMs[side] / 1000 < MIN_PACE_SECONDS
      ? 0
      : Math.min(MAX_WPM, Math.round(words[side] / (talkMs[side] / 60_000)));

  return {
    durationSeconds: ok.length
      ? Math.round((Math.max(...ok.map((s) => s.endedAt)) - ok[0].startedAt) / 1000)
      : 0,
    talkSeconds: { me: Math.round(talkMs.me / 1000), them: Math.round(talkMs.them / 1000) },
    talkRatio: {
      me: totalTalk > 0 ? talkMs.me / totalTalk : 0,
      them: totalTalk > 0 ? talkMs.them / totalTalk : 0,
    },
    wordCount: words,
    paceWpm: { me: pace('me'), them: pace('them') },
    questionsAsked: questions,
    longestMonologueSeconds: {
      me: Math.round(longestStreakMs(bySide.me) / 1000),
      them: Math.round(longestStreakMs(bySide.them) / 1000),
    },
  };
}
