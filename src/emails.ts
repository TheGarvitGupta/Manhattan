// The two emails Cadence sends, and when.
//
//   welcome  once, when someone turns on email updates (it carries the
//            "confirm your address" button)
//   weekly   9am every Sunday in the reader's own timezone: their last 10
//            songs and activities while Cadence is still collecting, or the
//            top findings once there are enough runs with music
//
// Email is written for mail clients: tables and inline styles only.

import { buildInsights } from './insights';
import { Env, now, User } from './util';

export const FROM = { email: 'no-reply@cadence.garvitgupta.com', name: 'Cadence' };
// Runs with music before the roundup switches from "collecting" to patterns.
const RUNS_NEEDED = 5;
const RUN_TYPES = ['Run', 'TrailRun', 'VirtualRun'];

export type Kind = 'welcome' | 'weekly';
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
}

// --- formatting -------------------------------------------------------------------

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function units(unit: string) {
  const metres = unit === 'mi' ? 1609.344 : 1000;
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
  };
}

const minSec = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
const length = (sec: number) => {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const kind = (type: string) => (RUN_TYPES.includes(type) ? 'Run' : type.replace(/([a-z])([A-Z])/g, '$1 $2'));
const when = (ts: number, tz: string | null) =>
  new Date(ts * 1000).toLocaleString('en-US', { timeZone: tz || 'UTC', weekday: 'short', hour: 'numeric', minute: '2-digit' });

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
const row = (image: string | null, title: string, sub: string, value: string, detail = '', lead = cover(image, title, 44)) => `
<tr>
  <td width="44" style="padding:10px 12px 10px 0;border-top:1px solid ${LINE};">${lead}</td>
  <td style="padding:10px 0;border-top:1px solid ${LINE};font:15px/1.35 ${FONT};color:${INK};">
    <b style="font-weight:600;">${esc(title)}</b><br><span style="color:${SOFT};font-size:13px;">${esc(sub)}</span>
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
  // Each kind has its own background colour, with the glyph in white: runs in
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

  const hero = `${kicker('Welcome')}${headline(`You're in, ${firstName(user)}.`)}${lede('Cadence lines up your Strava runs with what you were listening to on Spotify, and finds the songs you run fastest to.')}`;
  const body = `
${button(l.confirm, 'Confirm my email')}
<p style="margin:0;font:13px/1.5 ${FONT};color:${MUTED};">One tap, so the Sunday roundup goes to the right person.</p>
${heading('What happens next')}
${table(
  step(true, 'Strava connected', 'New activities arrive on their own.') +
    step(spotify, spotify ? 'Spotify connected' : 'Connect Spotify', spotify ? 'Cadence notes each song as you finish it.' : 'Cadence can only match songs it sees from the day you connect.') +
    step(false, 'Run with music on', `After ${RUNS_NEEDED} runs, your fastest and slowest songs from Spotify will appear.`),
)}`;

  return {
    subject: 'Welcome to Cadence',
    preview: 'Confirm your email, then just run with music on.',
    html: shell('Welcome to Cadence', hero, body, 'Confirm your email, then just run with music on.', `You're getting this because you turned on email updates in Cadence. <a href="${esc(l.off)}" style="color:${MUTED};">Turn them off</a>.`, l.app),
    text: `You're in, ${firstName(user)}.\n\nConfirm your email: ${l.confirm}\n\nWhat happens next: run with music on. After ${RUNS_NEEDED} runs your fastest and slowest songs appear, and a short roundup arrives every Sunday at 9am.\n\nOpen Cadence: ${l.app}\nTurn these emails off: ${l.off}`,
  };
}

// --- weekly ------------------------------------------------------------------------------

interface WeekTotals {
  runs: number;
  distance_m: number;
  songs: number;
}

async function week(env: Env, user: User): Promise<WeekTotals> {
  const since = now() - 7 * 86400;
  const row = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM runs WHERE user_id = ?1 AND start_time >= ?2) AS runs,
            (SELECT COALESCE(SUM(distance_m), 0) FROM runs WHERE user_id = ?1 AND start_time >= ?2) AS distance_m,
            (SELECT COUNT(*) FROM plays WHERE user_id = ?1 AND played_at >= ?2) AS songs`,
  )
    .bind(user.id, since)
    .first<WeekTotals>();
  return row ?? { runs: 0, distance_m: 0, songs: 0 };
}

async function weekly(env: Env, origin: string, user: EmailUser, unit: string, forced?: Variant): Promise<Email> {
  const l = links(env, origin, user);
  const u = units(unit);
  const ins = await buildInsights(env, user);
  const t = await week(env, user);
  const ready = ins.fastest.length > 0;
  // The patterns email leads with a fastest song; without one it falls back to collecting.
  const variant: Variant = !ready ? 'collecting' : (forced ?? (ins.totals.runs_with_music >= RUNS_NEEDED ? 'patterns' : 'collecting'));
  const footer = `You're getting this every Sunday because you turned on email updates in Cadence. <a href="${esc(l.off)}" style="color:${MUTED};">Turn them off</a>.`;
  const weekLine = `${plural(t.runs, 'run')}${t.runs ? `, ${u.dist(t.distance_m)}` : ''} and ${plural(t.songs, 'song')} this week.`;

  if (variant === 'collecting') {
    const songs = (
      await env.DB.prepare(
        `SELECT p.played_at, t.name, t.artist, t.image FROM plays p JOIN tracks t ON t.id = p.track_id
         WHERE p.user_id = ? ORDER BY p.played_at DESC LIMIT 10`,
      )
        .bind(user.id)
        .all<{ played_at: number; name: string; artist: string; image: string | null }>()
    ).results;
    const activities = (
      await env.DB.prepare(
        `SELECT a.name, a.type, a.start_time, a.elapsed_s, a.distance_m,
                (SELECT COUNT(*) FROM plays p WHERE p.user_id = a.user_id AND p.played_at > a.start_time
                   AND p.played_at <= a.start_time + a.elapsed_s + 120) AS songs
         FROM activities a WHERE a.user_id = ? ORDER BY a.start_time DESC LIMIT 10`,
      )
        .bind(user.id)
        .all<{ name: string; type: string; start_time: number; elapsed_s: number; distance_m: number; songs: number }>()
    ).results;

    // Previewing this email for an account that is already past it: show a mid-way count.
    const have = ins.totals.runs_with_music >= RUNS_NEEDED ? RUNS_NEEDED - 2 : ins.totals.runs_with_music;
    // One circle per run needed: gold with a tick once it's done.
    const circles = Array.from({ length: RUNS_NEEDED }, (_, i) =>
      i < have
        ? `<td style="padding-right:8px;"><div style="width:34px;height:34px;border-radius:17px;background:${GOLD};color:#4a36c4;font:800 16px/34px ${FONT};text-align:center;">&#10003;</div></td>`
        : `<td style="padding-right:8px;"><div style="width:30px;height:30px;border-radius:17px;border:2px solid #a99df0;color:#a99df0;font:700 13px/30px ${FONT};text-align:center;">${i + 1}</div></td>`,
    ).join('');
    const hero = `${kicker('Still collecting')}${headline(`${have} of ${RUNS_NEEDED} runs with music`)}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0 0;"><tr>${circles}</tr></table>
${lede(`Your fastest and slowest songs appear after ${RUNS_NEEDED}.`)}`;
    const body = `
${figures([[String(t.runs), t.runs === 1 ? 'run this week' : 'runs this week'], [t.runs ? u.dist(t.distance_m) : '–', 'run'], [String(t.songs), t.songs === 1 ? 'song played' : 'songs played']])}
${heading('Last 10 songs')}
${songs.length ? table(songs.map((s) => row(s.image, s.name, s.artist, when(s.played_at, user.email_tz))).join('')) : para('No songs yet. Play something on Spotify and it will show up here.')}
${heading('Last 10 activities')}
${
  activities.length
    ? table(
        activities
          .map((a) =>
            row(null, a.name, `${kind(a.type)} · ${length(a.elapsed_s)}${a.distance_m ? ` · ${u.dist(a.distance_m)}` : ''}`, when(a.start_time, user.email_tz), a.songs ? plural(a.songs, 'song') : 'no songs', glyphTile(a.type, l.app)),
          )
          .join(''),
      )
    : para('No activities yet.')
}
${button(l.app, 'Open Cadence')}`;
    const subject = `Still collecting: ${have} of ${RUNS_NEEDED} runs with music`;
    return {
      subject,
      preview: weekLine,
      html: shell(subject, hero, body, weekLine, footer, l.app),
      text: `${subject}\n\n${weekLine}\n\nLast songs:\n${songs.map((s) => `- ${s.name} · ${s.artist}`).join('\n')}\n\nLast activities:\n${activities.map((a) => `- ${a.name} (${kind(a.type)})`).join('\n')}\n\nOpen Cadence: ${l.app}\nTurn these emails off: ${l.off}`,
    };
  }

  // Patterns: one headline, two short lists, one fact. The site has the rest.
  const average = ins.totals.distance_m / ins.totals.moving_s;
  const top = ins.fastest[0];
  const best = unit === 'mi' ? ins.best_mile : ins.best_km;
  const hero = `${kicker('You run fastest to')}
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
  <td width="104" valign="middle" style="padding-right:18px;">${top.image ? `<img src="${esc(top.image)}" width="104" height="104" alt="" style="display:block;border-radius:18px;border:3px solid #ffffff;">` : cover(null, top.name, 104)}</td>
  <td valign="middle">
    ${headline(top.name)}
    <p style="margin:4px 0 10px;font:16px ${FONT};color:#e4dffc;">${esc(top.artist)}</p>
    <p style="margin:0;font:15px/1.4 ${FONT};color:#e4dffc;"><b style="font-weight:800;font-size:22px;color:${GOLD};">${esc(u.pace(top.speed))}</b>&nbsp; ${esc(u.gap(top.speed, average))}</p>
  </td>
</tr></table>`;
  const body = `
${figures([[String(t.runs), t.runs === 1 ? 'run this week' : 'runs this week'], [t.runs ? u.dist(t.distance_m) : '–', 'run'], [String(t.songs), t.songs === 1 ? 'song played' : 'songs played']])}
${heading('Fastest songs')}
${table(ins.fastest.slice(0, 3).map((s) => row(s.image, s.name, s.artist, u.pace(s.speed), u.gap(s.speed, average).replace(' than your average', ''))).join(''))}
${heading('Most played on runs')}
${table(ins.most_played.slice(0, 3).map((s) => row(s.image, s.name, s.artist, `${s.plays}×`, `on ${plural(s.runs, 'run')}`)).join(''))}
${
  best
    ? `${heading(unit === 'mi' ? 'Fastest mile' : 'Fastest kilometre')}${table(row(best.song?.image ?? null, minSec(best.seconds!), best.song ? `${best.song.name} was playing` : 'No music playing', new Date(best.start_time * 1000).toLocaleDateString('en-US', { timeZone: user.email_tz || 'UTC', month: 'short', day: 'numeric' })))}`
    : ''
}
${button(l.app, 'See everything')}
<p style="margin:0;font:13px/1.5 ${FONT};color:${MUTED};">Slowest songs, heart rate, skips and every run are on the site.</p>`;
  const subject = `You run fastest to ${top.name}`;
  return {
    subject,
    preview: `${u.pace(top.speed)}, ${u.gap(top.speed, average)}. ${weekLine}`,
    html: shell(subject, hero, body, `${u.pace(top.speed)}, ${u.gap(top.speed, average)}. ${weekLine}`, footer, l.app),
    text: `You run fastest to ${top.name} by ${top.artist}: ${u.pace(top.speed)}, ${u.gap(top.speed, average)}.\n\n${weekLine}\n\nFastest songs:\n${ins.fastest.slice(0, 3).map((s) => `- ${s.name}: ${u.pace(s.speed)}`).join('\n')}\n\nSee everything: ${l.app}\nTurn these emails off: ${l.off}`,
  };
}

/** Does this account have enough to fill the patterns email? */
export async function hasPatterns(env: Env, user: User): Promise<boolean> {
  return (await buildInsights(env, user)).fastest.length > 0;
}

export function buildEmail(env: Env, origin: string, user: EmailUser, which: Kind, opts: { unit?: string; variant?: Variant } = {}): Promise<Email> {
  // A preview can ask for a unit; otherwise the person's Strava setting decides.
  const own = user.units === 'mi' || user.units === 'km' ? user.units : user.email_units === 'mi' ? 'mi' : 'km';
  const unit = opts.unit === 'mi' || opts.unit === 'km' ? opts.unit : own;
  return which === 'welcome' ? welcome(env, origin, user) : weekly(env, origin, user, unit, opts.variant);
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
    `SELECT * FROM users WHERE is_demo = 0 AND email IS NOT NULL AND email_confirmed_at IS NOT NULL
       AND COALESCE(weekly_sent_at, 0) < ? LIMIT 20`,
  )
    .bind(now() - 6 * 86400)
    .all<EmailUser>();
  for (const user of due.results) {
    if (!sundayNine(user.email_tz)) continue;
    try {
      const email = await buildEmail(env, origin, user, 'weekly');
      await send(env, user.email!, email, links(env, origin, user).off);
      await env.DB.prepare(`UPDATE users SET weekly_sent_at = ? WHERE id = ?`).bind(now(), user.id).run();
    } catch (err) {
      console.error(`weekly email user ${user.id}:`, err);
    }
  }
}
