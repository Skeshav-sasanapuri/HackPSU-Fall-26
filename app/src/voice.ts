/* The coach's voice. Uses recorded clips listed in /voice/manifest.json ({"Jab!": "jab.mp3", ...}, made with
 * ElevenLabs), otherwise the browser's speech synthesis with a low, gruff setting. Lookups ignore case and punctuation,
 * and a line with no clip of its own is stitched from clips of its parts ("Your turn. Hook!" = "your turn" + "hook").
 * A part whose clip is missing or fails to load is spoken by the browser. */
const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

let clips = new Map<string, string>();
let enabled = true;

fetch('/voice/manifest.json')
  .then((r) => (r.ok ? r.json() : {}))
  .then((m: Record<string, string>) => { clips = new Map(Object.entries(m).map(([k, f]) => [norm(k), `/voice/${f}`])); })
  .catch(() => {});

let chosen: SpeechSynthesisVoice | null = null;
function pickVoice() {
  if (chosen || typeof speechSynthesis === 'undefined') return chosen;
  const vs = speechSynthesis.getVoices();
  chosen = vs.find((v) => /en-(US|GB)/.test(v.lang) && /male|david|daniel|george|guy|mark/i.test(v.name)) ?? vs.find((v) => v.lang.startsWith('en')) ?? null;
  return chosen;
}

function speak(text: string, rate = 1.05): Promise<void> {
  if (typeof speechSynthesis === 'undefined') return Promise.resolve();
  return new Promise((done) => {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate;
    u.pitch = 0.75;
    const v = pickVoice();
    if (v) u.voice = v;
    u.onend = u.onerror = () => done();
    speechSynthesis.speak(u);
  });
}

const audio = new Map<string, HTMLAudioElement>();
let playing: HTMLAudioElement | null = null;
let token = 0;
let queue: Promise<void> = Promise.resolve();

function play(url: string, text: string, rate: number, my: number): Promise<void> {
  let a = audio.get(url);
  if (!a) { a = new Audio(url); a.preload = 'auto'; audio.set(url, a); }
  a.currentTime = 0;
  playing = a;
  const el = a;
  return new Promise<void>((done) => {
    el.onended = el.onpause = () => done();
    el.onerror = () => { if (my === token) void speak(text, rate).then(done); else done(); };
    el.play().catch(() => { if (my === token) void speak(text, rate).then(done); else done(); });
  });
}

/** clip urls for the whole line, or for each of its parts; parts without a clip keep their text */
function plan(text: string): { url?: string; text: string }[] {
  const whole = clips.get(norm(text));
  if (whole) return [{ url: whole, text }];
  const parts = text.split(/[.,!?;]+/).map((p) => p.trim()).filter(Boolean);
  if (!parts.some((p) => clips.has(norm(p)))) return [{ text }];
  return parts.map((p) => ({ url: clips.get(norm(p)), text: p }));
}

export const voice = {
  setEnabled(on: boolean) { enabled = on; if (!on) voice.stop(); },
  isEnabled() { return enabled; },
  say(text: string, opts: { rate?: number; interrupt?: boolean } = {}) {
    if (!enabled) return;
    if (opts.interrupt !== false) voice.stop();
    const my = token, rate = opts.rate ?? 1.05;
    const steps = plan(text);
    if (steps.length === 1 && !steps[0].url) { void speak(text, rate); return; }
    queue = queue.then(async () => {
      for (const s of steps) {
        if (my !== token) return;
        await (s.url ? play(s.url, s.text, rate, my) : speak(s.text, rate));
      }
    });
  },
  stop() {
    token++;
    playing?.pause();
    playing = null;
    queue = Promise.resolve();
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  },
};
