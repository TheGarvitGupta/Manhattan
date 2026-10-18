// The picture of a run or ride in its email: the route on a map, each song's
// stretch of road in its own colour. Mail apps show no scripts, so Mapbox draws
// it as an image (its Static Images API). Emails link to it here, through the
// Worker, so the token stays out of them.

import { Streams } from './match';
import { Env, sha256Hex } from './util';

// One colour per song, in the order they played, each different from the next.
// Bright enough to stand out on the map's greens and blues.
export const SONG_COLORS = ['#6250d6', '#ef5a3c', '#e8a000', '#d63e9e', '#0e9f8e', '#2f6fe0', '#f07d1a', '#8e44ad', '#c8283c', '#5a9e1a'];
export const songColor = (i: number) => SONG_COLORS[i % SONG_COLORS.length];

// Strava's colours for the map, as on the app's activity page: outdoors shows parks green and water blue.
const STYLE = 'mapbox/outdoors-v12';
export const MAP_WIDTH = 600;
export const MAP_HEIGHT = 360;
// Mapbox refuses longer addresses.
const MAX_URL = 8000;

type Point = [number, number]; // [lat, lng]

/** Strava's encoded polyline, as [lat, lng] pairs. */
function decode(text: string): Point[] {
  const points: Point[] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const next = () => {
    let shift = 0;
    let value = 0;
    let byte;
    do {
      byte = text.charCodeAt(i++) - 63;
      value |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && i < text.length);
    return value & 1 ? ~(value >> 1) : value >> 1;
  };
  while (i < text.length) {
    lat += next();
    lng += next();
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

function encode(points: Point[]): string {
  let out = '';
  let lat = 0;
  let lng = 0;
  const put = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    while (n >= 0x20) {
      out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    out += String.fromCharCode(n + 63);
  };
  for (const [a, b] of points) {
    const [la, lo] = [Math.round(a * 1e5), Math.round(b * 1e5)];
    put(la - lat);
    put(lo - lng);
    [lat, lng] = [la, lo];
  }
  return out;
}

const RAD = Math.PI / 180;
/** Metres between two points, near enough for a run's length. */
function metres(a: Point, b: Point): number {
  const x = (b[1] - a[1]) * RAD * Math.cos(((a[0] + b[0]) / 2) * RAD);
  return Math.hypot(x, (b[0] - a[0]) * RAD) * 6371000;
}

/** Fewer points along the same line (Douglas–Peucker), none further than `tolerance` metres from it. */
function simplify(points: Point[], tolerance: number): Point[] {
  if (tolerance <= 0 || points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let worst = 0;
    let at = -1;
    const base = metres(points[s], points[e]) || 1e-9;
    for (let i = s + 1; i < e; i++) {
      // Distance from the chord, by the triangle's area.
      const [a, b, c] = [metres(points[s], points[i]), metres(points[i], points[e]), base];
      const p = (a + b + c) / 2;
      const d = (2 * Math.sqrt(Math.max(0, p * (p - a) * (p - b) * (p - c)))) / c;
      if (d > worst) [worst, at] = [d, i];
    }
    if (worst > tolerance) {
      keep[at] = 1;
      stack.push([s, at], [at, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** The value of ys at x, read off a rising series xs. */
function interp(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  let lo = 0;
  let hi = xs.length - 1;
  if (x >= xs[hi]) return ys[hi];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  return ys[lo] + ((ys[hi] - ys[lo]) * (x - xs[lo])) / (xs[hi] - xs[lo] || 1);
}

export interface MapSong {
  start_s: number;
  end_s: number;
}

/**
 * The Mapbox address for the route with its songs on it. The route has no
 * times of its own, so each song is placed by distance: how far in the
 * activity was when it began and ended, as a share of the whole, as on the
 * app's map. Null when there is no route to draw.
 */
export function mapboxUrl(token: string, polyline: string, streams: Streams | null, songs: MapSong[]): string | null {
  const full = decode(polyline);
  if (full.length < 2) return null;
  const total = streams && streams.t.length > 1 ? streams.d[streams.d.length - 1] : 0;

  // A long route is drawn with fewer points until the address fits.
  for (const tolerance of [0, 3, 6, 12, 25, 50, 100, 200]) {
    const route = simplify(full, tolerance);
    const along = [0];
    for (let i = 1; i < route.length; i++) along.push(along[i - 1] + metres(route[i - 1], route[i]));
    const length = along[along.length - 1] || 1;
    const at = (dist: number): Point => {
      const d = Math.max(0, Math.min(length, dist));
      let i = 1;
      while (i < route.length - 1 && along[i] < d) i++;
      const f = (d - along[i - 1]) / (along[i] - along[i - 1] || 1);
      return [route[i - 1][0] + (route[i][0] - route[i - 1][0]) * f, route[i - 1][1] + (route[i][1] - route[i - 1][1]) * f];
    };
    const stretch = (from: number, to: number): Point[] => [at(from), ...route.filter((_, i) => along[i] > from && along[i] < to), at(to)];

    const path = (width: number, color: string, points: Point[], opacity = 1) =>
      `path-${width}+${color.slice(1)}-${opacity}(${encodeURIComponent(encode(points))})`;
    // Overlays are laid in order: a white edge under the whole route, the route in grey, then the songs.
    const overlays = [path(9, '#ffffff', route, 0.95), path(3, '#77736b', route, 0.8)];
    if (total > 0) {
      songs.forEach((song, i) => {
        const from = (interp(streams!.t, streams!.d, song.start_s) / total) * length;
        const to = (interp(streams!.t, streams!.d, song.end_s) / total) * length;
        if (to - from >= 1) overlays.push(path(6, songColor(i), stretch(from, to)));
      });
    }
    const url = `https://api.mapbox.com/styles/v1/${STYLE}/static/${overlays.join(',')}/auto/${MAP_WIDTH}x${MAP_HEIGHT}@2x?padding=36&access_token=${encodeURIComponent(token)}`;
    if (url.length <= MAX_URL) return url;
  }
  return null;
}

// --- the address in the email ------------------------------------------------------

/** A run's picture is open to whoever has its link, which only its emails carry. */
async function signature(env: Env, runId: number): Promise<string> {
  return (await sha256Hex(`map:${runId}:${env.TOKEN_KEY}`)).slice(0, 24);
}

/** `songs` only tells caches apart: a run that gains a late song gets a new picture. */
export async function mapLink(env: Env, origin: string, runId: number, songs: number): Promise<string> {
  return `${origin}${env.BASE_PATH}/api/map/${runId}-${await signature(env, runId)}.png?v=${songs}`;
}

/** Serves /api/map/<run>-<signature>.png: the picture, made once and kept. */
export async function serveMap(env: Env, req: Request, runId: number, sig: string, ctx: ExecutionContext): Promise<Response> {
  if (!env.MAPBOX_TOKEN || sig !== (await signature(env, runId))) return new Response('not found', { status: 404 });
  const cache = caches.default;
  const hit = await cache.match(req);
  if (hit) return hit;

  const run = await env.DB.prepare(
    `SELECT r.streams, (SELECT polyline FROM activities WHERE user_id = r.user_id AND strava_id = r.strava_id) AS polyline
     FROM runs r WHERE r.id = ?`,
  )
    .bind(runId)
    .first<{ streams: string | null; polyline: string | null }>();
  if (!run?.polyline) return new Response('not found', { status: 404 });
  const songs = await env.DB.prepare(`SELECT start_s, end_s FROM run_songs WHERE run_id = ? ORDER BY idx`).bind(runId).all<MapSong>();
  const url = mapboxUrl(env.MAPBOX_TOKEN, run.polyline, run.streams ? (JSON.parse(run.streams) as Streams) : null, songs.results);
  if (!url) return new Response('not found', { status: 404 });

  // The token may be limited to the site's own pages, so the request says it comes from there.
  const image = await fetch(url, { headers: { referer: `${env.PUBLIC_ORIGIN ?? new URL(req.url).origin}${env.BASE_PATH}/` } });
  if (!image.ok) {
    console.error(`map ${runId}: Mapbox said ${image.status} ${(await image.text()).slice(0, 200)}`);
    return new Response('map unavailable', { status: 502 });
  }
  const res = new Response(image.body, {
    headers: { 'content-type': image.headers.get('content-type') ?? 'image/png', 'cache-control': 'public, max-age=2592000, immutable' },
  });
  ctx.waitUntil(cache.put(req, res.clone()));
  return res;
}
