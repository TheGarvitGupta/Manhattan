export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  BASE_PATH: string;
  STRAVA_CLIENT_ID: string;
  STRAVA_CLIENT_SECRET: string;
  SPOTIFY_CLIENT_ID: string;
  SPOTIFY_CLIENT_SECRET: string;
  TOKEN_KEY: string;
  STRAVA_VERIFY_TOKEN?: string;
  STRAVA_POLL_MINUTES?: string;
  // Cloudflare Email Sending. Absent until it is switched on for the domain.
  EMAIL?: { send(message: Record<string, unknown>): Promise<unknown> };
  // Where emails link back to; the cron has no request to read it from.
  PUBLIC_ORIGIN?: string;
}

export interface User {
  id: number;
  strava_athlete_id: number;
  name: string;
  avatar: string | null;
  is_demo: number;
  spotify_since: number | null;
  last_sync_at: number | null;
}

export const now = () => Math.floor(Date.now() / 1000);

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(null, { status: 302, headers });
}

export function getCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export function setCookie(req: Request, env: Env, name: string, value: string, maxAge: number): string {
  // `Secure` is skipped on plain-http local dev so Safari keeps the cookie.
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  // Scoped to the app's path: the origin is shared with the rest of the site.
  return `${name}=${value}; Path=${env.BASE_PATH}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

// --- crypto ---------------------------------------------------------------

const enc = new TextEncoder();
const dec = new TextDecoder();
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

export function randomToken(bytes = 32): string {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(s: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))));
}

async function aesKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(secret));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function seal(secret: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret), enc.encode(plain)));
  const all = new Uint8Array(iv.length + ct.length);
  all.set(iv);
  all.set(ct, iv.length);
  let bin = '';
  for (const b of all) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function unseal(secret: string, sealed: string): Promise<string> {
  const all = Uint8Array.from(atob(sealed), (c) => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, await aesKey(secret), all.slice(12));
  return dec.decode(plain);
}

// --- outbound request budget ----------------------------------------------

/** Workers cap subrequests per invocation; every outbound fetch spends one. */
export interface Budget {
  n: number;
}
export class BudgetExceeded extends Error {}
export class RateLimited extends Error {}

export async function outbound(budget: Budget, url: string, init?: RequestInit): Promise<Response> {
  if (budget.n <= 0) throw new BudgetExceeded();
  budget.n--;
  const res = await fetch(url, init);
  if (res.status === 429) throw new RateLimited(`${new URL(url).hostname} rate limit`);
  return res;
}
