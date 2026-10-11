// Pulls new songs and runs for a user, then lines them up.

import { matchSongs, normalizeStreams, Play, Streams } from './match';
import { accessToken, markRevoked, RUN_TYPES, spotifyRecentlyPlayed, stravaActivities, stravaStreams } from './providers';
import { Budget, BudgetExceeded, Env, now, RateLimited } from './util';

const DAY = 86400;
// Spotify can't backfill history, so runs older than this never have songs.
const FIRST_SYNC_LOOKBACK = 3 * DAY;
const STREAMS_PER_SYNC = 5;
const REMATCH_WINDOW = 12 * 3600;

async function setSyncResult(env: Env, userId: number, provider: string, error: string | null): Promise<void> {
  await env.DB.prepare(`UPDATE tokens SET last_sync_at = ?, last_error = ? WHERE user_id = ? AND provider = ?`)
    .bind(now(), error, userId, provider)
    .run();
}

async function syncSpotify(env: Env, userId: number, budget: Budget): Promise<void> {
  const token = await accessToken(env, userId, 'spotify', budget);
  if (!token) return;

  const last = await env.DB.prepare(`SELECT MAX(played_at) AS t FROM plays WHERE user_id = ?`).bind(userId).first<{ t: number | null }>();
  const afterMs = ((last?.t ?? now() - DAY) + 1) * 1000;
  const items = await spotifyRecentlyPlayed(token, afterMs, budget);
  if (items === null) {
    await markRevoked(env, userId, 'spotify');
    return;
  }
  if (items === 'not-allowed') {
    // Stop retrying until they reconnect, which they should do once added.
    await env.DB.prepare(`UPDATE tokens SET status = 'not-allowed' WHERE user_id = ? AND provider = 'spotify'`).bind(userId).run();
    return;
  }

  const stmts: D1PreparedStatement[] = [];
  for (const item of items) {
    const tr = item.track;
    if (!tr?.id) continue; // local files have no id
    const images = tr.album?.images ?? [];
    // The smallest image is plenty for thumbnails.
    const image = images.length ? images[images.length - 1].url : null;
    stmts.push(
      env.DB.prepare(
        `INSERT INTO tracks (id, name, artist, album, image, duration_s) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, artist = excluded.artist, image = excluded.image`,
      ).bind(tr.id, tr.name, tr.artists.map((a) => a.name).join(', '), tr.album?.name ?? null, image, tr.duration_ms / 1000),
      env.DB.prepare(`INSERT OR IGNORE INTO plays (user_id, played_at, track_id) VALUES (?, ?, ?)`).bind(
        userId,
        Math.floor(Date.parse(item.played_at) / 1000),
        tr.id,
      ),
    );
  }
  if (stmts.length) await env.DB.batch(stmts);
  await setSyncResult(env, userId, 'spotify', null);
}

async function syncStrava(env: Env, userId: number, budget: Budget): Promise<void> {
  const token = await accessToken(env, userId, 'strava', budget);
  if (!token) return;

  const row = await env.DB.prepare(`SELECT last_sync_at FROM tokens WHERE user_id = ? AND provider = 'strava'`)
    .bind(userId)
    .first<{ last_sync_at: number | null }>();
  // Look back a little past the last sync: activities can be uploaded late.
  const after = row?.last_sync_at ? row.last_sync_at - 2 * DAY : now() - FIRST_SYNC_LOOKBACK;
  const activities = await stravaActivities(token, after, budget);
  if (activities === null) {
    await markRevoked(env, userId, 'strava');
    return;
  }

  const stmts = activities
    .filter((a) => RUN_TYPES.has(a.sport_type ?? a.type) && a.distance > 0)
    .map((a) =>
      env.DB.prepare(
        `INSERT INTO runs (user_id, strava_id, name, start_time, distance_m, moving_s, elapsed_s, avg_hr)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, strava_id) DO UPDATE SET name = excluded.name`,
      ).bind(userId, a.id, a.name, Math.floor(Date.parse(a.start_date) / 1000), a.distance, a.moving_time, a.elapsed_time, a.average_heartrate ?? null),
    );
  if (stmts.length) await env.DB.batch(stmts);

  const pending = await env.DB.prepare(
    `SELECT id, strava_id FROM runs WHERE user_id = ? AND stream_state = 'pending' ORDER BY start_time DESC LIMIT ?`,
  )
    .bind(userId, STREAMS_PER_SYNC)
    .all<{ id: number; strava_id: number }>();

  for (const run of pending.results) {
    const raw = await stravaStreams(token, run.strava_id, budget);
    if (raw) {
      await env.DB.prepare(`UPDATE runs SET streams = ?, stream_state = 'ok', matched_at = NULL WHERE id = ?`)
        .bind(JSON.stringify(normalizeStreams(raw)), run.id)
        .run();
    } else {
      // Streams can lag the upload slightly; give up after a few tries.
      await env.DB.prepare(
        `UPDATE runs SET stream_tries = stream_tries + 1,
           stream_state = CASE WHEN stream_tries >= 2 THEN 'none' ELSE 'pending' END WHERE id = ?`,
      )
        .bind(run.id)
        .run();
    }
  }
  await setSyncResult(env, userId, 'strava', null);
}

/** (Re)compute run_songs for runs that are new or recent enough to gain songs. */
export async function matchRuns(env: Env, userId: number): Promise<void> {
  const runs = await env.DB.prepare(
    `SELECT id, start_time, elapsed_s, streams FROM runs
     WHERE user_id = ? AND stream_state = 'ok' AND (matched_at IS NULL OR start_time > ?)`,
  )
    .bind(userId, now() - REMATCH_WINDOW)
    .all<{ id: number; start_time: number; elapsed_s: number; streams: string }>();

  for (const run of runs.results) {
    const streams = JSON.parse(run.streams) as Streams;
    // A little history before the start bounds the first song; a song that
    // finishes after the run ended still overlapped it.
    const plays = await env.DB.prepare(
      `SELECT p.played_at, p.track_id, t.duration_s FROM plays p JOIN tracks t ON t.id = p.track_id
       WHERE p.user_id = ? AND p.played_at > ? AND p.played_at <= ? ORDER BY p.played_at`,
    )
      .bind(userId, run.start_time - 1200, run.start_time + run.elapsed_s + 900)
      .all<Play>();

    const songs = matchSongs(run.start_time, streams, plays.results);
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM run_songs WHERE run_id = ?`).bind(run.id),
      ...songs.map((s) =>
        env.DB.prepare(
          `INSERT INTO run_songs (run_id, idx, track_id, start_s, end_s, distance_m, moving_s, avg_hr, skipped)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(run.id, s.idx, s.track_id, s.start_s, s.end_s, s.distance_m, s.moving_s, s.avg_hr, s.skipped ? 1 : 0),
      ),
      env.DB.prepare(`UPDATE runs SET matched_at = ? WHERE id = ?`).bind(now(), run.id),
    ]);
  }
}

export interface SyncOptions {
  strava: boolean;
}

export async function syncUser(env: Env, userId: number, budget: Budget, opts: SyncOptions): Promise<void> {
  // Songs first, so a run that just finished is matched against fresh plays.
  for (const [provider, run] of [
    ['spotify', () => syncSpotify(env, userId, budget)],
    ['strava', () => (opts.strava ? syncStrava(env, userId, budget) : Promise.resolve())],
  ] as const) {
    try {
      await run();
    } catch (err) {
      if (err instanceof BudgetExceeded) throw err;
      await setSyncResult(env, userId, provider, String(err instanceof Error ? err.message : err).slice(0, 200));
      if (err instanceof RateLimited) continue;
      console.error(`sync ${provider} user ${userId}:`, err);
    }
  }
  await matchRuns(env, userId);
  await env.DB.prepare(`UPDATE users SET last_sync_at = ? WHERE id = ?`).bind(now(), userId).run();
}

/** Cron entry point: sync the users who have waited longest, within the request budget. */
export async function syncAll(env: Env): Promise<void> {
  const budget: Budget = { n: 40 };
  const stravaEvery = Number(env.STRAVA_POLL_MINUTES ?? 30) * 60;

  const users = await env.DB.prepare(
    `SELECT u.id, (SELECT last_sync_at FROM tokens WHERE user_id = u.id AND provider = 'strava') AS strava_synced
     FROM users u WHERE u.is_demo = 0 ORDER BY COALESCE(u.last_sync_at, 0) LIMIT 15`,
  ).all<{ id: number; strava_synced: number | null }>();

  for (const u of users.results) {
    try {
      await syncUser(env, u.id, budget, { strava: !u.strava_synced || now() - u.strava_synced >= stravaEvery });
    } catch (err) {
      if (err instanceof BudgetExceeded) break; // the rest go first next tick
      console.error(`sync user ${u.id}:`, err);
    }
  }

  await env.DB.prepare(`DELETE FROM sessions WHERE expires_at < ?`).bind(now()).run();
}
