// Cadence: which songs make you run faster?
// Routes live under env.BASE_PATH (/cadence) so the app can sit on the main site.

import { buildInsights } from './insights';
import { SongInterval, songIntervals } from './match';
import { accessToken, authorizeUrl, exchangeSpotifyCode, exchangeStravaCode, Provider, saveTokens, stravaDeauthorize } from './providers';
import { syncAll, syncUser } from './sync';
import { Env, getCookie, json, now, randomToken, redirect, setCookie, sha256Hex, User } from './util';

const SESSION_COOKIE = 'cadence_sid';
const STATE_COOKIE = 'cadence_oauth';
const SESSION_TTL = 30 * 86400;
const DEMO_ATHLETE_ID = -1;

async function currentUser(req: Request, env: Env): Promise<User | null> {
  const sid = getCookie(req, SESSION_COOKIE);
  if (!sid) return null;
  return env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256Hex(sid), now())
    .first<User>();
}

async function startSession(req: Request, env: Env, userId: number): Promise<string> {
  const sid = randomToken();
  await env.DB.prepare(`INSERT INTO sessions (id_hash, user_id, expires_at) VALUES (?, ?, ?)`)
    .bind(await sha256Hex(sid), userId, now() + SESSION_TTL)
    .run();
  return setCookie(req, env, SESSION_COOKIE, sid, SESSION_TTL);
}

function callbackUrl(req: Request, env: Env, provider: Provider): string {
  return `${new URL(req.url).origin}${env.BASE_PATH}/auth/${provider}/callback`;
}

function authStart(req: Request, env: Env, provider: Provider): Response {
  const url = new URL(req.url);
  if (url.hostname === 'localhost') {
    // Spotify only accepts the loopback IP for local redirect URIs.
    url.hostname = '127.0.0.1';
    return redirect(url.toString());
  }
  const state = randomToken(16);
  return redirect(authorizeUrl(env, provider, callbackUrl(req, env, provider), state), [setCookie(req, env, STATE_COOKIE, state, 600)]);
}

/** Checks the OAuth round trip and returns the code, or a redirect explaining what went wrong. */
function authReturn(req: Request, env: Env): { code: string } | Response {
  const q = new URL(req.url).searchParams;
  const fail = (why: string) => redirect(`${env.BASE_PATH}/?error=${why}`);
  if (q.get('error')) return fail('denied');
  const state = q.get('state');
  if (!state || state !== getCookie(req, STATE_COOKIE)) return fail('state');
  const code = q.get('code');
  return code ? { code } : fail('denied');
}

async function stravaCallback(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const r = authReturn(req, env);
  if (r instanceof Response) return r;
  const scope = new URL(req.url).searchParams.get('scope') ?? '';
  if (!scope.split(',').some((s) => s.startsWith('activity:read'))) return redirect(`${env.BASE_PATH}/?error=scope`);

  const t = await exchangeStravaCode(env, r.code);
  const name = [t.athlete.firstname, t.athlete.lastname].filter(Boolean).join(' ') || 'Runner';
  const user = await env.DB.prepare(
    `INSERT INTO users (strava_athlete_id, name, avatar, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (strava_athlete_id) DO UPDATE SET name = excluded.name, avatar = excluded.avatar
     RETURNING id`,
  )
    .bind(t.athlete.id, name, t.athlete.profile_medium ?? null, now())
    .first<{ id: number }>();
  await saveTokens(env, user!.id, 'strava', t);
  ctx.waitUntil(syncUser(env, user!.id, { n: 20 }, { strava: true }).catch(console.error));
  return redirect(`${env.BASE_PATH}/`, [await startSession(req, env, user!.id), setCookie(req, env, STATE_COOKIE, '', 0)]);
}

async function spotifyCallback(req: Request, env: Env, user: User, ctx: ExecutionContext): Promise<Response> {
  const r = authReturn(req, env);
  if (r instanceof Response) return r;
  const t = await exchangeSpotifyCode(env, r.code, callbackUrl(req, env, 'spotify'));
  await saveTokens(env, user.id, 'spotify', t);
  await env.DB.prepare(`UPDATE users SET spotify_since = COALESCE(spotify_since, ?) WHERE id = ?`).bind(now(), user.id).run();
  ctx.waitUntil(syncUser(env, user.id, { n: 20 }, { strava: true }).catch(console.error));
  return redirect(`${env.BASE_PATH}/`, [setCookie(req, env, STATE_COOKIE, '', 0)]);
}

async function me(env: Env, user: User) {
  const tokens = await env.DB.prepare(`SELECT provider, status, last_sync_at, last_error FROM tokens WHERE user_id = ?`)
    .bind(user.id)
    .all<{ provider: Provider; status: string; last_sync_at: number | null; last_error: string | null }>();
  const counts = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM runs WHERE user_id = ?1) AS runs, (SELECT COUNT(*) FROM plays WHERE user_id = ?1) AS plays`,
  )
    .bind(user.id)
    .first<{ runs: number; plays: number }>();
  const conn = (p: Provider) => {
    const t = tokens.results.find((x) => x.provider === p);
    // The demo account has data but no real connections.
    if (user.is_demo) return { connected: true, ok: true, not_allowed: false, last_sync_at: null, error: null };
    return { connected: !!t, ok: t?.status === 'ok', not_allowed: t?.status === 'not-allowed', last_sync_at: t?.last_sync_at ?? null, error: t?.last_error ?? null };
  };
  return {
    user: { name: user.name, avatar: user.avatar, is_demo: !!user.is_demo },
    strava: conn('strava'),
    spotify: conn('spotify'),
    counts,
  };
}

async function listRuns(env: Env, user: User) {
  const runs = await env.DB.prepare(
    `SELECT r.id, r.name, r.start_time, r.distance_m, r.moving_s, r.avg_hr,
            (SELECT COUNT(*) FROM run_songs WHERE run_id = r.id) AS songs
     FROM runs r WHERE r.user_id = ? AND r.stream_state = 'ok' ORDER BY r.start_time DESC LIMIT 200`,
  )
    .bind(user.id)
    .all();
  return { runs: runs.results };
}

async function getRun(env: Env, user: User, id: number) {
  const run = await env.DB.prepare(
    `SELECT id, name, start_time, distance_m, moving_s, elapsed_s, avg_hr, streams FROM runs
     WHERE id = ? AND user_id = ? AND stream_state = 'ok'`,
  )
    .bind(id, user.id)
    .first<Record<string, unknown> & { streams: string }>();
  if (!run) return null;
  const songs = await env.DB.prepare(
    `SELECT rs.idx, rs.start_s, rs.end_s, rs.distance_m, rs.moving_s, rs.avg_hr, rs.skipped, t.name, t.artist, t.image
     FROM run_songs rs JOIN tracks t ON t.id = rs.track_id WHERE rs.run_id = ? ORDER BY rs.idx`,
  )
    .bind(id)
    .all();
  return { ...run, streams: JSON.parse(run.streams), songs: songs.results };
}

interface RecentPlay {
  played_at: number;
  track_id: string;
  duration_s: number;
  name: string;
  artist: string;
  image: string | null;
}

interface RecentActivity {
  id: number;
  name: string;
  type: string;
  start_time: number;
  elapsed_s: number;
  distance_m: number;
  run_id: number | null;
}

/**
 * The latest activities (of any type) and songs fetched. Each activity comes
 * with the songs that were playing during it, and for how long.
 */
async function recent(env: Env, user: User) {
  let activities = (
    await env.DB.prepare(
      `SELECT a.strava_id AS id, a.name, a.type, a.start_time, a.elapsed_s, a.distance_m,
              (SELECT id FROM runs WHERE user_id = a.user_id AND strava_id = a.strava_id AND stream_state = 'ok') AS run_id
       FROM activities a WHERE a.user_id = ? ORDER BY a.start_time DESC LIMIT 8`,
    )
      .bind(user.id)
      .all<RecentActivity>()
  ).results;
  if (!activities.length) {
    // The demo account only has runs.
    activities = (
      await env.DB.prepare(
        `SELECT strava_id AS id, name, 'Run' AS type, start_time, elapsed_s, distance_m, id AS run_id FROM runs
         WHERE user_id = ? AND stream_state = 'ok' ORDER BY start_time DESC LIMIT 8`,
      )
        .bind(user.id)
        .all<RecentActivity>()
    ).results;
  }

  const playsBetween = async (from: number, to: number, limit: number) =>
    (
      await env.DB.prepare(
        `SELECT p.played_at, p.track_id, t.duration_s, t.name, t.artist, t.image
         FROM plays p JOIN tracks t ON t.id = p.track_id
         WHERE p.user_id = ? AND p.played_at > ? AND p.played_at <= ? ORDER BY p.played_at DESC LIMIT ?`,
      )
        .bind(user.id, from, to, limit)
        .all<RecentPlay>()
    ).results;
  const describe = (i: SongInterval<RecentPlay>, from = i.from, to = i.to) => ({
    name: i.play.name,
    artist: i.play.artist,
    image: i.play.image,
    from: Math.round(from),
    to: Math.round(to),
    skipped: i.skipped,
  });

  // One extra play bounds the start of the oldest song shown.
  const songs = songIntervals(await playsBetween(0, now() + 60, 13))
    .slice(-12)
    .reverse()
    .map((i) => describe(i));

  const withSongs = [];
  for (const a of activities) {
    const end = a.start_time + a.elapsed_s;
    const intervals = a.elapsed_s > 0 ? songIntervals(await playsBetween(a.start_time - 1800, end + 900, 200)) : [];
    withSongs.push({
      ...a,
      songs: intervals
        .filter((i) => Math.min(i.to, end) - Math.max(i.from, a.start_time) >= 10)
        .map((i) => describe(i, Math.max(i.from, a.start_time), Math.min(i.to, end))),
    });
  }
  return { songs, activities: withSongs };
}

async function handleStravaWebhook(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (req.method === 'GET') {
    // Subscription handshake.
    const q = new URL(req.url).searchParams;
    if (q.get('hub.mode') === 'subscribe' && env.STRAVA_VERIFY_TOKEN && q.get('hub.verify_token') === env.STRAVA_VERIFY_TOKEN) {
      return json({ 'hub.challenge': q.get('hub.challenge') });
    }
    return json({ error: 'forbidden' }, 403);
  }
  // Events aren't signed, so the payload is only ever a hint to go and look.
  const ev = (await req.json().catch(() => null)) as {
    object_type?: string;
    object_id?: number;
    aspect_type?: string;
    owner_id?: number;
    updates?: Record<string, string>;
  } | null;
  if (ev?.owner_id) {
    const user = await env.DB.prepare(`SELECT id, last_sync_at FROM users WHERE strava_athlete_id = ? AND is_demo = 0`)
      .bind(ev.owner_id)
      .first<{ id: number; last_sync_at: number | null }>();
    if (user && now() - (user.last_sync_at ?? 0) > 20) {
      if (ev.object_type === 'activity' && ev.aspect_type === 'delete') {
        ctx.waitUntil(
          env.DB.batch([
            env.DB.prepare(`DELETE FROM runs WHERE user_id = ? AND strava_id = ?`).bind(user.id, ev.object_id),
            env.DB.prepare(`DELETE FROM activities WHERE user_id = ? AND strava_id = ?`).bind(user.id, ev.object_id),
          ]),
        );
      } else {
        // A new upload, an edit, or a deauthorisation: syncing handles all three.
        ctx.waitUntil(syncUser(env, user.id, { n: 20 }, { strava: true }).catch(console.error));
      }
    }
  }
  return json({ ok: true });
}

async function route(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith(env.BASE_PATH + '/')) return env.ASSETS.fetch(req);
  const path = url.pathname.slice(env.BASE_PATH.length);
  const method = req.method;

  if (path === '/webhooks/strava') return handleStravaWebhook(req, env, ctx);

  // Anything that changes state must come from our own pages.
  if (method !== 'GET' && req.headers.get('origin') !== url.origin) return json({ error: 'bad origin' }, 403);

  if (path === '/auth/strava' && method === 'GET') return authStart(req, env, 'strava');
  if (path === '/auth/strava/callback') return stravaCallback(req, env, ctx);

  if (path === '/auth/demo' && method === 'POST') {
    const demo = await env.DB.prepare(`SELECT id FROM users WHERE strava_athlete_id = ?`).bind(DEMO_ATHLETE_ID).first<{ id: number }>();
    if (!demo) return json({ error: 'No demo data yet. Run `npm run simulate`.' }, 404);
    return json({ ok: true }, 200, { 'set-cookie': await startSession(req, env, demo.id) });
  }

  const user = await currentUser(req, env);

  if (path === '/auth/logout' && method === 'POST') {
    const sid = getCookie(req, SESSION_COOKIE);
    if (sid) await env.DB.prepare(`DELETE FROM sessions WHERE id_hash = ?`).bind(await sha256Hex(sid)).run();
    return json({ ok: true }, 200, { 'set-cookie': setCookie(req, env, SESSION_COOKIE, '', 0) });
  }

  if (!user) {
    if (path.startsWith('/auth/')) return redirect(`${env.BASE_PATH}/`);
    return json({ error: 'signed out' }, 401);
  }

  if (path === '/api/me') return json(await me(env, user));
  if (path === '/api/insights') return json(await buildInsights(env, user));
  if (path === '/api/runs') return json(await listRuns(env, user));
  if (path === '/api/recent') return json(await recent(env, user));
  const runMatch = path.match(/^\/api\/runs\/(\d+)$/);
  if (runMatch) {
    const run = await getRun(env, user, Number(runMatch[1]));
    return run ? json(run) : json({ error: 'not found' }, 404);
  }

  // Everything below changes the account; the shared demo account is read-only.
  if (user.is_demo) return path.startsWith('/auth/') ? redirect(`${env.BASE_PATH}/`) : json({ error: 'The demo is read-only.' }, 403);

  if (path === '/auth/spotify' && method === 'GET') return authStart(req, env, 'spotify');
  if (path === '/auth/spotify/callback') return spotifyCallback(req, env, user, ctx);

  if (path === '/api/sync' && method === 'POST') {
    if (now() - (user.last_sync_at ?? 0) < 60) return json({ error: 'Synced a moment ago. Try again in a minute.' }, 429);
    await syncUser(env, user.id, { n: 20 }, { strava: true });
    return json({ ok: true });
  }

  if (path === '/api/spotify' && method === 'DELETE') {
    await env.DB.prepare(`DELETE FROM tokens WHERE user_id = ? AND provider = 'spotify'`).bind(user.id).run();
    return json({ ok: true });
  }

  if (path === '/api/account' && method === 'DELETE') {
    const token = await accessToken(env, user.id, 'strava', { n: 2 }).catch(() => null);
    if (token) await stravaDeauthorize(token).catch(() => {});
    await env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(user.id).run(); // cascades to everything
    return json({ ok: true }, 200, { 'set-cookie': setCookie(req, env, SESSION_COOKIE, '', 0) });
  }

  return json({ error: 'not found' }, 404);
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await route(req, env, ctx);
    } catch (err) {
      console.error(err);
      const path = new URL(req.url).pathname;
      if (path.includes('/auth/')) return redirect(`${env.BASE_PATH}/?error=failed`);
      return json({ error: 'Something went wrong.' }, 500);
    }
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(syncAll(env));
  },
} satisfies ExportedHandler<Env>;
