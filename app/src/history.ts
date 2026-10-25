import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Detection } from './core/detector';
import { MoveId } from './core/moves';

/* Session history and lesson progress, kept in localStorage. */
export type Mode = 'mirror' | 'train' | 'bag';

export interface SessionRecord {
  id: string;
  mode: Mode;
  title: string;
  startedAt: number;
  endedAt: number;
  counts: Partial<Record<MoveId, number>>;
  total: number;
  bestSpeed: number;
  avgSpeed: number;
  maxForceN: number;
  /** share of called moves done right, null when nothing was called */
  accuracy: number | null;
  combos: number;
  score?: number;
  stars?: number;
  rounds?: number;
}

interface HistoryStore {
  sessions: SessionRecord[];
  /** best stars per lesson id */
  lessonStars: Record<string, number>;
  add: (s: SessionRecord) => void;
  setStars: (lesson: string, stars: number) => void;
  clear: () => void;
}

export const useHistory = create<HistoryStore>()(
  persist(
    (set) => ({
      sessions: [],
      lessonStars: {},
      add: (s) => set((h) => ({ sessions: [s, ...h.sessions].slice(0, 200) })),
      setStars: (lesson, n) => set((h) => ({ lessonStars: { ...h.lessonStars, [lesson]: Math.max(n, h.lessonStars[lesson] ?? 0) } })),
      clear: () => set({ sessions: [], lessonStars: {} }),
    }),
    { name: 'jab.history', version: 1 },
  ),
);

/** Collects detections during a session and turns them into a record. */
export class SessionTally {
  readonly startedAt = Date.now();
  counts: Partial<Record<MoveId, number>> = {};
  strikes: number[] = [];
  maxForceN = 0;
  called = 0;
  calledRight = 0;
  combos = 0;
  score = 0;

  add(d: Detection) {
    this.counts[d.move] = (this.counts[d.move] ?? 0) + 1;
    if (d.peakSpeed > 0) { this.strikes.push(d.peakSpeed); this.maxForceN = Math.max(this.maxForceN, d.forceN); }
  }
  get total() { return Object.values(this.counts).reduce((s, n) => s + (n ?? 0), 0); }

  finish(mode: Mode, title: string, extra: Partial<SessionRecord> = {}): SessionRecord {
    const sp = this.strikes;
    return {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      mode, title, startedAt: this.startedAt, endedAt: Date.now(), counts: this.counts, total: this.total,
      bestSpeed: sp.length ? Math.max(...sp) : 0, avgSpeed: sp.length ? sp.reduce((a, b) => a + b, 0) / sp.length : 0,
      maxForceN: this.maxForceN, accuracy: this.called ? this.calledRight / this.called : null, combos: this.combos,
      score: this.score || undefined, ...extra,
    };
  }
}
