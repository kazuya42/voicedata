// Gespeicherte Bestell-Transkripte (Text + Felder + Status), wie „Transkripte“ in der Mobil-App.
// Eine JSON-Datei im App-Datenordner; neueste zuerst.
import fs from 'node:fs';
import path from 'node:path';
import type { ParsedFields, TargetSystem, Transcript } from '../../../src/lib/types';
import { writeFileAtomic } from './fsutil';

export class OrderStore {
  private readonly file: string;

  constructor(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'orders.json');
  }

  list(): Transcript[] {
    return this.load().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  save(transcriptText: string, fields: ParsedFields): Transcript {
    const t: Transcript = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      transcriptText,
      fields,
      status: 'draft',
    };
    this.persist([...this.load(), t]);
    return t;
  }

  updateFields(id: string, fields: ParsedFields): void {
    this.mutate(id, (t) => {
      t.fields = fields;
    });
  }

  markSent(id: string, target: TargetSystem, resultInfo: string): void {
    this.mutate(id, (t) => {
      t.status = 'sent';
      t.sentTarget = target;
      t.sentAt = new Date().toISOString();
      t.resultInfo = resultInfo;
    });
  }

  delete(id: string): void {
    this.persist(this.load().filter((t) => t.id !== id));
  }

  deleteAll(): void {
    this.persist([]);
  }

  private mutate(id: string, fn: (t: Transcript) => void): void {
    const list = this.load();
    const t = list.find((x) => x.id === id);
    if (!t) return;
    fn(t);
    this.persist(list);
  }

  private load(): Transcript[] {
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return Array.isArray(raw) ? (raw as Transcript[]) : [];
    } catch {
      return [];
    }
  }

  private persist(list: Transcript[]): void {
    writeFileAtomic(this.file, JSON.stringify(list));
  }
}
