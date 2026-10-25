// Meeting-Ablage: eine JSON-Datei pro Session, fehlgeschlagene Audio-Chunks als WAV daneben.
// Eine Session („Meeting“) endet nach IDLE_CLOSE_MS ohne neue Sprache oder beim Ausschalten.
import fs from 'node:fs';
import path from 'node:path';
import type { AudioChunk, Segment, Session, SessionSummary } from '../shared/types';
import { SPEAKER_LABEL } from '../shared/types';
import { encodeWav16 } from '../shared/audio';
import { formatClock, formatDate } from '../shared/format';
import { computeMetrics } from '../shared/metrics';
import { writeFileAtomic } from './fsutil';

export const IDLE_CLOSE_MS = 5 * 60_000;

const percent = (ratio: number) => `${Math.round(ratio * 100)} %`;

export function toMarkdown(session: Session): string {
  const end = session.endedAt ?? session.segments.at(-1)?.endedAt ?? session.startedAt;
  const out = [
    `# ${session.title}`,
    `${formatDate(session.startedAt)} ${formatClock(session.startedAt).slice(0, 5)}–${formatClock(end).slice(0, 5)}`,
  ];

  const summary = session.summary;
  if (summary) {
    out.push('## Zusammenfassung', summary.overview);
    if (summary.keyPoints.length) {
      out.push(
        '## Kernpunkte',
        summary.keyPoints
          .map((kp) => `### ${kp.topic}\n${kp.points.map((p) => `- ${p}`).join('\n')}`)
          .join('\n\n'),
      );
    }
    if (summary.actionItems.length) {
      out.push('## To-dos', summary.actionItems.map((a) => `- [ ] ${a}`).join('\n'));
    }
  }

  const m = computeMetrics(session.segments);
  if (m.wordCount.me + m.wordCount.them > 0) {
    out.push(
      '## Gesprächsstatistik',
      [
        `| | ${SPEAKER_LABEL.mic} | ${SPEAKER_LABEL.system} |`,
        '|---|---|---|',
        `| Sprechanteil | ${percent(m.talkRatio.me)} | ${percent(m.talkRatio.them)} |`,
        `| Sprechzeit | ${m.talkSeconds.me} s | ${m.talkSeconds.them} s |`,
        `| Wörter | ${m.wordCount.me} | ${m.wordCount.them} |`,
        `| Tempo (Wörter/min) | ${m.paceWpm.me} | ${m.paceWpm.them} |`,
        `| Fragen | ${m.questionsAsked.me} | ${m.questionsAsked.them} |`,
        `| Längster Monolog | ${m.longestMonologueSeconds.me} s | ${m.longestMonologueSeconds.them} s |`,
      ].join('\n'),
    );
  }

  out.push(
    '## Transkript',
    session.segments
      .map((s) => {
        const prefix = `**[${formatClock(s.startedAt)}] ${SPEAKER_LABEL[s.channel]}:**`;
        return s.status === 'ok'
          ? `${prefix} ${s.text}`
          : `${prefix} _(Transkription fehlgeschlagen: ${s.error ?? 'unbekannter Fehler'})_`;
      })
      .join('\n\n'),
  );
  return `${out.join('\n\n')}\n`;
}

export class SessionStore {
  private openId: string | null = null;
  private lastActivityAt = 0;

  // onClose: wird aufgerufen, wenn ein laufendes Meeting endet (Pause, Ausschalten, Wechsel).
  constructor(
    private readonly dir: string,
    private readonly onClose: (sessionId: string) => void = () => {},
  ) {
    fs.mkdirSync(dir, { recursive: true });
    // Nach Absturz offen gebliebene Sessions abschließen (ohne onClose – App startet gerade).
    for (const s of this.readAll()) {
      if (s.endedAt === null) {
        s.endedAt = s.segments.at(-1)?.endedAt ?? s.startedAt;
        this.write(s);
      }
    }
  }

  get currentId(): string | null {
    return this.openId;
  }

  sessionForChunk(chunk: AudioChunk): string {
    if (this.openId && chunk.startedAt - this.lastActivityAt <= IDLE_CLOSE_MS) {
      this.lastActivityAt = Math.max(this.lastActivityAt, chunk.endedAt);
      return this.openId;
    }
    this.closeOpen();
    const session: Session = {
      id: `${chunk.startedAt}-${Math.random().toString(36).slice(2, 8)}`,
      title: `Meeting ${formatDate(chunk.startedAt)} ${formatClock(chunk.startedAt).slice(0, 5)}`,
      startedAt: chunk.startedAt,
      endedAt: null,
      segments: [],
    };
    this.write(session);
    this.openId = session.id;
    this.lastActivityAt = chunk.endedAt;
    return session.id;
  }

  appendSegment(sessionId: string, segment: Segment): void {
    const s = this.get(sessionId);
    if (!s) return;
    s.segments.push(segment);
    s.segments.sort((a, b) => a.startedAt - b.startedAt);
    this.write(s);
  }

  replaceSegment(sessionId: string, segment: Segment): void {
    const s = this.get(sessionId);
    if (!s) return;
    const i = s.segments.findIndex((x) => x.id === segment.id);
    if (i < 0) return;
    s.segments[i] = segment;
    this.write(s);
  }

  // notify=false beim App-Beenden: dann keine Nachbearbeitung (Zusammenfassung/Webhook) starten.
  closeOpen(notify = true): void {
    if (!this.openId) return;
    const s = this.get(this.openId);
    this.openId = null;
    if (!s) return;
    s.endedAt = Math.max(this.lastActivityAt, s.startedAt);
    this.write(s);
    if (notify) this.onClose(s.id);
  }

  // Liest, ändert und speichert eine Session atomar; null, wenn sie nicht (mehr) existiert.
  update(id: string, mutate: (s: Session) => void): Session | null {
    const s = this.get(id);
    if (!s) return null;
    mutate(s);
    this.write(s);
    return s;
  }

  closeIfIdle(now: number, hasPendingJobs: (id: string) => boolean): void {
    if (this.openId && now - this.lastActivityAt > IDLE_CLOSE_MS && !hasPendingJobs(this.openId)) {
      this.closeOpen();
    }
  }

  list(): SessionSummary[] {
    return this.readAll()
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((s) => ({
        id: s.id,
        title: s.title,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        segmentCount: s.segments.length,
        failedCount: s.segments.filter((x) => x.status === 'failed').length,
        preview: s.segments
          .filter((x) => x.status === 'ok')
          .map((x) => x.text)
          .join(' ')
          .slice(0, 120),
      }));
  }

  get(id: string): Session | null {
    try {
      return JSON.parse(fs.readFileSync(this.file(id), 'utf8')) as Session;
    } catch {
      return null;
    }
  }

  rename(id: string, title: string): void {
    const s = this.get(id);
    const t = title.trim();
    if (!s || !t) return;
    s.title = t;
    this.write(s);
  }

  delete(id: string): void {
    if (this.openId === id) this.openId = null;
    fs.rmSync(this.file(id), { force: true });
    fs.rmSync(this.audioDir(id), { recursive: true, force: true });
  }

  saveFailedAudio(sessionId: string, segmentId: string, pcm: Float32Array): string {
    const dir = this.audioDir(sessionId);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${segmentId}.wav`);
    fs.writeFileSync(file, encodeWav16(pcm));
    return file;
  }

  private file(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  private audioDir(id: string): string {
    return path.join(this.dir, `${id}-audio`);
  }

  private write(s: Session): void {
    writeFileAtomic(this.file(s.id), JSON.stringify(s));
  }

  private readAll(): Session[] {
    const out: Session[] = [];
    for (const name of fs.readdirSync(this.dir)) {
      if (!name.endsWith('.json')) continue;
      try {
        out.push(JSON.parse(fs.readFileSync(path.join(this.dir, name), 'utf8')) as Session);
      } catch (e) {
        console.error(`Session-Datei beschädigt, übersprungen: ${name}`, e);
      }
    }
    return out;
  }
}
