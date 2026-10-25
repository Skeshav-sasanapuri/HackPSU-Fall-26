import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ArmLengths, armFromHeight } from './core/body';
import { Clock } from './core/vec';
import { newSessionCode } from './link/config';

export interface Profile {
  name: string;
  heightCm: number;
  weightKg: number;
  /** which arm is tracked; the watch is on this wrist */
  lead: 'left' | 'right';
  units: 'imperial' | 'metric';
  /** user overrides of the estimated segment lengths (m) */
  upperArmM: number | null;
  forearmM: number | null;
  /** which clock direction of the watch face points toward the fingers */
  watchAxis: Clock;
  /** which clock direction of the PHONE points from the shoulder toward the elbow ('6' = top edge points to the shoulder) */
  phoneAxis: Clock;
  /** remembered watch (device id issued by the watch app) */
  watchDeviceId: string | null;
  /** show the boxer like a mirror (your left arm moves the arm on the left of the screen) */
  mirror: boolean;
  /** character */
  body: 'male' | 'female';
  /** 0 = very light .. 1 = very dark */
  skinTone: number;
  gloves: string;
  shorts: string;
  done: boolean;
}

interface ProfileStore extends Profile {
  set: (p: Partial<Profile>) => void;
  reset: () => void;
}

const DEFAULT: Profile = {
  name: '', heightCm: 175, weightKg: 75, lead: 'left', units: 'imperial', upperArmM: null, forearmM: null,
  watchAxis: '3', phoneAxis: '6', watchDeviceId: null, mirror: true, done: false,
  body: 'male', skinTone: 0.45, gloves: '#b3261c', shorts: '#a3271c',
};

export const useProfile = create<ProfileStore>()(
  persist(
    (set) => ({ ...DEFAULT, set: (p) => set(p), reset: () => set({ ...DEFAULT }) }),
    { name: 'jab.profile', version: 3, migrate: (old) => ({ ...DEFAULT, ...(old as object) }) as ProfileStore },
  ),
);

export function armLengths(p: Pick<Profile, 'heightCm' | 'upperArmM' | 'forearmM'>): ArmLengths {
  const est = armFromHeight(p.heightCm / 100);
  return { ...est, upperArm: p.upperArmM ?? est.upperArm, forearm: p.forearmM ?? est.forearm };
}

interface SessionStore {
  code: string;
  startedAt: number;
  /** begin a fresh session (new code) */
  fresh: () => void;
}
const SESSION_MAX_AGE = 8 * 3600 * 1000;

export const useSession = create<SessionStore>()(
  persist(
    (set) => ({
      code: '',
      startedAt: 0,
      fresh: () => set({ code: newSessionCode(), startedAt: Date.now() }),
    }),
    { name: 'jab.session', version: 1 },
  ),
);

/** The current session code, creating one when none exists or the old one is stale. */
export function ensureSession(): string {
  const s = useSession.getState();
  if (!s.code || Date.now() - s.startedAt > SESSION_MAX_AGE) s.fresh();
  return useSession.getState().code;
}
