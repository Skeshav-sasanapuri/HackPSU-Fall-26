/* ElevenLabs coach voice, called straight from the browser with the user's own key. Each line is synthesised once and
 * kept in the browser's Cache Storage, so repeated calls ("Jab!") cost no credits and play instantly. */
const API = 'https://api.elevenlabs.io/v1';
const FALLBACK_VOICE = 'JBFqnCBsd6RMkjVDRZzb'; // "George", a premade voice
const urls = new Map<string, Promise<string>>();
let voiceFor: { key: string; id: Promise<string> } | null = null;

/** A gruff, older male premade voice if the account has one. */
function voiceId(key: string): Promise<string> {
  if (voiceFor?.key === key) return voiceFor.id;
  const id = fetch(`${API}/voices`, { headers: { 'xi-api-key': key } })
    .then((r) => (r.ok ? r.json() : { voices: [] }))
    .then((j: { voices?: { voice_id: string; name: string; labels?: Record<string, string> }[] }) => {
      const vs = j.voices ?? [];
      const male = vs.filter((v) => /male/i.test(v.labels?.gender ?? '') && !/female/i.test(v.labels?.gender ?? ''));
      const v = male.find((x) => /old|middle/i.test(x.labels?.age ?? '')) ?? male[0] ?? vs[0];
      return v?.voice_id ?? FALLBACK_VOICE;
    })
    .catch(() => FALLBACK_VOICE);
  voiceFor = { key, id };
  return id;
}

async function synth(key: string, text: string): Promise<string> {
  const id = await voiceId(key);
  const cacheKey = `https://eleven.cache/${id}/${encodeURIComponent(text)}`;
  let cache: Cache | null = null;
  try { cache = await caches.open('jab-eleven'); } catch { /* no Cache Storage */ }
  const hit = await cache?.match(cacheKey);
  if (hit) return URL.createObjectURL(await hit.blob());
  const r = await fetch(`${API}/text-to-speech/${id}?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text, voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35 } }),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => null);
    throw new Error(j?.detail?.message ?? (r.status === 401 ? 'ElevenLabs rejected the key.' : `ElevenLabs error ${r.status}.`));
  }
  const blob = await r.blob();
  void cache?.put(cacheKey, new Response(blob, { headers: { 'content-type': 'audio/mpeg' } }));
  return URL.createObjectURL(blob);
}

/** Object URL of the spoken line (memoised per key and text). A failed line is retried next time. */
export function elevenUrl(key: string, text: string): Promise<string> {
  const k = `${key.slice(-6)}|${text}`;
  let p = urls.get(k);
  if (!p) {
    p = synth(key, text);
    urls.set(k, p);
    p.catch(() => urls.delete(k));
  }
  return p;
}
