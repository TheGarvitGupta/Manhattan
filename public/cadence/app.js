import { GLYPHS, glyphFor } from './glyphs.js';
import { activityChart, h, hideTip, minSec, runChart, s as svg, spectrum, stretchStats } from './charts.js';
import { scene } from './scene.js';

const app = document.getElementById('app');
// Running and biking are analysed apart: `insights` and `runs` each hold one of each ({ run, ride }), and `sport` is the tab that is open.
const state = { me: null, insights: null, runs: null, recent: null, sport: 'run', sportChosen: false, units: 'km', openActivity: null, filter: new Set(), filterFor: null, emailScenario: 'patterns' };

// Units: what the person picks here, else their Strava setting when Strava
// shares it, else whatever the rest of garvitgupta.com is showing them: its
// own choice if they made one there, or miles where the device's time zone is
// one that uses them (the same rule as the main site's js/units.js).
const MILE_ZONES = /^(US\/|America\/(Adak|Anchorage|Atka|Boise|Chicago|Denver|Detroit|Fort_Wayne|Indiana\/|Indianapolis|Juneau|Kentucky\/|Knox_IN|Los_Angeles|Louisville|Menominee|Metlakatla|New_York|Nome|North_Dakota\/|Phoenix|Shiprock|Sitka|Yakutat)|Pacific\/(Honolulu|Johnston|Guam|Saipan|Pago_Pago|Samoa)$|Africa\/Monrovia$|Asia\/(Yangon|Rangoon)$)/;
try {
	const site = localStorage.getItem('gg:units');
	const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	if (site === 'imperial' || site === 'metric') state.units = site === 'imperial' ? 'mi' : 'km';
	else if (zone && zone.includes('/') && !zone.startsWith('Etc/')) state.units = MILE_ZONES.test(zone) ? 'mi' : 'km';
	else if (['US', 'LR', 'MM'].includes(new Intl.Locale(navigator.language).maximize().region)) state.units = 'mi';
} catch {}
let unitsChosen = false;
try {
	const saved = localStorage.getItem('cadence-units');
	if (saved === 'mi' || saved === 'km') {
		state.units = saved;
		unitsChosen = true;
	}
} catch {}

// --- the two sports -----------------------------------------------------------

// How each is spoken of. A run is told by its pace (5:19 /km), a ride by its speed (28.4 km/h).
const SPORTS = ['run', 'ride'];
const WORDS = {
	run: { tab: 'Running', one: 'run', many: 'runs', verb: 'run', did: 'ran', rate: 'pace', Rate: 'Pace' },
	ride: { tab: 'Biking', one: 'ride', many: 'rides', verb: 'ride', did: 'rode', rate: 'speed', Rate: 'Speed' },
};
const RUN_TYPES = ['Run', 'TrailRun', 'VirtualRun'];
const RIDE_TYPES = ['Ride', 'VirtualRide', 'GravelRide', 'MountainBikeRide'];
const sportOf = (type) => (RUN_TYPES.includes(type) ? 'run' : RIDE_TYPES.includes(type) ? 'ride' : null);

// --- formatting ---------------------------------------------------------------

function formatter() {
	const unit = state.units;
	const unitMeters = unit === 'mi' ? 1609.344 : 1000;
	const per = unit === 'mi' ? 'mph' : 'km/h';
	return {
		unit,
		unitMeters,
		per,
		// How fast, said the sport's way: pace for a run, speed for a ride.
		rate(speed, sport) {
			return sport === 'ride' ? this.speed(speed) : this.pace(speed);
		},
		pace(speed) {
			if (!speed) return '–';
			const sec = Math.round(unitMeters / speed);
			return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} /${unit}`;
		},
		dist: (m) => `${(m / unitMeters).toFixed(m / unitMeters >= 100 ? 0 : 1)} ${unit}`,
		speed: (v) => (v ? `${((v * 3600) / unitMeters).toFixed(1)} ${per}` : '–'),
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

// --- server -------------------------------------------------------------------

// The demo's songs are dealt afresh each time the page is opened: a word made up here goes with every request, and the
// server shuffles which song is which by it. Real accounts ignore it.
const CAST = Math.random().toString(36).slice(2, 12);

async function api(path, method = 'GET', payload) {
	const headers = { 'x-cadence-cast': CAST };
	const res = await fetch(path, payload ? { method, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(payload) } : { method, headers });
	// Covers are stored as Spotify's 64px thumbnails; ask for the 300px picture of the same cover instead, which stays sharp at every size shown here.
	const text = (await res.text().catch(() => '')).replaceAll('/image/ab67616d00004851', '/image/ab67616d00001e02');
	let body = {};
	try {
		body = JSON.parse(text);
	} catch {}
	if (!res.ok) throw Object.assign(new Error(body.error || 'Something went wrong.'), { status: res.status });
	return body;
}

async function load() {
	try {
		state.me = await api('api/me');
		if (!unitsChosen && state.me.units) state.units = state.me.units;
	} catch (err) {
		if (err.status !== 401) return fail(err);
		state.me = null;
		return render();
	}
	try {
		// Both analyses are always made; the tabs only choose which is on screen.
		const [run, ride, runs, rides, recent] = await Promise.all([
			api('api/insights'),
			api('api/insights?sport=ride'),
			api('api/runs').then((r) => r.runs),
			api('api/runs?sport=ride').then((r) => r.runs),
			api('api/recent'),
		]);
		state.insights = { run, ride };
		state.runs = { run: runs, ride: rides };
		state.recent = recent;
		// Until a tab is picked, open on the sport there is more of.
		if (!state.sportChosen) {
			state.sport = ride.totals.runs_with_music > run.totals.runs_with_music || (!runs.length && rides.length) ? 'ride' : 'run';
		}
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

/** The name, set in a rounded face leaning forward like the beats in the mark, its tall letter in violet. */
function wordmark() {
	return h('span', { class: 'wordmark', 'aria-hidden': 'true' }, [...'cadence'].map((letter, i) => h('span', { class: letter === 'd' ? 'tall' : null, style: { animationDelay: `${i * 55}ms` } }, letter)));
}

// The account menu's icons, drawn as lines.
const MENU_ICONS = {
	sync: 'M20 11a8 8 0 0 0-14.3-4.5M4 4v3.5h3.5M4 13a8 8 0 0 0 14.3 4.5M20 20v-3.5h-3.5',
	mail: 'M4 6.5h16v11H4zM4.5 7l7.5 6 7.5-6',
	unlink: 'M10.5 6.5l1-1a4 4 0 0 1 5.7 5.7l-1 1M13.5 17.5l-1 1a4 4 0 0 1-5.7-5.7l1-1M4 4l16 16',
	leave: 'M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9',
	trash: 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10.5 10.5v5.5M13.5 10.5v5.5',
};

function header() {
	const me = state.me;
	const item = (icon, label, onclick, cls) =>
		h('button', { class: cls, onclick }, svg('svg', { class: 'icon', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, svg('path', { d: MENU_ICONS[icon] })), label);
	const rule = () => h('hr');
	const unitButton = (u) =>
		h('button', {
			'aria-pressed': String(state.units === u),
			onclick: () => {
				state.units = u;
				unitsChosen = true;
				try {
					localStorage.setItem('cadence-units', u);
				} catch {}
				render(true);
			},
		}, u);

	return h('header', { class: 'top' },
		h('a', { class: 'brand', href: '#/', 'aria-label': 'Cadence' }, h('img', { src: 'icon.svg', alt: '' }), wordmark()),
		me && h('div', { class: 'seg', role: 'group', 'aria-label': 'Units' }, unitButton('km'), unitButton('mi')),
		me && h('details', { class: 'menu' },
			h('summary', null, me.user.avatar ? h('img', { class: 'avatar', src: me.user.avatar, alt: '', referrerpolicy: 'no-referrer' }) : h('span', { class: 'avatar' }), me.user.name),
			h('div', { class: 'sheet' },
				!me.user.is_demo && item('sync', 'Sync now', () => act(() => api('api/sync', 'POST'))),
				item('mail', 'Emails', () => (location.hash = '#/emails')),
				!me.user.is_demo && me.spotify.connected && rule(),
				!me.user.is_demo && me.spotify.connected && item('unlink', 'Disconnect Spotify', () => confirm('Disconnect Spotify? Songs already matched are kept.') && act(() => api('api/spotify', 'DELETE'))),
				rule(),
				item('leave', me.user.is_demo ? 'Leave the demo' : 'Sign out', () => act(() => api('auth/logout', 'POST'))),
				!me.user.is_demo && rule(),
				!me.user.is_demo && item('trash', 'Delete my account', () => confirm('Delete your account and everything Cadence has stored about you? This cannot be undone.') && act(() => api('api/account', 'DELETE')), 'danger'),
			),
		),
	);
}

const footer = () => h('p', { class: 'foot' }, 'Powered by Strava. Music data from Spotify. These are patterns in your own runs and rides, not proof that a song changes how fast you go. The first two minutes of each one are left out as warm-up.');

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
	const logo = (name) => svg('svg', { class: `mark ${name}`, viewBox: '0 0 24 24', 'aria-hidden': 'true' }, svg('path', { d: MARKS[name] }));
	const step = (icon, text) => h('span', { class: 'step' }, icon, text);

	// The words stand on a moving picture: a runner crossing a playlist, the run kept to the room left for it under them.
	const room = h('div', { class: 'hero-run' });
	const hero = h('div', { class: 'hero' },
		h('div', { class: 'hero-copy' },
			error && h('div', { class: 'card note error' }, h('p', null, error)),
			emailNotice(),
			h('div', { class: 'hero-brand', role: 'img', 'aria-label': 'Cadence' }, h('img', { src: 'icon.svg', alt: '' }), wordmark()),
			h('h1', null, 'Which songs make you run faster?'),
			h('p', { class: 'lede' }, 'Cadence matches your Strava runs to what was playing on Spotify, and shows your pace song by song.'),
			h('div', { class: 'actions' },
				h('a', { class: 'btn strava start', href: 'auth/strava', 'aria-label': 'Start: connect with Strava' },
					logo('strava'),
					'Start',
					svg('svg', { class: 'chevron', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, svg('path', { d: 'M9 5l7 7-7 7' })),
				),
				h('button', { class: 'btn demo', onclick: () => act(() => api('auth/demo', 'POST')) }, 'See a demo'),
			),
		),
		room,
	);
	// Real covers for the songs underfoot, a different handful each visit.
	scene(hero, { room, units: () => state.units, covers: api('api/covers').then((r) => r.covers).catch(() => []) });

	// The picture fills the screen, edge to edge; the three steps and the small print are just below it.
	return h('main', { class: 'landing' },
		hero,
		h('div', { class: 'wrap' },
			h('div', { class: 'steps' },
				step(logo('strava'), 'Connect Strava'),
				h('i', { 'aria-hidden': 'true' }, '→'),
				step(logo('spotify'), 'Connect Spotify'),
				h('i', { 'aria-hidden': 'true' }, '→'),
				step(h('b', { class: 'note-glyph', 'aria-hidden': 'true' }, '♪'), 'Run with music'),
			),
			h('p', { class: 'fine' }, 'Read-only. Delete everything any time. Spotify access is by invitation: sign in, then ask for a spot.'),
		),
	);
}

// --- dashboard ----------------------------------------------------------------

/**
 * Spotify only lets a few named accounts use Cadence, so someone new asks the
 * owner to add them. A small form, or a thank-you once it has been sent.
 */
function askForAccess() {
	const { me } = state;
	if (me.access_requested) return h('p', { class: 'asked' }, 'You’ve asked for access. Once you’re added, reconnect Spotify here.');
	const email = h('input', { class: 'field', type: 'email', required: true, placeholder: 'The email on your Spotify account', autocomplete: 'email', 'aria-label': 'The email on your Spotify account', value: me.email.address || null });
	const note = h('input', { class: 'field', type: 'text', maxlength: '500', placeholder: 'A note for Garvit (optional)', 'aria-label': 'A note for Garvit (optional)' });
	const submit = () => act(() => api('api/access-request', 'POST', { email: email.value, message: note.value }));
	return h('details', { class: 'ask' },
		h('summary', null, 'Not been added yet? Ask for access'),
		h('p', null, 'Spotify only lets Cadence connect a few people, each added by hand. Send your Spotify email and Garvit will add you.'),
		h('form', { class: 'inline', onsubmit: (e) => (e.preventDefault(), submit()) }, email, note, h('button', { class: 'btn small', type: 'submit' }, 'Ask for access')),
	);
}

const EMAIL_NOTES = { confirmed: ['Email confirmed.', 'Your Sunday roundup starts this week.'], off: ['Emails turned off.', 'You won’t hear from Cadence again unless you turn them back on.'] };

/** The one-off message after following a link in an email. Works signed in or out. */
function emailNotice() {
	const note = EMAIL_NOTES[new URLSearchParams(location.search).get('email')];
	if (!note) return null;
	history.replaceState(null, '', location.pathname + location.hash);
	return h('div', { class: 'card note' }, h('p', null, h('strong', null, note[0]), note[1]));
}

function notices() {
	const me = state.me;
	const out = [];
	const emailNote = emailNotice();
	if (emailNote) out.push(emailNote);
	if (me.user.is_demo) {
		out.push(h('div', { class: 'card note' },
			h('p', null, h('strong', null, 'This is simulated data.'), 'A made-up athlete with six months of runs, rides and songs, so you can see what Cadence finds.'),
			h('button', { class: 'btn', onclick: () => act(() => api('auth/logout', 'POST')) }, 'Use my own data'),
		));
		return out;
	}
	if (!me.strava.ok) {
		out.push(h('div', { class: 'card note error' }, h('p', null, h('strong', null, 'Strava needs reconnecting.'), 'Cadence lost access to your activities.'), h('a', { class: 'btn strava', href: 'auth/strava' }, 'Reconnect Strava')));
	}
	if (!me.spotify.connected) {
		out.push(h('div', { class: 'card note' }, h('p', null, h('strong', null, 'One more step: connect Spotify.'), 'Cadence can only match songs it sees from now on, so connect before your next run or ride.'), h('a', { class: 'btn spotify', href: 'auth/spotify' }, 'Connect Spotify'), askForAccess()));
	} else if (me.spotify.not_allowed) {
		out.push(h('div', { class: 'card note error' }, h('p', null, h('strong', null, 'Your Spotify account isn’t on the guest list yet.'), 'Spotify only lets Cadence connect a handful of people, each added by hand. Ask below, then reconnect once you’ve been added.'), h('a', { class: 'btn spotify', href: 'auth/spotify' }, 'Reconnect Spotify'), askForAccess()));
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
// The two chips are made once and kept current. They sit in the strip, or at the head of the Activity cards when those are on the page.
const chips = { strava: h('span'), spotify: h('span') };
let chipsInCards = false;
let statusStarted = false;

function paintStatus() {
	const me = state.me;
	if (!me) return statusNode.replaceChildren();
	for (const [key, label] of [['strava', 'Strava'], ['spotify', 'Spotify']]) {
		const c = me[key];
		const good = c.connected && c.ok;
		const text = me.user.is_demo ? 'sample data' : !c.connected ? 'not connected' : !good ? 'needs reconnecting' : c.last_sync_at ? `checked ${agoShort(c.last_sync_at)}` : 'checking soon';
		chips[key].className = `chip${good ? '' : ' bad'}`;
		chips[key].title = `${label}: ${good ? 'connected' : 'not connected'}`;
		chips[key].replaceChildren(
			svg('svg', { class: `mark ${key}`, viewBox: '0 0 24 24', 'aria-hidden': 'true' }, svg('path', { d: MARKS[key] })),
			h('b', null, label),
			h('span', null, text),
			h('i', { class: 'dot', 'aria-hidden': 'true' }),
		);
	}
	// "Data since" only appears once there is some data; nothing is shown in its place.
	const since = me.since ? [h('span', { class: 'since' }, `Data since ${new Date(me.since * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`)] : [];
	const want = [...(chipsInCards ? [] : [chips.strava, chips.spotify]), ...since];
	// Only touched when it changes, so the chips are not pulled out of the cards each second.
	if (want.length !== statusNode.children.length || want.some((n, i) => n !== statusNode.children[i] && !(n.className === 'since' && statusNode.children[i].className === 'since' && n.textContent === statusNode.children[i].textContent))) statusNode.replaceChildren(...want);
}

function statusBar(inCards = false) {
	chipsInCards = inCards;
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

/** "28s faster", or for a ride "1.4 km/h faster": how fast a song went against the person's overall average. */
function paceGap(speed, average, fmt, sport) {
	if (sport === 'ride') {
		const d = ((speed - average) * 3600) / fmt.unitMeters;
		return Math.abs(d) < 0.05 ? 'your usual speed' : `${Math.abs(d).toFixed(1)} ${fmt.per} ${d > 0 ? 'faster' : 'slower'}`;
	}
	const sec = Math.round(fmt.unitMeters / average - fmt.unitMeters / speed);
	return sec === 0 ? 'your usual pace' : `${Math.abs(sec)}s ${sec > 0 ? 'faster' : 'slower'}`;
}

/** A pace or speed with its unit always attached, the unit set smaller: 9:03 /mi, 17.6 mph. */
function paceValue(speed, fmt, sport) {
	const [value, unit] = fmt.rate(speed, sport).split(' ');
	return [value, h('small', null, ` ${unit}`)];
}

/** The same, led by an arrow: coloured and up when faster, grey and down when slower. */
function paceArrow(speed, average, fmt, sport) {
	const text = paceGap(speed, average, fmt, sport);
	if (text.startsWith('your usual')) return text;
	const up = speed > average;
	return [h('i', { class: `arrow ${up ? 'up' : 'down'}`, 'aria-hidden': 'true' }, up ? '▲' : '▼'), text];
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
// A run's own page is its activity's; the older run page stays for a run the list no longer holds.
const activityLink = (runId) => {
	const a = state.recent.activities.find((x) => x.run_id === runId);
	return a ? `#/activity/${a.id}` : `#/run/${runId}`;
};

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
function story(ins, fmt, sport) {
	const runs = state.runs[sport];
	const w = WORDS[sport];
	const rate = (v) => fmt.rate(v, sport);
	const gap = (v) => paceGap(v, average, fmt, sport);
	const value = (r) => paceValue(r.speed, fmt, sport);
	const arrow = (r) => paceArrow(r.speed, average, fmt, sport);
	const t = ins.totals;
	const average = t.distance_m / t.moving_s;
	const out = [];

	// 1. The answer the page exists for.
	const top = ins.fastest[0];
	if (top) {
		out.push(h('div', { class: 'card headline' },
			art(top.image, top.name, 'lg'),
			h('div', { class: 'headline-text' },
				h('div', { class: 'kicker' }, `You ${w.verb} fastest to`),
				h('h1', null, top.name),
				h('p', { class: 'by' }, top.artist),
				h('p', { class: 'proof' }, h('b', null, rate(top.speed)), gap(top.speed).startsWith('your usual') ? ` ${gap(top.speed)}` : ` ${gap(top.speed)} than your average`),
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
			avgLabel: `your average ${rate(average)}`,
			left: 'slower',
			right: 'faster',
			describe: (r) => `${rate(r.speed)} · ${gap(r.speed)}`,
		});
		out.push(section('Fastest and slowest songs', `Each cover sits at the ${w.rate} you ${w.did} while it played.`,
			h('div', { class: 'card' }, box),
			h('div', { class: 'pair' },
				songList('Fastest', `You ${w.verb} quickest to these.`, ins.fastest, value, arrow),
				songList('Slowest', `You ${w.verb} slowest to these.`, ins.slowest, value, arrow),
			),
		));
	}

	// 3. What gets played.
	const mostPlays = Math.max(1, ...ins.most_played.map((r) => r.plays));
	// The fastest single kilometre, or mile for people who think in miles.
	const miles = fmt.unit === 'mi';
	const km = miles ? ins.best_mile : ins.best_km;
	out.push(section('On repeat', `What you play most while you ${w.verb}.`,
		h('div', { class: 'pair' },
			songList('Most played', `How many times each came up on a ${w.one}.`, ins.most_played, (r) => `${r.plays}×`, (r) => `on ${plural(r.runs, w.one)}`, (r) => bar(r.plays / mostPlays, 'var(--pace)')),
			songList('New this month', `First heard on a ${w.one} in the last 30 days.`, ins.new_this_month, value, arrow),
		),
		h('div', { class: 'pair' },
			ins.opener ? fact('Your opener', `The song you start ${w.many} with most.`, ins.opener.image, ins.opener.name, ins.opener.name, `${ins.opener.artist} · started ${plural(ins.opener.count, w.one)}`) : null,
			km ? fact(miles ? 'Fastest mile' : 'Fastest kilometre', `Your quickest single ${miles ? 'mile' : 'km'}, and what was on.`, km.song && km.song.image, km.song ? km.song.name : '♪', minSec(km.seconds), `${km.song ? `${km.song.name} · ` : ''}${day(km.start_time)}`, activityLink(km.run_id)) : null,
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
	out.push(section('Habits', `How you listen while you ${w.verb}.`,
		h('div', { class: 'pair' },
			songList('Most skipped', 'You cut these short most often.', ins.skips.most.slice(0, 3), skipText, () => 'plays skipped', split),
			songList('Least skipped', 'You nearly always let these finish.', ins.skips.least.slice(0, 3), skipText, () => 'plays skipped', split),
		),
		h('div', { class: 'pair' },
			parts.length >= 2
				? h('div', { class: 'card list' },
					h('h3', null, 'Time of day'),
					h('p', { class: 'what' }, `Your average ${w.rate} by when you ${w.verb}.`),
					h('div', { class: 'day-parts' }, parts.map((p) =>
						h('div', { class: p.speed === quickest ? 'best' : null },
							h('span', null, p.name),
							h('b', null, paceValue(p.speed, fmt, sport)),
							h('span', null, p.speed === quickest ? `fastest · ${plural(p.n, w.one)}` : plural(p.n, w.one)),
						))),
				)
				: null,
			// Each song's slice of everything covered since the data began: 4 km of 199 km is 2.0%.
			songList('Share of your distance', `How much of your ${fmt.dist(t.distance_m)} each song played for.`, ins.furthest.slice(0, 3),
				(r) => `${((r.distance_m / t.distance_m) * 100).toFixed(1)}%`, (r) => fmt.dist(r.distance_m)),
		),
	));
	return out.filter(Boolean);
}

const words = (type) => type.replace(/([a-z])([A-Z])/g, '$1 $2');

const clockTime = (ts) => new Date(ts * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const dayName = (ts) => {
	const today = new Date().setHours(0, 0, 0, 0) / 1000;
	return ts >= today ? 'Today' : ts >= today - 86400 ? 'Yesterday' : new Date(ts * 1000).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};
const kind = (a) => ({ run: 'Run', ride: 'Ride' })[sportOf(a.type)] || words(a.type);

/** A small tile with the activity's glyph (run, ride, weights), or its initial when there's no glyph. */
function glyphTile(type) {
	const key = glyphFor(type);
	return h('span', { class: `glyph-tile${key ? ` ${key}` : ''}`, 'aria-hidden': 'true' },
		key ? svg('svg', { class: 'glyph', viewBox: '0 0 24 24' }, svg('path', { d: GLYPHS[key] })) : words(type)[0]);
}

/** An opened activity: the activity across the page, its songs under it, and its data under those. */
// Under the chart, each distinct song is listed once with its totals for the activity.
function opened(act, fmt) {
	const box = h('div', { class: 'chart' });
	const note = h('p', { class: 'sub tally', hidden: true }, 'Speed, heart rate and the rest arrive with the next Strava check, within about 10 minutes.');
	const music = act.songs.reduce((sum, s) => sum + (s.to - s.from), 0);
	const isRun = RUN_TYPES.includes(act.type);
	const table = h('div');
	const sport = sportOf(act.type);
	const tiles = h('div', { class: 'tiles' });
	// The figures over the card: what Strava says of the whole activity, filled out once its per-second data is in.
	const fillTiles = (streams) => {
		const whole = stretchStats(streams, 0, act.elapsed_s);
		const rate = sport && whole.speed ? fmt.rate(whole.speed, sport).split(' ') : null;
		tiles.replaceChildren(...[
			act.distance_m ? tile('Distance', (act.distance_m / fmt.unitMeters).toFixed(2), fmt.unit) : null,
			rate ? tile(`Average ${WORDS[sport].rate}`, rate[0], rate[1]) : null,
			whole.moving ? tile('Moving time', duration(whole.moving)) : tile('Time', duration(act.elapsed_s)),
			whole.hr ? tile('Average heart rate', Math.round(whole.hr), 'bpm') : tile('Songs', new Set(act.songs.map((x) => `${x.name}|${x.artist}`)).size),
		].filter(Boolean));
	};

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
		// Each song is set against the whole activity's average.
		const whole = stretchStats(streams, 0, act.elapsed_s).speed;
		const against = (r) => (whole && r.moving >= 5 && r.distance > 0 ? versus(r.distance / r.moving / whole - 1) : dash());
		const dash = () => h('span', { class: 'dim' }, '–');
		const speed = (r) => (r.moving >= 5 && r.distance > 0 ? (isRun ? fmt.pace(r.distance / r.moving) : fmt.speed(r.distance / r.moving)) : dash());
		table.replaceChildren(h('div', { class: 'scroll' }, h('table', { class: 'table' },
			h('thead', null, h('tr', null,
				h('th', null, 'Song'),
				h('th', { class: 'n' }, 'Played for'),
				streams && h('th', { class: 'n' }, isRun ? 'Average pace' : 'Average speed'),
				streams && sport && h('th', { class: 'n hide-s' }, 'Against average'),
				streams && h('th', { class: 'n' }, 'Average heart rate'),
			)),
			h('tbody', null, rows.map((r) =>
				h('tr', null,
					h('td', null, h('div', { class: 'song' }, art(r.image, r.name, true), h('div', null, h('b', null, r.name), ' ', h('span', null, r.artist), r.plays > 1 ? h('span', { class: 'dim' }, ` · played ${r.plays} times`) : null))),
					h('td', { class: 'n' }, minSec(r.seconds)),
					streams && h('td', { class: 'n' }, speed(r)),
					streams && sport && h('td', { class: 'n hide-s' }, against(r)),
					streams && h('td', { class: 'n' }, r.hrN ? `${Math.round(r.hrSum / r.hrN)} bpm` : dash()),
				),
			)),
		)));
	};

	const card = h('div', { class: 'card' },
		h('div', { class: 'opened-head' },
			glyphTile(act.type),
			h('div', { class: 'grow' },
				h('h3', null, act.name),
				h('p', { class: 'sub' }, `${kind(act)} · ${dayName(act.start_time)}, ${clockTime(act.start_time)} – ${clockTime(act.start_time + act.elapsed_s)} · ${duration(act.elapsed_s)}${act.distance_m ? ` · ${fmt.dist(act.distance_m)}` : ''}`),
			),
		),
		box,
		note,
		act.songs.length ? h('p', { class: 'sub tally' }, `${plural(act.songs.length, 'song')} · music for ${duration(music)} of ${duration(act.elapsed_s)}`) : null,
		table,
	);

	const chart = activityChart(box, act, fmt);
	fillTable(null);
	fillTiles(null);
	api(`api/activities/${act.id}`)
		.then(({ streams }) => {
			chart.setStreams(streams);
			fillTable(streams);
			fillTiles(streams);
			note.hidden = !!streams || !act.songs.length || state.me.user.is_demo;
		})
		.catch(() => {});
	return h('div', { class: 'opened' }, tiles, card);
}

// Long lists are laid out a screenful at a time, more as the list is scrolled.
const ROWS_AT_ONCE = 60;
function rows(items, row, empty) {
	if (!items.length) return h('p', { class: 'dim' }, empty);
	const ul = h('ul', { class: 'rows' });
	let shown = 0;
	const more = () => {
		ul.append(...items.slice(shown, shown + ROWS_AT_ONCE).map(row));
		shown = Math.min(items.length, shown + ROWS_AT_ONCE);
	};
	ul.addEventListener('scroll', () => {
		if (shown < items.length && ul.scrollTop + ul.clientHeight > ul.scrollHeight - 400) more();
	});
	more();
	return ul;
}

/** The covers of an activity's songs, small and overlapping, then how many there were. */
function songsPill(songs) {
	if (!songs.length) return h('span', { class: 'pill none' }, 'no songs');
	const seen = new Set();
	const covers = songs.filter((s) => s.image && !seen.has(s.image) && seen.add(s.image)).slice(0, 5);
	return h('span', { class: 'heard' },
		covers.length ? h('span', { class: 'covers', 'aria-hidden': 'true' }, covers.map((s) => h('img', { src: s.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }))) : null,
		h('span', { class: 'pill' }, plural(songs.length, 'song')),
	);
}

// Each activity opens at its own address (#/activity/<id>), so the browser's back and forward buttons work.
// `cameFrom` is where the page was scrolled to when one was opened, to go back to.
let cameFrom = 0;
let openedHere = false;
// Back retraces the step when the activity was opened from the list; a link straight to one goes to the front page.
const closeActivity = () => (openedHere ? history.back() : (location.hash = '#/'));

// The filter's menu closes when anything else is pressed.
let closeFilter = null;
document.addEventListener('click', () => closeFilter && closeFilter());
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeFilter && closeFilter());

/** Every activity and every song, side by side; opening an activity lays it out against its songs. */
function latest(fmt) {
	// The list starts on the open tab's kind, each time the tab changes; the filter's menu can widen it.
	if (state.filterFor !== state.sport) {
		state.filter = new Set([state.sport]);
		state.filterFor = state.sport;
	}
	const { me, recent, filter } = state;
	const open = recent.activities.find((a) => a.id === state.openActivity);

	const activity = (a) =>
		h('li', null, h('button', { class: `row${sportOf(a.type) ? '' : ' off'}`, onclick: () => ((cameFrom = scrollY), (openedHere = true), (location.hash = `#/activity/${a.id}`)) },
			glyphTile(a.type),
			h('div', { class: 'who' },
				h('div', { class: 'meta' }, h('b', null, a.name), h('span', { class: 'at' }, `${dayName(a.start_time)}, ${clockTime(a.start_time)}`)),
				h('div', { class: 'meta' }, h('span', null, `${kind(a)} · ${duration(a.elapsed_s)}`), songsPill(a.songs)),
			),
			h('span', { class: 'go', 'aria-hidden': 'true' }, '›'),
		));

	const song = (s) =>
		h('li', null, h('div', { class: 'row' },
			art(s.image, s.name, true),
			h('div', { class: 'who' }, h('b', null, s.name), h('span', null, s.artist)),
			h('span', { class: 'at' }, `${dayName(s.to)}, ${clockTime(s.to)} · ${minSec(s.to - s.from)}`),
		));

	// The Strava card: its list, the count beside the chip, and the filter with its menu.
	const count = h('span', { class: 'count' });
	const listed = h('div');
	const menu = h('div', { class: 'pick', role: 'menu', hidden: true, onclick: (e) => e.stopPropagation() });
	const toggle = h('button', {
		class: 'filter', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
		onclick: (e) => {
			e.stopPropagation();
			const opening = menu.hidden;
			if (closeFilter) closeFilter();
			if (opening) {
				menu.hidden = false;
				toggle.setAttribute('aria-expanded', 'true');
				closeFilter = () => ((menu.hidden = true), toggle.setAttribute('aria-expanded', 'false'), (closeFilter = null));
			}
		},
	}, svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, svg('path', { d: 'M4.5 7.5h15M7 12h10M9.5 16.5h5' })));
	const paint = () => {
		const shown = filter.size ? recent.activities.filter((a) => filter.has(sportOf(a.type))) : recent.activities;
		const all = recent.activities.length;
		count.textContent = filter.size ? `${shown.length} of ${all}` : all === 1 ? '1 activity' : `${all} activities`;
		toggle.classList.toggle('on', filter.size > 0);
		toggle.setAttribute('aria-label', filter.size ? `Filter activities, showing ${SPORTS.filter((k) => filter.has(k)).map((k) => WORDS[k].tab.toLowerCase()).join(' and ')}` : 'Filter activities');
		toggle.title = filter.size ? `Showing ${SPORTS.filter((k) => filter.has(k)).map((k) => WORDS[k].tab.toLowerCase()).join(' and ')}` : 'Filter activities';
		listed.replaceChildren(rows(shown, activity, filter.size ? 'No activities of that kind yet.' : 'No activities yet.'));
		menu.replaceChildren(
			...SPORTS.map((k) =>
				h('button', { role: 'menuitemcheckbox', 'aria-checked': String(filter.has(k)), onclick: () => ((filter.has(k) ? filter.delete(k) : filter.add(k)), paint()) },
					svg('svg', { class: 'glyph', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, svg('path', { d: GLYPHS[k] })),
					h('span', null, WORDS[k].tab),
					svg('svg', { class: 'tick', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, svg('path', { d: 'M5 12.5l4.5 4.5L19 7.5' })),
				)),
			h('button', { class: 'clear', role: 'menuitem', disabled: !filter.size, onclick: () => (filter.clear(), paint(), closeFilter && closeFilter()) }, 'Remove filter'),
		);
	};
	paint();

	// An opened activity is shown by itself, with nothing over it.
	if (open) return opened(open, fmt);
	return h('section', { id: 'latest' },
		h('h2', null, 'Activity'),
		h('p', { class: 'sub' }, 'Open an activity to see what was playing during it.'),
		h('div', { class: 'pair' },
				h('div', { class: 'card' }, h('div', { class: 'card-head' }, chips.strava, count, h('div', { class: 'filter-box' }, toggle, menu)), listed),
				h('div', { class: 'card' },
					h('div', { class: 'card-head' }, chips.spotify, h('span', { class: 'count' }, plural(recent.songs.length, 'song'))),
					rows(recent.songs, song, me.spotify.connected ? 'No songs yet. Play something and check back in a few minutes.' : 'Connect Spotify to see your songs here.')),
			),
	);
}

/** Five records on a line: one for each run (or ride) with music, wearing a cover from it. The fifth unlocks the patterns. */
function collecting(sport, have) {
	const w = WORDS[sport];
	const seconds = (a) => a.songs.reduce((sum, s) => sum + (s.to - s.from), 0);
	// The ones that counted had music for at least half of them; those come first, fullest first, then they are put in order of date.
	const share = (a) => seconds(a) / Math.max(1, a.elapsed_s);
	const counted = state.recent.activities
		.filter((a) => sportOf(a.type) === sport && a.songs.length)
		.sort((a, b) => (share(b) >= 0.5) - (share(a) >= 0.5) || share(b) - share(a))
		.slice(0, have)
		.sort((a, b) => a.start_time - b.start_time);
	const cover = (a) => a && [...a.songs].sort((x, y) => y.to - y.from - (x.to - x.from)).find((s) => s.image)?.image;
	const left = RUNS_NEEDED - have;
	const glyph = () => svg('svg', { class: 'glyph', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, svg('path', { d: GLYPHS[sport] }));

	const discs = Array.from({ length: RUNS_NEEDED }, (_, i) => {
		if (i < have) {
			const src = cover(counted[i]);
			return h('span', { class: 'disc on', title: counted[i]?.name || '' }, src ? h('img', { src, alt: '', referrerpolicy: 'no-referrer' }) : glyph(), h('i'));
		}
		const last = i === RUNS_NEEDED - 1;
		return h('span', { class: `disc${i === have ? ' next' : ''}${last ? ' goal' : ''}` },
			last ? svg('svg', { class: 'glyph', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, svg('path', { d: 'M12 2.5l2.2 6.3 6.3 2.2-6.3 2.2L12 19.5l-2.2-6.3L3.5 11l6.3-2.2z' })) : i === have ? glyph() : null);
	});

	return h('div', { class: 'card collect' },
		h('div', { class: 'collect-text' },
			h('strong', null, h('b', null, String(have)), ` of ${RUNS_NEEDED} ${w.many} with music`),
			h('p', null, have ? `${left} more with Spotify on, and your song patterns appear.` : `${sport === 'ride' ? 'Ride' : 'Run'} with Spotify on. After ${RUNS_NEEDED}, your song patterns appear.`),
		),
		h('div', { class: 'discs', role: 'img', 'aria-label': `${have} of ${RUNS_NEEDED} ${w.many} with music` },
			h('i', { class: 'line' }, h('i', { style: { width: `${(Math.min(have, RUNS_NEEDED - 1) / (RUNS_NEEDED - 1)) * 100}%` } })),
			discs),
	);
}

// Runs with music needed before the song cards replace the "collecting" view. Rides need as many, counted apart.
const RUNS_NEEDED = 5;

/** Running or Biking: which analysis is on screen. Both are always made; this only turns the page. */
function sportTabs() {
	return h('div', { class: 'sports', role: 'tablist', 'aria-label': 'Which analysis to show' }, SPORTS.map((sport) =>
		h('button', {
			role: 'tab',
			'aria-selected': String(state.sport === sport),
			onclick: () => {
				state.sport = sport;
				state.sportChosen = true;
				render(true);
			},
		},
			svg('svg', { class: 'glyph', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, svg('path', { d: GLYPHS[sport] })),
			WORDS[sport].tab,
		)));
}

function dashboard() {
	const { sport } = state;
	const ins = state.insights[sport];
	const fmt = formatter();
	// Until there are enough runs (or rides) with music for the song cards to mean anything, the page shows
	// how many there are so far. Every activity and every song is listed under either.
	const have = ins.totals.runs_with_music;
	// An opened activity has the page to itself.
	if (state.recent.activities.some((a) => a.id === state.openActivity)) return h('div', { class: 'wrap' }, header(), h('button', { class: 'back', onclick: closeActivity }, '← Back'), latest(fmt), footer());
	const page = h('div', { class: 'wrap' }, header(), statusBar(true), notices(), sportTabs());
	if (have < RUNS_NEEDED) page.append(collecting(sport, have));
	else page.append(...story(ins, fmt, sport));
	page.append(latest(fmt), footer());
	return page;
}

// --- one run ------------------------------------------------------------------

async function runPage(id) {
	const fmt = formatter();
	const back = h('a', { class: 'back', href: '#/' }, '← Back');
	const page = h('div', { class: 'wrap' }, header(), back);
	app.replaceChildren(page);
	let run;
	try {
		run = await api(`api/runs/${id}`);
	} catch (err) {
		page.append(h('div', { class: 'card note' }, h('p', null, err.status === 404 ? 'That activity could not be found.' : err.message)));
		return;
	}
	// A ride is told by its speed where a run is told by its pace; going back lands on that sport's tab.
	const sport = run.sport === 'ride' ? 'ride' : 'run';
	const w = WORDS[sport];
	state.sport = sport;
	state.sportChosen = true;
	back.textContent = `← All ${w.many}`;
	const speed = run.distance_m / run.moving_s;
	const box = h('div', { class: 'chart' });
	const songs = run.songs.filter((s) => s.moving_s >= 20);

	page.append(
		h('h1', { class: 'title' }, run.name),
		h('p', { class: 'when' }, day(run.start_time, true)),
		h('div', { class: 'tiles' },
			tile('Distance', (run.distance_m / fmt.unitMeters).toFixed(2), fmt.unit),
			tile(`Average ${w.rate}`, fmt.rate(speed, sport).split(' ')[0], fmt.rate(speed, sport).split(' ')[1]),
			tile('Moving time', duration(run.moving_s)),
			run.avg_hr ? tile('Average heart rate', Math.round(run.avg_hr), 'bpm') : tile('Songs', songs.length),
		),
		h('section', null,
			h('h2', null, `${w.Rate}, song by song`),
			h('p', { class: 'sub' }, songs.length ? 'Each shaded block is one song.' : `No songs were matched to this ${w.one}.`),
			h('div', { class: 'card' },
				h('div', { class: 'legend' },
					h('span', null, h('i', { class: 'key line', style: { background: 'var(--pace)', height: '3px' } }), `Average ${w.rate} per song`),
					h('span', null, h('i', { class: 'key line faint', style: { background: 'var(--pace)' } }), w.Rate),
					run.streams.hr && h('span', null, h('i', { class: 'key line', style: { background: 'var(--heart)' } }), 'Heart rate'),
				),
				box,
			),
		),
	);

	if (songs.length) {
		page.append(h('section', null,
			h('h2', null, `Songs on this ${w.one}`),
			h('p', { class: 'sub' }, `Compared with your average ${w.rate} for the whole ${w.one}.`),
			h('div', { class: 'card' }, h('div', { class: 'scroll' },
				h('table', { class: 'table' },
					h('thead', null, h('tr', null, h('th', null, 'Song'), h('th', { class: 'n hide-s' }, 'From'), h('th', { class: 'n' }, w.Rate), h('th', { class: 'n' }, `Against ${w.one} average`), h('th', { class: 'n hide-s' }, 'Heart rate'))),
					h('tbody', null, songs.map((s) => {
						const v = s.distance_m / s.moving_s;
						return h('tr', null,
							h('td', null, h('div', { class: 'song' }, art(s.image, s.name, true), h('div', null, h('b', null, s.name), ' ', h('span', null, s.artist), s.skipped ? h('span', { class: 'dim' }, ' · cut short') : null))),
							h('td', { class: 'n dim hide-s' }, `${Math.floor(s.start_s / 60)}:${String(Math.round(s.start_s % 60)).padStart(2, '0')}`),
							h('td', { class: 'n' }, fmt.rate(v, sport)),
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

// --- emails ----------------------------------------------------------------------------------

const EMAIL_SCENARIOS = [
	{ id: 'welcome', kind: 'welcome', title: 'Welcome', when: 'Once, when you turn on email updates.', at: 'just now' },
	{ id: 'collecting', kind: 'weekly', variant: 'collecting', title: 'Sunday roundup: still collecting', when: 'Sundays at 9am, until there are 5 runs or 5 rides with music.', at: 'Sun 9:00 AM' },
	{ id: 'patterns', kind: 'weekly', variant: 'patterns', title: 'Sunday roundup: your patterns', when: 'Sundays at 9am, with running and biking once each has enough.', at: 'Sun 9:00 AM' },
];

const ICONS = {
	archive: 'M3 6h18v4H3zM5 10v9h14v-9M10 14h4',
	trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
	reply: 'M10 7l-6 5 6 5v-3c5 0 8 1 10 4 0-6-3-10-10-10z',
	forward: 'M14 7l6 5-6 5v-3c-5 0-8 1-10 4 0-6 3-10 10-10z',
	flag: 'M6 21V4h11l-2 4 2 4H6',
};
const icon = (name) => svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, svg('path', { d: ICONS[name] }));

/** The sign-up card for real accounts. The demo only looks at examples. */
function emailSettings() {
	const { me } = state;
	if (me.user.is_demo) return null;
	if (!me.email.available) return h('div', { class: 'card note' }, h('p', null, h('strong', null, 'Email updates aren’t switched on yet.'), 'These are previews, built from your own data.'));
	if (me.email.address) {
		return h('div', { class: 'card note' },
			h('p', null, h('strong', null, me.email.confirmed ? `Sunday emails go to ${me.email.address}` : `Check ${me.email.address} for the welcome email`), me.email.confirmed ? 'Every Sunday at 9am your time.' : 'Tap “Confirm my email” in it and the Sunday roundup starts.'),
			h('button', { class: 'btn small', onclick: () => act(() => api('api/email', 'DELETE')) }, 'Turn off'),
		);
	}
	const input = h('input', { class: 'field', type: 'email', placeholder: 'you@example.com', autocomplete: 'email', 'aria-label': 'Email address' });
	const turnOn = () => act(() => api('api/email', 'POST', { email: input.value, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, units: state.units }));
	return h('div', { class: 'card note' },
		h('p', null, h('strong', null, 'Get a Sunday roundup'), 'A welcome email now, then a short summary every Sunday at 9am.'),
		h('form', { class: 'inline', onsubmit: (e) => (e.preventDefault(), turnOn()) }, input, h('button', { class: 'btn small', type: 'submit' }, 'Turn on')),
	);
}

function emailsPage() {
	const { me } = state;
	const scenario = EMAIL_SCENARIOS.find((x) => x.id === state.emailScenario) || EMAIL_SCENARIOS[2];
	const query = `?cast=${CAST}&units=${state.units}&tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}${scenario.variant ? `&variant=${scenario.variant}` : ''}`;

	const subject = h('div', { class: 'subject' }, '…');
	const to = h('span', null, me.user.name);
	const example = h('p', { class: 'fine left', hidden: true }, 'Example: this one uses the demo data. Yours takes over after 5 runs or 5 rides with music.');
	api(`api/emails/${scenario.kind}${query}`).then((m) => ((subject.textContent = m.subject), (to.textContent = m.to), (example.hidden = !m.example))).catch(() => (subject.textContent = 'Could not load this email.'));

	const group = (...names) => h('span', { class: 'tools' }, names.map(icon));
	const windowed = h('div', { class: 'mail' },
		h('div', { class: 'mail-bar', 'aria-hidden': 'true' },
			h('span', { class: 'lights' }, h('i'), h('i'), h('i')),
			group('archive', 'trash'),
			group('reply', 'forward'),
			h('span', { class: 'tools right' }, icon('flag')),
		),
		h('div', { class: 'mail-count' }, '1 Message'),
		h('div', { class: 'mail-head' },
			h('img', { src: 'icon.svg', alt: '' }),
			h('div', { class: 'who' },
				h('b', null, 'Cadence'),
				h('span', { class: 'address' }, 'no-reply@cadence.garvitgupta.com'),
				subject,
				h('div', { class: 'to' }, 'To: ', to),
			),
			h('span', { class: 'at' }, `Inbox · ${scenario.at}`),
		),
		// Sandboxed: the email is plain HTML with inline styles and cannot run anything.
		h('iframe', { class: 'mail-body', title: `${scenario.title} email`, sandbox: 'allow-popups allow-popups-to-escape-sandbox', src: `api/emails/${scenario.kind}/html${query}` }),
	);

	return h('div', { class: 'wrap' },
		header(),
		h('a', { class: 'back', href: '#/' }, '← Back'),
		h('h1', { class: 'title' }, me.user.is_demo ? 'Demo emails' : 'Emails'),
		h('p', { class: 'when' }, me.user.is_demo ? 'What Cadence sends, filled in with the demo data.' : 'What Cadence sends, filled in with your own data.'),
		emailSettings(),
		h('div', { class: 'mailroom' },
			h('div', { class: 'scenarios', role: 'group', 'aria-label': 'Which email to show' },
				EMAIL_SCENARIOS.map((x) =>
					h('button', { class: 'scenario', 'aria-pressed': String(x.id === scenario.id), onclick: () => ((state.emailScenario = x.id), render(true)) },
						h('b', null, x.title), h('span', null, x.when))),
				example,
				h('p', { class: 'fine left' }, 'Sent from Cadence <no-reply@cadence.garvitgupta.com>.'),
			),
			windowed,
		),
		footer(),
	);
}

// --- routing ------------------------------------------------------------------

function render(keepScroll) {
	hideTip();
	if (!state.me) return app.replaceChildren(landing());
	const run = location.hash.match(/^#\/run\/(\d+)$/);
	if (run) return runPage(run[1]);
	if (location.hash === '#/emails') return app.replaceChildren(emailsPage());
	const activity = location.hash.match(/^#\/activity\/(-?\d+)$/);
	const wasOpen = state.openActivity != null;
	state.openActivity = activity ? Number(activity[1]) : null;
	app.replaceChildren(dashboard());
	// Leaving an activity lands back where the list was.
	if (wasOpen && !activity) scrollTo(0, cameFrom);
	else if (keepScroll !== true) scrollTo(0, 0);
}

addEventListener('hashchange', () => render());
load();
