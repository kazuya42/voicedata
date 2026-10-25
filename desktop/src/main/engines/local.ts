// Lokale Transkription mit whisper.cpp (`whisper-cli`, Metal-beschleunigt).
// Die fertige App bringt ein eigenes Binary mit (scripts/build-whisper.sh → Resources/whisper-cli);
// im Entwicklungsmodus wird Homebrews `whisper-cli` verwendet (`brew install whisper-cpp`).
// Chunk wird als temporäre WAV-Datei übergeben; ohne `-tr` wird nicht übersetzt.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { encodeWav16 } from '../../shared/audio';
import type { Engine } from './types';

const run = promisify(execFile);

// Mitgeliefertes Binary zuerst, dann Homebrew (Apple Silicon / Intel).
const CLI_CANDIDATES = [
  path.join(process.resourcesPath ?? '', 'whisper-cli'),
  '/opt/homebrew/bin/whisper-cli',
  '/usr/local/bin/whisper-cli',
];

export function createLocalEngine(modelPath: string): Engine {
  return {
    async transcribe(pcm, opts) {
      const cli = CLI_CANDIDATES.find((p) => fs.existsSync(p));
      if (!cli) {
        throw new Error('whisper-cli nicht gefunden – bitte "brew install whisper-cpp" ausführen');
      }
      const wav = path.join(
        os.tmpdir(),
        `vd-chunk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`,
      );
      fs.writeFileSync(wav, encodeWav16(pcm));
      try {
        const { stdout } = await run(
          cli,
          [
            '-m',
            modelPath,
            '-f',
            wav,
            '-l',
            opts.language,
            '-t',
            String(Math.max(2, Math.min(8, os.cpus().length - 2))),
            '-nt', // keine Zeitstempel
            '-np', // nur das Ergebnis ausgeben
            '-sns', // keine Geräusch-Tokens wie [lachen] / (Musik)
          ],
          { maxBuffer: 10 * 1024 * 1024 },
        );
        return stdout.replace(/\s+/g, ' ').trim();
      } catch (e) {
        throw new Error(
          `Lokales Whisper fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`,
        );
      } finally {
        fs.rmSync(wav, { force: true });
      }
    },
  };
}
