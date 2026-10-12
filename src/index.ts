// Cadence: which songs make you run faster?
// Routes live under env.BASE_PATH (/cadence) so the app can sit on the main site.

import { accessRequestEmail, buildEmail, canSend, EmailUser, FROM, hasPatterns, Kind, send, sendWeekly, Variant } from './emails';
import { buildInsights } from './insights';
import { SongInterval, songIntervals } from './match';
import { accessToken, authorizeUrl, exchangeSpotifyCode, exchangeStravaCode, Provider, saveTokens, stravaDeauthorize } from './providers';
import { syncAll, syncUser } from './sync';
import { Env, getCookie, json, now, randomToken, recast, redirect, setCookie, sha256Hex, User } from './util';

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
  // Permissions may have changed, so fetch the past week's detailed data afresh.
  await env.DB.prepare(
    `UPDATE activities SET stream_state = 'pending', stream_tries = 0 WHERE user_id = ? AND start_time > ?`,
  )
    .bind(user!.id, now() - 7 * 86400)
    .run();
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
  // The earliest thing held for this person: their first song or first run.
  const since = await env.DB.prepare(
    `SELECT MIN(t) AS t FROM (SELECT MIN(played_at) AS t FROM plays WHERE user_id = ?1
                               UNION ALL SELECT MIN(start_time) FROM runs WHERE user_id = ?1)`,
  )
    .bind(user.id)
    .first<{ t: number | null }>();
  const asked = await env.DB.prepare(`SELECT 1 FROM access_requests WHERE user_id = ? AND created_at > ? LIMIT 1`).bind(user.id, now() - 30 * 86400).first();
  const conn = (p: Provider) => {
    const t = tokens.results.find((x) => x.provider === p);
    // The demo account has data but no real connections.
    if (user.is_demo) return { connected: true, ok: true, not_allowed: false, last_sync_at: null, error: null };
    return { connected: !!t, ok: t?.status === 'ok', not_allowed: t?.status === 'not-allowed', last_sync_at: t?.last_sync_at ?? null, error: t?.last_error ?? null };
  };
  return {
    user: { name: user.name, avatar: user.avatar, is_demo: !!user.is_demo },
    // Their Strava setting, when known.
    units: user.units === 'mi' || user.units === 'km' ? user.units : null,
    strava: conn('strava'),
    spotify: conn('spotify'),
    counts,
    since: since?.t ?? null,
    // Whether they have already asked the owner to be added to Spotify.
    access_requested: !!asked,
    email: { available: canSend(env), address: (user as EmailUser).email ?? null, confirmed: !!(user as EmailUser).email_confirmed_at },
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
    .all<{ name: string; artist: string; image: string | null }>();
  return { ...run, streams: JSON.parse(run.streams), songs: await recast(env, user, songs.results) };
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

const RECENT_DAYS = 7;

/**
 * Every activity (of any type) and song from the last week. Each activity
 * comes with the songs that were playing during it, and for how long.
 */
async function recent(env: Env, user: User) {
  const since = now() - RECENT_DAYS * 86400;
  const activities = (
    await env.DB.prepare(
      `SELECT a.strava_id AS id, a.name, a.type, a.start_time, a.elapsed_s, a.distance_m,
              (SELECT id FROM runs WHERE user_id = a.user_id AND strava_id = a.strava_id AND stream_state = 'ok') AS run_id
       FROM activities a WHERE a.user_id = ? AND a.start_time >= ? ORDER BY a.start_time DESC LIMIT 60`,
    )
      .bind(user.id, since)
      .all<RecentActivity>()
  ).results;

  const playsBetween = async (from: number, to: number, limit: number) =>
    recast(
      env,
      user,
      (
        await env.DB.prepare(
          `SELECT p.played_at, p.track_id, t.duration_s, t.name, t.artist, t.image
           FROM plays p JOIN tracks t ON t.id = p.track_id
           WHERE p.user_id = ? AND p.played_at > ? AND p.played_at <= ? ORDER BY p.played_at DESC LIMIT ?`,
        )
          .bind(user.id, from, to, limit)
          .all<RecentPlay>()
      ).results,
    );
  const describe = (i: SongInterval<RecentPlay>, from = i.from, to = i.to) => ({
    name: i.play.name,
    artist: i.play.artist,
    image: i.play.image,
    from: Math.round(from),
    to: Math.round(to),
    skipped: i.skipped,
  });

  // An hour of earlier plays bounds the start of the oldest song shown.
  const songs = songIntervals(await playsBetween(since - 3600, now() + 60, 1500))
    .filter((i) => i.to >= since)
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

  // Links inside emails carry their own token, so they work without signing in.
  if ((path === '/auth/email/confirm' || path === '/auth/email/off') && (method === 'GET' || method === 'POST')) {
    const token = url.searchParams.get('t') ?? '';
    const confirm = path.endsWith('confirm');
    if (token && token !== 'preview') {
      await env.DB.prepare(
        confirm
          ? `UPDATE users SET email_confirmed_at = COALESCE(email_confirmed_at, ?1) WHERE email_token = ?2`
          : `UPDATE users SET email = NULL, email_confirmed_at = NULL, email_token = NULL WHERE email_token = ?2 AND ?1 > 0`,
      )
        .bind(now(), token)
        .run();
    }
    return redirect(`${env.BASE_PATH}/?email=${confirm ? 'confirmed' : 'off'}`);
  }

  // Anything that changes state must come from our own pages.
  if (method !== 'GET' && req.headers.get('origin') !== url.origin) return json({ error: 'bad origin' }, 403);

  if (path === '/auth/strava' && method === 'GET') return authStart(req, env, 'strava');
  if (path === '/auth/strava/callback') return stravaCallback(req, env, ctx);

  if (path === '/auth/demo' && method === 'POST') {
    const demo = await env.DB.prepare(`SELECT id FROM users WHERE strava_athlete_id = ?`).bind(DEMO_ATHLETE_ID).first<{ id: number }>();
    if (!demo) return json({ error: 'No demo data yet. Run `npm run simulate`.' }, 404);
    return json({ ok: true }, 200, { 'set-cookie': await startSession(req, env, demo.id) });
  }

  // A few covers for the picture on the front page, drawn at random from the demo's songs. Open to all: it is shown signed out.
  if (path === '/api/covers' && method === 'GET') {
    const covers = await env.DB.prepare(
      `SELECT image FROM tracks WHERE id LIKE 'sim:%' AND image LIKE 'https://%' ORDER BY RANDOM() LIMIT 6`,
    ).all<{ image: string }>();
    return json({ covers: covers.results.map((c) => c.image) });
  }

  const user = await currentUser(req, env);
  // The demo's songs are dealt afresh each time the page is opened: the page makes up a word and sends it with every request.
  if (user?.is_demo) {
    const cast = req.headers.get('x-cadence-cast') ?? url.searchParams.get('cast') ?? '';
    if (/^[a-z0-9]{1,24}$/.test(cast)) user.cast = cast;
  }

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

  // Previews of the emails, built from this account's own data.
  const emailMatch = path.match(/^\/api\/emails\/(welcome|weekly)(\/html)?$/);
  if (emailMatch && method === 'GET') {
    const variant = url.searchParams.get('variant');
    // Times in a preview follow the viewer's own timezone.
    let viewer = { ...(user as EmailUser), email_tz: (user as EmailUser).email_tz ?? url.searchParams.get('tz') };
    // An account without pace data yet can't fill the patterns email, so that
    // preview borrows the demo runner's data and says so.
    let example = false;
    if (emailMatch[1] === 'weekly' && variant === 'patterns' && !(await hasPatterns(env, user))) {
      const demo = await env.DB.prepare(`SELECT * FROM users WHERE is_demo = 1`).first<EmailUser>();
      if (demo) {
        viewer = { ...demo, email_tz: viewer.email_tz, email_token: null };
        example = true;
      }
    }
    const email = await buildEmail(env, url.origin, viewer, emailMatch[1] as Kind, {
      unit: url.searchParams.get('units') ?? undefined,
      variant: variant === 'collecting' || variant === 'patterns' ? (variant as Variant) : undefined,
    });
    if (emailMatch[2]) {
      // Shown in a sandboxed frame: email needs inline styles, which the app's own pages forbid.
      return new Response(email.html, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'content-security-policy': "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'",
        },
      });
    }
    return json({ subject: email.subject, preview: email.preview, from: FROM, to: (user as EmailUser).email ?? user.name, example });
  }
  const activityMatch = path.match(/^\/api\/activities\/(-?\d+)$/);
  if (activityMatch) {
    // Per-second data for one activity; runs fall back to their own copy.
    const row = await env.DB.prepare(
      `SELECT COALESCE(
         (SELECT streams FROM activities WHERE user_id = ?1 AND strava_id = ?2),
         (SELECT streams FROM runs WHERE user_id = ?1 AND strava_id = ?2)) AS streams`,
    )
      .bind(user.id, Number(activityMatch[1]))
      .first<{ streams: string | null }>();
    return json({ streams: row?.streams ? JSON.parse(row.streams) : null });
  }
  const runMatch = path.match(/^\/api\/runs\/(\d+)$/);
  if (runMatch) {
    const run = await getRun(env, user, Number(runMatch[1]));
    return run ? json(run) : json({ error: 'not found' }, 404);
  }

  // Everything below changes the account; the shared demo account is read-only.
  if (user.is_demo) return path.startsWith('/auth/') ? redirect(`${env.BASE_PATH}/`) : json({ error: 'The demo is read-only.' }, 403);

  if (path === '/auth/spotify' && method === 'GET') return authStart(req, env, 'spotify');
  if (path === '/auth/spotify/callback') return spotifyCallback(req, env, user, ctx);

  if (path === '/api/access-request' && method === 'POST') {
    const body = (await req.json().catch(() => ({}))) as { email?: string; message?: string };
    const address = (body.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || address.length > 254) return json({ error: 'That email address does not look right.' }, 400);
    const recent = await env.DB.prepare(`SELECT 1 FROM access_requests WHERE user_id = ? AND created_at > ? LIMIT 1`).bind(user.id, now() - 86400).first();
    if (recent) return json({ error: 'You already asked today. Give it a little time.' }, 429);
    const message = (body.message ?? '').trim().slice(0, 500);
    await env.DB.prepare(`INSERT INTO access_requests (user_id, spotify_email, message, created_at) VALUES (?, ?, ?, ?)`)
      .bind(user.id, address, message || null, now())
      .run();
    // The owner is whoever set the app up: the first real account with an email on it.
    const owner = await env.DB.prepare(`SELECT email FROM users WHERE is_demo = 0 AND email IS NOT NULL ORDER BY id LIMIT 1`).first<{ email: string }>();
    if (owner) await send(env, owner.email, accessRequestEmail(env, url.origin, user, address, message), undefined, address).catch(console.error);
    return json({ ok: true });
  }

  if (path === '/api/email' && method === 'POST') {
    if (!canSend(env)) return json({ error: 'Email updates are not switched on yet.' }, 503);
    const me = user as EmailUser;
    const body = (await req.json().catch(() => ({}))) as { email?: string; tz?: string; units?: string };
    const address = (body.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || address.length > 254) return json({ error: 'That email address does not look right.' }, 400);
    if (me.welcome_sent_at && now() - me.welcome_sent_at < 600 && address !== me.email) return json({ error: 'Please wait a few minutes before changing it again.' }, 429);
    const token = randomToken(16);
    const changed = address !== me.email;
    await env.DB.prepare(
      `UPDATE users SET email = ?, email_token = ?, email_tz = ?, email_units = ?, welcome_sent_at = ?,
         email_confirmed_at = CASE WHEN ? THEN NULL ELSE email_confirmed_at END WHERE id = ?`,
    )
      .bind(address, token, (body.tz ?? 'UTC').slice(0, 64), body.units === 'mi' ? 'mi' : 'km', now(), changed ? 1 : 0, user.id)
      .run();
    // The welcome email carries the confirm button; the roundup waits for it.
    const fresh = { ...me, email: address, email_token: token };
    const email = await buildEmail(env, url.origin, fresh, 'welcome');
    await send(env, address, email, `${url.origin}${env.BASE_PATH}/auth/email/off?t=${token}`);
    return json({ ok: true });
  }

  if (path === '/api/email' && method === 'DELETE') {
    await env.DB.prepare(`UPDATE users SET email = NULL, email_confirmed_at = NULL, email_token = NULL WHERE id = ?`).bind(user.id).run();
    return json({ ok: true });
  }

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
    ctx.waitUntil(sendWeekly(env, env.PUBLIC_ORIGIN ?? 'https://www.garvitgupta.com').catch(console.error));
  },
} satisfies ExportedHandler<Env>;
