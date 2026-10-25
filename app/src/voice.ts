import { elevenUrl } from './ai/eleven';
import { useKeys } from './ai/keys';

/* The coach's voice. Uses recorded clips listed in /voice/manifest.json when present ({"Jab!": "jab.mp3", ...}),
 * then ElevenLabs when the user added a key, otherwise the browser's speech synthesis with a low, gruff setting. */
let clips: Record<string, string> | null = null;
const cache = new Map<string, HTMLAudioElement>();
let enabled = true;

fetch('/voice/manifest.json')
  .then((r) => (r.ok ? r.json() : {}))
  .then((m) => { clips = m as Record<string, string>; })
  .catch(() => { clips = {}; });

let chosen: SpeechSynthesisVoice | null = null;
function pickVoice() {
  if (chosen || typeof speechSynthesis === 'undefined') return chosen;
  const vs = speechSynthesis.getVoices();
  chosen = vs.find((v) => /en-(US|GB)/.test(v.lang) && /male|david|daniel|george|guy|mark/i.test(v.name)) ?? vs.find((v) => v.lang.startsWith('en')) ?? null;
  return chosen;
}

let token = 0;
let playing: HTMLAudioElement | null = null;
let queue: Promise<void> = Promise.resolve();

function speak(text: string, opts: { rate?: number; interrupt?: boolean }) {
  if (typeof speechSynthesis === 'undefined') return;
  if (opts.interrupt !== false) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = opts.rate ?? 1.05;
  u.pitch = 0.75;
  const v = pickVoice();
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}

/** ElevenLabs lines play in order; an interrupting line drops whatever is queued or playing. */
function sayEleven(key: string, text: string, opts: { rate?: number; interrupt?: boolean }) {
  if (opts.interrupt !== false) { token++; playing?.pause(); playing = null; queue = Promise.resolve(); }
  const my = token;
  const url = elevenUrl(key, text);
  queue = queue.then(async () => {
    let u: string;
    try { u = await url; } catch { if (my === token) speak(text, { ...opts, interrupt: false }); return; }
    if (my !== token) return;
    const a = new Audio(u);
    playing = a;
    await new Promise<void>((done) => { a.onended = a.onerror = a.onpause = () => done(); a.play().catch(() => done()); });
  });
}

export const voice = {
  setEnabled(on: boolean) { enabled = on; if (!on) voice.stop(); },
  isEnabled() { return enabled; },
  say(text: string, opts: { rate?: number; interrupt?: boolean } = {}) {
    if (!enabled) return;
    const file = clips?.[text];
    if (file) {
      let a = cache.get(file);
      if (!a) { a = new Audio(`/voice/${file}`); cache.set(file, a); }
      a.currentTime = 0;
      void a.play().catch(() => {});
      return;
    }
    const key = useKeys.getState().eleven;
    if (key) sayEleven(key, text, opts);
    else speak(text, opts);
  },
  /** speak once now, resolving with an error message if ElevenLabs failed (for the key check) */
  async test(text: string): Promise<string> {
    const key = useKeys.getState().eleven;
    if (!key) return 'No key.';
    try { const a = new Audio(await elevenUrl(key, text)); await a.play(); return ''; } catch (e) { return (e as Error).message; }
  },
  stop() {
    token++; playing?.pause(); playing = null; queue = Promise.resolve();
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  },
};
