import { z } from 'zod';
import { eventSchema, type ProgressEvent } from './model';
export const journalSchema = z.object({ version: z.literal(1), events: z.array(eventSchema) });
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; }
/** One immutable local entry per event avoids cross-tab read/write clobbering. */
export class Journal {
  readonly prefix: string;
  readonly storage: Storage;
  constructor(storage: Storage, scope: string, userId: string) {
    this.storage = storage;
    this.prefix = `florine:events:v1:${scope}:${userId}:`;
  }
  read(): ProgressEvent[] {
    const events: ProgressEvent[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key?.startsWith(this.prefix)) {
        const raw = this.storage.getItem(key);
        if (raw !== null) events.push(eventSchema.parse(JSON.parse(raw)));
      }
    }
    return events;
  }
  put(e: ProgressEvent) {
    const key = this.prefix + e.id;
    const value = JSON.stringify(eventSchema.parse(e));
    const old = this.storage.getItem(key);
    if (old !== null && old !== value) throw new Error('A saved activity conflicts with an existing activity. Export a backup and contact support.');
    this.storage.setItem(key, value);
  }
}
