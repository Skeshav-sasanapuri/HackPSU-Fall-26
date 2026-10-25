// Every line the coach says -> app/public/voice/{manifest.json, README.txt} and, with a key, one MP3 per line.
//   npx tsx tools/gen_voices.mts                                  manifest + README only
//   ELEVENLABS_API_KEY=... npx tsx tools/gen_voices.mts [--force]  also generates missing MP3s
//   VOICE_ID=... to use another voice (library voices need a paid ElevenLabs plan for API use)
// Whole sentences are recorded as one clip so they sound natural; the [tags] are ElevenLabs audio tags (delivery
// directions). The app looks clips up by the plain text, ignoring case and punctuation.
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMBOS, MOVE_IDS, MOVE_INFO, MoveId } from '../app/src/core/moves';

const VOICE_ID = process.env.VOICE_ID ?? 'pNInz6obpgDQGcFmaJgB'; // "Adam", a premade deep male voice (free tier ok)
const MODEL = 'eleven_v4';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'public', 'voice');
// keep in sync with Bag.tsx (SINGLES, rounds) and Lesson.tsx (what each phase says)
const BAG_SINGLES: MoveId[] = ['jab', 'body jab', 'hook', 'body hook', 'uppercut'];
const ROUNDS = ['one', 'two', 'three'];

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const lines = new Map<string, { text: string; tagged: string }>();
const add = (text: string, tagged: string) => { if (!lines.has(norm(text))) lines.set(norm(text), { text, tagged }); };
const cue = (m: MoveId) => MOVE_INFO[m].cue;
const bare = (m: MoveId) => cue(m).replace('!', '');

// lessons
add('Arms straight out in front. Hold still.', '[calm] Arms straight out in front. [firmly] Hold still.');
for (const m of MOVE_IDS) add(MOVE_INFO[m].keys[0], `[calm, instructive] ${MOVE_INFO[m].keys[0]}.`);
for (const c of COMBOS) add(`Watch. ${c.name}`, `[calm, instructive] Watch. ${c.name}.`);
add('Now at full speed.', '[confident] Now at full speed.');
for (const m of MOVE_IDS) add(`Your turn. ${cue(m)}`, `[encouraging] Your turn. [shouting] ${cue(m)}`);
for (const c of COMBOS) add(`Your turn. ${c.name}`, `[encouraging] Your turn. [firmly] ${c.name}!`);
for (const m of MOVE_IDS) add(cue(m), `[shouting] ${cue(m)}`);
add('Again.', '[firmly] Again.');
add('Good work, kid.', '[warmly, proud] Good work, kid.');
add('Again. You can do better.', '[sighs] Again. [encouraging] You can do better.');
// gym rounds
ROUNDS.forEach((w, i) => add(`Round ${i + 1}. Fight!`, `[announcer voice] Round ${w}! [shouting] Fight!`));
for (const m of BAG_SINGLES) add(`${bare(m)}!`, `[shouting] ${cue(m)}`);
for (const c of COMBOS) { const t = c.moves.map(bare).join(', ') + '!'; add(t, `[shouting, fast] ${t}`); }
for (const p of ['Nice!', 'Beautiful!', 'That’s it!', 'Sharp!']) add(p, `[excited] ${p}`);
add('Time! Great work.', '[shouting] Time! [proud] Great work.');
add('Time. Breathe.', '[calm] Time. [exhales] Breathe.');

const file = (t: string) => norm(t).replace(/ /g, '-').slice(0, 48) + '.mp3';
const all = [...lines.values()];
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(Object.fromEntries(all.map((l) => [l.text, file(l.text)])), null, 1));
writeFileSync(join(OUT, 'README.txt'),
  `Coach voice clips, one per line the coach says (ElevenLabs ${MODEL}, voice ${VOICE_ID}).\n` +
  'Regenerate: ELEVENLABS_API_KEY=... npx tsx tools/gen_voices.mts --force   (VOICE_ID=... for another voice)\n' +
  'By hand: paste the text after the tab into ElevenLabs and save the MP3 under the file name on the left.\n' +
  'The app trims silence around each clip. Missing files fall back to the browser voice.\n\n' +
  all.map((l) => `${file(l.text)}\t${l.tagged}`).join('\n') + '\n');
console.log(`${all.length} lines, ${all.reduce((s, l) => s + l.tagged.length, 0)} characters`);

const key = process.env.ELEVENLABS_API_KEY;
if (key) {
  const force = process.argv.includes('--force');
  const keep = new Set(all.map((l) => file(l.text)));
  for (const f of readdirSync(OUT)) if (f.endsWith('.mp3') && !keep.has(f)) { unlinkSync(join(OUT, f)); console.log('removed', f); }
  for (const l of all) {
    const out = join(OUT, file(l.text));
    if (existsSync(out) && !force) continue;
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text: l.tagged, model_id: MODEL }),
    });
    if (!r.ok) { console.error('FAILED', l.text, r.status, (await r.text()).slice(0, 200)); process.exitCode = 1; continue; }
    writeFileSync(out, Buffer.from(await r.arrayBuffer()));
    console.log('ok', file(l.text));
  }
}
