// Pulls new songs and runs for a user, then lines them up.

import { bestStretch, matchSongs, MILE_M, normalizeStreams, Play, Streams } from './match';
import { accessToken, markRevoked, RUN_TYPES, spotifyRecentlyPlayed, stravaActivities, stravaStreams, stravaUnits } from './providers';
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

  const user = await env.DB.prepare(`SELECT created_at, units FROM users WHERE id = ?`).bind(userId).first<{ created_at: number; units: string | null }>();
  // Miles or kilometres follows the person's Strava setting. Asked once.
  if (user && user.units == null) {
    const units = await stravaUnits(token, budget);
    await env.DB.prepare(`UPDATE users SET units = ? WHERE id = ?`).bind(units ?? '-', userId).run();
  }
  // Runs from before someone joined have no songs to match, so they are skipped.
  const cutoff = (user?.created_at ?? now()) - FIRST_SYNC_LOOKBACK;
  const activities = await stravaActivities(token, budget);
  if (activities === null) {
    await markRevoked(env, userId, 'strava');
    return;
  }

  const stmts: D1PreparedStatement[] = [];
  for (const a of activities) {
    const type = a.sport_type ?? a.type;
    const start = Math.floor(Date.parse(a.start_date) / 1000);
    // Every activity is noted for the "recent activity" list; only runs are kept in full.
    stmts.push(
      env.DB.prepare(
        `INSERT INTO activities (user_id, strava_id, name, type, start_time, distance_m, elapsed_s) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, strava_id) DO UPDATE SET
           name = excluded.name, type = excluded.type, distance_m = excluded.distance_m, elapsed_s = excluded.elapsed_s`,
      ).bind(userId, a.id, a.name, type, start, a.distance ?? 0, a.elapsed_time ?? 0),
    );
    if (RUN_TYPES.has(type) && a.distance > 0 && start >= cutoff) {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO runs (user_id, strava_id, name, start_time, distance_m, moving_s, elapsed_s, avg_hr)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, strava_id) DO UPDATE SET name = excluded.name`,
        ).bind(userId, a.id, a.name, start, a.distance, a.moving_time, a.elapsed_time, a.average_heartrate ?? null),
      );
    }
  }
  stmts.push(
    env.DB.prepare(
      `DELETE FROM activities WHERE user_id = ?1 AND strava_id NOT IN
         (SELECT strava_id FROM activities WHERE user_id = ?1 ORDER BY start_time DESC LIMIT 60)`,
    ).bind(userId),
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
      const normalized = normalizeStreams(raw);
      const streams = JSON.stringify(normalized);
      const km = bestStretch(normalized, 1000);
      const mile = bestStretch(normalized, MILE_M);
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE runs SET streams = ?, stream_state = 'ok', matched_at = NULL,
             best_km_s = ?, best_km_at = ?, best_mi_s = ?, best_mi_at = ? WHERE id = ?`,
        ).bind(streams, km?.seconds ?? null, km?.at ?? null, mile?.seconds ?? null, mile?.at ?? null, run.id),
        env.DB.prepare(`UPDATE activities SET streams = ?, stream_state = 'ok' WHERE user_id = ? AND strava_id = ?`).bind(streams, userId, run.strava_id),
      ]);
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

  // Other activities only get their detailed data once there are songs to
  // show against it, which keeps both Strava requests and storage down.
  const withSongs = await env.DB.prepare(
    `SELECT a.strava_id FROM activities a
     WHERE a.user_id = ?1 AND a.stream_state = 'pending' AND a.elapsed_s > 0 AND a.start_time > ?2
       AND EXISTS (SELECT 1 FROM plays p WHERE p.user_id = a.user_id
                   AND p.played_at > a.start_time AND p.played_at <= a.start_time + a.elapsed_s + 600)
     ORDER BY a.start_time DESC LIMIT 3`,
  )
    .bind(userId, now() - 7 * DAY)
    .all<{ strava_id: number }>();

  for (const a of withSongs.results) {
    const raw = await stravaStreams(token, a.strava_id, budget);
    if (raw) {
      await env.DB.prepare(`UPDATE activities SET streams = ?, stream_state = 'ok' WHERE user_id = ? AND strava_id = ?`)
        .bind(JSON.stringify(normalizeStreams(raw)), userId, a.strava_id)
        .run();
    } else {
      await env.DB.prepare(
        `UPDATE activities SET stream_tries = stream_tries + 1,
           stream_state = CASE WHEN stream_tries >= 2 THEN 'none' ELSE 'pending' END
         WHERE user_id = ? AND strava_id = ?`,
      )
        .bind(userId, a.strava_id)
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

/**
 * The demo account's data would age out of the "last 7 days" view, so once a
 * day it is slid forward by a whole number of days (keeping times of day).
 */
async function refreshDemo(env: Env): Promise<void> {
  const demo = await env.DB.prepare(`SELECT id, last_sync_at FROM users WHERE is_demo = 1`).first<{ id: number; last_sync_at: number | null }>();
  if (!demo?.last_sync_at) return;
  const shift = Math.floor((now() - demo.last_sync_at) / DAY) * DAY;
  if (shift <= 0) return;
  await env.DB.batch([
    env.DB.prepare(`UPDATE runs SET start_time = start_time + ? WHERE user_id = ?`).bind(shift, demo.id),
    env.DB.prepare(`UPDATE activities SET start_time = start_time + ? WHERE user_id = ?`).bind(shift, demo.id),
    // played_at is part of the primary key: going via negatives avoids a row
    // briefly colliding with one that hasn't moved yet.
    env.DB.prepare(`UPDATE plays SET played_at = -(played_at + ?) WHERE user_id = ?`).bind(shift, demo.id),
    env.DB.prepare(`UPDATE plays SET played_at = -played_at WHERE user_id = ? AND played_at < 0`).bind(demo.id),
    env.DB.prepare(`UPDATE users SET last_sync_at = last_sync_at + ? WHERE id = ?`).bind(shift, demo.id),
  ]);
}

/** Cron entry point: sync the users who have waited longest, within the request budget. */
export async function syncAll(env: Env): Promise<void> {
  await refreshDemo(env).catch((err) => console.error('refresh demo:', err));
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
