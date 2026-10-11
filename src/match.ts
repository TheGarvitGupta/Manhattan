// Pure logic for lining songs up against a run. Shared by the Worker and the
// simulator, so simulated data goes through exactly the same matching.

export interface Streams {
  t: number[]; // elapsed seconds since the run started
  d: number[]; // cumulative metres
  m: number[]; // cumulative moving seconds (excludes stops)
  hr: (number | null)[] | null;
}

export interface RawStreams {
  time: number[];
  distance: number[];
  moving?: boolean[];
  heartrate?: number[];
}

export interface Play {
  played_at: number; // unix seconds
  track_id: string;
  duration_s: number;
}

export interface RunSong {
  idx: number;
  track_id: string;
  start_s: number;
  end_s: number;
  distance_m: number;
  moving_s: number;
  avg_hr: number | null;
  skipped: boolean;
}

// Spotify's `played_at` is treated as the moment a track stopped playing.
// If real runs show songs shifted by one track length, flip this.
export const PLAYED_AT_IS_END = true;

const MIN_OVERLAP_S = 20;

/** Downsample Strava's per-second streams to one point every `step` seconds. */
export function normalizeStreams(raw: RawStreams, step = 5): Streams {
  const n = Math.min(raw.time.length, raw.distance.length);
  const out: Streams = { t: [], d: [], m: [], hr: raw.heartrate ? [] : null };
  let moving = 0;
  let lastKept = -Infinity;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const dt = raw.time[i] - raw.time[i - 1];
      const isMoving = raw.moving ? raw.moving[i] : raw.distance[i] > raw.distance[i - 1];
      if (isMoving) moving += dt;
    }
    if (raw.time[i] - lastKept >= step || i === n - 1) {
      out.t.push(raw.time[i]);
      out.d.push(Math.round(raw.distance[i] * 10) / 10);
      out.m.push(moving);
      out.hr?.push(raw.heartrate?.[i] ?? null);
      lastKept = raw.time[i];
    }
  }
  return out;
}

/** Linear interpolation of a cumulative stream at elapsed time `at`. */
export function interp(t: number[], values: number[], at: number): number {
  const n = t.length;
  if (n === 0) return 0;
  if (at <= t[0]) return values[0];
  if (at >= t[n - 1]) return values[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= at) lo = mid;
    else hi = mid;
  }
  const span = t[hi] - t[lo];
  const f = span > 0 ? (at - t[lo]) / span : 0;
  return values[lo] + (values[hi] - values[lo]) * f;
}

export interface SongInterval<T extends Play> {
  play: T;
  from: number; // unix seconds
  to: number;
  skipped: boolean;
}

/** When each play started and stopped, oldest first. */
export function songIntervals<T extends Play>(plays: T[]): SongInterval<T>[] {
  const sorted = [...plays].sort((a, b) => a.played_at - b.played_at);
  return sorted.map((p, i) => {
    if (PLAYED_AT_IS_END) {
      const to = p.played_at;
      const prevEnd = i > 0 ? sorted[i - 1].played_at : -Infinity;
      const from = Math.max(to - p.duration_s, prevEnd);
      return { play: p, from, to, skipped: i > 0 && to - from < p.duration_s * 0.9 };
    }
    const from = p.played_at;
    const nextStart = i < sorted.length - 1 ? sorted[i + 1].played_at : Infinity;
    const to = Math.min(from + p.duration_s, nextStart);
    return { play: p, from, to, skipped: to - from < p.duration_s * 0.9 };
  });
}

/**
 * Work out which song was playing during which part of a run.
 * `plays` should include a little history before the run so the first song's
 * start can be bounded by the track before it.
 */
export function matchSongs(startTime: number, s: Streams, plays: Play[]): RunSong[] {
  if (s.t.length < 2) return [];
  const total = s.t[s.t.length - 1];
  const songs: RunSong[] = [];

  for (const { play: p, from, to, skipped } of songIntervals(plays)) {
    const a = Math.max(0, from - startTime);
    const b = Math.min(total, to - startTime);
    if (b - a < MIN_OVERLAP_S) continue;

    let hrSum = 0;
    let hrN = 0;
    if (s.hr) {
      for (let k = 0; k < s.t.length; k++) {
        const v = s.hr[k];
        if (v != null && s.t[k] >= a && s.t[k] <= b) {
          hrSum += v;
          hrN++;
        }
      }
    }

    songs.push({
      idx: songs.length,
      track_id: p.track_id,
      start_s: Math.round(a),
      end_s: Math.round(b),
      distance_m: Math.round((interp(s.t, s.d, b) - interp(s.t, s.d, a)) * 10) / 10,
      moving_s: Math.round(interp(s.t, s.m, b) - interp(s.t, s.m, a)),
      avg_hr: hrN ? Math.round((hrSum / hrN) * 10) / 10 : null,
      skipped,
    });
  }
  return songs;
}
