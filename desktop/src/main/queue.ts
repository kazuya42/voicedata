// Serielle FIFO-Transkription: ein Chunk nach dem anderen (lokales Whisper ist CPU/GPU-gebunden,
// seriell bleibt die Live-Reihenfolge stabil). Audio geht nie verloren: Fehler → WAV + failed-Segment.
import fs from 'node:fs';
import type { AudioChunk, Channel, Segment, Settings } from '../shared/types';
import { IPC } from '../shared/types';
import { decodeWav16 } from '../shared/audio';
import { getEngine } from './engines';
import type { SessionStore } from './sessions';

type Job = {
  sessionId: string;
  channel: Channel;
  startedAt: number;
  endedAt: number;
  voicedMs?: number;
  pcm: Float32Array;
  retryOf?: Segment; // gesetzt, wenn ein fehlgeschlagenes Segment erneut transkribiert wird
};

const PROMPT_TAIL_CHARS = 200;

export class TranscriptionQueue {
  private jobs: Job[] = [];
  private running = false;

  constructor(
    private readonly store: SessionStore,
    private readonly getSettings: () => Settings,
    private readonly emit: (channel: string, payload: unknown) => void,
  ) {}

  get pending(): number {
    return this.jobs.length + (this.running ? 1 : 0);
  }

  enqueue(chunk: AudioChunk): void {
    const sessionId = this.store.sessionForChunk(chunk);
    this.push({ sessionId, ...chunk });
  }

  hasPending(sessionId: string): boolean {
    return this.running || this.jobs.some((j) => j.sessionId === sessionId);
  }

  retryFailed(sessionId: string): void {
    const session = this.store.get(sessionId);
    if (!session) return;
    for (const seg of session.segments) {
      if (seg.status !== 'failed' || !seg.audioFile) continue;
      if (this.jobs.some((j) => j.retryOf?.id === seg.id)) continue;
      let pcm: Float32Array;
      try {
        pcm = decodeWav16(fs.readFileSync(seg.audioFile));
      } catch (e) {
        console.error(`Audio für Segment ${seg.id} nicht lesbar`, e);
        continue;
      }
      this.push({
        sessionId,
        channel: seg.channel,
        startedAt: seg.startedAt,
        endedAt: seg.endedAt,
        voicedMs: seg.voicedMs,
        pcm,
        retryOf: seg,
      });
    }
  }

  // Beim Beenden: offene Jobs als fehlgeschlagene Segmente sichern (erneut transkribierbar).
  drainToDisk(): void {
    const jobs = this.jobs;
    this.jobs = [];
    for (const job of jobs) {
      if (job.retryOf) continue; // WAV existiert bereits
      this.saveFailed(job, 'App beendet vor Transkription');
    }
  }

  private push(job: Job): void {
    this.jobs.push(job);
    this.emitQueue();
    void this.work();
  }

  private emitQueue(): void {
    this.emit(IPC.queue, { pending: this.pending });
  }

  private async work(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      let job: Job | undefined;
      while ((job = this.jobs.shift())) {
        this.emitQueue();
        await this.process(job);
      }
    } finally {
      this.running = false;
      this.emitQueue();
    }
  }

  private async process(job: Job): Promise<void> {
    const settings = this.getSettings();
    try {
      const engine = getEngine(settings);
      const text = await engine.transcribe(job.pcm, {
        language: settings.language,
        prompt: settings.engine === 'openai' ? this.promptFor(job.sessionId) : undefined,
      });
      if (job.retryOf) {
        const seg: Segment = { ...job.retryOf, status: 'ok', text, error: undefined };
        delete seg.audioFile;
        this.store.replaceSegment(job.sessionId, seg);
        if (job.retryOf.audioFile) fs.rmSync(job.retryOf.audioFile, { force: true });
        this.emit(IPC.segment, { sessionId: job.sessionId, segment: seg });
        return;
      }
      if (!text) return;
      const seg: Segment = {
        id: `${job.startedAt}-${job.channel}-${Math.random().toString(36).slice(2, 6)}`,
        channel: job.channel,
        startedAt: job.startedAt,
        endedAt: job.endedAt,
        voicedMs: job.voicedMs,
        text,
        status: 'ok',
      };
      this.store.appendSegment(job.sessionId, seg);
      this.emit(IPC.segment, { sessionId: job.sessionId, segment: seg });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (job.retryOf) {
        const seg: Segment = { ...job.retryOf, error: message };
        this.store.replaceSegment(job.sessionId, seg);
        this.emit(IPC.segment, { sessionId: job.sessionId, segment: seg });
        return;
      }
      this.saveFailed(job, message);
    }
  }

  private saveFailed(job: Job, error: string): void {
    const id = `${job.startedAt}-${job.channel}-${Math.random().toString(36).slice(2, 6)}`;
    const seg: Segment = {
      id,
      channel: job.channel,
      startedAt: job.startedAt,
      endedAt: job.endedAt,
      voicedMs: job.voicedMs,
      text: '',
      status: 'failed',
      error,
      audioFile: this.store.saveFailedAudio(job.sessionId, id, job.pcm),
    };
    this.store.appendSegment(job.sessionId, seg);
    this.emit(IPC.segment, { sessionId: job.sessionId, segment: seg });
  }

  // Letzte ~200 Zeichen des vorherigen erfolgreichen Segments als Kontext für die API.
  private promptFor(sessionId: string): string | undefined {
    const last = this.store
      .get(sessionId)
      ?.segments.filter((s) => s.status === 'ok')
      .at(-1);
    return last?.text.slice(-PROMPT_TAIL_CHARS);
  }
}
