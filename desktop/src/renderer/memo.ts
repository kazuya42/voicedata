// Diktat-Aufnahme für Bestellungen (wie der Aufnahme-Button der Mobil-App):
// Mikrofon → 16 kHz mono PCM im Speicher, automatischer Stopp nach 5 Minuten.
import { TARGET_RATE, downsampleTo16k } from '../shared/audio';

export const MAX_MEMO_MS = 5 * 60 * 1000;

export class MemoRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private parts: Float32Array[] = [];
  private samples = 0;

  get recording(): boolean {
    return this.ctx !== null;
  }

  get durationMs(): number {
    return (this.samples / TARGET_RATE) * 1000;
  }

  // onLimit: wird aufgerufen, wenn die Maximaldauer erreicht ist (Aufrufer stoppt dann).
  async start(onLimit: () => void): Promise<void> {
    if (this.ctx) return;
    this.parts = [];
    this.samples = 0;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    const ctx = new AudioContext();
    await ctx.audioWorklet.addModule('../dist/worklet.js');
    const node = new AudioWorkletNode(ctx, 'vd-capture', { numberOfInputs: 1, numberOfOutputs: 0 });
    let limitReported = false;
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (this.durationMs >= MAX_MEMO_MS) {
        if (!limitReported) onLimit();
        limitReported = true;
        return;
      }
      const pcm = downsampleTo16k(e.data, ctx.sampleRate);
      this.parts.push(pcm);
      this.samples += pcm.length;
    };
    ctx.createMediaStreamSource(stream).connect(node);
    this.ctx = ctx;
    this.stream = stream;
  }

  // Beendet die Aufnahme und liefert das komplette Diktat.
  async stop(): Promise<Float32Array> {
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    await this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.stream = null;
    const out = new Float32Array(this.samples);
    let offset = 0;
    for (const p of this.parts) {
      out.set(p, offset);
      offset += p.length;
    }
    this.parts = [];
    return out;
  }
}
