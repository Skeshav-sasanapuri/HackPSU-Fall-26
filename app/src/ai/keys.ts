import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* Optional API keys for the AI extras. Kept in this browser's localStorage only, sent only to Google / ElevenLabs. */
interface Keys {
  gemini: string;
  eleven: string;
  set: (k: Partial<Pick<Keys, 'gemini' | 'eleven'>>) => void;
}

export const useKeys = create<Keys>()(
  persist((set) => ({ gemini: '', eleven: '', set: (k) => set(k) }), { name: 'jab.keys', version: 1 }),
);
