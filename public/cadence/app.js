import { changesChart, h, hideTip, runChart } from './charts.js';

const app = document.getElementById('app');
const state = { me: null, insights: null, runs: null, recent: null, units: 'km', allRuns: false };

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
	};
}

const duration = (sec) => {
	const m = Math.round(sec / 60);
	return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};
const percent = (rel) => `${Math.abs(rel * 100).toFixed(1)}%`;
const signed = (rel) => (Math.abs(rel) < 0.0005 ? '0.0%' : `${rel > 0 ? '+' : '−'}${percent(rel)}`);
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

function finding(kicker, title, detail, image) {
	return h('div', { class: 'card finding' }, image, h('div', null, h('div', { class: 'kicker' }, kicker), h('h3', null, title), h('p', null, detail)));
}

const SAME = 0.004; // under 0.4% is "about the same"

function findings(ins, fmt) {
	const out = [];
	const songs = ins.songs;
	if (songs.length >= 2) {
		const fast = songs[0];
		const slow = songs[songs.length - 1];
		const line = (s) => `${fmt.pace(s.speed)} over ${duration(s.moving_s)} on ${plural(s.runs, 'run')}`;
		if (fast.rel > 0) out.push(finding('Fastest song', `You run fastest to “${fast.name}”`, `${percent(fast.rel)} quicker than the rest of those runs. ${line(fast)}.`, art(fast.image, fast.name)));
		if (slow.rel < 0) out.push(finding('Slowest song', `You slow down for “${slow.name}”`, `${percent(slow.rel)} slower than the rest of those runs. ${line(slow)}.`, art(slow.image, slow.name)));
	}
	if (ins.artists.length >= 2 && ins.artists[0].rel > 0) {
		const a = ins.artists[0];
		out.push(finding('Fastest artist', `${a.artist} gets the most out of you`, `${percent(a.rel)} quicker than your run average across ${duration(a.moving_s)} of their songs.`));
	}
	if (ins.changes) {
		const { few, many } = ins.changes;
		const longer = few.distance_m >= many.distance_m ? few : many;
		out.push(finding('Distance', longer === few ? 'You run longest when you let songs play' : 'You run longest when you keep changing songs',
			`${fmt.dist(few.distance_m)} on average when songs change least, ${fmt.dist(many.distance_m)} when they change most. ${plural(few.n + many.n, 'run')}.`));
		const rel = many.speed / few.speed - 1;
		out.push(finding('Pace', Math.abs(rel) < SAME ? 'Changing songs doesn’t change your pace' : rel > 0 ? 'You run faster when songs change often' : 'You run faster when you let songs play',
			`${fmt.pace(many.speed)} when songs change most, ${fmt.pace(few.speed)} when they change least.`));
	}
	if (ins.music) {
		const rel = ins.music.with.speed / ins.music.without.speed - 1;
		out.push(finding('Music or silence', Math.abs(rel) < SAME ? 'Music makes no difference to your pace' : `You run ${percent(rel)} ${rel > 0 ? 'faster' : 'slower'} with music`,
			`${fmt.pace(ins.music.with.speed)} with music (${plural(ins.music.with.n, 'run')}), ${fmt.pace(ins.music.without.speed)} without (${plural(ins.music.without.n, 'run')}).`));
	}
	if (ins.familiarity) {
		const { fresh, familiar } = ins.familiarity;
		const diff = familiar.rel - fresh.rel;
		out.push(finding('Old favourites', Math.abs(diff) < SAME ? 'New songs and old favourites pace you the same' : diff > 0 ? 'You run faster to songs you know' : 'New songs speed you up',
			`Songs you've run to before: ${signed(familiar.rel)} against your run average. First-time songs: ${signed(fresh.rel)}.`));
	}
	if (ins.skipping) {
		const { skipped, played } = ins.skipping;
		const diff = skipped.rel - played.rel;
		out.push(finding('Skips', Math.abs(diff) < SAME ? 'Skipping a song doesn’t change your pace' : diff < 0 ? 'You skip the songs that slow you down' : 'You speed up for songs you end up skipping',
			`Songs you cut short: ${signed(skipped.rel)} against your run average. Songs you let finish: ${signed(played.rel)}.`));
	}
	return out;
}

function ranking(songs, fmt) {
	const top = songs.filter((s) => s.rel > 0).slice(0, 6);
	const bottom = songs.filter((s) => s.rel < 0).slice(-6);
	const max = Math.max(...[...top, ...bottom].map((s) => Math.abs(s.rel)));
	const row = (s) =>
		h('div', { class: 'row', title: `${duration(s.moving_s)} on ${plural(s.runs, 'run')}` },
			art(s.image, s.name, true),
			h('div', { class: 'who' }, h('b', null, s.name), h('span', null, s.artist)),
			h('div', { class: 'track' }, h('div', { class: `bar ${s.rel >= 0 ? 'up' : 'down'}`, style: { width: `${(Math.abs(s.rel) / max) * 48}%` } })),
			h('div', { class: 'num' }, h('b', null, signed(s.rel)), h('span', null, fmt.pace(s.speed))),
		);
	return h('div', { class: 'card' },
		h('div', { class: 'legend' },
			h('span', null, h('i', { class: 'key', style: { background: 'var(--faster)' } }), 'Faster than the rest of the run'),
			h('span', null, h('i', { class: 'key', style: { background: 'var(--slower)' } }), 'Slower'),
		),
		h('div', { class: 'rank' }, top.map(row), top.length && bottom.length ? h('div', { class: 'gap' }) : null, bottom.map(row)),
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

/** One timeline of the latest songs and activities fetched, to show the connections are alive. */
function latest(fmt) {
	const { me, recent } = state;
	const items = [
		...recent.songs.map((s) => ({ ...s, at: s.played_at, song: true })),
		...recent.activities.map((a) => ({ ...a, at: a.start_time })),
	].sort((x, y) => y.at - x.at);

	const checked = [['Spotify', me.spotify], ['Strava', me.strava]]
		.filter(([, c]) => !me.user.is_demo && c.last_sync_at)
		.map(([name, c]) => `${name} checked ${ago(c.last_sync_at)}`)
		.join(' · ');

	const today = new Date().setHours(0, 0, 0, 0) / 1000;
	const dayLabel = (ts) => (ts >= today ? 'Today' : ts >= today - 86400 ? 'Yesterday' : new Date(ts * 1000).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }));
	const time = (ts) => new Date(ts * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

	const rows = [];
	let heading = null;
	for (const item of items) {
		const label = dayLabel(item.at);
		if (label !== heading) rows.push(h('li', { class: 'day' }, (heading = label)));
		if (item.song) {
			rows.push(h('li', { class: 'song' },
				h('span', { class: 'at' }, time(item.at)),
				h('i', { class: 'dot' }),
				art(item.image, item.name, true),
				h('div', { class: 'who' }, h('b', null, item.name), h('span', null, item.artist)),
			));
			continue;
		}
		const isRun = RUN_TYPES.includes(item.type);
		const who = h('div', { class: 'who' },
			h('b', null, item.name),
			h('span', null, isRun ? `Run · ${fmt.dist(item.distance_m)}${item.run_id ? '' : ' · not tracked'}` : `${words(item.type)} · not a run, so not tracked`),
		);
		rows.push(h('li', { class: `act${isRun ? '' : ' off'}` },
			h('span', { class: 'at' }, time(item.at)),
			h('i', { class: 'dot' }),
			item.run_id ? h('a', { href: `#/run/${item.run_id}` }, who) : who,
		));
	}

	return h('section', null,
		h('h2', null, 'Latest from your accounts'),
		h('p', { class: 'sub' }, checked || 'The most recent songs and activities Cadence has picked up.'),
		h('div', { class: 'card' },
			h('div', { class: 'legend' },
				h('span', null, h('i', { class: 'key round', style: { background: 'var(--spotify)' } }), 'Song played on Spotify'),
				h('span', null, h('i', { class: 'key round', style: { background: 'var(--strava)' } }), 'Activity on Strava'),
			),
			rows.length ? h('ol', { class: 'timeline' }, rows) : h('p', { class: 'dim' }, 'Nothing fetched yet. Choose Sync now from the menu, or play a song and check back in a few minutes.'),
		),
	);
}

function dashboard() {
	const { me, insights: ins, runs } = state;
	const fmt = formatter();
	const page = h('div', { class: 'wrap' }, header(), notices());

	if (!runs.length) {
		page.append(h('div', { class: 'card note' }, h('p', null,
			h('strong', null, 'Nothing to show yet.'),
			'Cadence starts collecting when you connect. Spotify only shares your most recent songs, so earlier runs can’t be matched. Go for a run with music on and check back afterwards.')));
		page.append(latest(fmt), footer());
		return page;
	}

	const t = ins.totals;
	page.append(h('div', { class: 'tiles' },
		tile('Runs', t.runs),
		tile('Distance', (t.distance_m / fmt.unitMeters).toFixed(0), fmt.unit),
		tile('Time running to music', duration(t.music_s)),
		tile('Songs heard on runs', t.tracks),
	));

	const found = findings(ins, fmt);
	page.append(h('section', null,
		h('h2', null, 'What your runs say'),
		h('p', { class: 'sub' }, found.length ? 'Each song is compared with the pace of the run it played on. The first two minutes of a run are left out as warm-up.' : 'Not enough runs with music yet. Findings appear after a few more.'),
		h('div', { class: 'findings' }, found),
	));

	if (ins.songs.length >= 2) {
		page.append(h('section', null,
			h('h2', null, 'Your fastest and slowest songs'),
			h('p', { class: 'sub' }, 'How much quicker or slower you ran while each song played.'),
			ranking(ins.songs, fmt),
		));
	}

	if (ins.changes) {
		const byId = new Map(runs.map((r) => [r.id, r]));
		const box = h('div', { class: 'chart' });
		page.append(h('section', null,
			h('h2', null, 'Song changes and distance'),
			h('p', { class: 'sub' }, 'One dot per run. Further right means the song changed more often.'),
			h('div', { class: 'card' }, box),
		));
		changesChart(box, ins.changes.points, fmt, (p) => {
			const r = byId.get(p.run_id);
			return r ? `${r.name} · ${day(r.start_time)}` : 'Run';
		}, (p) => (location.hash = `#/run/${p.run_id}`));
	}

	page.append(h('section', null,
		h('h2', null, 'Runs'),
		h('p', { class: 'sub' }, me.user.is_demo || !me.strava.last_sync_at ? 'Open a run to see its pace song by song.' : `Open a run to see its pace song by song. Last checked Strava ${ago(me.strava.last_sync_at)}.`),
		runsTable(runs, fmt),
	));
	page.append(latest(fmt), footer());
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
