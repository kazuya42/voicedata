// Reine Audio-Hilfsfunktionen (Resampling, Pegel, WAV-Kodierung) – ohne Electron-Abhängigkeit.

export const TARGET_RATE = 16000;

// Mittelwert-Dezimierung: jedes Ausgabe-Sample mittelt sein Quellfenster (einfacher Tiefpass).
export function downsampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === TARGET_RATE) return input.slice();
  const ratio = inputRate / TARGET_RATE;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / (end - start);
  }
  return out;
}

export function rms(pcm: Float32Array, from = 0, to = pcm.length): number {
  const n = to - from;
  if (n <= 0) return 0;
  let sum = 0;
  for (let i = from; i < to; i++) sum += pcm[i] * pcm[i];
  return Math.sqrt(sum / n);
}

const HEADER_BYTES = 44;

// PCM-Float32 → WAV (RIFF, mono, 16-bit little endian).
export function encodeWav16(pcm: Float32Array, sampleRate = TARGET_RATE): Uint8Array<ArrayBuffer> {
  const dataBytes = pcm.length * 2;
  const buf = new ArrayBuffer(HEADER_BYTES + dataBytes);
  const view = new DataView(buf);
  const writeAscii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt-Chunk-Größe
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // Byte-Rate
  view.setUint16(32, 2, true); // Block-Align
  view.setUint16(34, 16, true); // Bits pro Sample
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(HEADER_BYTES + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

// Gegenstück zu encodeWav16 (nur für von encodeWav16 erzeugte Dateien).
export function decodeWav16(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder('ascii');
  if (
    bytes.byteLength < HEADER_BYTES ||
    decoder.decode(bytes.subarray(0, 4)) !== 'RIFF' ||
    decoder.decode(bytes.subarray(8, 12)) !== 'WAVE' ||
    view.getUint16(20, true) !== 1 ||
    view.getUint16(22, true) !== 1 ||
    view.getUint16(34, true) !== 16
  ) {
    throw new Error('Ungültige WAV-Datei');
  }
  const samples = Math.floor((bytes.byteLength - HEADER_BYTES) / 2);
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const v = view.getInt16(HEADER_BYTES + i * 2, true);
    out[i] = v < 0 ? v / 0x8000 : v / 0x7fff;
  }
  return out;
}
