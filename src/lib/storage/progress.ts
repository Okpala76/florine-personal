import { create } from 'zustand';
import type { Skill } from '../content/schema';
import type { Rating } from '../srs/sm2';
import { emptyProgress, snapshotSchema, type ProgressData, type Operation, type ExamResult } from '../cloud/model';
export type { UnitProgress, UnitStatus, ExamResult } from '../cloud/model';
export function vocabKey(unitId: string, vocabId: string) { return `${unitId}::${vocabId}`; }
let writer: ((operation: Operation) => void) | null = null;
export function setProgressWriter(next: typeof writer) { writer = next; }
function write(operation: Operation) {
  if (!writer) throw new Error('Your progress is still loading. Please wait and try again.');
  writer(operation);
}
interface ProgressActions {
  markVisited: (unitId: string) => void;
  recordScore: (unitId: string, score: number) => void;
  addStudyMinutes: (mins: number) => void;
  exportJSON: () => string;
  importJSON: (json: string) => boolean;
  addSkillXp: (skill: Skill, n: number) => void;
  touchStreak: () => void;
  reviewVocab: (key: string, rating: Rating) => void;
  addVocabCard: (key: string) => void;
  removeVocabCard: (key: string) => void;
  recordExamResult: (examId: string, r: Omit<ExamResult, 'attempts' | 'lastAttemptISO'>) => void;
  resetAll: () => void;
}
export type ProgressState = ProgressData & ProgressActions;
export const useProgress = create<ProgressState>()((_set, get) => ({
  ...emptyProgress(),
  markVisited: unitId => write({ type: 'visit', unitId }),
  recordScore: (unitId, score) => write({ type: 'score', unitId, score }),
  addStudyMinutes: minutes => write({ type: 'minutes', minutes }),
  exportJSON: () => JSON.stringify(snapshotSchema.parse(get()), null, 2),
  importJSON: json => {
    try { write({ type: 'import', snapshot: snapshotSchema.parse(JSON.parse(json)) }); return true; }
    catch { return false; }
  },
  addSkillXp: (skill, amount) => write({ type: 'xp', skill, amount }),
  touchStreak: () => {
    if (get().lastStudyDate !== new Date().toISOString().slice(0, 10)) write({ type: 'study' });
  },
  reviewVocab: (key, rating) => write({ type: 'review', key, rating }),
  addVocabCard: key => { if (!get().vocab[key]) write({ type: 'add', key }); },
  removeVocabCard: key => write({ type: 'remove', key }),
  recordExamResult: (examId, result) => write({ type: 'exam', examId, result }),
  resetAll: () => write({ type: 'reset' }),
}));
