// Whisper-GGML-Modelle: Status prüfen und von Hugging Face herunterladen.
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { app } from 'electron';
import type { LocalModel } from '../shared/types';
import { LOCAL_MODELS } from '../shared/types';

export const MODEL_SIZES: Record<LocalModel, number> = {
  base: 147_951_465,
  small: 487_601_967,
  'large-v3-turbo-q5_0': 574_041_195,
};

const running = new Set<LocalModel>();

export function modelPath(m: LocalModel): string {
  return path.join(app.getPath('userData'), 'models', `ggml-${m}.bin`);
}

export function modelStatus(): Record<LocalModel, boolean> {
  const out = {} as Record<LocalModel, boolean>;
  for (const m of LOCAL_MODELS) {
    try {
      out[m] = fs.statSync(modelPath(m)).size === MODEL_SIZES[m];
    } catch {
      out[m] = false;
    }
  }
  return out;
}

export async function downloadModel(
  m: LocalModel,
  onProgress: (received: number, total: number) => void,
): Promise<void> {
  if (running.has(m)) throw new Error('Download läuft bereits');
  running.add(m);
  const target = modelPath(m);
  const part = `${target}.part`;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const res = await fetch(
      `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${m}.bin`,
    );
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const total = MODEL_SIZES[m];
    let received = 0;
    let lastReport = 0;
    const body = Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>);
    body.on('data', (c: Buffer) => {
      received += c.length;
      if (received - lastReport >= 1_000_000 || received === total) {
        lastReport = received;
        onProgress(received, total);
      }
    });
    await finished(body.pipe(fs.createWriteStream(part)));
    if (fs.statSync(part).size !== total) throw new Error('Dateigröße stimmt nicht');
    fs.renameSync(part, target);
    onProgress(total, total);
  } catch (e) {
    fs.rmSync(part, { force: true });
    throw new Error(
      `Modell-Download fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    running.delete(m);
  }
}
