// Turns runs (or rides) + songs into what the dashboard shows. One sport at a time:
// a ride's speeds have nothing to say about a run's, so each gets its own analysis.
//
// Comparisons ("rel") measure a song against the pace of the run it was heard
// on, so a song that only comes up on easy days isn't unfairly "slow". The
// plain lists (fastest, most played, ...) use straightforward averages.

import { Sport } from './providers';
import { Env, now, recast, User } from './util';

const MIN_SEGMENT_S = 30;
// Everyone starts slow: a song that opens a run shouldn't be blamed for the warm-up.
const WARMUP_S = 120;
const TOP = 5;

interface RunRow {
  id: number;
  start_time: number;
  distance_m: number;
  moving_s: number;
  avg_hr: number | null;
  best_km_s: number | null;
  best_km_at: number | null;
  best_mi_s: number | null;
  best_mi_at: number | null;
}

interface SongRow {
  run_id: number;
  idx: number;
  track_id: string;
  start_s: number;
  end_s: number;
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

/** Everything known about one song across all runs. */
class Song {
  plays = 0;
  skipped = 0;
  runs = new Set<number>();
  moving = 0;
  distance = 0;
  // Pace and heart rate leave out warm-up and very short stretches.
  paceMoving = 0;
  paceDistance = 0;
  paceRuns = new Set<number>();
  hrSum = 0;
  hrWeight = 0;
  runDistance = 0;
  firstSeen = Infinity;
  opened = 0;
  constructor(
    readonly track_id: string,
    readonly name: string,
    readonly artist: string,
    readonly image: string | null,
  ) {}
  get base() {
    return { track_id: this.track_id, name: this.name, artist: this.artist, image: this.image };
  }
  get speed() {
    return this.paceMoving ? this.paceDistance / this.paceMoving : 0;
  }
}

function group(runs: { distance_m: number; moving_s: number }[]) {
  const distance = runs.reduce((a, r) => a + r.distance_m, 0);
  const moving = runs.reduce((a, r) => a + r.moving_s, 0);
  return { n: runs.length, distance_m: runs.length ? distance / runs.length : 0, speed: moving ? distance / moving : 0 };
}

/** Applies the strict rule; if that leaves too few songs to be worth showing, the loose one. */
function eligible(songs: Song[], strict: (s: Song) => boolean, loose: (s: Song) => boolean): Song[] {
  const first = songs.filter(strict);
  return first.length >= 4 ? first : songs.filter(loose);
}

export async function buildInsights(env: Env, user: User, sport: Sport = 'run') {
  const runs = (
    await env.DB.prepare(
      `SELECT id, start_time, distance_m, moving_s, avg_hr, best_km_s, best_km_at, best_mi_s, best_mi_at FROM runs
       WHERE user_id = ? AND sport = ? AND stream_state = 'ok' AND moving_s > 0 ORDER BY start_time`,
    )
      .bind(user.id, sport)
      .all<RunRow>()
  ).results;

  const rows = await recast(
    env,
    user,
    (
      await env.DB.prepare(
        `SELECT rs.run_id, rs.idx, rs.track_id, rs.start_s, rs.end_s, rs.distance_m, rs.moving_s, rs.avg_hr, rs.skipped,
                t.name, t.artist, t.image
         FROM run_songs rs JOIN runs r ON r.id = rs.run_id JOIN tracks t ON t.id = rs.track_id
         WHERE r.user_id = ? AND r.sport = ? ORDER BY r.start_time, rs.idx`,
      )
        .bind(user.id, sport)
        .all<SongRow>()
    ).results,
  );

  const perRun = new Map(runs.map((r) => [r.id, { ...r, speed: r.distance_m / r.moving_s, songs: 0, music_s: 0 }]));

  const songs = new Map<string, Song>();
  const artistRel = new Map<string, Bucket>();
  const artistTime = new Map<string, number>();
  const heard = new Map<string, number>();
  const fresh = new Bucket();
  const familiar = new Bucket();
  const skipped = new Bucket();
  const playedThrough = new Bucket();
  const firstSongs = new Set<number>();

  for (const row of rows) {
    const run = perRun.get(row.run_id);
    if (!run) continue;
    run.songs++;
    run.music_s += row.moving_s;

    let song = songs.get(row.track_id);
    if (!song) songs.set(row.track_id, (song = new Song(row.track_id, row.name, row.artist, row.image)));
    song.plays++;
    song.skipped += row.skipped ? 1 : 0;
    song.runs.add(run.id);
    song.moving += row.moving_s;
    song.distance += row.distance_m;
    song.runDistance += run.distance_m;
    song.firstSeen = Math.min(song.firstSeen, run.start_time);
    if (!firstSongs.has(run.id)) {
      firstSongs.add(run.id);
      song.opened++;
    }

    // Credit the lead artist so "A, B" and "A" count together.
    const lead = row.artist.split(',')[0].trim();
    artistTime.set(lead, (artistTime.get(lead) ?? 0) + row.moving_s);

    if (row.moving_s < MIN_SEGMENT_S || row.start_s < WARMUP_S) continue;

    song.paceMoving += row.moving_s;
    song.paceDistance += row.distance_m;
    song.paceRuns.add(run.id);
    if (row.avg_hr != null) {
      song.hrSum += row.avg_hr * row.moving_s;
      song.hrWeight += row.moving_s;
    }

    let artist = artistRel.get(lead);
    if (!artist) artistRel.set(lead, (artist = new Bucket()));
    artist.add(row.distance_m, row.moving_s, run.speed, run.id);

    const before = heard.get(row.track_id) ?? 0;
    if (before === 0) fresh.add(row.distance_m, row.moving_s, run.speed, run.id);
    else if (before >= 2) familiar.add(row.distance_m, row.moving_s, run.speed, run.id);
    heard.set(row.track_id, before + 1);

    (row.skipped ? skipped : playedThrough).add(row.distance_m, row.moving_s, run.speed, run.id);
  }

  const all = [...songs.values()];

  // --- plain lists -------------------------------------------------------------

  // Songs need a few minutes on more than one run before their pace is ranked.
  const paced = eligible(all, (s) => s.paceMoving >= 240 && s.paceRuns.size >= 2, (s) => s.paceMoving >= 120);
  const byPace = [...paced].sort((a, b) => b.speed - a.speed);
  const paceRow = (s: Song) => ({ ...s.base, speed: s.speed, moving_s: Math.round(s.paceMoving) });
  const fastest = byPace.slice(0, TOP).map(paceRow);
  // Never list a song as both fastest and slowest.
  const slowest = byPace.slice(Math.max(TOP, byPace.length - TOP)).reverse().map(paceRow);

  const mostPlayed = [...all]
    .sort((a, b) => b.plays - a.plays || b.moving - a.moving)
    .slice(0, TOP)
    .map((s) => ({ ...s.base, plays: s.plays, runs: s.runs.size }));

  const furthest = [...all]
    .sort((a, b) => b.distance - a.distance)
    .slice(0, TOP)
    .map((s) => ({ ...s.base, distance_m: Math.round(s.distance) }));

  const withHr = eligible(all, (s) => s.hrWeight >= 240 && s.paceRuns.size >= 2, (s) => s.hrWeight >= 120);
  const byHr = withHr.map((s) => ({ ...s.base, hr: s.hrSum / s.hrWeight })).sort((a, b) => b.hr - a.hr);
  const heart = { high: byHr.slice(0, TOP), low: byHr.slice(Math.max(TOP, byHr.length - TOP)).reverse() };

  const repeated = eligible(all, (s) => s.plays >= 4, (s) => s.plays >= 2);
  const skipRow = (s: Song) => ({ ...s.base, plays: s.plays, skipped: s.skipped, rate: s.skipped / s.plays });
  const bySkip = [...repeated].sort((a, b) => b.skipped / b.plays - a.skipped / a.plays || b.plays - a.plays);
  const skips = {
    most: bySkip.filter((s) => s.skipped > 0).slice(0, TOP).map(skipRow),
    least: [...repeated].sort((a, b) => a.skipped / a.plays - b.skipped / b.plays || b.plays - a.plays).slice(0, TOP).map(skipRow),
  };

  // The songs that tend to be on when the run is a long one.
  const longRun = [...repeated]
    .map((s) => ({ ...s.base, run_m: s.runDistance / s.plays, plays: s.plays }))
    .sort((a, b) => b.run_m - a.run_m)
    .slice(0, TOP);

  const monthAgo = now() - 30 * 86400;
  const newThisMonth = all.some((s) => s.firstSeen < monthAgo) // only meaningful once there is a "before"
    ? all
        .filter((s) => s.firstSeen >= monthAgo && s.paceMoving >= 60)
        .sort((a, b) => b.moving - a.moving)
        .slice(0, TOP)
        .map(paceRow)
    : [];

  const topArtists = [...artistTime.entries()]
    .map(([artist, moving_s]) => ({ artist, moving_s: Math.round(moving_s) }))
    .sort((a, b) => b.moving_s - a.moving_s)
    .slice(0, TOP);

  const opener = [...all].sort((a, b) => b.opened - a.opened)[0];

  // The fastest single kilometre and mile, and what was playing through the middle of each.
  const quickest = (seconds: (r: RunRow) => number | null, at: (r: RunRow) => number | null) => {
    const run = runs.filter((r) => seconds(r) != null).sort((a, b) => seconds(a)! - seconds(b)!)[0];
    if (!run) return null;
    const middle = at(run)! + seconds(run)! / 2;
    const playing = rows.find((r) => r.run_id === run.id && r.start_s <= middle && middle < r.end_s);
    return {
      seconds: seconds(run),
      run_id: run.id,
      start_time: run.start_time,
      song: playing ? { name: playing.name, artist: playing.artist, image: playing.image } : null,
    };
  };
  const bestKm = quickest((r) => r.best_km_s, (r) => r.best_km_at);
  const bestMile = quickest((r) => r.best_mi_s, (r) => r.best_mi_at);

  // --- comparisons ---------------------------------------------------------------

  const rankedArtists = [...artistRel.entries()]
    .map(([artist, b]) => ({ artist, ...b.summary() }))
    .filter((a) => a.moving_s >= 600 && a.runs >= 2)
    .sort((a, b) => b.rel - a.rel);

  // Song changes: runs with music for most of the way, split at the median rate.
  const everyRun = [...perRun.values()];
  const musical = everyRun
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
  const withMusic = everyRun.filter((r) => r.music_s >= 0.5 * r.moving_s);
  const silent = everyRun.filter((r) => user.spotify_since != null && r.start_time >= user.spotify_since && r.music_s < 0.05 * r.moving_s);
  const music = withMusic.length >= 2 && silent.length >= 2 ? { with: group(withMusic), without: group(silent) } : null;

  const pair = (a: Bucket, b: Bucket) => (a.moving >= 600 && b.moving >= 600 ? [a.summary(), b.summary()] : null);
  const fam = pair(fresh, familiar);
  const skip = pair(skipped, playedThrough);

  // Average heart rate across all runs, weighted by how long each lasted.
  const withRate = runs.filter((r) => r.avg_hr != null);
  const hrTime = withRate.reduce((a, r) => a + r.moving_s, 0);
  const hrTotal = withRate.reduce((a, r) => a + r.avg_hr! * r.moving_s, 0);

  return {
    sport,
    totals: {
      runs: runs.length,
      runs_with_music: withMusic.length,
      distance_m: runs.reduce((a, r) => a + r.distance_m, 0),
      moving_s: runs.reduce((a, r) => a + r.moving_s, 0),
      music_s: Math.round(everyRun.reduce((a, r) => a + r.music_s, 0)),
      tracks: songs.size,
      avg_hr: hrTime ? hrTotal / hrTime : null,
    },
    most_played: mostPlayed,
    fastest,
    slowest,
    furthest,
    heart,
    skips,
    long_run: longRun,
    new_this_month: newThisMonth,
    top_artists: topArtists,
    opener: opener && opener.opened >= 2 ? { ...opener.base, count: opener.opened } : null,
    best_km: bestKm,
    best_mile: bestMile,
    // For the week-by-week chart, which the browser buckets in local time.
    per_run: everyRun.map((r) => ({ t: r.start_time, music_s: Math.round(r.music_s) })),
    artists: rankedArtists,
    changes,
    music,
    familiarity: fam && { fresh: fam[0], familiar: fam[1] },
    skipping: skip && { skipped: skip[0], played: skip[1] },
  };
}
