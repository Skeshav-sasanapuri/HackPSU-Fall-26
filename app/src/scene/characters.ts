import { Boxer } from './boxer';
import { Fighter, FighterColors } from './fighter';
import { GltfFighter } from './gltfFighter';

/* Picks the user's character: the rigged model at /models/<body>.glb when it exists (Keshav's MPFB + Mixamo
 * characters), the three.js Mixamo test models with ?model=test, otherwise the built-in placeholder. */
export type Body = 'male' | 'female';

const TEST_MODELS: Record<Body, string> = { male: '/models/test/Xbot.glb', female: '/models/test/Michelle.glb' };

async function exists(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    // the SPA fallback answers unknown paths with index.html, so check the type too
    return r.ok && !(r.headers.get('content-type') ?? '').includes('text/html');
  } catch { return false; }
}

export async function makeFighter(body: Body, colors: FighterColors & { hair?: string }, useTestModels: boolean): Promise<Fighter> {
  const candidates = [`/models/${body}.glb`, ...(useTestModels ? [TEST_MODELS[body]] : [])];
  for (const url of candidates) {
    if (!(await exists(url))) continue;
    try {
      return await GltfFighter.load(url, colors, body === 'female' ? 1.68 : 1.8);
    } catch (e) {
      console.warn('could not use', url, e);
    }
  }
  return new Boxer({ ...colors, trim: '#efe6d2', hair: colors.hair ?? '#1b130e' }, body === 'female' ? 'female' : 'fighter');
}
