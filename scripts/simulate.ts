// Generates a simulated runner — runs with per-second pace and heart rate,
// plus a Spotify listening history — and loads it as the demo account.
//
//   npm run simulate                     local dev database
//   npm run simulate -- --remote         the deployed database
//   npm run simulate -- --runs 120 --weeks 40 --seed 7
//
// The data has real effects baked in (some songs and artists speed the runner
// up, restless song-skipping goes with shorter runs, music beats silence), so
// the dashboard has something true to find. Songs are matched to runs with the
// same code the live sync uses (src/match.ts).

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { matchSongs, Play, Streams } from '../src/match';

const args = process.argv.slice(2);
const flag = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const REMOTE = args.includes('--remote');
const RUNS = flag('runs', 72);
const WEEKS = flag('weeks', 26);
const SEED = flag('seed', 1);

// Small seeded PRNG so a given seed always produces the same runner.
let state = SEED >>> 0;
const rand = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (a: number, b: number) => a + rand() * (b - a);
const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

// --- a fictional music library ----------------------------------------------

const ARTISTS = [
  'Neon Harbor', 'Violet Static', 'The Paper Lanterns', 'Juno Vale', 'Glass Cathedral', 'Marlowe & Finch',
  'Sable Coast', 'Kite Season', 'Odessa Run', 'Low Tide Choir', 'Atlas Minor', 'Honeywire',
];
const TITLES = [
  'Afterglow', 'Northbound', 'Paper Planes at Dawn', 'Second Wind', 'Static Bloom', 'Long Way Round',
  'Copper Sky', 'Hold the Line', 'Slow Burn', 'Overpass', 'Golden Hour', 'Run It Back',
  'Halogen', 'Side Streets', 'Weightless', 'Last Mile', 'Borrowed Time', 'Riverside',
  'Open Road', 'Night Shift', 'Wildfire Season', 'Quiet Engine', 'Sugar Rush', 'Undertow',
  'High Tide', 'Featherweight', 'Daylight Savings', 'Kerosene', 'Soft Landing', 'Tailwind',
  'Blue Hour', 'Echo Park', 'Marathon Heart', 'Small Hours', 'Lightning Bug', 'Homestretch',
];

interface Track {
  id: string;
  name: string;
  artist: string;
  image: string;
  duration: number;
  boost: number; // fractional effect on pace while this plays
  weight: number; // how often it comes up
}

function cover(i: number): string {
  const h = (i * 47) % 360;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0' stop-color='hsl(${h} 70% 62%)'/><stop offset='1' stop-color='hsl(${(h + 60) % 360} 65% 38%)'/></linearGradient></defs>` +
    `<rect width='64' height='64' fill='url(#g)'/><circle cx='${18 + ((i * 13) % 28)}' cy='${20 + ((i * 7) % 24)}' r='${8 + (i % 9)}' fill='white' fill-opacity='.22'/></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

const artistBoost = ARTISTS.map(() => gauss() * 0.012);
const tracks: Track[] = TITLES.map((name, i) => {
  const a = i % ARTISTS.length;
  return {
    id: `sim:${i}`,
    name,
    artist: ARTISTS[a],
    image: cover(i),
    duration: Math.round(between(150, 265)),
    boost: artistBoost[a] + gauss() * 0.022,
    weight: 0.3 + rand() ** 2 * 3,
  };
});

function nextTrack(recent: string[]): Track {
  const pool = tracks.filter((t) => !recent.includes(t.id));
  let r = rand() * pool.reduce((a, t) => a + t.weight, 0);
  for (const t of pool) if ((r -= t.weight) <= 0) return t;
  return pool[pool.length - 1];
}

// --- runs -------------------------------------------------------------------

const STEP = 5;
const NOW = Math.floor(Date.now() / 1000);
const KINDS = [
  { name: 'Easy Run', km: [5, 8], pace: 345 },
  { name: 'Easy Run', km: [5, 8], pace: 345 },
  { name: 'Tempo Run', km: [6, 9], pace: 305 },
  { name: 'Long Run', km: [12, 18], pace: 360 },
];
const PARTS = ['Morning', 'Lunch', 'Evening'];

interface SimRun {
  name: string;
  start: number;
  streams: Streams;
  plays: Play[];
  distance: number;
  moving: number;
  elapsed: number;
  avgHr: number;
}

function simulateRun(index: number): SimRun {
  const progress = index / Math.max(1, RUNS - 1); // 0 = oldest
  const part = Math.floor(rand() * 3);
  const start = Math.floor(NOW - (1 - progress) * WEEKS * 7 * 86400 - between(0, 86400) - 3600) - (2 - part) * 5 * 3600;
  const kind = pick(KINDS);

  const silent = rand() < 0.15;
  const restless = rand(); // 0 = lets songs play, 1 = skips constantly
  // Restless days tend to be shorter days.
  const targetM = between(kind.km[0], kind.km[1]) * 1000 * (silent ? 1 : 1.18 - 0.36 * restless);
  // Fitness improves ~4% over the period; music is worth ~2%.
  const base = (1000 / kind.pace) * (0.98 + 0.04 * progress) * (silent ? 0.98 : 1) * (1 + gauss() * 0.015);

  // The playlist starts a little before the run does.
  const plays: Play[] = [];
  let songEnd = start - between(0, 90);
  let current: Track | null = null;
  const recent: string[] = [];
  const stops = [between(0.2, 0.5), between(0.55, 0.9)].filter(() => rand() < 0.45).map((f) => ({ at: f, left: between(15, 60) }));

  const altitude = (at: number) => Math.round((24 + 14 * Math.sin(at / 620 + index + 1.6) + 5 * Math.sin(at / 170)) * 10) / 10;
  const s: Streams = { t: [0], d: [0], m: [0], hr: [Math.round(between(95, 110))], c: [0], a: [altitude(0)] };
  let t = 0;
  let d = 0;
  let m = 0;
  let wobble = 0;
  let hr = s.hr![0]!;
  let hrSum = 0;

  while (d < targetM) {
    const clock = start + t;
    if (!silent && clock >= songEnd) {
      current = nextTrack(recent);
      recent.push(current.id);
      if (recent.length > 8) recent.shift();
      const skip = rand() < 0.04 + 0.5 * restless;
      songEnd = Math.max(songEnd, clock) + (skip ? current.duration * between(0.3, 0.75) : current.duration);
      plays.push({ played_at: Math.round(songEnd), track_id: current.id, duration_s: current.duration });
    }

    const stop = stops.find((x) => d / targetM >= x.at && x.left > 0);
    let v = 0;
    if (stop) {
      stop.left -= STEP;
    } else {
      wobble = 0.85 * wobble + gauss() * 0.012;
      const frac = d / targetM;
      const warmup = Math.min(1, 0.9 + t / 1800);
      const fatigue = 1 - 0.05 * frac * frac;
      const hills = 1 + 0.025 * Math.sin(d / 620 + index);
      v = base * warmup * fatigue * hills * (1 + wobble) * (1 + (current?.boost ?? 0));
      m += STEP;
    }
    t += STEP;
    d += v * STEP;
    const targetHr = v === 0 ? 118 : 150 + 190 * (v / (1000 / 330) - 1) + 14 * (d / targetM);
    hr += (targetHr - hr) * 0.12 + gauss() * 0.6;
    hrSum += hr;
    s.t.push(t);
    s.d.push(Math.round(d * 10) / 10);
    s.m.push(m);
    s.hr!.push(Math.round(hr));
    // One-foot cadence, as Strava reports it for runs.
    s.c!.push(v === 0 ? 0 : Math.round(83 + 22 * (v / base - 1) + gauss() * 0.8));
    s.a!.push(altitude(d));
  }

  return { name: `${PARTS[part]} ${kind.name}`, start, streams: s, plays, distance: d, moving: m, elapsed: t, avgHr: hrSum / (s.t.length - 1) };
}

// --- emit SQL ---------------------------------------------------------------

const q = (v: string | number | null) => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${v.replace(/'/g, "''")}'`);
const USER = `(SELECT id FROM users WHERE strava_athlete_id = -1)`;

const sql: string[] = [
  // Deleting the demo user cascades to its runs, songs and plays.
  `DELETE FROM users WHERE strava_athlete_id = -1;`,
  `INSERT INTO users (strava_athlete_id, name, is_demo, spotify_since, last_sync_at, created_at) VALUES (-1, 'Demo Runner', 1, 0, ${NOW}, ${NOW});`,
];
for (const t of tracks) {
  sql.push(
    `INSERT OR REPLACE INTO tracks (id, name, artist, album, image, duration_s) VALUES (${q(t.id)}, ${q(t.name)}, ${q(t.artist)}, NULL, ${q(t.image)}, ${t.duration});`,
  );
}

let songCount = 0;
for (let i = 0; i < RUNS; i++) {
  const run = simulateRun(i);
  const stravaId = -(i + 1);
  sql.push(
    `INSERT INTO runs (user_id, strava_id, name, start_time, distance_m, moving_s, elapsed_s, avg_hr, stream_state, streams, matched_at) VALUES ` +
      `(${USER}, ${stravaId}, ${q(run.name)}, ${run.start}, ${run.distance.toFixed(1)}, ${run.moving}, ${run.elapsed}, ${run.avgHr.toFixed(1)}, 'ok', ${q(JSON.stringify(run.streams))}, ${NOW});`,
  );
  for (const p of run.plays) {
    sql.push(`INSERT OR IGNORE INTO plays (user_id, played_at, track_id) VALUES (${USER}, ${p.played_at}, ${q(p.track_id)});`);
  }
  const songs = matchSongs(run.start, run.streams, run.plays);
  songCount += songs.length;
  if (songs.length) {
    const RUN = `(SELECT id FROM runs WHERE user_id = ${USER} AND strava_id = ${stravaId})`;
    sql.push(
      `INSERT INTO run_songs (run_id, idx, track_id, start_s, end_s, distance_m, moving_s, avg_hr, skipped) VALUES ` +
        songs.map((s) => `(${RUN}, ${s.idx}, ${q(s.track_id)}, ${s.start_s}, ${s.end_s}, ${s.distance_m}, ${s.moving_s}, ${q(s.avg_hr)}, ${s.skipped ? 1 : 0})`).join(', ') +
        ';',
    );
  }
}

mkdirSync('.sim', { recursive: true });
writeFileSync('.sim/demo.sql', sql.join('\n') + '\n');
console.log(`Simulated ${RUNS} runs over ${WEEKS} weeks with ${songCount} songs (seed ${SEED}).`);

// What the simulator baked in, to check the dashboard against.
const byBoost = [...tracks].sort((a, b) => b.boost - a.boost);
const show = (t: Track) => `  ${(t.boost * 100).toFixed(1).padStart(5)}%  ${t.name} — ${t.artist}`;
console.log('Fastest songs by design:\n' + byBoost.slice(0, 3).map(show).join('\n'));
console.log('Slowest songs by design:\n' + byBoost.slice(-3).map(show).join('\n'));

execFileSync('npx', ['wrangler', 'd1', 'execute', 'cadence', REMOTE ? '--remote' : '--local', '--file=.sim/demo.sql', '--yes'], {
  stdio: ['ignore', 'ignore', 'inherit'],
});
console.log(`Loaded into the ${REMOTE ? 'remote' : 'local'} database. Open the app and choose "See the demo".`);
