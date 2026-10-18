// The emails Cadence sends, and when.
//
//   welcome   once, when someone gives their address (it carries the
//             "confirm your address" button)
//   weekly    9am every Sunday in the reader's own timezone: their last 10
//             songs and activities while Cadence is still collecting, or the
//             top findings once there are enough runs with music
//   activity  if they asked for it, after each run or ride that had music:
//             its route with the songs on it, then how that sport is going
//
// Email is written for mail clients: tables and inline styles only.

import { buildInsights } from './insights';
import { songIntervals } from './match';
import { RIDE_TYPES, Sport, SPORTS } from './providers';
import { coverColors, NO_COVER } from './covers';
import { mapLink } from './staticmap';
import { Env, now, recast, User } from './util';

export const FROM = { email: 'no-reply@cadence.garvitgupta.com', name: 'Cadence' };
// Runs with music before the roundup switches from "collecting" to patterns. Rides need the same number, counted apart.
const RUNS_NEEDED = 5;
// How each sport is spoken of.
const WORDS = {
  run: { one: 'run', many: 'runs', verb: 'run', doing: 'running', done: 'run' },
  ride: { one: 'ride', many: 'rides', verb: 'ride', doing: 'biking', done: 'ridden' },
} as const;
const RUN_TYPES = ['Run', 'TrailRun', 'VirtualRun'];

export type Kind = 'welcome' | 'weekly' | 'activity';
export type Variant = 'collecting' | 'patterns';

export interface Email {
  subject: string;
  preview: string;
  html: string;
  text: string;
}

export interface EmailUser extends User {
  email: string | null;
  email_token: string | null;
  email_confirmed_at: number | null;
  email_tz: string | null;
  email_units: string | null;
  welcome_sent_at: number | null;
  weekly_sent_at: number | null;
  // Which emails they get: the Sunday roundup, and a note after each run or ride (for those since they asked).
  email_weekly: number;
  activity_emails: number;
  activity_emails_since: number | null;
}

// --- formatting -------------------------------------------------------------------

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function units(unit: string) {
  const metres = unit === 'mi' ? 1609.344 : 1000;
  const per = unit === 'mi' ? 'mph' : 'km/h';
  return {
    unit,
    pace(speed: number) {
      const sec = Math.round(metres / speed);
      return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} /${unit}`;
    },
    dist: (m: number) => `${(m / metres).toFixed(1)} ${unit}`,
    gap(speed: number, average: number) {
      const sec = Math.round(metres / average - metres / speed);
      return sec === 0 ? 'your usual pace' : `${Math.abs(sec)}s ${sec > 0 ? 'faster' : 'slower'} than your average`;
    },
    // How fast, in the way each sport says it: a run's pace (5:19 /km), a ride's speed (28.4 km/h).
    rate(speed: number, sport: Sport) {
      return sport === 'ride' ? `${((speed * 3600) / metres).toFixed(1)} ${per}` : this.pace(speed);
    },
    // And how that compares with the person's average: seconds for a run, km/h or mph for a ride.
    against(speed: number, average: number, sport: Sport) {
      if (sport === 'run') return this.gap(speed, average);
      const d = ((speed - average) * 3600) / metres;
      return Math.abs(d) < 0.05 ? 'your usual speed' : `${Math.abs(d).toFixed(1)} ${per} ${d > 0 ? 'faster' : 'slower'} than your average`;
    },
  };
}

const minSec = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
const length = (sec: number) => {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const kind = (type: string) => (RUN_TYPES.includes(type) ? 'Run' : RIDE_TYPES.has(type) ? 'Ride' : type.replace(/([a-z])([A-Z])/g, '$1 $2'));
const when = (ts: number, tz: string | null) =>
  new Date(ts * 1000).toLocaleString('en-US', { timeZone: tz || 'UTC', weekday: 'short', hour: 'numeric', minute: '2-digit' });
// The runs and rides listed can be weeks apart, so they carry the date and not the weekday.
const whenDated = (ts: number, tz: string | null) =>
  new Date(ts * 1000).toLocaleString('en-US', { timeZone: tz || 'UTC', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// --- building blocks -------------------------------------------------------------------

const INK = '#0b0b0b';
const SOFT = '#52514e';
const MUTED = '#898781';
const LINE = '#e6e5df';
const ACCENT = '#6250d6';
const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;

const cover = (image: string | null, name: string, size: number) =>
  image
    ? `<img src="${esc(image)}" width="${size}" height="${size}" alt="" style="display:block;border-radius:${Math.round(size / 5)}px;">`
    : `<div style="width:${size}px;height:${size}px;border-radius:${Math.round(size / 5)}px;background:#eeede8;color:${MUTED};font:600 ${Math.round(size / 2.6)}px/${size}px ${FONT};text-align:center;">${esc((name || '?')[0])}</div>`;

/** One row: a cover or a glyph tile, two lines of text, and a value on the right. */
const row = (image: string | null, title: string, sub: string, value: string, detail = '', lead = cover(image, title, 44), below = '') => `
<tr>
  <td width="44" style="padding:10px 12px 10px 0;border-top:1px solid ${LINE};">${lead}</td>
  <td style="padding:10px 0;border-top:1px solid ${LINE};font:15px/1.35 ${FONT};color:${INK};">
    <b style="font-weight:600;">${esc(title)}</b><br><span style="color:${SOFT};font-size:13px;">${esc(sub)}</span>${below}
  </td>
  <td align="right" style="padding:10px 0 10px 12px;border-top:1px solid ${LINE};font:15px/1.35 ${FONT};color:${INK};white-space:nowrap;">
    <b style="font-weight:600;">${esc(value)}</b>${detail ? `<br><span style="color:${MUTED};font-size:12px;">${esc(detail)}</span>` : ''}
  </td>
</tr>`;

const GOLD = '#ffd24a';
const TINT = '#f3f1fd';

// Section headings carry a small gold beat in front, echoing the logo.
const heading = (text: string) =>
  `<p style="margin:32px 0 6px;font:700 12px/1.4 ${FONT};color:${SOFT};letter-spacing:0.07em;text-transform:uppercase;"><span style="display:inline-block;width:14px;height:5px;border-radius:3px;background:${GOLD};vertical-align:middle;margin:-2px 8px 0 0;"></span>${esc(text)}</p>`;
const table = (rows: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>`;
const para = (html: string) => `<p style="margin:0 0 14px;font:16px/1.55 ${FONT};color:${SOFT};">${html}</p>`;
const button = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 6px;"><tr><td style="border-radius:999px;background:${ACCENT};">
     <a href="${esc(href)}" target="_blank" style="display:inline-block;padding:14px 26px;font:700 15px ${FONT};color:#ffffff;text-decoration:none;">${esc(label)}</a>
   </td></tr></table>`;

/** A row of figures in tinted tiles: [value, label] pairs. */
const figures = (items: [string, string][]) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 4px;"><tr>${items
    .map(
      ([value, label], i) =>
        `<td width="${Math.floor(100 / items.length)}%" style="padding-${i === 0 ? 'right' : i === items.length - 1 ? 'left' : 'left:4px;padding-right'}:4px;">
           <div style="border-radius:14px;background:${TINT};padding:14px 8px;text-align:center;">
             <div style="font:700 22px/1.2 ${FONT};color:${INK};letter-spacing:-0.02em;">${esc(value)}</div>
             <div style="font:12px/1.4 ${FONT};color:${SOFT};">${esc(label)}</div>
           </div>
         </td>`,
    )
    .join('')}</tr></table>`;

/** On the violet band: a song's cover, large and framed in white, beside its name, artist and how fast it went. */
const songHero = (song: { image: string | null; name: string; artist: string }, rate: string, against: string) => `
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
  <td width="104" valign="middle" style="padding-right:18px;">${song.image ? `<img src="${esc(song.image)}" width="104" height="104" alt="" style="display:block;border-radius:18px;border:3px solid #ffffff;">` : cover(null, song.name, 104)}</td>
  <td valign="middle">
    <h1 style="margin:0;font:800 32px/1.1 ${FONT};color:#ffffff;letter-spacing:-0.025em;">${esc(song.name)}</h1>
    <p style="margin:4px 0 10px;font:16px ${FONT};color:#e4dffc;">${esc(song.artist)}</p>
    <p style="margin:0;font:15px/1.4 ${FONT};color:#e4dffc;"><b style="font-weight:800;font-size:22px;color:${GOLD};">${esc(rate)}</b>&nbsp; ${esc(against)}</p>
  </td>
</tr></table>`;

// Pieces of the violet band at the top of every email.
const kicker = (text: string) => `<p style="margin:22px 0 6px;font:700 13px/1.4 ${FONT};color:${GOLD};letter-spacing:0.06em;text-transform:uppercase;">${esc(text)}</p>`;
const headline = (text: string) => `<h1 style="margin:0;font:800 32px/1.1 ${FONT};color:#ffffff;letter-spacing:-0.025em;">${esc(text)}</h1>`;
const lede = (html: string) => `<p style="margin:10px 0 0;font:16px/1.5 ${FONT};color:#e4dffc;">${html}</p>`;

/**
 * Every email: a violet band holding the logo and the headline, a white body,
 * and a quiet footer, all on a pale violet page so no part of it looks empty.
 */
function shell(title: string, hero: string, body: string, preview: string, footer: string, app: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#e9e6fb;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#e9e6fb" style="background:#e9e6fb;"><tr><td align="center" style="padding:26px 12px 8px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;border-radius:22px;overflow:hidden;background:#ffffff;">
    <tr><td bgcolor="${ACCENT}" style="padding:26px 30px 32px;border-radius:22px 22px 0 0;background:${ACCENT};background-image:url(${esc(app)}beats.png),linear-gradient(135deg,#7b5cf0,#4a36c4);background-repeat:no-repeat,no-repeat;background-position:right bottom,center;background-size:260px auto,cover;">
      <img src="${esc(app)}wordmark-light.png" width="140" height="34" alt="Cadence" style="display:block;border:0;">
      ${hero}
    </td></tr>
    <tr><td style="padding:26px 30px 32px;">${body}</td></tr>
  </table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;"><tr><td align="center" style="padding:20px 30px 26px;font:12px/1.7 ${FONT};color:#7a74a8;">
    ${footer}<br>Powered by Strava. Music data from Spotify.
  </td></tr></table>
</td></tr></table>
</body></html>`;
}

function links(env: Env, origin: string, user: EmailUser) {
  const app = `${origin}${env.BASE_PATH}/`;
  const token = user.email_token ?? 'preview';
  return {
    app,
    confirm: `${app}auth/email/confirm?t=${token}`,
    off: `${app}auth/email/off?t=${token}`,
    // Stops the note after each activity and keeps the Sunday roundup.
    offActivity: `${app}auth/email/off?t=${token}&only=activity`,
    settings: `${app}#/emails`,
  };
}

/** Strava's activity glyphs, as on garvitgupta.com. Mail apps strip inline SVG, so these are small PNGs. */
function glyphTile(type: string, app: string): string {
  const key = /^(Run|TrailRun|VirtualRun)$/.test(type)
    ? 'run'
    : /^(Ride|VirtualRide|GravelRide|MountainBikeRide|EBikeRide)$/.test(type)
      ? 'ride'
      : /^(WeightTraining|Workout|Crossfit)$/.test(type)
        ? 'weight'
        : null;
  if (!key) return cover(null, kind(type), 44);
  // Each kind has its own background color, with the glyph in white: runs in
  // Cadence violet, rides blue, weights orange.
  const tint = { run: '#6250d6', ride: '#2a78d6', weight: '#eb6834' }[key];
  return `<div style="width:44px;height:44px;border-radius:9px;background:${tint};text-align:center;"><img src="${esc(app)}glyphs/${key}.png" width="22" height="22" alt="${esc(kind(type))}" style="display:inline-block;margin-top:11px;border:0;"></div>`;
}

const firstName = (user: User) => user.name.split(' ')[0] || 'there';

// --- welcome ---------------------------------------------------------------------------

async function welcome(env: Env, origin: string, user: EmailUser): Promise<Email> {
  const l = links(env, origin, user);
  const spotify = user.is_demo
    ? true
    : !!(await env.DB.prepare(`SELECT 1 FROM tokens WHERE user_id = ? AND provider = 'spotify' AND status = 'ok'`).bind(user.id).first());
  const step = (done: boolean, title: string, text: string) => `
<tr>
  <td width="30" valign="top" style="padding:12px 12px 12px 0;border-top:1px solid ${LINE};">
    <div style="width:24px;height:24px;border-radius:12px;background:${done ? ACCENT : '#eeede8'};color:${done ? '#ffffff' : '#c3c2b7'};font:700 13px/24px ${FONT};text-align:center;">&#10003;</div>
  </td>
  <td style="padding:12px 0;border-top:1px solid ${LINE};font:15px/1.4 ${FONT};color:${INK};"><b style="font-weight:600;">${esc(title)}</b><br><span style="color:${SOFT};font-size:14px;">${esc(text)}</span></td>
</tr>`;

  // What they asked for.
  const what =
    [user.email_weekly === 0 ? '' : 'the Sunday roundup', user.activity_emails ? 'a note after each run or ride' : ''].filter(Boolean).join(' and ') || 'your emails';
  const hero = `${kicker('Welcome')}${headline(`You're in, ${firstName(user)}.`)}${lede('Cadence lines up your Strava runs and rides with what you were listening to on Spotify, and finds the songs you go fastest to.')}`;
  const body = `
${button(l.confirm, 'Confirm my email')}
<p style="margin:0;font:13px/1.5 ${FONT};color:${MUTED};">One tap, so ${esc(what)} ${what.includes(' and ') || what === 'your emails' ? 'go' : 'goes'} to the right person.</p>
${heading('What happens next')}
${table(
  step(true, 'Strava connected', 'New activities arrive on their own.') +
    step(spotify, spotify ? 'Spotify connected' : 'Connect Spotify', spotify ? 'Cadence notes each song as you finish it.' : 'Cadence can only match songs it sees from the day you connect.') +
    step(false, 'Run or ride with music on', `After ${RUNS_NEEDED} runs, or ${RUNS_NEEDED} rides, your fastest and slowest songs from Spotify will appear.`),
)}`;

  return {
    subject: 'Welcome to Cadence',
    preview: 'Confirm your email, then just run or ride with music on.',
    html: shell('Welcome to Cadence', hero, body, 'Confirm your email, then just run or ride with music on.', `You're getting this because you gave Cadence your email address. <a href="${esc(l.off)}" style="color:${MUTED};">Turn them off</a>.`, l.app),
    text: `You're in, ${firstName(user)}.\n\nConfirm your email: ${l.confirm}\n\nWhat happens next: run or ride with music on. After ${RUNS_NEEDED} runs, or ${RUNS_NEEDED} rides, your fastest and slowest songs appear. You'll get ${what}.\n\nOpen Cadence: ${l.app}\nTurn these emails off: ${l.off}`,
  };
}

// --- weekly ------------------------------------------------------------------------------

interface WeekTotals {
  runs: number;
  rides: number;
  run_m: number;
  ride_m: number;
  songs: number;
}

/** The week in a line and in three tiles: both sports when there was some of each. */
function weekSummary(t: WeekTotals, u: ReturnType<typeof units>): { line: string; tiles: [string, string][] } {
  const did = [
    t.runs || !t.rides ? `${plural(t.runs, 'run')}${t.runs ? `, ${u.dist(t.run_m)}` : ''}` : '',
    t.rides ? `${plural(t.rides, 'ride')}, ${u.dist(t.ride_m)}` : '',
  ].filter(Boolean);
  const songsTile: [string, string] = [String(t.songs), t.songs === 1 ? 'song played' : 'songs played'];
  return {
    line: `${did.join('; ')} and ${plural(t.songs, 'song')} this week.`,
    tiles:
      t.runs && t.rides
        ? [[String(t.runs), t.runs === 1 ? 'run this week' : 'runs this week'], [String(t.rides), t.rides === 1 ? 'ride this week' : 'rides this week'], songsTile]
        : t.rides
          ? [[String(t.rides), t.rides === 1 ? 'ride this week' : 'rides this week'], [u.dist(t.ride_m), 'ridden'], songsTile]
          : [[String(t.runs), t.runs === 1 ? 'run this week' : 'runs this week'], [t.runs ? u.dist(t.run_m) : '–', 'run'], songsTile],
  };
}

/** One circle per activity needed, gold with a tick once it's done. On the violet band, or (`light`) on the white body. */
function dots(have: number, light = false): string {
  const open = light ? '#c9c2f5' : '#a99df0';
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:${light ? '6px 0 12px' : '16px 0 0'};"><tr>${Array.from({ length: RUNS_NEEDED }, (_, i) =>
    i < have
      ? `<td style="padding-right:8px;"><div style="width:34px;height:34px;border-radius:17px;background:${GOLD};color:#4a36c4;font:800 16px/34px ${FONT};text-align:center;">&#10003;</div></td>`
      : `<td style="padding-right:8px;"><div style="width:30px;height:30px;border-radius:17px;border:2px solid ${open};color:${open};font:700 13px/30px ${FONT};text-align:center;">${i + 1}</div></td>`,
  ).join('')}</tr></table>`;
}

type Insights = Awaited<ReturnType<typeof buildInsights>>;

/** A sport's findings: its fastest and most played songs, and its fastest kilometre or mile. The site has the rest. */
function sportBlock(i: Insights, s: Sport, unit: string, user: EmailUser, named: boolean): string {
  const u = units(unit);
  const w = WORDS[s];
  const average = i.totals.distance_m / i.totals.moving_s;
  const shortGap = (speed: number) => u.against(speed, average, s).replace(' than your average', '');
  const best = unit === 'mi' ? i.best_mile : i.best_km;
  const stretch = unit === 'mi' ? 'mile' : 'kilometre';
  return `
${heading(named ? `Fastest songs, ${w.doing}` : 'Fastest songs')}
${table(i.fastest.slice(0, 3).map((x) => row(x.image, x.name, x.artist, u.rate(x.speed, s), shortGap(x.speed))).join(''))}
${heading(`Most played on ${w.many}`)}
${table(i.most_played.slice(0, 3).map((x) => row(x.image, x.name, x.artist, `${x.plays}×`, `on ${plural(x.runs, w.one)}`)).join(''))}
${
  best
    ? `${heading(named ? `Fastest ${stretch}, ${w.doing}` : `Fastest ${stretch}`)}${table(row(best.song?.image ?? null, minSec(best.seconds!), best.song ? `${best.song.name} was playing` : 'No music playing', new Date(best.start_time * 1000).toLocaleDateString('en-US', { timeZone: user.email_tz || 'UTC', month: 'short', day: 'numeric' })))}`
    : ''
}`;
}

async function week(env: Env, user: User): Promise<WeekTotals> {
  const since = now() - 7 * 86400;
  const row = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM runs WHERE user_id = ?1 AND sport = 'run' AND start_time >= ?2) AS runs,
            (SELECT COUNT(*) FROM runs WHERE user_id = ?1 AND sport = 'ride' AND start_time >= ?2) AS rides,
            (SELECT COALESCE(SUM(distance_m), 0) FROM runs WHERE user_id = ?1 AND sport = 'run' AND start_time >= ?2) AS run_m,
            (SELECT COALESCE(SUM(distance_m), 0) FROM runs WHERE user_id = ?1 AND sport = 'ride' AND start_time >= ?2) AS ride_m,
            (SELECT COUNT(*) FROM plays WHERE user_id = ?1 AND played_at >= ?2) AS songs`,
  )
    .bind(user.id, since)
    .first<WeekTotals>();
  return row ?? { runs: 0, rides: 0, run_m: 0, ride_m: 0, songs: 0 };
}

/**
 * The Sunday roundup. Running and biking are analysed apart and the email
 * carries both: each sport's patterns appear once it has enough activities
 * with music, and until then it is counted towards the number it needs.
 * Nothing here is for the reader to choose.
 */
async function weekly(env: Env, origin: string, user: EmailUser, unit: string, forced?: Variant): Promise<Email> {
  const l = links(env, origin, user);
  const u = units(unit);
  const ins = { run: await buildInsights(env, user, 'run'), ride: await buildInsights(env, user, 'ride') };
  const t = await week(env, user);
  const withMusic = (s: Sport) => ins[s].totals.runs_with_music;
  // The sport there is more of leads; running, when they are level.
  const order = [...SPORTS].sort((a, b) => withMusic(b) - withMusic(a));
  // A sport's patterns need a fastest song to lead with, and enough activities behind it. A preview may ask for either email.
  const ready = order.filter((s) => ins[s].fastest.length > 0);
  const shown = forced === 'collecting' ? [] : forced === 'patterns' ? ready : ready.filter((s) => withMusic(s) >= RUNS_NEEDED);
  const footer = `You're getting this every Sunday because you turned on email updates in Cadence. <a href="${esc(l.off)}" style="color:${MUTED};">Turn them off</a>.`;

  const { line: weekLine, tiles: weekTiles } = weekSummary(t, u);

  if (!shown.length) {
    const songs = await recast(
      env,
      user,
      (
        await env.DB.prepare(
          `SELECT p.played_at, t.name, t.artist, t.image FROM plays p JOIN tracks t ON t.id = p.track_id
           WHERE p.user_id = ? ORDER BY p.played_at DESC LIMIT 10`,
        )
          .bind(user.id)
          .all<{ played_at: number; name: string; artist: string; image: string | null }>()
      ).results,
    );
    // Only runs and rides are listed: they are what Cadence analyses.
    const kinds = [...RUN_TYPES, ...RIDE_TYPES];
    const activities = (
      await env.DB.prepare(
        `SELECT a.name, a.type, a.start_time, a.elapsed_s, a.distance_m
         FROM activities a WHERE a.user_id = ? AND a.type IN (${kinds.map(() => '?').join(', ')}) ORDER BY a.start_time DESC LIMIT 10`,
      )
        .bind(user.id, ...kinds)
        .all<{ name: string; type: string; start_time: number; elapsed_s: number; distance_m: number }>()
    ).results;
    // What played during each, for the covers under its name.
    // A song counts when at least ten seconds of it fell inside the activity, as on the site.
    const heard = new Map<number, { image: string | null }[]>();
    for (const a of activities) {
      const end = a.start_time + a.elapsed_s;
      const plays = await recast(
        env,
        user,
        (
          await env.DB.prepare(
            `SELECT p.played_at, p.track_id, t.duration_s, t.name, t.artist, t.image FROM plays p JOIN tracks t ON t.id = p.track_id
             WHERE p.user_id = ? AND p.played_at > ? AND p.played_at <= ? ORDER BY p.played_at DESC LIMIT 200`,
          )
            .bind(user.id, a.start_time - 1800, end + 900)
            .all<{ played_at: number; track_id: string; duration_s: number; name: string; artist: string; image: string | null }>()
        ).results,
      );
      heard.set(
        a.start_time,
        a.elapsed_s > 0 ? songIntervals(plays).filter((i) => Math.min(i.to, end) - Math.max(i.from, a.start_time) >= 10).map((i) => i.play) : [],
      );
    }
    /** An activity's songs: up to five small covers, then how many there were in a pill. */
    const songsLine = (songs: { image: string | null }[]) => {
      const pill = (text: string, bg: string, color: string) =>
        `<span style="display:inline-block;vertical-align:middle;padding:1px 8px;border-radius:999px;background:${bg};color:${color};font:600 12px/18px ${FONT};">${text}</span>`;
      if (!songs.length) return `<div style="margin-top:5px;">${pill('no songs', '#f1f0ee', MUTED)}</div>`;
      const covers = [...new Set(songs.map((x) => x.image).filter((x): x is string => !!x))].slice(0, 5);
      return `<div style="margin-top:5px;">${covers
        .map((src) => `<img src="${esc(src)}" width="18" height="18" alt="" style="display:inline-block;vertical-align:middle;border:0;border-radius:5px;margin-right:3px;">`)
        .join('')}${covers.length ? '<span style="display:inline-block;width:3px;"></span>' : ''}${pill(plural(songs.length, 'song'), '#e3f6ea', INK)}</div>`;
    };

    // The count that leads is the sport nearest its number; the other is told in a line under it.
    const lead = order[0];
    const other = order[1];
    const w = WORDS[lead];
    // Previewing this email for an account that is already past it: show a mid-way count.
    const have = withMusic(lead) >= RUNS_NEEDED ? RUNS_NEEDED - 2 : withMusic(lead);
    const also = ins[other].totals.runs > 0 ? ` ${WORDS[other].doing[0].toUpperCase()}${WORDS[other].doing.slice(1)} is counted apart: ${withMusic(other) >= RUNS_NEEDED ? RUNS_NEEDED - 2 : withMusic(other)} of ${RUNS_NEEDED} ${WORDS[other].many} with music so far.` : '';
    const hero = `${kicker('Still collecting')}${headline(`${have} of ${RUNS_NEEDED} ${w.many} with music`)}
${dots(have)}
${lede(esc(`Your fastest and slowest songs appear after ${RUNS_NEEDED}.${also}`))}`;
    const body = `
${figures(weekTiles)}
${heading('Last 10 songs')}
${songs.length ? table(songs.map((s) => row(s.image, s.name, s.artist, when(s.played_at, user.email_tz))).join('')) : para('No songs yet. Play something on Spotify and it will show up here.')}
${heading('Last runs and rides')}
${
  activities.length
    ? table(
        activities
          .map((a) =>
            row(null, a.name, `${kind(a.type)} · ${length(a.elapsed_s)}${a.distance_m ? ` · ${u.dist(a.distance_m)}` : ''}`, whenDated(a.start_time, user.email_tz), '', glyphTile(a.type, l.app), songsLine(heard.get(a.start_time) ?? [])),
          )
          .join(''),
      )
    : para('No runs or rides yet.')
}
${button(l.app, 'Open Cadence')}`;
    const subject = `Still collecting: ${have} of ${RUNS_NEEDED} ${w.many} with music`;
    return {
      subject,
      preview: weekLine,
      html: shell(subject, hero, body, weekLine, footer, l.app),
      text: `${subject}\n\n${weekLine}\n\nLast songs:\n${songs.map((s) => `- ${s.name} · ${s.artist}`).join('\n')}\n\nLast runs and rides:\n${activities.map((a) => `- ${a.name} (${kind(a.type)}, ${plural((heard.get(a.start_time) ?? []).length, 'song')})`).join('\n')}\n\nOpen Cadence: ${l.app}\nTurn these emails off: ${l.off}`,
    };
  }

  // Patterns: one headline, then for each sport two short lists and one fact. The site has the rest.
  const lead = shown[0];
  const average = (s: Sport) => ins[s].totals.distance_m / ins[s].totals.moving_s;
  const top = ins[lead].fastest[0];
  const proof = (s: Sport, speed: number) => `${u.rate(speed, s)}, ${u.against(speed, average(s), s)}`;
  const hero = `${kicker(`You ${WORDS[lead].verb} fastest to`)}${songHero(top, u.rate(top.speed, lead), u.against(top.speed, average(lead), lead))}`;

  const several = shown.length > 1;
  const block = (s: Sport) => sportBlock(ins[s], s, unit, user, several);
  // A sport still short of its number is counted, so its patterns are known to be on their way.
  const waiting = SPORTS.filter((s) => !shown.includes(s) && ins[s].totals.runs > 0)
    .map((s) => `${heading(`${WORDS[s].doing[0].toUpperCase()}${WORDS[s].doing.slice(1)}: still collecting`)}${para(esc(`${Math.min(withMusic(s), RUNS_NEEDED - 1)} of ${RUNS_NEEDED} ${WORDS[s].many} with music so far. Its fastest and slowest songs join this email after ${RUNS_NEEDED}.`))}`)
    .join('');

  const body = `
${figures(weekTiles)}
${shown.map(block).join('')}
${waiting}
${button(l.app, 'See everything')}
<p style="margin:0;font:13px/1.5 ${FONT};color:${MUTED};">Slowest songs, heart rate, skips and every ${several || waiting ? 'run and ride' : WORDS[lead].one} are on the site.</p>`;
  const subject = `You ${WORDS[lead].verb} fastest to ${top.name}`;
  const preview = `${proof(lead, top.speed)}. ${weekLine}`;
  return {
    subject,
    preview,
    html: shell(subject, hero, body, preview, footer, l.app),
    text: `${shown
      .map((s) => {
        const f = ins[s].fastest;
        return `You ${WORDS[s].verb} fastest to ${f[0].name} by ${f[0].artist}: ${proof(s, f[0].speed)}.\n\nFastest songs, ${WORDS[s].doing}:\n${f.slice(0, 3).map((x) => `- ${x.name}: ${u.rate(x.speed, s)}`).join('\n')}`;
      })
      .join('\n\n')}\n\n${weekLine}\n\nSee everything: ${l.app}\nTurn these emails off: ${l.off}`,
  };
}

// --- after each activity ---------------------------------------------------------------------

interface ActivityRun {
  id: number;
  strava_id: number;
  name: string;
  sport: Sport;
  type: string | null;
  start_time: number;
  elapsed_s: number;
  distance_m: number;
  moving_s: number;
  avg_hr: number | null;
  polyline: string | null;
}

interface ActivitySong {
  start_s: number;
  end_s: number;
  distance_m: number;
  moving_s: number;
  skipped: number;
  name: string;
  artist: string;
  image: string | null;
}

// Songs listed in full before the rest are left to the site.
const SONGS_LISTED = 25;

/**
 * The note after a run or ride: what was playing, song by song, on a map of
 * the route where each song's stretch of road wears its own color, then how
 * that sport is going (its findings, or how many more it needs).
 * Without `runId` it is the latest one with music, for previews. Null when there is none.
 */
async function activity(env: Env, origin: string, user: EmailUser, unit: string, runId?: number): Promise<Email | null> {
  const l = links(env, origin, user);
  const u = units(unit);
  const run = await env.DB.prepare(
    `SELECT r.id, r.strava_id, r.name, r.sport, r.start_time, r.elapsed_s, r.distance_m, r.moving_s, r.avg_hr, a.type, a.polyline
     FROM runs r LEFT JOIN activities a ON a.user_id = r.user_id AND a.strava_id = r.strava_id
     WHERE r.user_id = ?1 AND r.stream_state = 'ok' AND (?2 IS NULL OR r.id = ?2) AND EXISTS (SELECT 1 FROM run_songs WHERE run_id = r.id)
     ORDER BY r.start_time DESC LIMIT 1`,
  )
    .bind(user.id, runId ?? null)
    .first<ActivityRun>();
  if (!run) return null;
  const songs = await recast(
    env,
    user,
    (
      await env.DB.prepare(
        `SELECT rs.start_s, rs.end_s, rs.distance_m, rs.moving_s, rs.skipped, t.name, t.artist, t.image
         FROM run_songs rs JOIN tracks t ON t.id = rs.track_id WHERE rs.run_id = ? ORDER BY rs.idx`,
      )
        .bind(run.id)
        .all<ActivitySong>()
    ).results,
  );
  const s = run.sport;
  const w = WORDS[s];
  const speedOf = (x: { distance_m: number; moving_s: number }) => (x.moving_s > 0 ? x.distance_m / x.moving_s : 0);
  const average = speedOf(run);
  // The fastest song is one that had a minute or more of moving, so a few seconds at a light don't win it.
  const fastest = songs.filter((x) => x.moving_s >= 60).sort((a, b) => speedOf(b) - speedOf(a))[0] ?? null;
  const ins = await buildInsights(env, user, s);
  const have = ins.totals.runs_with_music;
  const t = await week(env, user);
  const { line: weekLine, tiles: weekTiles } = weekSummary(t, u);
  const map = run.polyline && env.MAPBOX_TOKEN ? await mapLink(env, origin, run.id, songs.length) : null;
  const open = `${l.app}#/activity/${run.strava_id}`;

  const gap = (x: ActivitySong) => u.against(speedOf(x), average, s).replace('than your average', `than this ${w.one}'s average`).replace('your usual', `this ${w.one}'s usual`);
  const did = w.verb === 'run' ? 'ran' : 'rode';
  const when = `${kind(run.type ?? (s === 'ride' ? 'Ride' : 'Run'))} · ${whenDated(run.start_time, user.email_tz)}`;
  // Led by its fastest song, as the Sunday roundup is by the person's; without one, by the activity's name.
  const hero = fastest
    ? `${kicker(`You ${did} fastest to`)}${songHero(fastest, u.rate(speedOf(fastest), s), gap(fastest))}
${lede(esc(`${run.name}, ${whenDated(run.start_time, user.email_tz)}: the fastest of ${plural(songs.length, 'song')} over ${u.dist(run.distance_m)}.`))}`
    : `${kicker(when)}${headline(run.name)}${lede(esc(`${plural(songs.length, 'song')} over ${u.dist(run.distance_m)}.`))}`;

  // Each song wears its cover's color, as on the app's map: on the map, in the strip and around its cover below.
  // An email being sent waits until every cover has one, so the email and its map agree; a preview makes do.
  const { colors, complete } = await coverColors(env, songs.map((x) => x.image), { n: 25 });
  if (runId != null && !complete) throw new Error('cover colors still being worked out');
  const colorOf = (x: { image: string | null }) => (x.image && colors.get(x.image)) || NO_COVER;
  const tz = user.email_tz || 'UTC';
  const clock = (ts: number) => new Date(ts * 1000).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  const music = songs.reduce((sum, x) => sum + (x.end_s - x.start_s), 0);
  const heard = Math.min(run.distance_m, songs.reduce((sum, x) => sum + x.distance_m, 0));

  // The head of the app's activity page: whose it was, when, and its figures in a line.
  const tint = s === 'ride' ? '#2a78d6' : ACCENT;
  const face = user.avatar
    ? `<img src="${esc(user.avatar)}" width="56" height="56" alt="" style="display:block;border-radius:28px;border:3px solid ${tint};">`
    : glyphTile(run.type ?? (s === 'ride' ? 'Ride' : 'Run'), l.app);
  const fact = (value: string, label: string) =>
    `<span style="display:inline-block;margin:0 18px 6px 0;white-space:nowrap;font:15px/1.3 ${FONT};color:${SOFT};"><b style="font:700 20px/1.3 ${FONT};color:${INK};letter-spacing:-0.01em;">${esc(value)}</b> ${esc(label)}</span>`;
  const head = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;"><tr>
  <td width="62" valign="top" style="padding:2px 14px 0 0;">${face}</td>
  <td valign="top">
    <p style="margin:0;font:800 22px/1.25 ${FONT};color:${INK};letter-spacing:-0.02em;">${esc(run.name)}</p>
    <p style="margin:2px 0 12px;font:14px/1.4 ${FONT};color:${SOFT};">${esc(`${new Date(run.start_time * 1000).toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', month: 'short', day: 'numeric' })}, ${clock(run.start_time)} – ${clock(run.start_time + run.elapsed_s)}`)}</p>
    ${fact(u.dist(run.distance_m), 'distance')}${fact(length(run.moving_s), 'moving')}${fact(u.rate(average, s), s === 'ride' ? 'average speed' : 'average pace')}${run.avg_hr ? fact(`${Math.round(run.avg_hr)} bpm`, 'average heart rate') : ''}${fact(length(music), 'of music')}
  </td>
</tr></table>`;

  // When each song played, as a strip from start to finish: a bar of its color for each, the gaps left pale.
  const spans = [...songs].sort((a, b) => a.start_s - b.start_s);
  const cells: string[] = [];
  let upTo = 0;
  const cell = (seconds: number, color: string | null) => {
    const width = Math.max(color ? 0.4 : 0, (seconds / Math.max(1, run.elapsed_s)) * 100);
    if (width > 0.05) cells.push(`<td width="${width.toFixed(2)}%" style="height:26px;${color ? `background:${color};` : ''}font-size:0;line-height:0;">&nbsp;</td>`);
  };
  for (const x of spans) {
    const from = Math.max(upTo, x.start_s);
    cell(from - upTo, null);
    cell(Math.max(0, x.end_s - from), colorOf(x));
    upTo = Math.max(upTo, x.end_s);
  }
  cell(run.elapsed_s - upTo, null);
  const strip = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 4px;"><tr>
  <td style="font:12px ${FONT};color:${MUTED};">${esc(clock(run.start_time))}</td>
  <td align="right" style="font:12px ${FONT};color:${MUTED};">${esc(clock(run.start_time + run.elapsed_s))}</td>
</tr></table>
<div style="border-radius:8px;overflow:hidden;background:#efeee9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;border-collapse:collapse;background:#efeee9;"><tr>${cells.join('')}</tr></table>
</div>`;

  // Fastest to slowest, as on the app: a song that played more than once is counted once, its plays added together.
  const bySong = new Map<string, { name: string; artist: string; image: string | null; plays: number; seconds: number; distance: number; moving: number }>();
  for (const x of songs) {
    const key = `${x.name}|${x.artist}`;
    const r = bySong.get(key) ?? { name: x.name, artist: x.artist, image: x.image, plays: 0, seconds: 0, distance: 0, moving: 0 };
    r.plays++;
    r.seconds += x.end_s - x.start_s;
    r.distance += x.distance_m;
    r.moving += x.moving_s;
    bySong.set(key, r);
  }
  const ranked = [...bySong.values()]
    .map((r) => ({ ...r, speed: r.moving >= 5 && r.distance > 0 ? r.distance / r.moving : null }))
    .sort((a, b) => (b.speed ?? -1) - (a.speed ?? -1));
  const listed = ranked.slice(0, SONGS_LISTED);
  const framed = (x: { image: string | null; name: string }) =>
    x.image
      ? `<img src="${esc(x.image)}" width="38" height="38" alt="" style="display:block;border:3px solid ${colorOf(x)};border-radius:11px;">`
      : `<div style="width:38px;height:38px;border:3px solid ${colorOf(x)};border-radius:11px;background:#eeede8;color:${MUTED};font:600 16px/38px ${FONT};text-align:center;">${esc((x.name || '?')[0])}</div>`;
  const versus = (speed: number) => u.against(speed, average, s).replace(' than your average', '').replace('your usual', 'usual');

  const progress =
    have >= RUNS_NEEDED && ins.fastest.length
      ? sportBlock(ins, s, unit, user, true)
      : `${heading(`${w.doing[0].toUpperCase()}${w.doing.slice(1)}: still collecting`)}
${dots(Math.min(have, RUNS_NEEDED - 1), true)}
${para(esc(`${Math.min(have, RUNS_NEEDED - 1)} of ${RUNS_NEEDED} ${w.many} with music so far. ${RUNS_NEEDED - Math.min(have, RUNS_NEEDED - 1)} more and your fastest and slowest songs appear.`))}
${ins.most_played.length ? `${heading(`Most played on ${w.many}`)}${table(ins.most_played.slice(0, 3).map((x) => row(x.image, x.name, x.artist, `${x.plays}×`, `on ${plural(x.runs, w.one)}`)).join(''))}` : ''}`;

  const body = `
${head}
${
  map
    ? `<a href="${esc(open)}" target="_blank" style="display:block;text-decoration:none;"><img src="${esc(map)}" width="500" alt="The route, with each song's stretch in the color of its cover" style="display:block;width:100%;height:auto;border:0;border-radius:16px;background:#eae8e3;"></a>`
    : ''
}
<p style="margin:10px 0 18px;font:14px/1.5 ${FONT};color:${SOFT};">${esc(`Music played over ${u.dist(heard)} of ${u.dist(run.distance_m)}.${map ? ' The map shows where on the road each song played; the strip below shows when.' : ''}`)}</p>
${strip}
${heading('Fastest to slowest')}
<p style="margin:-2px 0 8px;font:13px/1.5 ${FONT};color:${MUTED};">${esc(`Your ${s === 'ride' ? 'speed' : 'pace'} while each song played.`)}</p>
${table(listed.map((x) => row(null, x.name, `${x.artist} · ${minSec(x.seconds)}${x.plays > 1 ? ` · ${x.plays} times` : ''}`, x.speed ? u.rate(x.speed, s) : '–', x.speed ? versus(x.speed) : '', framed(x))).join(''))}
${ranked.length > listed.length ? para(esc(`And ${plural(ranked.length - listed.length, 'more song')}, on the site.`)) : ''}
${button(open, `Open this ${w.one}`)}
${progress}
${t.runs + t.rides ? `${heading('This week')}${figures(weekTiles)}` : ''}`;

  const subject = fastest ? `${run.name}: you ${did} fastest to ${fastest.name}` : `${run.name}: ${plural(songs.length, 'song')}`;
  const preview = `${plural(songs.length, 'song')} over ${u.dist(run.distance_m)}. ${weekLine}`;
  const footer = `You're getting this after each run and ride with music because you asked for it in Cadence. <a href="${esc(l.offActivity)}" style="color:${MUTED};">Just Sundays, please</a> · <a href="${esc(l.off)}" style="color:${MUTED};">Turn all emails off</a>.`;
  return {
    subject,
    preview,
    html: shell(subject, hero, body, preview, footer, l.app),
    text: `${run.name}, ${whenDated(run.start_time, user.email_tz)}\n${u.dist(run.distance_m)} · ${length(run.moving_s)} · ${u.rate(average, s)} · ${length(music)} of music\n\n${
      fastest ? `Fastest song: ${fastest.name} by ${fastest.artist}, ${u.rate(speedOf(fastest), s)}.\n\n` : ''
    }Fastest to slowest:\n${ranked.map((x) => `- ${x.name} · ${x.artist}: ${x.speed ? u.rate(x.speed, s) : '–'}`).join('\n')}\n\n${weekLine}\n${
      have >= RUNS_NEEDED ? '' : `${Math.min(have, RUNS_NEEDED - 1)} of ${RUNS_NEEDED} ${w.many} with music so far.\n`
    }\nOpen this ${w.one}: ${open}\nJust Sundays, please: ${l.offActivity}\nTurn all emails off: ${l.off}`,
  };
}

/** Does this account have enough, in either sport, to fill the patterns email? */
export async function hasPatterns(env: Env, user: User): Promise<boolean> {
  for (const sport of SPORTS) if ((await buildInsights(env, user, sport)).fastest.length > 0) return true;
  return false;
}

/** Builds one email. Only the activity email can be null: when there is no run or ride with music to write about. */
export async function buildEmail(
  env: Env,
  origin: string,
  user: EmailUser,
  which: Kind,
  opts: { unit?: string; variant?: Variant; runId?: number } = {},
): Promise<Email | null> {
  // A preview can ask for a unit; otherwise the person's Strava setting decides.
  const own = user.units === 'mi' || user.units === 'km' ? user.units : user.email_units === 'mi' ? 'mi' : 'km';
  const unit = opts.unit === 'mi' || opts.unit === 'km' ? opts.unit : own;
  const email = await (which === 'welcome'
    ? welcome(env, origin, user)
    : which === 'activity'
      ? activity(env, origin, user, unit, opts.runId)
      : weekly(env, origin, user, unit, opts.variant));
  if (!email) return null;
  // Covers are stored as Spotify's 64px thumbnails; the 300px picture of the same cover stays sharp on a phone's screen.
  return { ...email, html: email.html.replaceAll('/image/ab67616d00004851', '/image/ab67616d00001e02') };
}

// --- sending --------------------------------------------------------------------------------

/** True once a Resend API key is set; until then nothing is sent. */
export const canSend = (env: Env) => !!env.RESEND_API_KEY;

/** Sends through Resend (resend.com), which has verified cadence.garvitgupta.com. */
export async function send(env: Env, to: string, email: Email, unsubscribe?: string, replyTo?: string): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: `${FROM.name} <${FROM.email}>`,
      to: [to],
      subject: email.subject,
      html: email.html,
      text: email.text,
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(unsubscribe ? { headers: { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Resend refused the email (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return true;
}

/**
 * A note to the app's owner that someone wants to be let in. Spotify limits
 * the app to a few named accounts, which only the owner can add.
 */
export function accessRequestEmail(env: Env, origin: string, who: User, spotifyEmail: string, message: string): Email {
  const app = `${origin}${env.BASE_PATH}/`;
  const manage = `https://developer.spotify.com/dashboard/${env.SPOTIFY_CLIENT_ID}/users`;
  const hero = `${kicker('Access request')}${headline(`${who.name} wants in`)}${lede('They signed in with Strava and are asking to be added to Spotify.')}`;
  const line = (label: string, value: string) => `
<tr><td style="padding:10px 0;border-top:1px solid ${LINE};font:13px/1.4 ${FONT};color:${SOFT};width:120px;" valign="top">${esc(label)}</td>
<td style="padding:10px 0;border-top:1px solid ${LINE};font:15px/1.4 ${FONT};color:${INK};">${value}</td></tr>`;
  const body = `
${table(
  line('Name', esc(who.name)) +
    line('Spotify email', `<b style="font-weight:600;">${esc(spotifyEmail)}</b>`) +
    line('Strava', `<a href="https://www.strava.com/athletes/${who.strava_athlete_id}" style="color:${ACCENT};">strava.com/athletes/${who.strava_athlete_id}</a>`) +
    (message ? line('Message', esc(message)) : ''),
)}
${heading('To let them in')}
${para('Add their name and Spotify email under User Management, then reply to tell them. They reconnect Spotify in Cadence and it starts working.')}
${button(manage, 'Open User Management')}`;
  return {
    subject: `${who.name} is asking for Spotify access`,
    preview: `Spotify email: ${spotifyEmail}`,
    html: shell('Access request', hero, body, `Spotify email: ${spotifyEmail}`, 'Sent because someone used “Ask for access” in Cadence. Replying goes to them.', app),
    text: `${who.name} is asking for Spotify access to Cadence.\n\nSpotify email: ${spotifyEmail}\nStrava: https://www.strava.com/athletes/${who.strava_athlete_id}\n${message ? `Message: ${message}\n` : ''}\nAdd them here: ${manage}\nReplying to this email goes to them.`,
  };
}

/** Is it Sunday between 9:00 and 9:59 where this person is? */
function sundayNine(tz: string | null): boolean {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(new Date());
    const get = (type: string) => parts.find((p) => p.type === type)?.value;
    return get('weekday') === 'Sun' && Number(get('hour')) === 9;
  } catch {
    return false;
  }
}

/** Cron step: the Sunday roundup, to confirmed addresses, once a week each. */
export async function sendWeekly(env: Env, origin: string): Promise<void> {
  if (!canSend(env)) return;
  const due = await env.DB.prepare(
    `SELECT * FROM users WHERE is_demo = 0 AND email IS NOT NULL AND email_confirmed_at IS NOT NULL AND email_weekly = 1
       AND COALESCE(weekly_sent_at, 0) < ? LIMIT 20`,
  )
    .bind(now() - 6 * 86400)
    .all<EmailUser>();
  for (const user of due.results) {
    if (!sundayNine(user.email_tz)) continue;
    try {
      const email = await buildEmail(env, origin, user, 'weekly');
      if (email) await send(env, user.email!, email, links(env, origin, user).off);
      await env.DB.prepare(`UPDATE users SET weekly_sent_at = ? WHERE id = ?`).bind(now(), user.id).run();
    } catch (err) {
      console.error(`weekly email user ${user.id}:`, err);
    }
  }
}

// Songs land with Spotify when they finish and are fetched every ten minutes, so a run is written up this long after it ends.
const SETTLE_S = 20 * 60;

/** Cron step: the note after each run or ride with music, once each, to those who asked for it. One at a time: each may fetch a few dozen covers. */
export async function sendActivityEmails(env: Env, origin: string): Promise<void> {
  if (!canSend(env)) return;
  const due = await env.DB.prepare(
    `SELECT r.id AS run_id, u.* FROM runs r JOIN users u ON u.id = r.user_id
     WHERE u.is_demo = 0 AND u.email IS NOT NULL AND u.email_confirmed_at IS NOT NULL AND u.activity_emails = 1
       AND r.emailed_at IS NULL AND r.stream_state = 'ok' AND r.matched_at IS NOT NULL
       AND r.start_time >= COALESCE(u.activity_emails_since, 0) AND r.start_time > ?1 - 2 * 86400
       AND r.start_time + r.elapsed_s < ?1 - ?2
       AND EXISTS (SELECT 1 FROM run_songs WHERE run_id = r.id)
     ORDER BY r.start_time LIMIT 1`,
  )
    .bind(now(), SETTLE_S)
    .all<EmailUser & { run_id: number }>();
  for (const user of due.results) {
    try {
      const email = await buildEmail(env, origin, user, 'activity', { runId: user.run_id });
      if (email) await send(env, user.email!, email, links(env, origin, user).off);
      await env.DB.prepare(`UPDATE runs SET emailed_at = ? WHERE id = ?`).bind(now(), user.run_id).run();
    } catch (err) {
      console.error(`activity email run ${user.run_id}:`, err);
    }
  }
}
