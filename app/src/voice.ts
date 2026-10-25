/* The coach's voice. Uses recorded clips listed in /voice/manifest.json when present ({"Jab!": "jab.mp3", ...}, for
 * example made with ElevenLabs), otherwise the browser's speech synthesis with a low, gruff setting. */
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
    if (typeof speechSynthesis === 'undefined') return;
    if (opts.interrupt !== false) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = opts.rate ?? 1.05;
    u.pitch = 0.75;
    const v = pickVoice();
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  },
  stop() { if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); },
};
