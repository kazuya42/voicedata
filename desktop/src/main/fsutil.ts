import fs from 'node:fs';

// Atomar schreiben: erst *.tmp, dann rename – kein halb geschriebenes JSON bei Absturz.
export function writeFileAtomic(file: string, data: string | Uint8Array): void {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
