import { SessionRecord } from '../history';
import { Profile } from '../store';

/* Gemini progress reports, called straight from the browser with the user's own key. */
const API = 'https://generativelanguage.googleapis.com/v1beta';

let model: { key: string; name: string } | null = null;

/** Newest stable Flash model this key can use (model names change often, so ask instead of hard-coding). */
export async function pickModel(key: string): Promise<string> {
  if (model?.key === key) return model.name;
  const r = await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
  if (!r.ok) throw new Error(r.status === 400 || r.status === 403 ? 'Gemini rejected the key.' : `Gemini error ${r.status}.`);
  const list = ((await r.json()).models ?? []) as { name: string; supportedGenerationMethods?: string[] }[];
  const ok = list
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => /^gemini-[\d.]+-flash/.test(n) && !/lite|image|tts|audio|live|embed|thinking|exp/.test(n));
  const ver = (n: string) => parseFloat(n.slice(7));
  ok.sort((a, b) => Number(/preview/.test(a)) - Number(/preview/.test(b)) || ver(b) - ver(a) || a.length - b.length);
  const name = ok[0] ?? list.find((m) => /flash/.test(m.name))?.name.replace(/^models\//, '');
  if (!name) throw new Error('No Gemini Flash model is available for this key.');
  model = { key, name };
  return name;
}

const SYSTEM = `You are an experienced boxing coach writing a progress report for one of your students.
The data comes from a training app that tracks only the student's LEAD arm (a smartwatch on the forearm, a phone on the upper arm).
Speeds are hand speeds in m/s with the shoulder assumed fixed, so they underestimate real punches but are consistent between sessions.
"forceN" is an ESTIMATE from hand speed and body weight; call it estimated power and never present it as measured.
Lesson tries are scored 0-100 by the app; tips are the app's own form notes for that try.
Write in plain, direct coach language, second person, encouraging but honest. Use Markdown with ## headings, short paragraphs and "- " bullet lists. No tables, no emoji.
Sections, in this order:
## Summary (3-4 sentences)
## Progress over time (trends in speed, power, accuracy and lesson scores, with concrete numbers and dates)
## Strengths
## What to fix (the most common form problems from the tips, each with one drill)
## Next week's plan (4-6 concrete sessions using the app's modes: Free mirror, Train lessons, Heavy bag)
If there is little data, say so and keep the report short.`;

function compact(s: SessionRecord) {
  return {
    date: new Date(s.startedAt).toISOString().slice(0, 16).replace('T', ' '),
    minutes: Math.max(1, Math.round((s.endedAt - s.startedAt) / 60000)),
    mode: s.mode, title: s.title, moves: s.total, counts: s.counts,
    bestSpeed: +s.bestSpeed.toFixed(2), avgSpeed: +s.avgSpeed.toFixed(2), maxForceN_est: Math.round(s.maxForceN),
    accuracy: s.accuracy == null ? undefined : Math.round(s.accuracy * 100), combos: s.combos || undefined,
    score: s.score, stars: s.stars, rounds: s.rounds, tries: s.tries,
  };
}

/** Sessions that belong to this boxer (older records have no name and are included). */
export function mySessions(all: SessionRecord[], name: string) {
  return all.filter((s) => !s.who || !name || s.who === name);
}

export async function progressReport(key: string, p: Profile, sessions: SessionRecord[]): Promise<{ md: string; model: string }> {
  const name = await pickModel(key);
  const data = {
    student: { name: p.name || 'the boxer', heightCm: p.heightCm, weightKg: p.weightKg, leadArm: p.lead, character: p.body },
    sessions: [...sessions].sort((a, b) => a.startedAt - b.startedAt).map(compact),
  };
  const r = await fetch(`${API}/models/${name}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: `Training data (JSON):\n${JSON.stringify(data)}` }] }],
      generationConfig: { temperature: 0.6 },
    }),
  });
  if (!r.ok) {
    const msg = (await r.json().catch(() => null))?.error?.message;
    throw new Error(msg ? `Gemini: ${msg}` : `Gemini error ${r.status}.`);
  }
  const j = await r.json();
  const md = (j.candidates?.[0]?.content?.parts ?? []).map((x: { text?: string }) => x.text ?? '').join('').trim();
  if (!md) throw new Error('Gemini returned an empty report. Try again.');
  return { md, model: name };
}

/** Tiny Markdown to HTML for the report: headings, bullets, bold, italics, paragraphs. */
export function mdToHtml(md: string): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (t: string) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>');
  const out: string[] = [];
  let list = false, para: string[] = [];
  const flush = () => { if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`); para = []; if (list) { out.push('</ul>'); list = false; } };
  for (const raw of md.split(/\r?\n/)) {
    const l = raw.trim();
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    const b = /^[-*•]\s+(.*)$/.exec(l) ?? /^\d+[.)]\s+(.*)$/.exec(l);
    if (!l) flush();
    else if (h) { flush(); out.push(`<h${Math.min(4, h[1].length + 1)}>${inline(h[2])}</h${Math.min(4, h[1].length + 1)}>`); }
    else if (b) { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(b[1])}</li>`); }
    else { if (list) { out.push('</ul>'); list = false; } para.push(l); }
  }
  flush();
  return out.join('\n');
}
