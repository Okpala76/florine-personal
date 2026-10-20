import { z } from 'zod';
import { initialCard, review } from '../srs/sm2';

const count = z.number().finite().nonnegative();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const cardSchema = z.object({ ease: count, intervalDays: count, reps: count, dueISO: day, lastISO: day.nullable() });
const unitSchema = z.object({ status: z.enum(['not-started', 'in-progress', 'completed']), bestScore: z.number().min(0).max(1), lastVisitedISO: z.string().nullable() });
const examSchema = z.object({ autoPoints: count, autoMax: count, selfPoints: count.nullable(), total: count.nullable(), passed: z.boolean().nullable(), attempts: count, lastAttemptISO: z.string() });
export const snapshotSchema = z.object({
  version: z.literal(1).default(1),
  unitProgress: z.record(z.string(), unitSchema).default({}),
  skillXp: z.object({ reading: count, listening: count, writing: count, speaking: count }).default({ reading: 0, listening: 0, writing: 0, speaking: 0 }),
  totalStudyMinutes: count.default(0), streakDays: count.default(0), lastStudyDate: day.nullable().default(null),
  vocab: z.record(z.string(), cardSchema).default({}), examResults: z.record(z.string(), examSchema).default({}),
});
export type ProgressData = z.infer<typeof snapshotSchema>;
export type UnitProgress = z.infer<typeof unitSchema>;
export type UnitStatus = UnitProgress['status'];
export type ExamResult = z.infer<typeof examSchema>;

export const operationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('visit'), unitId: z.string() }),
  z.object({ type: z.literal('score'), unitId: z.string(), score: z.number().min(0).max(1) }),
  z.object({ type: z.literal('minutes'), minutes: count.max(1440) }),
  z.object({ type: z.literal('xp'), skill: z.enum(['reading', 'listening', 'writing', 'speaking']), amount: count }),
  z.object({ type: z.literal('study') }),
  z.object({ type: z.literal('review'), key: z.string(), rating: z.enum(['again', 'hard', 'good', 'easy']) }),
  z.object({ type: z.literal('add'), key: z.string() }),
  z.object({ type: z.literal('remove'), key: z.string() }),
  z.object({ type: z.literal('exam'), examId: z.string(), result: examSchema.omit({ attempts: true, lastAttemptISO: true }) }),
  z.object({ type: z.literal('import'), snapshot: snapshotSchema }),
  z.object({ type: z.literal('reset') }),
]);
export type Operation = z.infer<typeof operationSchema>;
export const eventSchema = z.object({ id: z.uuid(), at: z.iso.datetime(), operation: operationSchema });
export type ProgressEvent = z.infer<typeof eventSchema>;
export const emptyProgress = (): ProgressData => snapshotSchema.parse({});

/** Replay immutable events, deduplicating retries and preserving concurrent study. */
export function projectProgress(events: ProgressEvent[]): ProgressData {
  let s = emptyProgress();
  let studyDays = new Set<string>();
  const unique = new Map(events.map(e => [e.id, e]));
  const ordered = [...unique.values()].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  for (const e of ordered) {
    const o = e.operation;
    const now = new Date(e.at);
    if (o.type === 'reset') { s = emptyProgress(); studyDays = new Set(); continue; }
    if (o.type === 'import') {
      // Import is an explicit replacement, like the original app; later events remain.
      s = structuredClone(o.snapshot);
      studyDays = new Set();
      if (s.lastStudyDate) {
        for (let n = 0; n < s.streakDays; n++) {
          const d = new Date(s.lastStudyDate + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n);
          studyDays.add(d.toISOString().slice(0, 10));
        }
      }
      continue;
    }
    switch (o.type) {
      case 'visit': {
        const u = s.unitProgress[o.unitId] ?? { status: 'not-started', bestScore: 0, lastVisitedISO: null };
        s.unitProgress[o.unitId] = { ...u, status: u.status === 'completed' ? 'completed' : 'in-progress', lastVisitedISO: e.at };
        break;
      }
      case 'score': {
        const u = s.unitProgress[o.unitId] ?? { status: 'not-started', bestScore: 0, lastVisitedISO: null };
        const bestScore = Math.max(u.bestScore, o.score);
        s.unitProgress[o.unitId] = { ...u, bestScore, status: bestScore >= .7 ? 'completed' : 'in-progress' };
        break;
      }
      case 'minutes': s.totalStudyMinutes += o.minutes; break;
      case 'xp': s.skillXp[o.skill] += o.amount; break;
      case 'study': studyDays.add(e.at.slice(0, 10)); break;
      case 'review': s.vocab[o.key] = review(s.vocab[o.key] ?? initialCard(now), o.rating, now); break;
      case 'add': s.vocab[o.key] ??= initialCard(now); break;
      case 'remove': delete s.vocab[o.key]; break;
      case 'exam': {
        const prev = s.examResults[o.examId];
        const best = (o.result.total ?? o.result.autoPoints) >= (prev?.total ?? prev?.autoPoints ?? -1) ? o.result : prev!;
        s.examResults[o.examId] = { ...best, attempts: (prev?.attempts ?? 0) + 1, lastAttemptISO: e.at };
        break;
      }
    }
  }
  if (studyDays.size) {
    const latest = [...studyDays].sort().at(-1)!;
    s.lastStudyDate = latest; s.streakDays = 0;
    const d = new Date(latest + 'T12:00:00Z');
    while (studyDays.has(d.toISOString().slice(0, 10))) { s.streakDays++; d.setUTCDate(d.getUTCDate() - 1); }
  }
  return s;
}
