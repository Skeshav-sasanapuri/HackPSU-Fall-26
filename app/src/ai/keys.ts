import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* Optional API keys for the AI extras. Kept in this browser's localStorage only, sent only to Google. */
interface Keys {
  gemini: string;
  set: (k: Partial<Pick<Keys, 'gemini'>>) => void;
}

export const useKeys = create<Keys>()(
  persist((set) => ({ gemini: '', set: (k) => set(k) }), { name: 'jab.keys', version: 1 }),
);
