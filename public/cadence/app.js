import { activityChart, h, hideTip, minSec, runChart, s as svg, spectrum, stretchStats } from './charts.js';

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

// `size` is true for the small cover, or a class name ('md', 'lg').
const art = (src, name, size) => {
	const cls = `art${size === true ? ' sm' : size ? ` ${size}` : ''}`;
	return src
		? h('img', { class: cls, src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })
		: h('div', { class: cls, 'aria-hidden': 'true' }, (name || '?')[0]);
};

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

const footer = () => h('p', { class: 'foot' }, 'Powered by Strava. Music data from Spotify. These are patterns in your own runs, not proof that a song changes your pace. The first two minutes of each run are left out as warm-up.');

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

// --- connections and data range ---------------------------------------------------------

const MARKS = {
	strava: 'M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169',
	spotify: 'M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z',
};

const agoShort = (ts) => {
	const sec = Math.max(0, Math.round(Date.now() / 1000 - ts));
	return sec < 60 ? `${sec}s ago` : sec < 3600 ? `${Math.floor(sec / 60)}m ago` : sec < 86400 ? `${Math.floor(sec / 3600)}h ago` : `${Math.floor(sec / 86400)}d ago`;
};

// One strip under the header: is each service connected, when was it last
// checked, and how far back the data goes. It keeps itself current.
const statusNode = h('div', { class: 'status' });
let statusStarted = false;

function paintStatus() {
	const me = state.me;
	if (!me) return statusNode.replaceChildren();
	const chip = (key, label) => {
		const c = me[key];
		const good = c.connected && c.ok;
		const text = me.user.is_demo ? 'sample data' : !c.connected ? 'not connected' : !good ? 'needs reconnecting' : c.last_sync_at ? `checked ${agoShort(c.last_sync_at)}` : 'first check pending';
		return h('span', { class: `chip${good ? '' : ' bad'}`, title: `${label}: ${good ? 'connected' : 'not connected'}` },
			svg('svg', { class: `mark ${key}`, viewBox: '0 0 24 24', 'aria-hidden': 'true' }, svg('path', { d: MARKS[key] })),
			h('b', null, label),
			h('span', null, text),
			h('i', { class: 'dot', 'aria-hidden': 'true' }),
		);
	};
	statusNode.replaceChildren(
		chip('strava', 'Strava'),
		chip('spotify', 'Spotify'),
		me.since ? h('span', { class: 'since' }, `Data since ${new Date(me.since * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`) : null,
	);
}

function statusBar() {
	paintStatus();
	if (!statusStarted) {
		statusStarted = true;
		// Tick the "31s ago" text every second; ask the server for fresh times each minute.
		setInterval(paintStatus, 1000);
		setInterval(async () => {
			if (document.hidden || !state.me) return;
			try {
				state.me = await api('api/me');
			} catch {}
		}, 60000);
	}
	return statusNode;
}

// --- dashboard pieces -------------------------------------------------------------------------

/** "28s faster": a song's pace against the person's overall average, per km or mile. */
function paceGap(speed, average, fmt) {
	const sec = Math.round(fmt.unitMeters / average - fmt.unitMeters / speed);
	return sec === 0 ? 'your usual pace' : `${Math.abs(sec)}s ${sec > 0 ? 'faster' : 'slower'}`;
}

/** A pace with its unit always attached, the unit set smaller: 9:03 /mi. */
function paceValue(speed, fmt) {
	const [time, unit] = fmt.pace(speed).split(' ');
	return [time, h('small', null, ` ${unit}`)];
}

/** The same, led by an arrow: coloured and up when faster, grey and down when slower. */
function paceArrow(speed, average, fmt) {
	const sec = Math.round(fmt.unitMeters / average - fmt.unitMeters / speed);
	if (sec === 0) return paceGap(speed, average, fmt);
	return [h('i', { class: `arrow ${sec > 0 ? 'up' : 'down'}`, 'aria-hidden': 'true' }, sec > 0 ? '▲' : '▼'), paceGap(speed, average, fmt)];
}

/** A span that covers every value with a little room either side. */
function span(values, pad = 0.08) {
	const lo = Math.min(...values);
	const hi = Math.max(...values);
	const room = (hi - lo || 1) * pad;
	return [lo - room, hi + room];
}

/** A ranked list of songs: cover, name and artist, one number, one short reason. */
function songList(title, note, rows, value, detail, meter) {
	if (!rows || !rows.length) return null;
	return h('div', { class: 'card list' },
		h('h3', null, title),
		h('p', { class: 'what' }, note),
		h('ol', null, rows.map((r, i) =>
			h('li', null,
				h('span', { class: 'n' }, i + 1),
				art(r.image, r.name, 'md'),
				h('div', { class: 'who' }, h('b', null, r.name), h('span', null, r.artist)),
				h('div', { class: 'num' }, h('b', null, value(r)), detail ? h('span', null, detail(r)) : null),
				meter ? meter(r) : null,
			))),
	);
}

/** One fact: a cover, a big value, a short line. */
function fact(title, note, image, name, big, small, href) {
	const body = [art(image, name), h('div', { class: 'who' }, h('b', null, big), h('span', null, small))];
	return h('div', { class: 'card list' }, h('h3', null, title), h('p', { class: 'what' }, note), href ? h('a', { class: 'fact', href }, body) : h('div', { class: 'fact' }, body));
}

const bar = (fraction, color) => h('i', { class: 'meter' }, h('i', { style: { width: `${Math.max(2, Math.min(1, fraction) * 100)}%`, background: color } }));

function section(title, sub, ...kids) {
	const shown = kids.flat().filter(Boolean);
	return shown.length ? h('section', null, h('h2', null, title), h('p', { class: 'sub' }, sub), shown) : null;
}

/** The whole "enough data" dashboard, top to bottom. */
function story(ins, fmt) {
	const { runs } = state;
	const t = ins.totals;
	const average = t.distance_m / t.moving_s;
	const out = [];

	// 1. The answer the page exists for.
	const top = ins.fastest[0];
	if (top) {
		out.push(h('div', { class: 'card headline' },
			art(top.image, top.name, 'lg'),
			h('div', { class: 'headline-text' },
				h('div', { class: 'kicker' }, 'You run fastest to'),
				h('h1', null, top.name),
				h('p', { class: 'by' }, top.artist),
				h('p', { class: 'proof' }, h('b', null, fmt.pace(top.speed)), ` ${paceGap(top.speed, average, fmt)} than your average`),
			),
		));
	}
	// 2. Pace: every ranked song on one line from slow to fast.
	const paced = [...ins.fastest, ...ins.slowest];
	if (paced.length >= 2) {
		const box = h('div', { class: 'spectrum-box' });
		spectrum(box, paced.map((r) => ({ ...r, value: r.speed })), {
			range: span([...paced.map((r) => r.speed), average]),
			avg: average,
			avgLabel: `your average ${fmt.pace(average)}`,
			left: 'slower',
			right: 'faster',
			describe: (r) => `${fmt.pace(r.speed)} · ${paceGap(r.speed, average, fmt)}`,
		});
		out.push(section('Fastest and slowest songs', 'Each cover sits at the pace you ran while it played.',
			h('div', { class: 'card' }, box),
			h('div', { class: 'pair' },
				songList('Fastest', 'You run quickest to these.', ins.fastest, (r) => paceValue(r.speed, fmt), (r) => paceArrow(r.speed, average, fmt)),
				songList('Slowest', 'You run slowest to these.', ins.slowest, (r) => paceValue(r.speed, fmt), (r) => paceArrow(r.speed, average, fmt)),
			),
		));
	}

	// 3. What gets played.
	const mostPlays = Math.max(1, ...ins.most_played.map((r) => r.plays));
	// The fastest single kilometre, or mile for people who think in miles.
	const miles = fmt.unit === 'mi';
	const km = miles ? ins.best_mile : ins.best_km;
	out.push(section('On repeat', 'What you play most while you run.',
		h('div', { class: 'pair' },
			songList('Most played', 'How many times each came up on a run.', ins.most_played, (r) => `${r.plays}×`, (r) => `on ${plural(r.runs, 'run')}`, (r) => bar(r.plays / mostPlays, 'var(--pace)')),
			songList('New this month', 'First heard on a run in the last 30 days.', ins.new_this_month, (r) => paceValue(r.speed, fmt), (r) => paceArrow(r.speed, average, fmt)),
		),
		h('div', { class: 'pair' },
			ins.opener ? fact('Your opener', 'The song you start runs with most.', ins.opener.image, ins.opener.name, ins.opener.name, `${ins.opener.artist} · started ${plural(ins.opener.count, 'run')}`) : null,
			km ? fact(miles ? 'Fastest mile' : 'Fastest kilometre', `Your quickest single ${miles ? 'mile' : 'km'}, and what was on.`, km.song && km.song.image, km.song ? km.song.name : '♪', minSec(km.seconds), `${km.song ? `${km.song.name} · ` : ''}${day(km.start_time)}`, `#/run/${km.run_id}`) : null,
		),
	));

	// 4. Heart rate, on the same kind of line.
	const hearts = [...ins.heart.low, ...ins.heart.high];
	if (hearts.length >= 2) {
		const box = h('div', { class: 'spectrum-box heart' });
		const avgHr = t.avg_hr;
		const beats = (r) => `${Math.round(r.hr)} bpm`;
		const against = (r) => (avgHr == null ? '' : `${Math.abs(Math.round(r.hr - avgHr))} ${r.hr >= avgHr ? 'above' : 'below'} average`);
		spectrum(box, hearts.map((r) => ({ ...r, value: r.hr })), {
			range: span([...hearts.map((r) => r.hr), ...(avgHr == null ? [] : [avgHr])]),
			avg: avgHr,
			avgLabel: avgHr == null ? '' : `your average ${Math.round(avgHr)}`,
			left: 'calmer',
			right: 'higher',
			describe: (r) => [beats(r), against(r)].filter(Boolean).join(' · '),
		});
		out.push(section('Heart rate', 'Each cover sits at your average heart rate while it played.',
			h('div', { class: 'card' }, box),
			h('div', { class: 'pair' },
				songList('Get your heart going', 'Your heart beats fastest to these.', ins.heart.high.slice(0, 3), beats, against),
				songList('Keep you calm', 'Your heart stays lowest to these.', ins.heart.low.slice(0, 3), beats, against),
			),
		));
	}

	// 5. Habits.
	const parts = [['Morning', 0, 12], ['Afternoon', 12, 17], ['Evening', 17, 24]]
		.map(([name, from, to]) => {
			const mine = runs.filter((r) => {
				const hour = new Date(r.start_time * 1000).getHours();
				return hour >= from && hour < to;
			});
			const moving = mine.reduce((sum, r) => sum + r.moving_s, 0);
			return { name, n: mine.length, speed: moving ? mine.reduce((sum, r) => sum + r.distance_m, 0) / moving : 0 };
		})
		.filter((p) => p.n >= 2);
	const quickest = Math.max(0, ...parts.map((p) => p.speed));
	const split = (r) => h('i', { class: 'meter split' }, h('i', { style: { width: `${r.rate * 100}%` } }));
	const skipText = (r) => `${r.skipped} of ${r.plays}`;
	out.push(section('Habits', 'How you listen while you run.',
		h('div', { class: 'pair' },
			songList('Most skipped', 'You cut these short most often.', ins.skips.most.slice(0, 3), skipText, () => 'plays skipped', split),
			songList('Least skipped', 'You nearly always let these finish.', ins.skips.least.slice(0, 3), skipText, () => 'plays skipped', split),
		),
		h('div', { class: 'pair' },
			parts.length >= 2
				? h('div', { class: 'card list' },
					h('h3', null, 'Time of day'),
					h('p', { class: 'what' }, 'Your average pace by when you run.'),
					h('div', { class: 'day-parts' }, parts.map((p) =>
						h('div', { class: p.speed === quickest ? 'best' : null },
							h('span', null, p.name),
							h('b', null, paceValue(p.speed, fmt)),
							h('span', null, p.speed === quickest ? `fastest · ${plural(p.n, 'run')}` : plural(p.n, 'run')),
						))),
				)
				: null,
			// Each song's slice of everything run since the data began: 4 km of 199 km is 2.0%.
			songList('Share of your distance', `How much of your ${fmt.dist(t.distance_m)} each song played for.`, ins.furthest.slice(0, 3),
				(r) => `${((r.distance_m / t.distance_m) * 100).toFixed(1)}%`, (r) => fmt.dist(r.distance_m)),
		),
	));
	return out.filter(Boolean);
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
	const page = h('div', { class: 'wrap' }, header(), statusBar(), notices());

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

	page.append(...story(ins, fmt));

	page.append(h('section', null,
		h('h2', null, 'Every run'),
		h('p', { class: 'sub' }, 'Open one to see your pace song by song.'),
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
