// Cadence: which songs make you run faster?
// Routes live under env.BASE_PATH (/cadence) so the app can sit on the main site.

import { accessRequestEmail, buildEmail, canSend, EmailUser, FROM, hasPatterns, Kind, send, sendActivityEmails, sendWeekly, Variant } from './emails';
import { buildInsights } from './insights';
import { SongInterval, songIntervals } from './match';
import { accessToken, authorizeUrl, exchangeSpotifyCode, exchangeStravaCode, Provider, saveTokens, Sport, stravaDeauthorize } from './providers';
import { serveMap } from './staticmap';
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

/** The app's owner, named by Strava athlete id in wrangler.jsonc. Only they see the admin page. */
const isOwner = (env: Env, user: User) => !user.is_demo && !!env.OWNER_STRAVA_ID && String(user.strava_athlete_id) === env.OWNER_STRAVA_ID;

/** Everyone who has signed in, with what they have connected, which emails they get, and how much Cadence holds for them. */
async function admin(env: Env) {
  const users = await env.DB.prepare(
    `SELECT u.id, u.strava_athlete_id, u.name, u.avatar, u.created_at, u.last_sync_at, u.units,
            u.email, u.email_confirmed_at, u.email_weekly, u.activity_emails, u.welcome_sent_at, u.weekly_sent_at,
            (SELECT MAX(emailed_at) FROM runs WHERE user_id = u.id) AS activity_sent_at,
            st.status AS strava_status, st.last_sync_at AS strava_synced, st.last_error AS strava_error,
            sp.status AS spotify_status, sp.last_sync_at AS spotify_synced, sp.last_error AS spotify_error,
            (SELECT COUNT(*) FROM runs WHERE user_id = u.id AND sport = 'run') AS runs,
            (SELECT COUNT(*) FROM runs WHERE user_id = u.id AND sport = 'ride') AS rides,
            (SELECT COUNT(*) FROM runs r WHERE r.user_id = u.id AND EXISTS (SELECT 1 FROM run_songs WHERE run_id = r.id)) AS with_music,
            (SELECT COUNT(*) FROM plays WHERE user_id = u.id) AS plays,
            (SELECT MAX(start_time) FROM activities WHERE user_id = u.id) AS last_activity,
            (SELECT MAX(expires_at) FROM sessions WHERE user_id = u.id) AS session_until
     FROM users u
     LEFT JOIN tokens st ON st.user_id = u.id AND st.provider = 'strava'
     LEFT JOIN tokens sp ON sp.user_id = u.id AND sp.provider = 'spotify'
     WHERE u.is_demo = 0 ORDER BY u.created_at DESC`,
  ).all();
  const requests = await env.DB.prepare(
    `SELECT a.id, a.user_id, u.name, a.spotify_email, a.message, a.created_at FROM access_requests a JOIN users u ON u.id = a.user_id
     ORDER BY a.created_at DESC LIMIT 50`,
  ).all();
  return { users: users.results, requests: requests.results, session_ttl: SESSION_TTL };
}

async function me(env: Env, user: User) {
  const tokens = await env.DB.prepare(`SELECT provider, status, last_sync_at, last_error FROM tokens WHERE user_id = ?`)
    .bind(user.id)
    .all<{ provider: Provider; status: string; last_sync_at: number | null; last_error: string | null }>();
  const counts = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM runs WHERE user_id = ?1 AND sport = 'run') AS runs,
            (SELECT COUNT(*) FROM runs WHERE user_id = ?1 AND sport = 'ride') AS rides,
            (SELECT COUNT(*) FROM plays WHERE user_id = ?1) AS plays`,
  )
    .bind(user.id)
    .first<{ runs: number; rides: number; plays: number }>();
  // The earliest thing held for this person: their first song or first run.
  const since = await env.DB.prepare(
    `SELECT MIN(t) AS t FROM (SELECT MIN(played_at) AS t FROM plays WHERE user_id = ?1
                               UNION ALL SELECT MIN(start_time) FROM runs WHERE user_id = ?1)`,
  )
    .bind(user.id)
    .first<{ t: number | null }>();
  const asked = await env.DB.prepare(`SELECT 1 FROM access_requests WHERE user_id = ? AND created_at > ? LIMIT 1`).bind(user.id, now() - 30 * 86400).first();
  const lastNote = await env.DB.prepare(`SELECT MAX(emailed_at) AS t FROM runs WHERE user_id = ?`).bind(user.id).first<{ t: number | null }>();
  const e = user as EmailUser;
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
    mapbox: env.MAPBOX_TOKEN ?? null,
    // The owner sees what every email looks like; everyone else only their own settings.
    owner: isOwner(env, user),
    // Whether they have already asked the owner to be added to Spotify.
    access_requested: !!asked,
    email: {
      available: canSend(env),
      address: e.email ?? null,
      confirmed: !!e.email_confirmed_at,
      // Which they get. An address is asked for before anything else; the demo has none and needs none.
      weekly: !!e.email_weekly,
      activity: !!e.activity_emails,
      required: !user.is_demo && !e.email,
      // When each last went out.
      sent: { welcome: e.welcome_sent_at ?? null, weekly: e.weekly_sent_at ?? null, activity: lastNote?.t ?? null },
    },
  };
}

async function listRuns(env: Env, user: User, sport: Sport) {
  const runs = await env.DB.prepare(
    `SELECT r.id, r.name, r.start_time, r.distance_m, r.moving_s, r.avg_hr,
            (SELECT COUNT(*) FROM run_songs WHERE run_id = r.id) AS songs
     FROM runs r WHERE r.user_id = ? AND r.sport = ? AND r.stream_state = 'ok' ORDER BY r.start_time DESC LIMIT 200`,
  )
    .bind(user.id, sport)
    .all();
  return { runs: runs.results };
}

async function getRun(env: Env, user: User, id: number) {
  const run = await env.DB.prepare(
    `SELECT id, sport, name, start_time, distance_m, moving_s, elapsed_s, avg_hr, streams FROM runs
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

// The most plays and activities the Activity lists carry. Far more than anyone has yet.
const PLAYS_SHOWN = 6000;
const ACTIVITIES_SHOWN = 1000;

/**
 * Every activity (of any type) and every song Cadence has seen. Each activity
 * comes with the songs that were playing during it, and for how long.
 */
async function recent(env: Env, user: User) {
  const activities = (
    await env.DB.prepare(
      `SELECT a.strava_id AS id, a.name, a.type, a.start_time, a.elapsed_s, a.distance_m,
              (SELECT id FROM runs WHERE user_id = a.user_id AND strava_id = a.strava_id AND stream_state = 'ok') AS run_id
       FROM activities a WHERE a.user_id = ? ORDER BY a.start_time DESC LIMIT ?`,
    )
      .bind(user.id, ACTIVITIES_SHOWN)
      .all<RecentActivity>()
  ).results;

  const plays = await recast(
    env,
    user,
    (
      await env.DB.prepare(
        `SELECT p.played_at, p.track_id, t.duration_s, t.name, t.artist, t.image
         FROM plays p JOIN tracks t ON t.id = p.track_id
         WHERE p.user_id = ? ORDER BY p.played_at DESC LIMIT ?`,
      )
        .bind(user.id, PLAYS_SHOWN)
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

  // Oldest first, so one pass can hand each activity the songs that overlap it.
  const intervals = songIntervals(plays);
  const withSongs = [];
  let first = intervals.length;
  for (const a of activities) {
    // Activities come newest first, so the first song that could overlap only ever moves back.
    const end = a.start_time + a.elapsed_s;
    while (first > 0 && intervals[first - 1].to > a.start_time) first--;
    const songs = [];
    for (let k = first; k < intervals.length && intervals[k].from < end; k++) {
      const i = intervals[k];
      if (Math.min(i.to, end) - Math.max(i.from, a.start_time) >= 10) songs.push(describe(i, Math.max(i.from, a.start_time), Math.min(i.to, end)));
    }
    withSongs.push({ ...a, songs });
  }
  return { songs: intervals.reverse().map((i) => describe(i)), activities: withSongs };
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
    // Turning off keeps the address: it stops the emails, and "only=activity" stops just the note after each activity.
    const only = !confirm && url.searchParams.get('only') === 'activity';
    if (token && token !== 'preview') {
      await (confirm
        ? env.DB.prepare(`UPDATE users SET email_confirmed_at = COALESCE(email_confirmed_at, ?) WHERE email_token = ?`).bind(now(), token)
        : only
          ? env.DB.prepare(`UPDATE users SET activity_emails = 0 WHERE email_token = ?`).bind(token)
          : env.DB.prepare(`UPDATE users SET email_weekly = 0, activity_emails = 0 WHERE email_token = ?`).bind(token)
      ).run();
    }
    return redirect(`${env.BASE_PATH}/?email=${confirm ? 'confirmed' : only ? 'sundays' : 'off'}`);
  }

  // The picture of a route in an email. Mail apps fetch it without signing in; its link is signed instead.
  const mapMatch = path.match(/^\/api\/map\/(-?\d+)-([0-9a-f]+)\.png$/);
  if (mapMatch && method === 'GET') return serveMap(env, req, Number(mapMatch[1]), mapMatch[2], ctx);

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
  // Running and biking are analysed apart; ?sport=ride asks for the rides.
  const sport: Sport = url.searchParams.get('sport') === 'ride' ? 'ride' : 'run';
  if (path === '/api/insights') return json(await buildInsights(env, user, sport));
  if (path === '/api/runs') return json(await listRuns(env, user, sport));
  if (path === '/api/recent') return json(await recent(env, user));
  if (path === '/api/admin' && method === 'GET') return isOwner(env, user) ? json(await admin(env)) : json({ error: 'not found' }, 404);

  // Previews of the emails, built from this account's own data.
  const emailMatch = path.match(/^\/api\/emails\/(welcome|weekly|activity)(\/html)?$/);
  if (emailMatch && method === 'GET') {
    if (!isOwner(env, user)) return json({ error: 'not found' }, 404);
    const variant = url.searchParams.get('variant');
    // Times in a preview follow the viewer's own timezone.
    let viewer = { ...(user as EmailUser), email_tz: (user as EmailUser).email_tz ?? url.searchParams.get('tz') };
    // An account without pace data yet can't fill the patterns email, nor one without a run or ride with
    // music the activity email, so those previews borrow the demo runner's data and say so.
    let example = false;
    const borrow = async () => {
      const demo = await env.DB.prepare(`SELECT * FROM users WHERE is_demo = 1`).first<EmailUser>();
      if (!demo) return false;
      viewer = { ...demo, email_tz: viewer.email_tz, email_token: null };
      return (example = true);
    };
    if (emailMatch[1] === 'weekly' && variant === 'patterns' && !(await hasPatterns(env, user))) await borrow();
    const opts = {
      unit: url.searchParams.get('units') ?? undefined,
      variant: variant === 'collecting' || variant === 'patterns' ? (variant as Variant) : undefined,
    };
    let email = await buildEmail(env, url.origin, viewer, emailMatch[1] as Kind, opts);
    if (!email && !example && (await borrow())) email = await buildEmail(env, url.origin, viewer, emailMatch[1] as Kind, opts);
    if (!email) return json({ error: 'Nothing to show yet.' }, 404);
    if (emailMatch[2]) {
      // Shown in a sandboxed frame: email needs inline styles, which the app's own pages forbid.
      return new Response(email.html, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'content-security-policy': "default-src 'none'; img-src https: data: 'self'; style-src 'unsafe-inline'",
        },
      });
    }
    return json({ subject: email.subject, preview: email.preview, from: FROM, to: (user as EmailUser).email ?? user.name, example });
  }
  const activityMatch = path.match(/^\/api\/activities\/(-?\d+)$/);
  if (activityMatch) {
    // Per-second data for one activity (runs fall back to their own copy), and its route where it has one.
    const row = await env.DB.prepare(
      `SELECT (SELECT polyline FROM activities WHERE user_id = ?1 AND strava_id = ?2) AS polyline, COALESCE(
         (SELECT streams FROM activities WHERE user_id = ?1 AND strava_id = ?2),
         (SELECT streams FROM runs WHERE user_id = ?1 AND strava_id = ?2)) AS streams`,
    )
      .bind(user.id, Number(activityMatch[1]))
      .first<{ streams: string | null; polyline: string | null }>();
    return json({ streams: row?.streams ? JSON.parse(row.streams) : null, polyline: row?.polyline ?? null });
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
    const owner = await env.DB.prepare(`SELECT email FROM users WHERE strava_athlete_id = ? AND is_demo = 0`).bind(Number(env.OWNER_STRAVA_ID ?? 0)).first<{ email: string | null }>();
    if (owner?.email) await send(env, owner.email, accessRequestEmail(env, url.origin, user, address, message), undefined, address).catch(console.error);
    return json({ ok: true });
  }

  // The address, asked for at sign-up, and which emails go to it. Saved even while sending is off.
  if (path === '/api/email' && method === 'POST') {
    const me = user as EmailUser;
    const body = (await req.json().catch(() => ({}))) as { email?: string; tz?: string; units?: string; weekly?: boolean; activity?: boolean };
    const address = (body.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || address.length > 254) return json({ error: 'That email address does not look right.' }, 400);
    const changed = address !== me.email;
    const settled = (me.welcome_sent_at ?? 0) < now() - 600;
    if (changed && !settled) return json({ error: 'Please wait a few minutes before changing it again.' }, 429);
    // A new address needs confirming, through a welcome email; so does one that never was, if its welcome is not just out.
    const welcome = canSend(env) && (changed || (!me.email_confirmed_at && settled));
    const token = changed || !me.email_token ? randomToken(16) : me.email_token;
    const activity = !!body.activity;
    await env.DB.prepare(
      `UPDATE users SET email = ?1, email_token = ?2, email_tz = ?3, email_units = ?4,
         email_weekly = ?5, activity_emails = ?6,
         activity_emails_since = CASE WHEN ?6 AND NOT activity_emails THEN ?7 ELSE activity_emails_since END,
         email_confirmed_at = CASE WHEN ?8 THEN NULL ELSE email_confirmed_at END WHERE id = ?9`,
    )
      .bind(address, token, (body.tz ?? 'UTC').slice(0, 64), body.units === 'mi' ? 'mi' : 'km', body.weekly === false ? 0 : 1, activity ? 1 : 0, now(), changed ? 1 : 0, user.id)
      .run();
    if (welcome) {
      // The welcome email carries the confirm button; the others wait for it.
      const email = await buildEmail(env, url.origin, { ...me, email: address, email_token: token, email_weekly: body.weekly === false ? 0 : 1, activity_emails: activity ? 1 : 0 }, 'welcome');
      if (email && (await send(env, address, email, `${url.origin}${env.BASE_PATH}/auth/email/off?t=${token}`))) {
        await env.DB.prepare(`UPDATE users SET welcome_sent_at = ? WHERE id = ?`).bind(now(), user.id).run();
      }
    }
    return json({ ok: true });
  }

  // Turning emails off keeps the address.
  if (path === '/api/email' && method === 'DELETE') {
    await env.DB.prepare(`UPDATE users SET email_weekly = 0, activity_emails = 0 WHERE id = ?`).bind(user.id).run();
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
    ctx.waitUntil(sendActivityEmails(env, env.PUBLIC_ORIGIN ?? 'https://www.garvitgupta.com').catch(console.error));
  },
} satisfies ExportedHandler<Env>;
