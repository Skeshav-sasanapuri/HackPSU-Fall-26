/* Tiny synthesized sounds until the real sound effects arrive (countdown ticks, confirm, error). */
let ctx: AudioContext | null = null;
const ac = () => (ctx ??= new AudioContext());

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

export const sfx = {
  tick: () => tone(660, 0.12),
  go: () => tone(990, 0.25),
  ok: () => { tone(523, 0.12, 'triangle', 0.12); tone(784, 0.25, 'triangle', 0.12, 0.1); },
  bad: () => { tone(220, 0.18, 'sawtooth', 0.06); tone(165, 0.3, 'sawtooth', 0.06, 0.15); },
  /** short thump for a punch, louder for harder punches (0..1) */
  punch: (k: number) => {
    try {
      const a = ac(), t = a.currentTime;
      const o = a.createOscillator(), g = a.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(140 + 60 * k, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.15);
      g.gain.setValueAtTime(0.15 + 0.35 * k, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.connect(g).connect(a.destination);
      o.start(t); o.stop(t + 0.22);
    } catch { /* audio not available */ }
  },
};
