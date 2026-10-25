/* Sound effects. Real samples are used when /sfx/manifest.json lists them, e.g.
 *   {"hit": ["hit1.mp3", "hit2.mp3"], "bell": "bell.mp3", "whoosh": "whoosh.mp3", "cheer": "cheer.mp3"}
 * Otherwise everything is synthesized, so the app never goes silent. */
let ctx: AudioContext | null = null;
const ac = () => (ctx ??= new AudioContext());
const buffers: Record<string, AudioBuffer[]> = {};

fetch('/sfx/manifest.json')
  .then((r) => (r.ok ? r.json() : {}))
  .then(async (m: Record<string, string | string[]>) => {
    for (const [name, files] of Object.entries(m)) {
      for (const f of Array.isArray(files) ? files : [files]) {
        try {
          const data = await fetch(`/sfx/${f}`).then((r) => r.arrayBuffer());
          (buffers[name] ??= []).push(await ac().decodeAudioData(data));
        } catch { /* skip a broken file */ }
      }
    }
  })
  .catch(() => {});

function sample(name: string, gain: number, rate = 1): boolean {
  const list = buffers[name];
  if (!list?.length) return false;
  try {
    const a = ac(), src = a.createBufferSource(), g = a.createGain();
    src.buffer = list[Math.floor(Math.random() * list.length)];
    src.playbackRate.value = rate;
    g.gain.value = gain;
    src.connect(g).connect(a.destination);
    src.start();
    return true;
  } catch { return false; }
}

function tone(freq: number, dur: number, type: OscillatorType = 'square', gain = 0.08, when = 0) {
  try {
    const a = ac(), t = a.currentTime + when;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t); o.stop(t + dur + 0.02);
  } catch { /* audio not available */ }
}

let noise: AudioBuffer | null = null;
function noiseBurst(dur: number, gain: number, freq: number, q = 0.8) {
  try {
    const a = ac();
    if (!noise) {
      noise = a.createBuffer(1, a.sampleRate * 0.5, a.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(), t = a.currentTime;
    src.buffer = noise;
    f.type = 'lowpass'; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(a.destination);
    src.start(t); src.stop(t + dur + 0.02);
  } catch { /* audio not available */ }
}

export const sfx = {
  tick: () => tone(660, 0.12),
  go: () => tone(990, 0.25),
  ok: () => { tone(523, 0.12, 'triangle', 0.12); tone(784, 0.25, 'triangle', 0.12, 0.1); },
  bad: () => { tone(220, 0.18, 'sawtooth', 0.06); tone(165, 0.3, 'sawtooth', 0.06, 0.15); },
  /** short thump for a punch in the air, louder for harder punches (0..1) */
  punch: (k: number) => {
    if (sample('whoosh', 0.3 + 0.5 * k, 0.9 + Math.random() * 0.2)) return;
    noiseBurst(0.12, 0.05 + 0.12 * k, 1800);
  },
  /** glove on leather, layered: low body + slap + rattle of the chain */
  hit: (k: number) => {
    if (sample('hit', 0.4 + 0.6 * k, 0.92 + Math.random() * 0.16)) return;
    try {
      const a = ac(), t = a.currentTime;
      const o = a.createOscillator(), g = a.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(110 + 50 * k + Math.random() * 15, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.18);
      g.gain.setValueAtTime(0.35 + 0.5 * k, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(g).connect(a.destination);
      o.start(t); o.stop(t + 0.27);
    } catch { /* audio not available */ }
    noiseBurst(0.07, 0.25 + 0.3 * k, 1400 + Math.random() * 500);
    noiseBurst(0.25, 0.03, 6000, 3);
  },
  bell: () => {
    if (sample('bell', 0.8)) return;
    for (let r = 0; r < 3; r++) for (const [f, gn] of [[880, 0.12], [1320, 0.06], [2210, 0.04]] as const) tone(f, 1.1, 'sine', gn, r * 0.32);
  },
  cheer: () => { sample('cheer', 0.6); },
};
