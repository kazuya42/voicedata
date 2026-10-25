import { describe, expect, test } from 'vitest';
import { decodeWav16, downsampleTo16k, encodeWav16 } from '../src/shared/audio';

describe('encodeWav16 / decodeWav16', () => {
  test('writes a valid 16 kHz mono 16-bit header', () => {
    const wav = encodeWav16(new Float32Array(16000));
    const view = new DataView(wav.buffer);
    const ascii = new TextDecoder('ascii');
    expect(wav.byteLength).toBe(32044);
    expect(ascii.decode(wav.subarray(0, 4))).toBe('RIFF');
    expect(ascii.decode(wav.subarray(8, 12))).toBe('WAVE');
    expect(view.getUint32(24, true)).toBe(16000);
    expect(ascii.decode(wav.subarray(36, 40))).toBe('data');
    expect(view.getUint32(40, true)).toBe(32000);
  });

  test('clamps out-of-range samples', () => {
    const view = new DataView(encodeWav16(new Float32Array([1.5, -1.5])).buffer);
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });

  test('round-trips within 16-bit precision', () => {
    const pcm = new Float32Array(1000).map((_, i) => Math.sin(i / 10) * 0.8);
    const back = decodeWav16(encodeWav16(pcm));
    expect(back.length).toBe(pcm.length);
    for (let i = 0; i < pcm.length; i++) expect(Math.abs(back[i] - pcm[i])).toBeLessThan(1 / 16384);
  });

  test('rejects non-WAV data', () => {
    expect(() => decodeWav16(new Uint8Array(100))).toThrow('Ungültige WAV-Datei');
  });
});

describe('downsampleTo16k', () => {
  test('48 kHz → 16 kHz keeps duration and level', () => {
    const out = downsampleTo16k(new Float32Array(48000).fill(0.5), 48000);
    expect(out.length).toBe(16000);
    expect(out[100]).toBeCloseTo(0.5);
  });

  test('44.1 kHz input yields one second of output per second of input', () => {
    expect(downsampleTo16k(new Float32Array(44100), 44100).length).toBe(16000);
  });
});
