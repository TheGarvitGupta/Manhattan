// The picture of a run or ride in its email: the route on a map, each song's
// stretch of road in its cover's color, with the covers pinned where they fit. Mail apps show no scripts, so Mapbox draws
// it as an image (its Static Images API). Emails link to it here, through the
// Worker, so the token stays out of them.

import { coverColors, NO_COVER, pinLink } from './covers';
import { Streams } from './match';
import { Env, sha256Hex } from './util';

// Strava's colors for the map, as on the app's activity page: outdoors shows parks green and water blue.
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
  color: string;
  // Its framed cover, to pin where it played when there is room.
  pin: string | null;
}

// A cover is pinned where its stretch is this long on the map, and no closer than this to another (CSS pixels).
const PIN_ROOM = 38;
const PIN_APART = 30;
const PAD = 36;

/**
 * The Mapbox address for the route with its songs on it. The route has no
 * times of its own, so each song is placed by distance: how far in the
 * activity was when it began and ended, as a share of the whole, as on the
 * app's map. Null when there is no route to draw.
 */
export function mapboxUrl(token: string, polyline: string, streams: Streams | null, songs: MapSong[], pins = true): string | null {
  const full = decode(polyline);
  if (full.length < 2) return null;
  const total = streams && streams.t.length > 1 ? streams.d[streams.d.length - 1] : 0;

  // Roughly how many CSS pixels a metre will be once Mapbox has fitted the route, to know where a cover has room.
  const lats = full.map((p) => p[0]);
  const lngs = full.map((p) => p[1]);
  const [south, north, west, east] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const wide = metres([south, west], [south, east]) || 1;
  const tall = metres([south, west], [north, west]) || 1;
  const scale = Math.min((MAP_WIDTH - 2 * PAD) / wide, (MAP_HEIGHT - 2 * PAD) / tall);
  const screen = (p: Point): [number, number] => [metres([p[0], west], p) * Math.sign(p[1] - west) * scale, metres([south, p[1]], p) * Math.sign(p[0] - south) * scale];

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
    // Overlays are laid in order: the road without music thin and grey on a white edge, then the songs, then their covers.
    const overlays = [path(7, '#ffffff', route, 0.9), path(2.5, '#4a4a48', route, 0.7)];
    const markers: string[] = [];
    const placed: [number, number][] = [];
    if (total > 0) {
      const stretches = songs
        .map((song) => ({
          song,
          from: (interp(streams!.t, streams!.d, song.start_s) / total) * length,
          to: (interp(streams!.t, streams!.d, song.end_s) / total) * length,
        }))
        .filter((x) => x.to - x.from >= 1);
      for (const x of stretches) overlays.push(path(6, x.song.color, stretch(x.from, x.to)));
      // The longest stretches are pinned first, so the covers that fit are the songs that played longest.
      for (const x of [...stretches].sort((a, b) => b.to - b.from - (a.to - a.from))) {
        if (!pins || !x.song.pin || (x.to - x.from) * scale < PIN_ROOM) continue;
        const mid = at((x.from + x.to) / 2);
        const [sx, sy] = screen(mid);
        if (placed.some(([px, py]) => Math.hypot(px - sx, py - sy) < PIN_APART)) continue;
        placed.push([sx, sy]);
        markers.push(`url-${encodeURIComponent(x.song.pin)}(${mid[1].toFixed(5)},${mid[0].toFixed(5)})`);
      }
    }
    const url = `https://api.mapbox.com/styles/v1/${STYLE}/static/${[...overlays, ...markers].join(',')}/auto/${MAP_WIDTH}x${MAP_HEIGHT}@2x?padding=${PAD}&access_token=${encodeURIComponent(token)}`;
    if (url.length <= MAX_URL) return url;
  }
  return pins ? mapboxUrl(token, polyline, streams, songs, false) : null;
}

// --- the address in the email ------------------------------------------------------

/** A run's picture is open to whoever has its link, which only its emails carry. */
async function signature(env: Env, runId: number): Promise<string> {
  return (await sha256Hex(`map:${runId}:${env.TOKEN_KEY}`)).slice(0, 24);
}

// Raised whenever the map is drawn differently, so pictures already cached are drawn again.
const DESIGN = 2;

/** `songs` only tells caches apart: a run that gains a late song gets a new picture. */
export async function mapLink(env: Env, origin: string, runId: number, songs: number): Promise<string> {
  return `${origin}${env.BASE_PATH}/api/map/${runId}-${await signature(env, runId)}.png?v=${songs}&d=${DESIGN}`;
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
  const rows = (
    await env.DB.prepare(`SELECT rs.start_s, rs.end_s, t.image FROM run_songs rs JOIN tracks t ON t.id = rs.track_id WHERE rs.run_id = ? ORDER BY rs.idx`)
      .bind(runId)
      .all<{ start_s: number; end_s: number; image: string | null }>()
  ).results;
  // The same colors as the email that links here, worked out when it was written.
  const { colors } = await coverColors(env, rows.map((r) => r.image));
  // Mapbox fetches the pins from the live site, so a map drawn anywhere else goes without them.
  const origin = env.PUBLIC_ORIGIN ?? new URL(req.url).origin;
  const songs: MapSong[] = await Promise.all(
    rows.map(async (r) => {
      const color = (r.image && colors.get(r.image)) || NO_COVER;
      return { start_s: r.start_s, end_s: r.end_s, color, pin: r.image ? await pinLink(env, origin, r.image, color) : null };
    }),
  );
  const streams = run.streams ? (JSON.parse(run.streams) as Streams) : null;

  // The token may be limited to the site's own pages, so the request says it comes from there.
  const draw = (url: string | null) => (url ? fetch(url, { headers: { referer: `${origin}${env.BASE_PATH}/` } }) : null);
  let image = await draw(mapboxUrl(env.MAPBOX_TOKEN, run.polyline, streams, songs));
  // Mapbox refuses the whole map when it can't fetch a pin, so then it is drawn without them.
  if (image && !image.ok) {
    console.error(`map ${runId}: Mapbox said ${image.status} ${(await image.text()).slice(0, 200)}; drawing it without covers`);
    image = await draw(mapboxUrl(env.MAPBOX_TOKEN, run.polyline, streams, songs, false));
  }
  if (!image) return new Response('not found', { status: 404 });
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
