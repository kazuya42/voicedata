// AudioWorklet: sammelt Kanal 0 in 4096-Sample-Blöcken und schickt sie an den Renderer-Hauptthread.
// Läuft im AudioWorkletGlobalScope – diese Globals fehlen in der DOM-Lib, daher hier deklariert.
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(
  name: string,
  ctor: new () => AudioWorkletProcessor & { process(inputs: Float32Array[][]): boolean },
): void;

const BLOCK = 4096;

class CaptureProcessor extends AudioWorkletProcessor {
  private block = new Float32Array(BLOCK);
  private filled = 0;

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    if (!input) return true;
    let offset = 0;
    while (offset < input.length) {
      const n = Math.min(BLOCK - this.filled, input.length - offset);
      this.block.set(input.subarray(offset, offset + n), this.filled);
      this.filled += n;
      offset += n;
      if (this.filled === BLOCK) {
        this.port.postMessage(this.block, [this.block.buffer]);
        this.block = new Float32Array(BLOCK);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('vd-capture', CaptureProcessor);
