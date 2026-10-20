import type { SupabaseClient } from '@supabase/supabase-js';
import { Journal, journalSchema } from './journal';
import { eventSchema, operationSchema, projectProgress, type ProgressEvent } from './model';
import { setProgressWriter, useProgress } from '../storage/progress';
export type SyncStatus = { state: 'syncing' | 'saved' | 'offline' | 'error'; message: string; pending: number };
export function startSync(client: SupabaseClient, scope: string, userId: string, report: (s: SyncStatus) => void) {
  const journal = new Journal(localStorage, scope, userId);
  // Parse before installing the writer: invalid data is never silently replaced.
  journal.read();
  let stopped = false, busy = false, rerun = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastMillis = journal.read().reduce((latest, e) => Math.max(latest, Date.parse(e.at)), 0);
  let acknowledged = new Set<string>();
  const read = () => journal.read();
  const render = () => { if (!stopped) useProgress.setState(projectProgress(read())); };
  const status = (state: SyncStatus['state'], message: string) => {
    if (!stopped) report({ state, message, pending: read().filter(e => !acknowledged.has(e.id)).length });
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => void sync(), 600); };
  async function sync() {
    if (stopped) return;
    if (busy) { rerun = true; return; }
    busy = true;
    try {
      if (!navigator.onLine) { status('offline', 'Saved on this device. Connect to sync.'); return; }
      status('syncing', 'Syncing your progress…');
      const pending = read().filter(e => !acknowledged.has(e.id));
      for (let i = 0; i < pending.length; i += 100) {
        const batch = pending.slice(i, i + 100);
        const { error } = await client.from('progress_events').upsert(batch.map(e => ({ user_id: userId, id: e.id, event: e })), { onConflict: 'user_id,id', ignoreDuplicates: true });
        if (stopped) return;
        if (error) throw error;
        batch.forEach(e => acknowledged.add(e.id));
      }
      // Fetch the whole log in pages. Rescanning also catches concurrent commits.
      const remote: ProgressEvent[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await client.from('progress_events').select('event').eq('user_id', userId).order('id').range(offset, offset + 499);
        if (stopped) return;
        if (error) throw error;
        for (const row of data ?? []) remote.push(eventSchema.parse(row.event));
        if (!data || data.length < 500) break;
      }
      if (stopped) return;
      remote.forEach(e => journal.put(e));
      acknowledged = new Set([...acknowledged, ...remote.map(e => e.id)]);
      render();
      const remaining = read().some(e => !acknowledged.has(e.id));
      status(remaining ? 'syncing' : 'saved', remaining ? 'Saving new activity…' : 'Progress saved to your account');
      if (remaining) rerun = true;
    } catch (error) {
      status(navigator.onLine ? 'error' : 'offline', error instanceof Error ? error.message : 'Sync failed. Your activity remains saved on this device; retry when connected.');
    } finally {
      busy = false;
      if (rerun && !stopped) { rerun = false; schedule(); }
    }
  }
  render();
  setProgressWriter(operation => {
    if (stopped) throw new Error('Please sign in again before studying.');
    lastMillis = Math.max(Date.now(), lastMillis + 1);
    const event = { id: crypto.randomUUID(), at: new Date(lastMillis).toISOString(), operation: operationSchema.parse(operation) };
    // Durable local write happens BEFORE visible progress changes.
    try { journal.put(event); }
    catch { status('error', 'Device storage is unavailable or full. Export a backup before continuing.'); throw new Error('Unable to save this activity on your device.'); }
    render(); status('syncing', 'Saved on this device. Syncing…'); schedule();
  });
  const refresh = () => { render(); void sync(); };
  const onStorage = (e: StorageEvent) => { if (e.key?.startsWith(journal.prefix)) refresh(); };
  const visibility = () => { if (document.visibilityState === 'visible') refresh(); };
  window.addEventListener('storage', onStorage);
  window.addEventListener('online', refresh);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', visibility);
  const interval = setInterval(() => void sync(), 20_000);
  void sync();
  return {
    retry: () => sync(),
    exportBackup: () => JSON.stringify({ version: 1, events: read() }, null, 2),
    restoreBackup: (json: string) => {
      const backup = journalSchema.parse(JSON.parse(json));
      backup.events.forEach(e => journal.put(e));
      render(); schedule();
    },
    stop: () => {
      stopped = true; clearTimeout(timer); clearInterval(interval); setProgressWriter(null);
      window.removeEventListener('storage', onStorage); window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', visibility);
    },
  };
}
