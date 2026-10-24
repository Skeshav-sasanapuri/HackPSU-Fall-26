/* Where the relay lives. Set VITE_RELAY_URL (e.g. https://jab-relay.<you>.workers.dev) on Vercel; locally it is wrangler dev. */
const raw = (import.meta.env.VITE_RELAY_URL as string | undefined) ?? 'http://localhost:8787';

export const RELAY_HTTP = raw.replace(/\/$/, '').replace(/^ws/, 'http');
export const RELAY_WS = RELAY_HTTP.replace(/^http/, 'ws');

/** Origin the phone should open. Override with VITE_PUBLIC_ORIGIN when the laptop is on a LAN address. */
export const publicOrigin = () => (import.meta.env.VITE_PUBLIC_ORIGIN as string | undefined) ?? window.location.origin;

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O, 1/I
export const SESSION_RE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;
export const PAIR_CODE_RE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/;

export function newSessionCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** What a person typed -> a pairing code candidate (uppercase, only characters the codes can contain). */
export function cleanCode(s: string): string {
  return Array.from(s.toUpperCase()).filter((c) => ALPHABET.includes(c)).join('');
}
