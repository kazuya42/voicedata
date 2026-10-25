// Aufnahme-Pipeline im Renderer: Mikrofon + Systemton → 16 kHz → Segmenter → IPC an den Main-Prozess.
import type { Channel } from '../shared/types';
import { downsampleTo16k } from '../shared/audio';
import { ChunkSegmenter } from '../shared/segmenter';

const CHANNEL_NAME: Record<Channel, string> = { mic: 'Mikrofon', system: 'Systemaudio' };

const SYSTEM_AUDIO_HINT =
  'Systemaudio nicht verfügbar – in Systemeinstellungen › Datenschutz & Sicherheit › Bildschirm- & Systemaudioaufnahme „VoiceData Desktop“ erlauben.';

export type CaptureResult = { mic: boolean; system: boolean; errors: string[] };

export class CaptureController {
  private ctx: AudioContext | null = null;
  private streams: MediaStream[] = [];
  private segmenters: ChunkSegmenter[] = [];

  constructor(private readonly onError: (message: string) => void) {}

  get running(): boolean {
    return this.ctx !== null;
  }

  async start(want: { mic: boolean; system: boolean }): Promise<CaptureResult> {
    await this.stop();
    const ctx = new AudioContext();
    this.ctx = ctx;
    await ctx.audioWorklet.addModule('../dist/worklet.js');
    const result: CaptureResult = { mic: false, system: false, errors: [] };

    if (want.mic) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
        this.attach('mic', stream);
        result.mic = true;
      } catch (e) {
        result.errors.push(
          `Mikrofon nicht verfügbar: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    if (want.system) {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: false });
        for (const t of stream.getVideoTracks()) {
          t.stop();
          stream.removeTrack(t);
        }
        // Ohne macOS-Berechtigung kommt ein bereits beendeter Track ohne Samples (kein Fehler).
        const track = stream.getAudioTracks()[0];
        if (!track || track.readyState === 'ended') {
          for (const t of stream.getTracks()) t.stop();
          result.errors.push(SYSTEM_AUDIO_HINT);
        } else {
          this.attach('system', stream);
          result.system = true;
        }
      } catch (e) {
        result.errors.push(`${SYSTEM_AUDIO_HINT} (${e instanceof Error ? e.message : String(e)})`);
      }
    }

    if (!result.mic && !result.system) await this.stop();
    return result;
  }

  async stop(): Promise<void> {
    for (const s of this.segmenters) s.flush();
    this.segmenters = [];
    for (const stream of this.streams) for (const t of stream.getTracks()) t.stop();
    this.streams = [];
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx) await ctx.close().catch(() => {});
  }

  private attach(channel: Channel, stream: MediaStream): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const segmenter = new ChunkSegmenter(channel, (chunk) => window.vd.sendChunk(chunk));
    const source = ctx.createMediaStreamSource(stream);
    // Keine Ausgänge: reine Senke, nicht mit ctx.destination verbunden – nichts wird abgespielt.
    const node = new AudioWorkletNode(ctx, 'vd-capture', { numberOfInputs: 1, numberOfOutputs: 0 });
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      segmenter.push(downsampleTo16k(e.data, ctx.sampleRate), Date.now());
    };
    source.connect(node);
    const track = stream.getAudioTracks()[0];
    track.onended = () => {
      segmenter.flush();
      node.port.onmessage = null;
      this.onError(`${CHANNEL_NAME[channel]} wurde getrennt`);
    };
    this.streams.push(stream);
    this.segmenters.push(segmenter);
  }
}
