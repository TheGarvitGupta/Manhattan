// Album covers, for the emails: the color each one lends its song, and the
// small framed cover that sits on the map where the song played. The app
// works both out in the browser; mail can't, so here they are made by hand
// from Spotify's 64px thumbnails.

import jpeg from 'jpeg-js';
import { Env, sha256Hex } from './util';

/** Spotify's 64px picture of the same cover, which is plenty for a color or a pin. */
const thumbnail = (url: string) => url.replace('ab67616d00001e02', 'ab67616d00004851');

async function decode(url: string): Promise<{ width: number; height: number; data: Uint8Array } | null> {
  const res = await fetch(thumbnail(url));
  if (!res.ok) return null;
  try {
    return jpeg.decode(new Uint8Array(await res.arrayBuffer()), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 16 });
  } catch {
    return null;
  }
}

// --- color --------------------------------------------------------------------------

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The strongest color in a cover, kept bright enough to draw with: the same
 * rule as the app's map (charts.js coverColor), on the cover shrunk to 12 by 12.
 */
function colorOf(img: { width: number; height: number; data: Uint8Array }): string {
  const size = 12;
  let [r, g, b, total] = [0, 0, 0, 0];
  for (let cy = 0; cy < size; cy++) {
    for (let cx = 0; cx < size; cx++) {
      // Each of the 144 cells is the average of the pixels under it.
      const [x0, x1] = [Math.floor((cx * img.width) / size), Math.floor(((cx + 1) * img.width) / size)];
      const [y0, y1] = [Math.floor((cy * img.height) / size), Math.floor(((cy + 1) * img.height) / size)];
      let [pr, pg, pb, n] = [0, 0, 0, 0];
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * img.width + x) * 4;
          pr += img.data[i];
          pg += img.data[i + 1];
          pb += img.data[i + 2];
          n++;
        }
      }
      if (!n) continue;
      [pr, pg, pb] = [pr / n, pg / n, pb / n];
      const [hi, lo] = [Math.max(pr, pg, pb), Math.min(pr, pg, pb)];
      const light = (hi + lo) / 510;
      const sat = hi === lo ? 0 : (hi - lo) / (255 - Math.abs(hi + lo - 255));
      // Strong, mid-bright pixels count for most; greys and near-black or near-white for little.
      const weight = sat * sat * (1 - Math.abs(light - 0.5) * 1.4) + 0.004;
      r += pr * weight;
      g += pg * weight;
      b += pb * weight;
      total += weight;
    }
  }
  [r, g, b] = [r / total, g / total, b / total];
  const [hi, lo] = [Math.max(r, g, b), Math.min(r, g, b)];
  let hue = 0;
  if (hi !== lo) hue = hi === r ? ((g - b) / (hi - lo)) % 6 : hi === g ? (b - r) / (hi - lo) + 2 : (r - g) / (hi - lo) + 4;
  const sat = hi === lo ? 0 : (hi - lo) / (255 - Math.abs(hi + lo - 255));
  const light = (hi + lo) / 510;
  return sat < 0.12
    ? hslToHex(0, 0, 38)
    : hslToHex(Math.round(hue * 60 + 360) % 360, Math.round(Math.max(55, sat * 100)), Math.round(Math.min(54, Math.max(40, light * 100))));
}

/** A song with no cover, or one that won't load, is drawn in the app's violet. */
export const NO_COVER = '#6250d6';

/**
 * The color of each cover, worked out once and kept. Each new cover costs a
 * request, so at most `budget.n` are fetched; `complete` says whether every
 * one asked for now has its color.
 */
export async function coverColors(env: Env, images: (string | null)[], budget = { n: 30 }): Promise<{ colors: Map<string, string>; complete: boolean }> {
  const wanted = [...new Set(images.filter((x): x is string => !!x))];
  const colors = new Map<string, string>();
  if (!wanted.length) return { colors, complete: true };
  const known = await env.DB.prepare(`SELECT image, color FROM cover_colors WHERE image IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(wanted))
    .all<{ image: string; color: string }>();
  for (const k of known.results) colors.set(k.image, k.color);
  let complete = true;
  const found: [string, string][] = [];
  for (const image of wanted) {
    if (colors.has(image)) continue;
    if (budget.n <= 0) {
      complete = false;
      continue;
    }
    budget.n--;
    const img = await decode(image).catch(() => null);
    const color = img ? colorOf(img) : NO_COVER;
    colors.set(image, color);
    // A cover that failed to load is tried again another time.
    if (img) found.push([image, color]);
  }
  if (found.length) {
    await env.DB.batch(found.map(([image, color]) => env.DB.prepare(`INSERT OR REPLACE INTO cover_colors (image, color) VALUES (?, ?)`).bind(image, color)));
  }
  return { colors, complete };
}

// --- pins -------------------------------------------------------------------------------

// The pin is drawn at twice its size on the map, which is drawn for sharp screens.
const PIN = 76;
const BORDER = 5;
const RADIUS = 18;

/** The cover with rounded corners in a frame of its color, as a PNG, the way the app's map pins it. */
async function pinPng(image: string, color: string): Promise<Uint8Array | null> {
  const img = await decode(image);
  if (!img) return null;
  const [cr, cg, cb] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const inner = PIN - 2 * BORDER;
  const px = new Uint8Array(PIN * PIN * 4);
  // How much of the pixel at (x, y) lies inside a rounded square of side `side` starting at `from`, for smooth edges.
  const inside = (x: number, y: number, from: number, side: number, radius: number) => {
    const [lx, ly] = [x + 0.5 - from, y + 0.5 - from];
    const [qx, qy] = [Math.max(radius - lx, lx - (side - radius), 0), Math.max(radius - ly, ly - (side - radius), 0)];
    return Math.max(0, Math.min(1, radius - Math.hypot(qx, qy) + 0.5));
  };
  for (let y = 0; y < PIN; y++) {
    for (let x = 0; x < PIN; x++) {
      const i = (y * PIN + x) * 4;
      const outer = inside(x, y, 0, PIN, RADIUS);
      if (!outer) continue;
      const cover = inside(x, y, BORDER, inner, RADIUS - BORDER);
      // The cover, scaled to fit inside the frame by its nearest pixel.
      const sx = Math.min(img.width - 1, Math.max(0, Math.floor(((x - BORDER) * img.width) / inner)));
      const sy = Math.min(img.height - 1, Math.max(0, Math.floor(((y - BORDER) * img.height) / inner)));
      const j = (sy * img.width + sx) * 4;
      px[i] = Math.round(img.data[j] * cover + cr * (1 - cover));
      px[i + 1] = Math.round(img.data[j + 1] * cover + cg * (1 - cover));
      px[i + 2] = Math.round(img.data[j + 2] * cover + cb * (1 - cover));
      px[i + 3] = Math.round(255 * outer);
    }
  }
  return png(PIN, PIN, px);
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** RGBA pixels as a PNG: no filters, compressed by the runtime's own zlib. */
async function png(width: number, height: number, rgba: Uint8Array): Promise<Uint8Array> {
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const zipped = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zipped), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// --- the pin's address ---------------------------------------------------------------------

/** Pins are made for Mapbox to fetch, so each link is signed: this Worker draws only the pins its own maps ask for. */
const pinSignature = async (env: Env, image: string, color: string) => (await sha256Hex(`pin:${image}:${color}:${env.TOKEN_KEY}`)).slice(0, 20);

export async function pinLink(env: Env, origin: string, image: string, color: string): Promise<string> {
  const q = new URLSearchParams({ i: image, c: color, s: await pinSignature(env, image, color) });
  return `${origin}${env.BASE_PATH}/api/pin.png?${q}`;
}

/** Serves /api/pin.png: one framed cover, made once and kept. */
export async function servePin(env: Env, req: Request, ctx: ExecutionContext): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const [image, color, sig] = [q.get('i') ?? '', q.get('c') ?? '', q.get('s') ?? ''];
  if (!/^https:\/\/i\.scdn\.co\/image\/[0-9a-f]+$/.test(image) || !/^#[0-9a-f]{6}$/.test(color) || sig !== (await pinSignature(env, image, color))) {
    return new Response('not found', { status: 404 });
  }
  const cache = caches.default;
  const hit = await cache.match(req);
  if (hit) return hit;
  const bytes = await pinPng(image, color);
  if (!bytes) return new Response('not found', { status: 404 });
  const res = new Response(bytes, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=31536000, immutable' } });
  ctx.waitUntil(cache.put(req, res.clone()));
  return res;
}
