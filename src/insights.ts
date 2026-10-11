// Turns runs + songs into the correlations shown on the dashboard.
//
// Song pace is always compared with the pace of the run it was heard on
// ("rel"), so a song that only comes up on easy days isn't unfairly "slow".

import type { Env, User } from './util';

const MIN_SEGMENT_S = 30;
// Everyone starts slow: a song that opens a run shouldn't be blamed for the warm-up.
const WARMUP_S = 120;

interface RunRow {
  id: number;
  start_time: number;
  distance_m: number;
  moving_s: number;
}

interface SongRow {
  run_id: number;
  track_id: string;
  start_s: number;
  distance_m: number;
  moving_s: number;
  avg_hr: number | null;
  skipped: number;
  name: string;
  artist: string;
  image: string | null;
}

/** Accumulates distance against what the run's own average pace would predict. */
class Bucket {
  moving = 0;
  distance = 0;
  expected = 0;
  runs = new Set<number>();
  add(distance: number, moving: number, runSpeed: number, runId: number) {
    this.moving += moving;
    this.distance += distance;
    this.expected += moving * runSpeed;
    this.runs.add(runId);
  }
  summary() {
    return {
      moving_s: Math.round(this.moving),
      runs: this.runs.size,
      speed: this.moving ? this.distance / this.moving : 0,
      rel: this.expected ? this.distance / this.expected - 1 : 0,
    };
  }
}

function group(runs: { distance_m: number; moving_s: number }[]) {
  const distance = runs.reduce((a, r) => a + r.distance_m, 0);
  const moving = runs.reduce((a, r) => a + r.moving_s, 0);
  return { n: runs.length, distance_m: runs.length ? distance / runs.length : 0, speed: moving ? distance / moving : 0 };
}

export async function buildInsights(env: Env, user: User) {
  const runs = (
    await env.DB.prepare(
      `SELECT id, start_time, distance_m, moving_s FROM runs
       WHERE user_id = ? AND stream_state = 'ok' AND moving_s > 0 ORDER BY start_time`,
    )
      .bind(user.id)
      .all<RunRow>()
  ).results;

  const rows = (
    await env.DB.prepare(
      `SELECT rs.run_id, rs.track_id, rs.start_s, rs.distance_m, rs.moving_s, rs.avg_hr, rs.skipped, t.name, t.artist, t.image
       FROM run_songs rs JOIN runs r ON r.id = rs.run_id JOIN tracks t ON t.id = rs.track_id
       WHERE r.user_id = ? ORDER BY r.start_time, rs.idx`,
    )
      .bind(user.id)
      .all<SongRow>()
  ).results;

  const perRun = new Map(runs.map((r) => [r.id, { ...r, speed: r.distance_m / r.moving_s, songs: 0, music_s: 0 }]));

  const songs = new Map<string, { b: Bucket; name: string; artist: string; image: string | null }>();
  const artists = new Map<string, Bucket>();
  const heard = new Map<string, number>();
  const fresh = new Bucket();
  const familiar = new Bucket();
  const skipped = new Bucket();
  const playedThrough = new Bucket();

  for (const row of rows) {
    const run = perRun.get(row.run_id);
    if (!run) continue;
    run.songs++;
    run.music_s += row.moving_s;
    if (row.moving_s < MIN_SEGMENT_S || row.start_s < WARMUP_S) continue;

    let song = songs.get(row.track_id);
    if (!song) songs.set(row.track_id, (song = { b: new Bucket(), name: row.name, artist: row.artist, image: row.image }));
    song.b.add(row.distance_m, row.moving_s, run.speed, run.id);

    // Credit the lead artist so "A, B" and "A" count together.
    const lead = row.artist.split(',')[0].trim();
    let artist = artists.get(lead);
    if (!artist) artists.set(lead, (artist = new Bucket()));
    artist.add(row.distance_m, row.moving_s, run.speed, run.id);

    const before = heard.get(row.track_id) ?? 0;
    if (before === 0) fresh.add(row.distance_m, row.moving_s, run.speed, run.id);
    else if (before >= 2) familiar.add(row.distance_m, row.moving_s, run.speed, run.id);
    heard.set(row.track_id, before + 1);

    (row.skipped ? skipped : playedThrough).add(row.distance_m, row.moving_s, run.speed, run.id);
  }

  // Songs need a few minutes on more than one run before they're ranked.
  const rank = (minS: number, minRuns: number) =>
    [...songs.entries()]
      .map(([track_id, s]) => ({ track_id, name: s.name, artist: s.artist, image: s.image, ...s.b.summary() }))
      .filter((s) => s.moving_s >= minS && s.runs >= minRuns)
      .sort((a, b) => b.rel - a.rel);
  let rankedSongs = rank(240, 2);
  if (rankedSongs.length < 4) rankedSongs = rank(120, 1);

  const rankedArtists = [...artists.entries()]
    .map(([artist, b]) => ({ artist, ...b.summary() }))
    .filter((a) => a.moving_s >= 600 && a.runs >= 2)
    .sort((a, b) => b.rel - a.rel);

  // Song changes: runs with music for most of the way, split at the median rate.
  const all = [...perRun.values()];
  const musical = all
    .filter((r) => r.songs >= 3 && r.music_s >= 0.5 * r.moving_s)
    .map((r) => ({ run_id: r.id, rate: r.songs / (r.music_s / 600), distance_m: r.distance_m, moving_s: r.moving_s, speed: r.speed }));
  let changes = null;
  if (musical.length >= 6) {
    const sorted = [...musical].sort((a, b) => a.rate - b.rate);
    const half = Math.floor(sorted.length / 2);
    const few = sorted.slice(0, half);
    const many = sorted.slice(sorted.length - half);
    const avgRate = (g: typeof sorted) => g.reduce((a, r) => a + r.rate, 0) / g.length;
    changes = {
      few: { ...group(few), rate: avgRate(few) },
      many: { ...group(many), rate: avgRate(many) },
      points: musical.map(({ run_id, rate, distance_m, speed }) => ({ run_id, rate, distance_m, speed })),
    };
  }

  // Music vs silence: only runs since Spotify was connected can count as silent.
  const withMusic = all.filter((r) => r.music_s >= 0.5 * r.moving_s);
  const silent = all.filter((r) => user.spotify_since != null && r.start_time >= user.spotify_since && r.music_s < 0.05 * r.moving_s);
  const music = withMusic.length >= 2 && silent.length >= 2 ? { with: group(withMusic), without: group(silent) } : null;

  const pair = (a: Bucket, b: Bucket) => (a.moving >= 600 && b.moving >= 600 ? [a.summary(), b.summary()] : null);
  const fam = pair(fresh, familiar);
  const skip = pair(skipped, playedThrough);

  return {
    totals: {
      runs: runs.length,
      runs_with_music: withMusic.length,
      distance_m: runs.reduce((a, r) => a + r.distance_m, 0),
      moving_s: runs.reduce((a, r) => a + r.moving_s, 0),
      music_s: Math.round(all.reduce((a, r) => a + r.music_s, 0)),
      tracks: songs.size,
    },
    songs: rankedSongs,
    artists: rankedArtists,
    changes,
    music,
    familiarity: fam && { fresh: fam[0], familiar: fam[1] },
    skipping: skip && { skipped: skip[0], played: skip[1] },
  };
}
