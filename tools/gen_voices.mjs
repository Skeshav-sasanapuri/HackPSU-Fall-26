// Coach voice lines -> app/public/voice/{manifest.json, README.txt} and, with a key, the MP3s from ElevenLabs.
//   node tools/gen_voices.mjs                      writes manifest + README only
//   ELEVENLABS_API_KEY=... node tools/gen_voices.mjs [--force]   also generates every missing MP3 (eleven_v3)
// The [tags] are ElevenLabs v3 audio tags (delivery directions); the app looks clips up by the plain text.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VOICE_ID = 'd3qrd1ge6zWDvUxIeXiH';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'public', 'voice');

// [file, what the app says, what ElevenLabs gets]
const LINES = [
  ['cue-jab', 'Jab!', '[shouting] Jab!'],
  ['cue-double', 'Double!', '[shouting] Double!'],
  ['cue-body-jab', 'Body jab!', '[shouting] Body jab!'],
  ['cue-hook', 'Hook!', '[shouting] Hook!'],
  ['cue-body-hook', 'Body hook!', '[shouting] Body hook!'],
  ['cue-uppercut', 'Uppercut!', '[shouting] Uppercut!'],
  ['cue-cover', 'Cover!', '[shouting] Cover!'],
  ['cue-parry', 'Parry!', '[shouting] Parry!'],
  ['cue-elbow', 'Elbow!', '[shouting] Elbow!'],
  ['cue-feint', 'Feint!', '[shouting] Feint!'],
  ['elbow-block', 'Elbow block.', '[firmly] Elbow block.'],
  ['tip-jab', 'Straight line from the chin.', '[calm, instructive] Straight line from the chin.'],
  ['tip-double-jab', 'First jab reaches, half returns.', '[calm, instructive] First jab reaches, half returns.'],
  ['tip-body-jab', 'Drop the level with your knees.', '[calm, instructive] Drop the level with your knees.'],
  ['tip-hook', 'Elbow up to shoulder height.', '[calm, instructive] Elbow up to shoulder height.'],
  ['tip-body-hook', 'Dip to the side.', '[calm, instructive] Dip to the side.'],
  ['tip-uppercut', 'Small dip, no big wind-up.', '[calm, instructive] Small dip, no big wind-up.'],
  ['tip-high-guard', 'Glove to the temple.', '[calm, instructive] Glove to the temple.'],
  ['tip-parry', 'Small movement.', '[calm, instructive] Small movement.'],
  ['tip-elbow-block', 'Elbow tight to the side.', '[calm, instructive] Elbow tight to the side.'],
  ['tip-feint', 'Sharp little twitch.', '[calm, instructive] Sharp little twitch.'],
  ['calibrate', 'Arms straight out in front. Hold still.', '[calm] Arms straight out in front. [firmly] Hold still.'],
  ['full-speed', 'Now at full speed.', '[confident] Now at full speed.'],
  ['your-turn', 'Your turn.', '[encouraging] Your turn.'],
  ['again', 'Again.', '[firmly] Again.'],
  ['good-work', 'Good work, kid.', '[warmly, proud] Good work, kid.'],
  ['do-better', 'Again. You can do better.', '[sighs] Again. [encouraging] You can do better.'],
  ['nice', 'Nice!', '[excited] Nice!'],
  ['beautiful', 'Beautiful!', '[excited] Beautiful!'],
  ['thats-it', "That's it!", "[excited] That's it!"],
  ['sharp', 'Sharp!', '[excited] Sharp!'],
  ['round-1', 'Round 1.', '[announcer voice] Round one.'],
  ['round-2', 'Round 2.', '[announcer voice] Round two.'],
  ['round-3', 'Round 3.', '[announcer voice] Round three.'],
  ['fight', 'Fight!', '[shouting] Fight!'],
  ['time-great', 'Time! Great work.', '[shouting] Time! [proud] Great work.'],
  ['time-breathe', 'Time. Breathe.', '[calm] Time. [exhales] Breathe.'],
];

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(Object.fromEntries(LINES.map(([f, t]) => [t, `${f}.mp3`])), null, 1));
writeFileSync(join(OUT, 'README.txt'),
  'Coach voice clips (ElevenLabs, model Eleven v3, voice ' + VOICE_ID + ').\n' +
  'Paste the text after the tab into ElevenLabs, download the MP3, save it here under the file name on the left.\n' +
  'Or generate all of them: ELEVENLABS_API_KEY=... node tools/gen_voices.mjs\n' +
  'Silence around each clip is trimmed by the app. Missing files fall back to the browser voice.\n\n' +
  LINES.map(([f, , tagged]) => `${f}.mp3\t${tagged}`).join('\n') + '\n');
console.log(`manifest + README written (${LINES.length} lines)`);

const key = process.env.ELEVENLABS_API_KEY;
if (key) {
  const force = process.argv.includes('--force');
  for (const [f, , tagged] of LINES) {
    const file = join(OUT, `${f}.mp3`);
    if (existsSync(file) && !force) { console.log('skip', f); continue; }
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text: tagged, model_id: 'eleven_v3' }),
    });
    if (!r.ok) { console.error('FAILED', f, r.status, (await r.text()).slice(0, 200)); process.exitCode = 1; continue; }
    writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    console.log('ok', f);
  }
}
