// Strava and Spotify: OAuth plus the handful of API calls the app needs.

import { Budget, Env, now, outbound, seal, unseal } from './util';
import type { RawStreams } from './match';

export type Provider = 'strava' | 'spotify';

// Strava: profile + activities. `activity:read_all` is needed for complete
// data: with plain `activity:read`, Strava cuts out the stretches of every
// activity that fall inside the athlete's hidden start/end zones.
// Spotify: listening history.
const STRAVA_SCOPE = 'read,activity:read_all';
const SPOTIFY_SCOPE = 'user-read-recently-played';

export const RUN_TYPES = new Set(['Run', 'TrailRun', 'VirtualRun']);

interface TokenSet {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export function authorizeUrl(env: Env, provider: Provider, redirectUri: string, state: string): string {
  if (provider === 'strava') {
    const q = new URLSearchParams({
      client_id: env.STRAVA_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      approval_prompt: 'auto',
      scope: STRAVA_SCOPE,
      state,
    });
    return `https://www.strava.com/oauth/authorize?${q}`;
  }
  const q = new URLSearchParams({
    client_id: env.SPOTIFY_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SPOTIFY_SCOPE,
    state,
  });
  return `https://accounts.spotify.com/authorize?${q}`;
}

function spotifyBasic(env: Env): string {
  return 'Basic ' + btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`);
}

export interface StravaAthlete {
  id: number;
  firstname?: string;
  lastname?: string;
  profile_medium?: string;
}

export async function exchangeStravaCode(env: Env, code: string): Promise<TokenSet & { athlete: StravaAthlete }> {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Strava token exchange failed (${res.status})`);
  return res.json();
}

export async function exchangeSpotifyCode(env: Env, code: string, redirectUri: string): Promise<TokenSet> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { authorization: spotifyBasic(env) },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
  });
  if (!res.ok) throw new Error(`Spotify token exchange failed (${res.status})`);
  const t = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  return { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: now() + t.expires_in };
}

export async function saveTokens(env: Env, userId: number, provider: Provider, t: TokenSet): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO tokens (user_id, provider, access_token, refresh_token, expires_at, status, last_error)
     VALUES (?, ?, ?, ?, ?, 'ok', NULL)
     ON CONFLICT (user_id, provider) DO UPDATE SET
       access_token = excluded.access_token, refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at, status = 'ok', last_error = NULL`,
  )
    .bind(userId, provider, await seal(env.TOKEN_KEY, t.access_token), await seal(env.TOKEN_KEY, t.refresh_token), t.expires_at)
    .run();
}

/** A valid access token, refreshed if needed. Null if not connected or revoked. */
export async function accessToken(env: Env, userId: number, provider: Provider, budget: Budget): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT access_token, refresh_token, expires_at, status FROM tokens WHERE user_id = ? AND provider = ?`,
  )
    .bind(userId, provider)
    .first<{ access_token: string; refresh_token: string; expires_at: number; status: string }>();
  if (!row || row.status !== 'ok') return null;
  if (row.expires_at > now() + 120) return unseal(env.TOKEN_KEY, row.access_token);

  const refresh = await unseal(env.TOKEN_KEY, row.refresh_token);
  const res =
    provider === 'strava'
      ? await outbound(budget, 'https://www.strava.com/oauth/token', {
          method: 'POST',
          body: new URLSearchParams({
            client_id: env.STRAVA_CLIENT_ID,
            client_secret: env.STRAVA_CLIENT_SECRET,
            refresh_token: refresh,
            grant_type: 'refresh_token',
          }),
        })
      : await outbound(budget, 'https://accounts.spotify.com/api/token', {
          method: 'POST',
          headers: { authorization: spotifyBasic(env) },
          body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh }),
        });

  if (res.status === 400 || res.status === 401) {
    // The user revoked access (or the refresh token expired): ask them to reconnect.
    await markRevoked(env, userId, provider);
    return null;
  }
  if (!res.ok) throw new Error(`${provider} token refresh failed (${res.status})`);

  const t = (await res.json()) as { access_token: string; refresh_token?: string; expires_at?: number; expires_in?: number };
  await saveTokens(env, userId, provider, {
    access_token: t.access_token,
    refresh_token: t.refresh_token ?? refresh,
    expires_at: t.expires_at ?? now() + (t.expires_in ?? 3600),
  });
  return t.access_token;
}

export async function markRevoked(env: Env, userId: number, provider: Provider): Promise<void> {
  await env.DB.prepare(`UPDATE tokens SET status = 'revoked' WHERE user_id = ? AND provider = ?`).bind(userId, provider).run();
}

// --- API calls --------------------------------------------------------------

export interface StravaActivity {
  id: number;
  name: string;
  type: string;
  sport_type?: string;
  start_date: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  average_heartrate?: number;
}

/** The athlete's most recent activities of every type, newest first. */
export async function stravaActivities(token: string, budget: Budget): Promise<StravaActivity[] | null> {
  const res = await outbound(budget, `https://www.strava.com/api/v3/athlete/activities?per_page=30`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`Strava activities failed (${res.status})`);
  return res.json();
}

/** Per-second streams for one activity of any type, or null if it has none (e.g. a manual entry). */
export async function stravaStreams(token: string, activityId: number, budget: Budget): Promise<RawStreams | null> {
  const res = await outbound(
    budget,
    `https://www.strava.com/api/v3/activities/${activityId}/streams?keys=time,distance,moving,heartrate,watts,cadence,altitude&key_by_type=true`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Strava streams failed (${res.status})`);
  const s = (await res.json()) as Record<string, { data: unknown[] } | undefined>;
  if (!s.time?.data?.length) return null;
  const time = s.time.data as number[];
  return {
    time,
    // Indoor sessions (weights, yoga) have no distance.
    distance: (s.distance?.data as number[] | undefined) ?? time.map(() => 0),
    moving: s.moving?.data as boolean[] | undefined,
    heartrate: s.heartrate?.data as number[] | undefined,
    watts: s.watts?.data as (number | null)[] | undefined,
    cadence: s.cadence?.data as number[] | undefined,
    altitude: s.altitude?.data as number[] | undefined,
  };
}

export async function stravaDeauthorize(token: string): Promise<void> {
  await fetch('https://www.strava.com/oauth/deauthorize', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
}

export interface SpotifyPlay {
  played_at: string;
  track: {
    id: string | null;
    name: string;
    duration_ms: number;
    artists: { name: string }[];
    album: { name: string; images: { url: string; width: number }[] };
  };
}

/**
 * Null means the token no longer works. 'not-allowed' means Spotify refused
 * this account: the app is in Development mode and they aren't on its user list.
 */
export async function spotifyRecentlyPlayed(token: string, afterMs: number, budget: Budget): Promise<SpotifyPlay[] | 'not-allowed' | null> {
  const res = await outbound(budget, `https://api.spotify.com/v1/me/player/recently-played?limit=50&after=${afterMs}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) return null;
  if (res.status === 403) return 'not-allowed';
  if (!res.ok) throw new Error(`Spotify recently-played failed (${res.status})`);
  return ((await res.json()) as { items?: SpotifyPlay[] }).items ?? [];
}

/** The athlete's own unit setting in Strava: 'mi', 'km', or null if Strava doesn't say. */
export async function stravaUnits(token: string, budget: Budget): Promise<'mi' | 'km' | null> {
  const res = await outbound(budget, 'https://www.strava.com/api/v3/athlete', { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const pref = ((await res.json()) as { measurement_preference?: string }).measurement_preference;
  return pref === 'feet' ? 'mi' : pref === 'meters' ? 'km' : null;
}
