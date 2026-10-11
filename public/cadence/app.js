import { activityChart, h, hideTip, minSec, runChart, stretchStats, weekBars } from './charts.js';

const app = document.getElementById('app');
const state = { me: null, insights: null, runs: null, recent: null, units: 'km', allRuns: false, openActivity: null };

try {
	if (localStorage.getItem('cadence-units') === 'mi') state.units = 'mi';
} catch {}

// --- formatting ---------------------------------------------------------------

function formatter() {
	const unit = state.units;
	const unitMeters = unit === 'mi' ? 1609.344 : 1000;
	return {
		unit,
		unitMeters,
		pace(speed) {
			if (!speed) return '–';
			const sec = Math.round(unitMeters / speed);
			return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} /${unit}`;
		},
		dist: (m) => `${(m / unitMeters).toFixed(m / unitMeters >= 100 ? 0 : 1)} ${unit}`,
		speed: (v) => `${((v * 3600) / unitMeters).toFixed(1)} ${unit}/h`,
	};
}

const duration = (sec) => {
	const m = Math.round(sec / 60);
	return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};
const percent = (rel) => `${Math.abs(rel * 100).toFixed(1)}%`;
const versus = (rel) => (Math.abs(rel) < 0.0005 ? 'Same' : `${percent(rel)} ${rel > 0 ? 'faster' : 'slower'}`);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const day = (ts, long) =>
	new Date(ts * 1000).toLocaleDateString(undefined, long ? { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' });
const ago = (ts) => {
	const m = Math.round((Date.now() / 1000 - ts) / 60);
	return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

// --- server -------------------------------------------------------------------

async function api(path, method = 'GET') {
	const res = await fetch(path, { method });
	const body = await res.json().catch(() => ({}));
	if (!res.ok) throw Object.assign(new Error(body.error || 'Something went wrong.'), { status: res.status });
	return body;
}

async function load() {
	try {
		state.me = await api('api/me');
	} catch (err) {
		if (err.status !== 401) return fail(err);
		state.me = null;
		return render();
	}
	try {
		[state.insights, state.runs, state.recent] = await Promise.all([api('api/insights'), api('api/runs').then((r) => r.runs), api('api/recent')]);
	} catch (err) {
		return fail(err);
	}
	render();
}

function fail(err) {
	app.replaceChildren(h('div', { class: 'wrap' }, header(), h('div', { class: 'card note error' }, h('p', null, h('strong', null, 'Cadence could not load.'), err.message))));
}

async function act(fn) {
	try {
		await fn();
	} catch (err) {
		alert(err.message);
	}
	await load();
}

// --- shared pieces ------------------------------------------------------------

const art = (src, name, small) =>
	src
		? h('img', { class: `art${small ? ' sm' : ''}`, src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })
		: h('div', { class: `art${small ? ' sm' : ''}`, 'aria-hidden': 'true' }, (name || '?')[0]);

function header() {
	const me = state.me;
	const unitButton = (u) =>
		h('button', {
			'aria-pressed': String(state.units === u),
			onclick: () => {
				state.units = u;
				try {
					localStorage.setItem('cadence-units', u);
				} catch {}
				render(true);
			},
		}, u);

	return h('header', { class: 'top' },
		h('a', { class: 'brand', href: '#/' }, h('img', { src: 'icon.svg', alt: '' }), 'Cadence'),
		me && h('div', { class: 'seg', role: 'group', 'aria-label': 'Units' }, unitButton('km'), unitButton('mi')),
		me && h('details', { class: 'menu' },
			h('summary', null, me.user.avatar ? h('img', { class: 'avatar', src: me.user.avatar, alt: '', referrerpolicy: 'no-referrer' }) : h('span', { class: 'avatar' }), me.user.name),
			h('div', { class: 'sheet' },
				!me.user.is_demo && h('button', { onclick: () => act(() => api('api/sync', 'POST')) }, 'Sync now'),
				!me.user.is_demo && me.spotify.connected && h('button', { onclick: () => confirm('Disconnect Spotify? Songs already matched are kept.') && act(() => api('api/spotify', 'DELETE')) }, 'Disconnect Spotify'),
				h('button', { onclick: () => act(() => api('auth/logout', 'POST')) }, me.user.is_demo ? 'Leave the demo' : 'Sign out'),
				!me.user.is_demo && h('button', { class: 'danger', onclick: () => confirm('Delete your account and everything Cadence has stored about you? This cannot be undone.') && act(() => api('api/account', 'DELETE')) }, 'Delete my account'),
			),
		),
	);
}

const footer = () => h('p', { class: 'foot' }, 'Powered by Strava. Music data from Spotify. These are patterns in your own runs, not proof that a song changes your pace.');

// --- signed out ---------------------------------------------------------------

const ERRORS = {
	denied: 'Sign-in was cancelled.',
	scope: 'Cadence needs permission to see your activities. Please leave that box ticked and try again.',
	state: 'That sign-in attempt expired. Please try again.',
	failed: 'Something went wrong talking to Strava or Spotify. Please try again.',
};

function landing() {
	const error = ERRORS[new URLSearchParams(location.search).get('error')];
	if (error) history.replaceState(null, '', location.pathname);
	const step = (n, title, text) => h('div', { class: 'card' }, h('div', { class: 'n' }, n), h('h3', null, title), h('p', null, text));

	return h('div', { class: 'wrap' },
		header(),
		h('main', { class: 'hero' },
			error && h('div', { class: 'card note error' }, h('p', null, error)),
			h('h1', null, 'Which songs make you run faster?'),
			h('p', { class: 'lede' }, 'Cadence lines up your Strava runs with what you were listening to on Spotify, and shows how your pace moves with the music.'),
			h('div', { class: 'actions' },
				h('a', { class: 'btn strava', href: 'auth/strava' }, 'Connect with Strava'),
				h('button', { class: 'btn', onclick: () => act(() => api('auth/demo', 'POST')) }, 'See the demo'),
			),
			h('div', { class: 'steps' },
				step('1', 'Sign in with Strava', 'Your Strava account is your Cadence account. No password to remember.'),
				step('2', 'Connect Spotify', 'Cadence notes what you listen to from that moment on.'),
				step('3', 'Just run', 'New runs are matched to their songs automatically.'),
			),
			h('p', { class: 'fine' }, 'Cadence only reads your runs and your listening history. You can delete everything at any time.'),
		),
	);
}

// --- dashboard ----------------------------------------------------------------

function notices() {
	const me = state.me;
	const out = [];
	if (me.user.is_demo) {
		out.push(h('div', { class: 'card note' },
			h('p', null, h('strong', null, 'This is simulated data.'), 'A made-up runner with six months of runs and songs, so you can see what Cadence finds.'),
			h('button', { class: 'btn', onclick: () => act(() => api('auth/logout', 'POST')) }, 'Use my own runs'),
		));
		return out;
	}
	if (!me.strava.ok) {
		out.push(h('div', { class: 'card note error' }, h('p', null, h('strong', null, 'Strava needs reconnecting.'), 'Cadence lost access to your runs.'), h('a', { class: 'btn strava', href: 'auth/strava' }, 'Reconnect Strava')));
	}
	if (!me.spotify.connected) {
		out.push(h('div', { class: 'card note' }, h('p', null, h('strong', null, 'One more step: connect Spotify.'), 'Cadence can only match songs it sees from now on, so connect before your next run.'), h('a', { class: 'btn spotify', href: 'auth/spotify' }, 'Connect Spotify')));
	} else if (me.spotify.not_allowed) {
		out.push(h('div', { class: 'card note error' }, h('p', null, h('strong', null, 'Your Spotify account isn’t on the guest list yet.'), 'Spotify only lets Cadence connect a handful of people, each added by hand. Send Garvit the email address on your Spotify account, then reconnect once you’ve been added.'), h('a', { class: 'btn spotify', href: 'auth/spotify' }, 'Reconnect Spotify')));
	} else if (!me.spotify.ok) {
		out.push(h('div', { class: 'card note error' }, h('p', null, h('strong', null, 'Spotify needs reconnecting.'), 'Cadence lost access to your listening history.'), h('a', { class: 'btn spotify', href: 'auth/spotify' }, 'Reconnect Spotify')));
	}
	return out;
}

function tile(label, value, unit) {
	return h('div', { class: 'card tile' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value, unit && h('span', { class: 'unit' }, unit)));
}

/**
 * A compact ranked list: cover, name, one number, and a thin meter under each
 * row. With `range` the meter is a dot placed between two ends (for measures
 * like pace that don't start at zero); without it, a bar from zero.
 */
function mini(title, rows, o) {
	if (!rows || !rows.length) return null;
	const [lo, hi] = o.range || [0, Math.max(...rows.map(o.amount))];
	const label = o.name || ((r) => r.name);
	return h('div', { class: 'card mini' },
		h('h3', null, title),
		h('ol', { class: o.plain ? 'plain' : null }, rows.map((r) => {
			const f = hi > lo ? Math.min(1, Math.max(0, (o.amount(r) - lo) / (hi - lo))) : 1;
			const mark = h('i', { style: o.range ? { left: `${5 + f * 90}%`, background: o.color } : { width: `${Math.max(2, f * 100)}%`, background: o.color } });
			return h('li', { title: r.artist ? `${r.name} · ${r.artist}` : null },
				o.plain ? null : art(r.image, label(r), true),
				h('span', { class: 'name' }, label(r)),
				h('b', null, o.value(r)),
				h('i', { class: `meter${o.range ? ' dot' : ''}` }, mark),
			);
		})),
		o.ends ? h('div', { class: 'ends' }, h('span', null, o.ends[0]), h('span', null, o.ends[1])) : null,
	);
}

/** One headline fact: a cover, a big value, a short line. */
function feature(title, image, name, big, small, href) {
	const body = [art(image, name), h('div', { class: 'who' }, h('b', null, big), h('span', null, small))];
	return h('div', { class: 'card mini' }, h('h3', null, title), href ? h('a', { class: 'feature', href }, body) : h('div', { class: 'feature' }, body));
}

/** A span that covers every value with a little room either side. */
function span(values, pad = 0.08) {
	const lo = Math.min(...values);
	const hi = Math.max(...values);
	const room = (hi - lo || 1) * pad;
	return [lo - room, hi + room];
}

function songCards(ins, fmt) {
	const { runs } = state;
	const BLUE = 'var(--pace)';
	const pacePool = [...ins.fastest, ...ins.slowest, ...ins.new_this_month].map((r) => r.speed);
	const paceRange = pacePool.length ? span(pacePool) : null;
	const pace = { amount: (r) => r.speed, value: (r) => fmt.pace(r.speed).split(' ')[0], range: paceRange, color: BLUE, ends: ['slower', `faster · min/${fmt.unit}`] };
	const hrPool = [...ins.heart.high, ...ins.heart.low].map((r) => r.hr);
	const heart = { amount: (r) => r.hr, value: (r) => Math.round(r.hr), range: hrPool.length ? span(hrPool) : null, color: 'var(--heart)', ends: ['lower', 'higher · bpm'] };

	// Pace by time of day, in the viewer's own timezone.
	const parts = [['Morning', 0, 12], ['Afternoon', 12, 17], ['Evening', 17, 24]]
		.map(([name, from, to]) => {
			const mine = runs.filter((r) => { const hr = new Date(r.start_time * 1000).getHours(); return hr >= from && hr < to; });
			const moving = mine.reduce((a, r) => a + r.moving_s, 0);
			return { name: `${name} · ${mine.length}`, n: mine.length, speed: moving ? mine.reduce((a, r) => a + r.distance_m, 0) / moving : 0 };
		})
		.filter((p) => p.n >= 2);

	// Minutes with music for each of the last twelve weeks, Monday to Sunday.
	const monday = new Date();
	monday.setHours(0, 0, 0, 0);
	monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
	const weeks = Array.from({ length: 12 }, (_, i) => {
		const start = new Date(monday);
		start.setDate(start.getDate() - 7 * (11 - i));
		return { start, seconds: 0 };
	});
	for (const r of ins.per_run) {
		const i = 11 - Math.floor((monday.getTime() / 1000 + 7 * 86400 - r.t) / (7 * 86400));
		if (weeks[i]) weeks[i].seconds += r.music_s;
	}
	const weekBox = h('div', { class: 'chart' });
	const weekly = weeks.some((w) => w.seconds) ? h('div', { class: 'card mini wide' }, h('h3', null, 'Music each week'), weekBox) : null;
	if (weekly) weekBars(weekBox, weeks, duration);

	const km = ins.best_km;
	return h('div', { class: 'minis' },
		mini('Most played', ins.most_played, { amount: (r) => r.plays, value: (r) => `${r.plays}×`, color: BLUE }),
		mini('Fastest', ins.fastest, pace),
		mini('Endurance', ins.slowest, pace),
		mini('Carried you furthest', ins.furthest, { amount: (r) => r.distance_m, value: (r) => fmt.dist(r.distance_m), color: BLUE }),
		mini('On your long runs', ins.long_run, { amount: (r) => r.run_m, value: (r) => fmt.dist(r.run_m), color: BLUE }),
		mini('New this month', ins.new_this_month, pace),
		mini('Heart-rate raisers', ins.heart.high, heart),
		mini('Heart-rate calmers', ins.heart.low, heart),
		mini('Most skipped', ins.skips.most, { amount: (r) => r.rate, value: (r) => `${r.skipped} of ${r.plays}`, range: [0, 1], color: 'var(--slower)', ends: ['never', 'always'] }),
		mini('Never skipped', ins.skips.least.filter((r) => r.skipped === 0), { amount: (r) => r.plays, value: (r) => `${r.plays}×`, color: BLUE }),
		mini('Top artists', ins.top_artists, { amount: (r) => r.moving_s, value: (r) => duration(r.moving_s), name: (r) => r.artist, plain: true, color: BLUE }),
		mini('Time of day', parts, { amount: (r) => r.speed, value: (r) => fmt.pace(r.speed).split(' ')[0], range: parts.length ? span(parts.map((p) => p.speed), 0.3) : null, plain: true, color: BLUE, ends: ['slower', 'faster'] }),
		ins.opener ? feature('Your opener', ins.opener.image, ins.opener.name, ins.opener.name, `starts ${plural(ins.opener.count, 'run')}`) : null,
		km ? feature('Fastest kilometre', km.song && km.song.image, km.song ? km.song.name : '♪', minSec(km.seconds), `${km.song ? km.song.name : 'no music'} · ${day(km.start_time)}`, `#/run/${km.run_id}`) : null,
		weekly,
	);
}

const RUNS_SHOWN = 10;

function runsTable(all, fmt) {
	const runs = state.allRuns ? all : all.slice(0, RUNS_SHOWN);
	return h('div', { class: 'card' }, h('div', { class: 'scroll' },
		h('table', { class: 'table' },
			h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Run'), h('th', { class: 'n' }, 'Distance'), h('th', { class: 'n' }, 'Pace'), h('th', { class: 'n hide-s' }, 'Songs'))),
			h('tbody', null, runs.map((r) =>
				h('tr', { class: 'go', tabindex: '0', onclick: () => (location.hash = `#/run/${r.id}`), onkeydown: (e) => e.key === 'Enter' && (location.hash = `#/run/${r.id}`) },
					h('td', { class: 'dim' }, day(r.start_time)),
					h('td', null, r.name),
					h('td', { class: 'n' }, fmt.dist(r.distance_m)),
					h('td', { class: 'n' }, fmt.pace(r.distance_m / r.moving_s)),
					h('td', { class: 'n hide-s' }, r.songs || h('span', { class: 'dim' }, '–')),
				),
			)),
		),
	), all.length > runs.length && h('button', { class: 'btn more', onclick: () => ((state.allRuns = true), render(true)) }, `Show all ${all.length} runs`));
}

const RUN_TYPES = ['Run', 'TrailRun', 'VirtualRun'];
const words = (type) => type.replace(/([a-z])([A-Z])/g, '$1 $2');

const clockTime = (ts) => new Date(ts * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const dayName = (ts) => {
	const today = new Date().setHours(0, 0, 0, 0) / 1000;
	return ts >= today ? 'Today' : ts >= today - 86400 ? 'Yesterday' : new Date(ts * 1000).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};
const kind = (a) => (RUN_TYPES.includes(a.type) ? 'Run' : words(a.type));

/** An opened activity: the activity across the page, its songs under it, and its data under those. */
// Under the chart, each distinct song is listed once with its totals for the activity.
function opened(act, fmt) {
	const box = h('div', { class: 'chart' });
	const note = h('p', { class: 'sub tally', hidden: true }, 'Speed, heart rate and the rest arrive with the next Strava check, within about 10 minutes.');
	const music = act.songs.reduce((sum, s) => sum + (s.to - s.from), 0);
	const isRun = RUN_TYPES.includes(act.type);
	const table = h('div');

	// One row per distinct song: every time it played is added together.
	const fillTable = (streams) => {
		if (!act.songs.length) return;
		const bySong = new Map();
		for (const song of act.songs) {
			const key = `${song.name}|${song.artist}`;
			let row = bySong.get(key);
			if (!row) bySong.set(key, (row = { ...song, plays: 0, seconds: 0, distance: 0, moving: 0, hrSum: 0, hrN: 0 }));
			const st = stretchStats(streams, song.from - act.start_time, song.to - act.start_time);
			row.plays++;
			row.seconds += song.to - song.from;
			row.distance += st.distance || 0;
			row.moving += st.moving || 0;
			row.hrSum += st.hrSum || 0;
			row.hrN += st.hrN || 0;
		}
		const rows = [...bySong.values()].sort((a, b) => b.seconds - a.seconds);
		const dash = () => h('span', { class: 'dim' }, '–');
		const speed = (r) => (r.moving >= 5 && r.distance > 0 ? (isRun ? fmt.pace(r.distance / r.moving) : fmt.speed(r.distance / r.moving)) : dash());
		table.replaceChildren(h('div', { class: 'scroll' }, h('table', { class: 'table' },
			h('thead', null, h('tr', null,
				h('th', null, 'Song'),
				h('th', { class: 'n' }, 'Played for'),
				streams && h('th', { class: 'n' }, isRun ? 'Average pace' : 'Average speed'),
				streams && h('th', { class: 'n' }, 'Average heart rate'),
			)),
			h('tbody', null, rows.map((r) =>
				h('tr', null,
					h('td', null, h('div', { class: 'song' }, art(r.image, r.name, true), h('div', null, h('b', null, r.name), ' ', h('span', null, r.artist), r.plays > 1 ? h('span', { class: 'dim' }, ` · played ${r.plays} times`) : null))),
					h('td', { class: 'n' }, minSec(r.seconds)),
					streams && h('td', { class: 'n' }, speed(r)),
					streams && h('td', { class: 'n' }, r.hrN ? `${Math.round(r.hrSum / r.hrN)} bpm` : dash()),
				),
			)),
		)));
	};

	const card = h('div', { class: 'card' },
		h('div', { class: 'opened-head' },
			h('div', null,
				h('h3', null, act.name),
				h('p', { class: 'sub' }, `${kind(act)} · ${dayName(act.start_time)}, ${clockTime(act.start_time)} – ${clockTime(act.start_time + act.elapsed_s)} · ${duration(act.elapsed_s)}${act.distance_m ? ` · ${fmt.dist(act.distance_m)}` : ''}`),
			),
			h('button', { class: 'btn small', onclick: () => ((state.openActivity = null), render(true)) }, 'Close'),
		),
		box,
		note,
		act.songs.length ? h('p', { class: 'sub tally' }, `${plural(act.songs.length, 'song')} · music for ${duration(music)} of ${duration(act.elapsed_s)}`) : null,
		table,
		act.run_id ? h('a', { class: 'btn small more', href: `#/run/${act.run_id}` }, 'See pace song by song') : null,
	);

	const chart = activityChart(box, act, fmt);
	fillTable(null);
	api(`api/activities/${act.id}`)
		.then(({ streams }) => {
			chart.setStreams(streams);
			fillTable(streams);
			note.hidden = !!streams || !act.songs.length || state.me.user.is_demo;
		})
		.catch(() => {});
	return card;
}

/** The latest activities and songs side by side; opening an activity lays it out against its songs. */
function latest(fmt) {
	const { me, recent } = state;
	const open = recent.activities.find((a) => a.id === state.openActivity);
	const checked = (c) => (me.user.is_demo || !c.last_sync_at ? '' : ` Checked ${ago(c.last_sync_at)}.`);

	const activities = recent.activities.map((a) =>
		h('li', null, h('button', { class: `row${RUN_TYPES.includes(a.type) ? '' : ' off'}`, onclick: () => ((state.openActivity = a.id), render(true)) },
			h('div', { class: 'who' },
				h('b', null, a.name),
				h('span', null, `${kind(a)} · ${duration(a.elapsed_s)} · ${a.songs.length ? plural(a.songs.length, 'song') : 'no songs'}`),
			),
			h('span', { class: 'at' }, `${dayName(a.start_time)}, ${clockTime(a.start_time)}`),
			h('span', { class: 'go', 'aria-hidden': 'true' }, '›'),
		)));

	const songs = recent.songs.map((s) =>
		h('li', null, h('div', { class: 'row' },
			art(s.image, s.name, true),
			h('div', { class: 'who' }, h('b', null, s.name), h('span', null, s.artist)),
			h('span', { class: 'at' }, `${dayName(s.to)}, ${clockTime(s.to)} · ${minSec(s.to - s.from)}`),
		)));

	const list = (rows, empty) => (rows.length ? h('ul', { class: 'rows' }, rows) : h('p', { class: 'dim' }, empty));
	return h('section', { id: 'latest' },
		h('h2', null, 'The last 7 days'),
		h('p', { class: 'sub' }, open ? 'What was playing, and for how long.' : 'Open an activity to see what was playing during it.'),
		open
			? opened(open, fmt)
			: h('div', { class: 'pair' },
				h('div', { class: 'card' }, h('h3', null, `Strava activities · ${activities.length}`), h('p', { class: 'sub' }, `Most recent first.${checked(me.strava)}`), list(activities, 'No activities in the last 7 days.')),
				h('div', { class: 'card' }, h('h3', null, `Spotify songs · ${songs.length}`), h('p', { class: 'sub' }, `When each ended, and how long it played.${checked(me.spotify)}`), list(songs, me.spotify.connected ? 'No songs in the last 7 days. Play something and check back in a few minutes.' : 'Connect Spotify to see your songs here.')),
			),
	);
}

// Runs with music needed before the song cards replace the "collecting" view.
const RUNS_NEEDED = 5;

function dashboard() {
	const { me, insights: ins, runs } = state;
	const fmt = formatter();
	const page = h('div', { class: 'wrap' }, header(), notices());

	// Until there are enough runs with music for the song cards to mean anything,
	// the page shows what is being collected instead: the last 7 days.
	const have = ins.totals.runs_with_music;
	if (have < RUNS_NEEDED) {
		page.append(h('div', { class: 'card note collecting' },
			h('p', null,
				h('strong', null, `Collecting your runs: ${have} of ${RUNS_NEEDED}`),
				`Your song patterns appear after ${RUNS_NEEDED} runs with music. Cadence can only match songs it sees from the day you connect, so just keep running with Spotify on.`),
			h('i', { class: 'meter' }, h('i', { style: { width: `${(have / RUNS_NEEDED) * 100}%`, background: 'var(--pace)' } })),
		));
		page.append(latest(fmt));
		if (runs.length) {
			page.append(h('section', null, h('h2', null, 'Runs'), h('p', { class: 'sub' }, 'Open a run to see its pace song by song.'), runsTable(runs, fmt)));
		}
		page.append(footer());
		return page;
	}

	const t = ins.totals;
	page.append(h('div', { class: 'tiles' },
		tile('Runs', t.runs),
		tile('Distance', (t.distance_m / fmt.unitMeters).toFixed(0), fmt.unit),
		tile('Time running to music', duration(t.music_s)),
		tile('Songs heard on runs', t.tracks),
	));

	page.append(h('section', null,
		h('h2', null, 'Your songs on runs'),
		h('p', { class: 'sub' }, 'Hover a song for its artist.'),
		songCards(ins, fmt),
	));

	page.append(h('section', null,
		h('h2', null, 'Runs'),
		h('p', { class: 'sub' }, me.user.is_demo || !me.strava.last_sync_at ? 'Open a run to see its pace song by song.' : `Open a run to see its pace song by song. Last checked Strava ${ago(me.strava.last_sync_at)}.`),
		runsTable(runs, fmt),
	));
	page.append(footer());
	return page;
}

// --- one run ------------------------------------------------------------------

async function runPage(id) {
	const fmt = formatter();
	const page = h('div', { class: 'wrap' }, header(), h('a', { class: 'back', href: '#/' }, '← All runs'));
	app.replaceChildren(page);
	let run;
	try {
		run = await api(`api/runs/${id}`);
	} catch (err) {
		page.append(h('div', { class: 'card note' }, h('p', null, err.status === 404 ? 'That run could not be found.' : err.message)));
		return;
	}
	const speed = run.distance_m / run.moving_s;
	const box = h('div', { class: 'chart' });
	const songs = run.songs.filter((s) => s.moving_s >= 20);

	page.append(
		h('h1', { class: 'title' }, run.name),
		h('p', { class: 'when' }, day(run.start_time, true)),
		h('div', { class: 'tiles' },
			tile('Distance', (run.distance_m / fmt.unitMeters).toFixed(2), fmt.unit),
			tile('Average pace', fmt.pace(speed).split(' ')[0], `/${fmt.unit}`),
			tile('Moving time', duration(run.moving_s)),
			run.avg_hr ? tile('Average heart rate', Math.round(run.avg_hr), 'bpm') : tile('Songs', songs.length),
		),
		h('section', null,
			h('h2', null, 'Pace, song by song'),
			h('p', { class: 'sub' }, songs.length ? 'Each shaded block is one song.' : 'No songs were matched to this run.'),
			h('div', { class: 'card' },
				h('div', { class: 'legend' },
					h('span', null, h('i', { class: 'key line', style: { background: 'var(--pace)', height: '3px' } }), 'Average pace per song'),
					h('span', null, h('i', { class: 'key line faint', style: { background: 'var(--pace)' } }), 'Pace'),
					run.streams.hr && h('span', null, h('i', { class: 'key line', style: { background: 'var(--heart)' } }), 'Heart rate'),
				),
				box,
			),
		),
	);

	if (songs.length) {
		page.append(h('section', null,
			h('h2', null, 'Songs on this run'),
			h('p', { class: 'sub' }, 'Compared with your average pace for the whole run.'),
			h('div', { class: 'card' }, h('div', { class: 'scroll' },
				h('table', { class: 'table' },
					h('thead', null, h('tr', null, h('th', null, 'Song'), h('th', { class: 'n hide-s' }, 'From'), h('th', { class: 'n' }, 'Pace'), h('th', { class: 'n' }, 'Against run average'), h('th', { class: 'n hide-s' }, 'Heart rate'))),
					h('tbody', null, songs.map((s) => {
						const v = s.distance_m / s.moving_s;
						return h('tr', null,
							h('td', null, h('div', { class: 'song' }, art(s.image, s.name, true), h('div', null, h('b', null, s.name), ' ', h('span', null, s.artist), s.skipped ? h('span', { class: 'dim' }, ' · cut short') : null))),
							h('td', { class: 'n dim hide-s' }, `${Math.floor(s.start_s / 60)}:${String(Math.round(s.start_s % 60)).padStart(2, '0')}`),
							h('td', { class: 'n' }, fmt.pace(v)),
							h('td', { class: 'n' }, versus(v / speed - 1)),
							h('td', { class: 'n hide-s' }, s.avg_hr ? Math.round(s.avg_hr) : h('span', { class: 'dim' }, '–')),
						);
					})),
				),
			)),
		));
	}
	page.append(footer());
	runChart(box, run, fmt);
}

// --- routing ------------------------------------------------------------------

function render(keepScroll) {
	hideTip();
	if (!state.me) return app.replaceChildren(landing());
	const run = location.hash.match(/^#\/run\/(\d+)$/);
	if (run) return runPage(run[1]);
	app.replaceChildren(dashboard());
	if (keepScroll !== true) scrollTo(0, 0);
}

addEventListener('hashchange', () => render());
load();
