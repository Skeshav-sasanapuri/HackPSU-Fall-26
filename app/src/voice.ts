/* The coach's voice. Uses recorded clips listed in /voice/manifest.json ({"Jab!": "jab.mp3", ...}, made with
 * ElevenLabs), otherwise the browser's speech synthesis with a low, gruff setting. Lookups ignore case and punctuation,
 * and a line with no clip of its own is stitched from clips of its parts ("Your turn. Hook!" = "your turn" + "hook").
 * A part whose clip is missing or fails to load is spoken by the browser. Clips are decoded and their leading and
 * trailing silence is skipped, so stitched parts run together like one sentence. */
const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

let clips = new Map<string, string>();
let enabled = true;

fetch('/voice/manifest.json')
  .then((r) => (r.ok ? r.json() : {}))
  .then((m: Record<string, string>) => {
    clips = new Map(Object.entries(m).map(([k, f]) => [norm(k), `/voice/${f}`]));
    // decode everything now so the first call of each line is instant (missing files just fall back later)
    setTimeout(() => clips.forEach((u) => void clip(u).catch(() => {})), 1500);
  })
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

interface Clip { buf: AudioBuffer; from: number; to: number }
let ctx: AudioContext | null = null;
const decoded = new Map<string, Promise<Clip>>();
let playing: AudioBufferSourceNode | null = null;
let token = 0;
let queue: Promise<void> = Promise.resolve();

/** the voiced part of a clip: first and last sample above -40 dB, with a few ms of padding */
function clip(url: string): Promise<Clip> {
  let p = decoded.get(url);
  if (!p) {
    ctx ??= new AudioContext();
    const c = ctx;
    p = fetch(url).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); }).then((b) => c.decodeAudioData(b)).then((buf) => {
      const d = buf.getChannelData(0), th = 0.01;
      let a = 0, z = d.length - 1;
      while (a < z && Math.abs(d[a]) < th) a++;
      while (z > a && Math.abs(d[z]) < th) z--;
      const pad = 0.03 * buf.sampleRate;
      return { buf, from: Math.max(0, a - pad) / buf.sampleRate, to: Math.min(d.length, z + pad) / buf.sampleRate };
    });
    decoded.set(url, p);
    p.catch(() => decoded.delete(url));
  }
  return p;
}

async function play(url: string, text: string, rate: number, my: number): Promise<void> {
  let c: Clip;
  try { c = await clip(url); } catch { if (my === token) await speak(text, rate); return; }
  if (my !== token || !ctx) return;
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  const src = ctx.createBufferSource();
  src.buffer = c.buf;
  src.connect(ctx.destination);
  playing = src;
  await new Promise<void>((done) => { src.onended = () => done(); src.start(0, c.from, c.to - c.from); });
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
    steps.forEach((s) => { if (s.url) void clip(s.url).catch(() => {}); }); // decode every part up front
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
    try { playing?.stop(); } catch { /* not started */ }
    playing = null;
    queue = Promise.resolve();
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  },
};
