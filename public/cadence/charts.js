// SVG charts, drawn by hand so there is no build step and nothing to load.

const SVG = 'http://www.w3.org/2000/svg';

export function h(tag, props, ...kids) {
	const el = document.createElement(tag);
	apply(el, props);
	return add(el, kids);
}

export function s(tag, props, ...kids) {
	const el = document.createElementNS(SVG, tag);
	apply(el, props);
	return add(el, kids);
}

function apply(el, props) {
	for (const [k, v] of Object.entries(props || {})) {
		if (v == null || v === false) continue;
		if (k === 'style') Object.assign(el.style, v);
		else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
		else el.setAttribute(k, v === true ? '' : v);
	}
}

function add(el, kids) {
	for (const kid of kids.flat(3)) {
		if (kid == null || kid === false) continue;
		el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
	}
	return el;
}

// --- tooltip -----------------------------------------------------------------

const tip = () => document.getElementById('tip');

export function showTip(evt, nodes) {
	const el = tip();
	el.replaceChildren(...nodes);
	el.hidden = false;
	const r = el.getBoundingClientRect();
	let x = evt.clientX + 14;
	if (x + r.width > innerWidth - 8) x = evt.clientX - r.width - 14;
	el.style.left = Math.max(8, x) + 'px';
	el.style.top = Math.max(8, Math.min(innerHeight - r.height - 8, evt.clientY - r.height - 12)) + 'px';
}

export function hideTip() {
	tip().hidden = true;
}

/** The head of a tooltip: the song's cover, name and artist, with a short note (a time, a pace) at the right. */
const tipSong = (song, note) =>
	h('div', { class: 'head' },
		song && song.image ? h('img', { src: song.image, alt: '', referrerpolicy: 'no-referrer' }) : h('span', { class: 'none', 'aria-hidden': 'true' }, '♪'),
		h('div', { class: 'who' }, h('b', null, song ? song.name : 'No song playing'), song ? h('span', null, song.artist) : null),
		note ? h('span', { class: 'note' }, note) : null,
	);

const tipRow = (color, value, label) =>
	h('div', { class: 'r' }, color && h('i', { class: 'key line', style: { background: color } }), h('b', null, value), h('span', null, label));

// --- helpers ------------------------------------------------------------------

const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

function quantile(sorted, q) {
	return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
}

function path(xs, ys) {
	let d = '';
	let pen = false;
	for (let i = 0; i < xs.length; i++) {
		if (ys[i] == null) {
			pen = false;
			continue;
		}
		d += `${pen ? 'L' : 'M'}${xs[i].toFixed(1)} ${ys[i].toFixed(1)}`;
		pen = true;
	}
	return d;
}

/** Redraws when the container changes width. Returns a function that redraws on demand. */
function responsive(container, draw) {
	let last = 0;
	const ro = new ResizeObserver(() => {
		const w = Math.floor(container.clientWidth);
		if (w && w !== last) {
			last = w;
			hideTip();
			container.replaceChildren(draw(w));
		}
	});
	ro.observe(container);
	return () => last && container.replaceChildren(draw(last));
}

// --- run chart ----------------------------------------------------------------

/**
 * Pace through one run (or speed through one ride) with the song that was
 * playing behind it, and heart rate in its own panel underneath (never a
 * second axis on the pace plot).
 */
export function runChart(container, run, fmt) {
	const { t, d, m, hr } = run.streams;
	const n = t.length;
	const ride = run.sport === 'ride';
	const rate = (v) => fmt.rate(v, ride ? 'ride' : 'run');

	// Speed over a ~30 s window, using moving time so stops don't read as slow.
	const speed = new Array(n).fill(null);
	const W = 3;
	for (let i = 0; i < n; i++) {
		const a = Math.max(0, i - W);
		const b = Math.min(n - 1, i + W);
		const dm = m[b] - m[a];
		if (dm >= 10) speed[i] = (d[b] - d[a]) / dm;
	}
	const known = speed.filter((v) => v != null).sort((a, b) => a - b);
	if (known.length < 2) return container.replaceChildren(h('p', { class: 'dim' }, `Not enough data to draw this ${ride ? 'ride' : 'run'}.`));

	const songs = run.songs.filter((x) => x.moving_s >= 20).map((x) => ({ ...x, speed: x.distance_m / x.moving_s }));
	const lo = quantile(known, 0.03) * 0.96;
	const hi = quantile(known, 0.97) * 1.04;
	const total = t[n - 1];
	const hasHr = !!hr && hr.some((v) => v != null);
	const ranked = [...songs].filter((x) => x.moving_s >= 60).sort((a, b) => b.speed - a.speed);
	const fastest = ranked.length > 1 ? ranked[0] : null;
	const slowest = ranked.length > 1 ? ranked[ranked.length - 1] : null;

	const songAt = (sec) => songs.find((x) => sec >= x.start_s && sec < x.end_s);

	responsive(container, (width) => {
		const L = 52;
		const R = 12;
		const T = 18;
		const paceH = width < 520 ? 190 : 250;
		const strip = songs.length ? 30 : 0;
		const hrTop = T + paceH + strip + 34;
		const hrH = hasHr ? 80 : 0;
		const height = (hasHr ? hrTop + hrH : T + paceH + strip) + 30;
		const x = (sec) => L + (sec / total) * (width - L - R);
		const y = (v) => T + paceH - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * paceH;

		const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, height, role: 'img', 'aria-label': ride ? 'Speed through the ride with the song playing at each moment' : 'Pace through the run with the song playing at each moment' });

		// Song bands: neutral washes with a 2px surface gap between neighbours.
		for (const song of songs) {
			const x0 = x(song.start_s) + 1;
			const w = x(song.end_s) - x(song.start_s) - 2;
			if (w <= 0) continue;
			svg.append(s('rect', { class: 'band', x: x0, y: T, width: w, height: paceH, rx: 3 }));
			if (w >= 24) {
				const img = song.image
					? s('image', { href: song.image, x: x0 + 2, y: T + paceH + 6, width: 20, height: 20, preserveAspectRatio: 'xMidYMid slice' })
					: s('rect', { class: 'band', x: x0 + 2, y: T + paceH + 6, width: 20, height: 20, rx: 4 });
				if (song.image) img.style.clipPath = 'inset(0 round 4px)';
				svg.append(img);
				// Only name a song when the name fits its band.
				const room = w - 30;
				if (room >= song.name.length * 6.6) svg.append(s('text', { x: x0 + 27, y: T + paceH + 20 }, song.name));
			}
		}

		// Pace axis: labelled as pace, positioned by speed, faster at the top.
		const unit = fmt.unitMeters;
		if (ride) {
			// A ride's axis is plain speed, in km/h or mph.
			const perHour = 3600 / unit;
			const stepV = [1, 2, 5, 10, 20].find((v) => ((hi - lo) * perHour) / v <= 5) || 20;
			for (let v = Math.ceil((lo * perHour) / stepV) * stepV; v <= hi * perHour; v += stepV) {
				const yy = y(v / perHour);
				svg.append(s('line', { class: 'grid', x1: L, x2: width - R, y1: yy, y2: yy }), s('text', { x: L - 8, y: yy + 4, 'text-anchor': 'end' }, v));
			}
			svg.append(s('text', { x: 0, y: 10 }, `Speed, ${fmt.per}`));
		} else {
			const paceLo = unit / hi;
			const paceHi = unit / lo;
			const stepS = [10, 15, 20, 30, 60, 120].find((v) => (paceHi - paceLo) / v <= 5) || 120;
			for (let p = Math.ceil(paceLo / stepS) * stepS; p <= paceHi; p += stepS) {
				const yy = y(unit / p);
				svg.append(s('line', { class: 'grid', x1: L, x2: width - R, y1: yy, y2: yy }), s('text', { x: L - 8, y: yy + 4, 'text-anchor': 'end' }, clock(p)));
			}
			svg.append(s('text', { x: 0, y: 10 }, `Pace, min/${fmt.unit}`));
		}

		// Time axis.
		const baseY = hasHr ? hrTop + hrH : T + paceH + strip;
		const stepT = [300, 600, 900, 1200, 1800].find((v) => total / v <= (width < 520 ? 5 : 9)) || 1800;
		for (let sec = 0; sec <= total; sec += stepT) {
			svg.append(s('text', { x: x(sec), y: baseY + 18, 'text-anchor': sec === 0 ? 'start' : 'middle' }, sec === 0 ? '0' : `${sec / 60} min`));
		}
		svg.append(s('line', { class: 'axis', x1: L, x2: width - R, y1: baseY, y2: baseY }));

		const xs = t.map(x);
		svg.append(s('path', { class: 'raw', d: path(xs, speed.map((v) => (v == null ? null : y(v)))) }));

		// The point of the chart: the average pace while each song played.
		for (const song of songs) {
			const yy = y(song.speed);
			svg.append(s('line', { class: 'avg', x1: x(song.start_s) + 4, x2: Math.max(x(song.start_s) + 4, x(song.end_s) - 4), y1: yy, y2: yy }));
		}
		for (const [song, word] of [[fastest, 'Fastest'], [slowest, 'Slowest']]) {
			if (!song) continue;
			const mid = (x(song.start_s) + x(song.end_s)) / 2;
			const above = word === 'Fastest';
			const yy = y(song.speed) + (above ? -9 : 20);
			const anchor = mid < L + 60 ? 'start' : mid > width - R - 60 ? 'end' : 'middle';
			svg.append(s('text', { class: 'strong', x: mid, y: Math.max(12, yy), 'text-anchor': anchor }, `${word} ${rate(song.speed)}`));
		}

		// Heart rate, in its own panel with its own scale.
		let hy = null;
		if (hasHr) {
			const vals = hr.filter((v) => v != null).sort((a, b) => a - b);
			const hLo = Math.floor(quantile(vals, 0.02) / 10) * 10;
			const hHi = Math.ceil(vals[vals.length - 1] / 10) * 10;
			hy = (v) => hrTop + hrH - ((Math.max(hLo, v) - hLo) / (hHi - hLo || 1)) * hrH;
			svg.append(s('text', { x: 0, y: hrTop - 10 }, 'Heart rate, bpm'));
			for (const v of [hLo, Math.round((hLo + hHi) / 20) * 10, hHi]) {
				svg.append(s('line', { class: 'grid', x1: L, x2: width - R, y1: hy(v), y2: hy(v) }), s('text', { x: L - 8, y: hy(v) + 4, 'text-anchor': 'end' }, v));
			}
			svg.append(s('path', { class: 'hr', d: path(xs, hr.map((v) => (v == null ? null : hy(v)))) }));
		}

		// Hover layer: a crosshair that snaps to the nearest moment.
		const cross = s('line', { class: 'cross', y1: T, y2: baseY, visibility: 'hidden' });
		const dotP = s('circle', { class: 'dot', r: 4.5, fill: 'var(--pace)', visibility: 'hidden' });
		const dotH = s('circle', { class: 'dot', r: 4.5, fill: 'var(--heart)', visibility: 'hidden' });
		const hit = s('rect', { class: 'hit', x: L, y: T, width: width - L - R, height: baseY - T });
		const move = (evt) => {
			const box = svg.getBoundingClientRect();
			const sec = Math.max(0, Math.min(total, ((evt.clientX - box.left - L) / (width - L - R)) * total));
			let i = Math.round((sec / total) * (n - 1));
			while (i > 0 && t[i] > sec) i--;
			while (i < n - 1 && t[i + 1] <= sec) i++;
			const cx = xs[i];
			cross.setAttribute('x1', cx);
			cross.setAttribute('x2', cx);
			cross.setAttribute('visibility', 'visible');
			dotP.setAttribute('visibility', speed[i] == null ? 'hidden' : 'visible');
			if (speed[i] != null) (dotP.setAttribute('cx', cx), dotP.setAttribute('cy', y(speed[i])));
			const beat = hasHr ? hr[i] : null;
			dotH.setAttribute('visibility', beat == null ? 'hidden' : 'visible');
			if (beat != null) (dotH.setAttribute('cx', cx), dotH.setAttribute('cy', hy(beat)));

			const song = songAt(t[i]);
			showTip(evt, [
				h('div', { class: 't' }, `${clock(t[i])} in · ${fmt.dist(d[i])}`),
				tipRow('var(--pace)', speed[i] == null ? 'Stopped' : rate(speed[i]), speed[i] == null ? '' : ride ? 'speed' : 'pace'),
				beat != null && tipRow('var(--heart)', beat, 'bpm'),
				song && h('div', { class: 'song' }, h('b', null, song.name), h('div', { class: 't' }, `${song.artist} · ${rate(song.speed)} average`)),
			].filter(Boolean));
		};
		const leave = () => {
			for (const el of [cross, dotP, dotH]) el.setAttribute('visibility', 'hidden');
			hideTip();
		};
		hit.addEventListener('pointermove', move);
		hit.addEventListener('pointerdown', move);
		hit.addEventListener('pointerleave', leave);
		svg.append(cross, dotP, dotH, hit);
		return svg;
	});
}

// --- one activity, with its songs ---------------------------------------------------

const clockTime = (ts) => new Date(ts * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
export const minSec = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
const RUNS = ['Run', 'TrailRun', 'VirtualRun'];

function interp(t, values, at) {
	const n = t.length;
	if (at <= t[0]) return values[0];
	if (at >= t[n - 1]) return values[n - 1];
	let lo = 0;
	let hi = n - 1;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (t[mid] <= at) lo = mid;
		else hi = mid;
	}
	const span = t[hi] - t[lo];
	return values[lo] + (values[hi] - values[lo]) * (span > 0 ? (at - t[lo]) / span : 0);
}

/**
 * Totals over one stretch of an activity, e.g. while a song played. `a` and `b`
 * are seconds in. Sums are returned alongside the averages so that several
 * stretches (the same song played twice) can be combined correctly.
 */
export function stretchStats(st, a, b) {
	if (!st || st.t.length < 2) return {};
	const distance = interp(st.t, st.d, b) - interp(st.t, st.d, a);
	const moving = interp(st.t, st.m, b) - interp(st.t, st.m, a);
	const tally = (arr) => {
		let sum = 0;
		let n = 0;
		if (arr) for (let i = 0; i < arr.length; i++) if (arr[i] != null && st.t[i] >= a && st.t[i] <= b) (sum += arr[i]), n++;
		return { sum, n };
	};
	const hr = tally(st.hr);
	const watts = tally(st.w);
	return {
		distance,
		moving,
		hrSum: hr.sum,
		hrN: hr.n,
		wattsSum: watts.sum,
		wattsN: watts.n,
		speed: moving >= 5 && distance > 0 ? distance / moving : null,
		hr: hr.n ? hr.sum / hr.n : null,
		watts: watts.n ? watts.sum / watts.n : null,
	};
}

function smooth(arr, k) {
	return arr.map((_, i) => {
		let sum = 0;
		let n = 0;
		for (let j = Math.max(0, i - k); j <= Math.min(arr.length - 1, i + k); j++) if (arr[j] != null) (sum += arr[j]), n++;
		return n ? sum / n : null;
	});
}

function niceTicks(lo, hi, steps) {
	const span = hi - lo || 1;
	const mag = 10 ** Math.floor(Math.log10(span / 3));
	const step = (steps || [1, 2, 5, 10].map((m) => m * mag)).find((v) => span / v <= 3) || (steps ? steps[steps.length - 1] : 10 * mag);
	const out = [];
	for (let v = Math.floor(lo / step) * step; v < hi + step - 1e-9; v += step) out.push(v);
	return out;
}

/** The measures an activity has data for, each as its own panel on its own scale. */
function measures(st, isRun, fmt) {
	if (!st || st.t.length < 2) return [];
	const n = st.t.length;
	const any = (arr) => !!arr && arr.some((v) => v != null);
	const out = [];

	if (st.d[n - 1] > 0) {
		// Speed over a short window, using moving time so stops read as stops.
		const values = st.t.map((_, i) => {
			const a = Math.max(0, i - 3);
			const b = Math.min(n - 1, i + 3);
			const dm = st.m[b] - st.m[a];
			const v = dm >= 0.4 * (st.t[b] - st.t[a]) && dm > 0 ? (st.d[b] - st.d[a]) / dm : 0;
			if (isRun) return v > 0.8 ? fmt.unitMeters / v : null; // pace, seconds per km or mile
			return (v * 3600) / fmt.unitMeters;
		});
		// The whole activity's average, drawn across the panel as a dashed line.
		const whole = st.m[n - 1] > 0 ? st.d[n - 1] / st.m[n - 1] : 0;
		const average = whole > 0 ? (isRun ? fmt.unitMeters / whole : (whole * 3600) / fmt.unitMeters) : null;
		// A run is read by its pace, a ride by its speed.
		out.push(isRun
			? { title: `Pace, min/${fmt.unit}`, average, averageLabel: 'Average pace', color: 'var(--pace)', values, invert: true, steps: [10, 15, 20, 30, 60, 120, 300], tick: minSec, tip: (v) => [minSec(v), `/${fmt.unit}`] }
			: { title: `Speed, ${fmt.per}`, average, averageLabel: 'Average speed', color: 'var(--pace)', values, tick: (v) => v, tip: (v) => [v.toFixed(1), fmt.per] });
	}
	if (any(st.hr)) out.push({ title: 'Heart rate, bpm', color: 'var(--heart)', values: st.hr, tick: (v) => v, tip: (v) => [Math.round(v), 'bpm'] });
	if (any(st.w)) out.push({ title: 'Power, watts', color: 'var(--power)', values: smooth(st.w, 2), tick: (v) => v, tip: (v) => [Math.round(v), 'W'] });
	if (any(st.c)) {
		// Strava counts one foot for runs; double it for steps per minute.
		const k = isRun ? 2 : 1;
		out.push({ title: isRun ? 'Cadence, steps/min' : 'Cadence, rpm', color: 'var(--cadence)', values: smooth(st.c, 2).map((v) => (v == null ? null : v * k)), tick: (v) => v, tip: (v) => [Math.round(v), isRun ? 'spm' : 'rpm'] });
	}
	if (any(st.a)) {
		// Feet alongside miles, metres alongside kilometres.
		const feet = fmt.unit === 'mi';
		const values = feet ? st.a.map((v) => (v == null ? null : v * 3.28084)) : st.a;
		out.push({ title: `Elevation, ${feet ? 'ft' : 'm'}`, color: 'var(--muted)', values, tick: (v) => v, tip: (v) => [Math.round(v), feet ? 'ft' : 'm'] });
	}

	for (const m of out) {
		const sorted = m.values.filter((v) => v != null).sort((a, b) => a - b);
		const ticks = niceTicks(quantile(sorted, 0.02), quantile(sorted, 0.98), m.steps);
		m.ticks = ticks;
		m.lo = ticks[0];
		m.hi = ticks[ticks.length - 1];
	}
	return out;
}

/**
 * An activity laid out left to right in time: the activity, the songs that
 * played during it (each as wide as the time it played), and under those one
 * panel per measure, with a line down through the panels at every song change.
 * Call setStreams() once the per-second data has loaded.
 */
export function activityChart(container, act, fmt) {
	let streams = null;
	const isRun = RUNS.includes(act.type);
	const songs = act.songs.map((song) => ({ ...song, a: song.from - act.start_time, b: song.to - act.start_time }));

	const redraw = responsive(container, (width) => {
		const L = width < 520 ? 40 : 64;
		const R = 10;
		const total = Math.max(1, act.elapsed_s, streams ? streams.t[streams.t.length - 1] : 0);
		const x = (sec) => L + (sec / total) * (width - L - R);
		const panels = measures(streams, isRun, fmt);
		const laneH = 36;
		const actY = 22;
		const songY = actY;
		// The first panel is the point of the page: pace (or speed) with each song's average laid over it. The rest are slim.
		const lead = panels.length && panels[0].average != null ? panels[0] : null;
		const panelGap = 34;
		let bottom = songY + laneH;
		for (const m of panels) {
			m.h = m === lead ? (width < 520 ? 170 : 230) : 44;
			m.top = bottom + (m === lead ? 40 : panelGap);
			bottom = m.top + m.h;
		}
		const height = bottom + 6;
		const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, height, role: 'img', 'aria-label': `${act.name}: the songs that played, with speed, heart rate and other data underneath` });

		// Clock times along the top.
		const step = [300, 600, 900, 1800, 3600, 7200, 14400].find((v) => total / v <= (width < 520 ? 3 : 7)) || 14400;
		for (let sec = 0; sec <= total; sec += step) {
			if (sec > 0 && x(sec) > width - R - 30) break;
			svg.append(s('text', { x: x(sec), y: 12, 'text-anchor': sec === 0 ? 'start' : 'middle' }, clockTime(act.start_time + sec)));
		}

		// The songs as a row of blocks, a 2px gap of surface between neighbours.
		const W = width - L - R;
		svg.append(s('rect', { class: 'lane', x: L, y: songY, width: W, height: laneH, rx: 8 }));
		if (!songs.length) svg.append(s('text', { x: L + 12, y: songY + 23 }, 'No songs were captured during this activity.'));
		for (const song of songs) {
			const x0 = x(song.a);
			const w = Math.max(3, x(song.b) - x0 - 2);
			const bar = s('rect', { class: 'songbar', x: x0, y: songY, width: w, height: laneH, rx: Math.min(8, w / 2) });
			// Each song wears the colour of its cover, here and on the map.
			coverColor(song.image).then((color) => color && (bar.style.fill = color));
			svg.append(bar);
			const hasArt = !!song.image && w >= 30;
			if (hasArt) {
				const img = s('image', { href: song.image, x: x0 + 5, y: songY + 5, width: 26, height: 26, preserveAspectRatio: 'xMidYMid slice' });
				img.style.clipPath = 'inset(0 round 4px)';
				svg.append(img);
			}
			// Only name a song when the name fits its block.
			const textX = x0 + (hasArt ? 38 : 8);
			if (w >= textX - x0 + 6 + song.name.length * 7) svg.append(s('text', { class: 'on', x: textX, y: songY + 23 }, song.name));
		}

		// A line down through every panel wherever the song changes.
		// (Left out when the songs are too many for the width: the lines would crowd out the data.)
		if (panels.length && W / Math.max(1, songs.length) >= 26) {
			const changes = new Set();
			songs.forEach((song, i) => {
				if (song.a > 2) changes.add(Math.round(song.a));
				if (song.b < total - 2 && (i === songs.length - 1 || songs[i + 1].a - song.b > 5)) changes.add(Math.round(song.b));
			});
			for (const sec of changes) svg.append(s('line', { class: 'change', x1: x(sec), x2: x(sec), y1: songY + laneH, y2: bottom }));
		}

		// One panel per measure, each with its own scale (never two scales on one plot).
		const xs = streams ? streams.t.map(x) : [];
		panels.forEach((m, i) => {
			m.y = (v) => {
				const f = (Math.min(m.hi, Math.max(m.lo, v)) - m.lo) / (m.hi - m.lo || 1);
				return m.top + (m.invert ? f : 1 - f) * m.h;
			};
			svg.append(s('text', { class: m === lead ? 'strong' : '', x: L, y: m.top - 10 }, m.title));
			// A slim panel shows only the ends of its scale.
			for (const v of m === lead ? m.ticks : [m.ticks[0], m.ticks[m.ticks.length - 1]]) svg.append(s('line', { class: 'grid', x1: L, x2: width - R, y1: m.y(v), y2: m.y(v) }), s('text', { x: L - 8, y: m.y(v) + 4, 'text-anchor': 'end' }, m.tick(v)));
			const line = s('path', { class: 'series', d: path(xs, m.values.map((v) => (v == null ? null : m.y(v)))) });
			line.style.stroke = m.color;
			svg.append(line);
			if (m.average != null && m.average >= m.lo && m.average <= m.hi) {
				const y = m.y(m.average);
				const mean = s('line', { class: 'mean', x1: L, x2: width - R, y1: y, y2: y });
				mean.style.stroke = m.color;
				svg.append(mean, s('text', { class: 'mean', x: width - R, y: m.top - 10, 'text-anchor': 'end' }, `${m.averageLabel} ${m.tip(m.average).join(' ')}`));
				const key = s('line', { class: 'mean', x1: width - R - 12 - (m.averageLabel.length + m.tip(m.average).join(' ').length + 1) * 6.6 - 22, x2: width - R - 8 - (m.averageLabel.length + m.tip(m.average).join(' ').length + 1) * 6.6, y1: m.top - 14, y2: m.top - 14 });
				key.style.stroke = m.color;
				svg.append(key);
			}
		});

		// Hover: one crosshair for everything, read off in a single tooltip.
		const cross = s('line', { class: 'cross', y1: actY, y2: bottom, visibility: 'hidden' });
		const dots = panels.map((m) => {
			const dot = s('circle', { class: 'dot', r: 4.5, visibility: 'hidden' });
			dot.style.fill = m.color;
			return dot;
		});
		const hit = s('rect', { class: 'hit', x: L, y: actY, width: W, height: bottom - actY });
		const move = (evt) => {
			const box = svg.getBoundingClientRect();
			let sec = Math.max(0, Math.min(total, ((evt.clientX - box.left - L) / W) * total));
			let i = -1;
			if (streams) {
				i = 0;
				while (i < streams.t.length - 1 && streams.t[i + 1] <= sec) i++;
				sec = streams.t[i];
			}
			cross.setAttribute('x1', x(sec));
			cross.setAttribute('x2', x(sec));
			cross.setAttribute('visibility', 'visible');
			// The song first, as the page is about songs; then what the body was doing at that moment.
			const song = songs.find((q) => sec >= q.a && sec < q.b);
			const figures = [];
			panels.forEach((m, k) => {
				const v = m.values[i];
				dots[k].setAttribute('visibility', v == null ? 'hidden' : 'visible');
				if (v == null) return;
				dots[k].setAttribute('cx', x(sec));
				dots[k].setAttribute('cy', m.y(v));
				const [value, unit] = m.tip(v);
				figures.push(h('span', null, h('i', { style: { background: m.color } }), h('b', null, value), unit));
			});
			const rows = [tipSong(song, clockTime(act.start_time + sec)), figures.length ? h('div', { class: 'figs' }, figures) : null].filter(Boolean);
			showTip(evt, rows);
		};
		hit.addEventListener('pointermove', move);
		hit.addEventListener('pointerdown', move);
		hit.addEventListener('pointerleave', () => {
			for (const el of [cross, ...dots]) el.setAttribute('visibility', 'hidden');
			hideTip();
		});
		svg.append(cross, ...dots, hit);
		return svg;
	});

	return {
		setStreams(next) {
			streams = next && next.t && next.t.length > 1 ? next : null;
			redraw();
		},
	};
}

// --- route: where the activity went, and which song played where ------------------------

// A colour for each song, taken from its cover: the strongest colour in it, kept bright enough to draw with.
const coverColors = new Map();
export function coverColor(url) {
	if (!url) return Promise.resolve(null);
	if (!coverColors.has(url)) {
		coverColors.set(url, new Promise((resolve) => {
			const img = new Image();
			img.crossOrigin = 'anonymous';
			img.onerror = () => resolve(null);
			img.onload = () => {
				try {
					const size = 12;
					const canvas = document.createElement('canvas');
					canvas.width = canvas.height = size;
					const ctx = canvas.getContext('2d', { willReadFrequently: true });
					ctx.drawImage(img, 0, 0, size, size);
					const px = ctx.getImageData(0, 0, size, size).data;
					let [r, g, b, total] = [0, 0, 0, 0];
					for (let i = 0; i < px.length; i += 4) {
						const [hi, lo] = [Math.max(px[i], px[i + 1], px[i + 2]), Math.min(px[i], px[i + 1], px[i + 2])];
						const light = (hi + lo) / 510;
						const sat = hi === lo ? 0 : (hi - lo) / (255 - Math.abs(hi + lo - 255));
						// Strong, mid-bright pixels count for most; greys and near-black or near-white for little.
						const weight = sat * sat * (1 - Math.abs(light - 0.5) * 1.4) + 0.004;
						r += px[i] * weight;
						g += px[i + 1] * weight;
						b += px[i + 2] * weight;
						total += weight;
					}
					[r, g, b] = [r / total, g / total, b / total];
					const [hi, lo] = [Math.max(r, g, b), Math.min(r, g, b)];
					let hue = 0;
					if (hi !== lo) hue = hi === r ? ((g - b) / (hi - lo)) % 6 : hi === g ? (b - r) / (hi - lo) + 2 : (r - g) / (hi - lo) + 4;
					const sat = hi === lo ? 0 : (hi - lo) / (255 - Math.abs(hi + lo - 255));
					const light = (hi + lo) / 510;
					resolve(sat < 0.12 ? 'hsl(0, 0%, 38%)' : `hsl(${Math.round(hue * 60 + 360) % 360}, ${Math.round(Math.max(55, sat * 100))}%, ${Math.round(Math.min(54, Math.max(40, light * 100)))}%)`);
				} catch {
					resolve(null);
				}
			};
			// The small cover is plenty for a colour.
			img.src = url.replace('ab67616d00001e02', 'ab67616d00004851');
		}));
	}
	return coverColors.get(url);
}

/** Strava's encoded polyline, as [lat, lng] pairs. */
function decodeRoute(text) {
	const points = [];
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

// Mapbox draws the map, as it does Strava's. Its code is served from here (vendor/), in the build that needs no inline
// script or blob worker, so the page's content policy stays strict. The token is a public one; the server hands it over
// with the account (it is a Worker secret, MAPBOX_TOKEN), so it is not written in the code.
const MAP_STYLES = [
	// The pale style, so the songs are the colour on the map.
	['Standard', 'mapbox://styles/mapbox/light-v11'],
	['Satellite', 'mapbox://styles/mapbox/satellite-v9'],
	['Hybrid', 'mapbox://styles/mapbox/satellite-streets-v12'],
];
let mapbox = null;
function loadMapbox(token) {
	if (!mapbox) {
		mapbox = new Promise((resolve, reject) => {
			document.head.append(h('link', { rel: 'stylesheet', href: 'vendor/mapbox-gl.css' }));
			const script = h('script', { src: 'vendor/mapbox-gl-csp.js' });
			script.onload = () => {
				const gl = window.mapboxgl;
				if (!gl) return reject(new Error('no map'));
				gl.workerUrl = new URL('vendor/mapbox-gl-csp-worker.js', document.baseURI).href;
				gl.accessToken = token;
				resolve(gl);
			};
			script.onerror = () => reject(new Error('no map'));
			document.head.append(script);
		});
	}
	return mapbox;
}

/**
 * The route on a map that can be dragged, zoomed, tilted and switched between
 * street, satellite and hybrid. The songs are laid along it as on the still
 * map below, which is what is drawn if Mapbox cannot be.
 */
export function routeChart(container, polyline, act, streams, fmt, token) {
	const still = () => routeStill(container, polyline, act, streams, fmt);
	if (!token) return still();
	loadMapbox(token)
		.then((gl) => {
			try {
				routeLive(gl, container, polyline, act, streams, fmt);
			} catch {
				still();
			}
		})
		.catch(still);
}

function routeLive(gl, container, polyline, act, streams, fmt) {
	const coords = decodeRoute(polyline);
	if (coords.length < 2) return;
	const st = streams && streams.t && streams.t.length > 1 && streams.d[streams.d.length - 1] > 0 ? streams : null;

	// How far along the route each point is, in metres.
	const rad = Math.PI / 180;
	const along = [0];
	for (let i = 1; i < coords.length; i++) {
		const [a, b] = [coords[i - 1], coords[i]];
		const x = (b[1] - a[1]) * rad * Math.cos(((a[0] + b[0]) / 2) * rad);
		const y = (b[0] - a[0]) * rad;
		along.push(along[i - 1] + Math.hypot(x, y) * 6371000);
	}
	const length = along[along.length - 1] || 1;
	// Mapbox takes longitude first.
	const at = (dist) => {
		const d = Math.max(0, Math.min(length, dist));
		let i = 1;
		while (i < coords.length - 1 && along[i] < d) i++;
		const f = (d - along[i - 1]) / (along[i] - along[i - 1] || 1);
		return [coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * f, coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * f];
	};
	const stretch = (from, to) => [at(from), ...coords.filter((_, i) => along[i] > from && along[i] < to).map((p) => [p[1], p[0]]), at(to)];
	const line = (points, properties = {}) => ({ type: 'Feature', properties, geometry: { type: 'LineString', coordinates: points } });

	// Each song's stretch of road, by distance: how far in the activity was when it began and ended, as a share of the whole.
	const songs = [];
	if (st) {
		const total = st.d[st.d.length - 1];
		for (const song of act.songs) {
			const [a, b] = [song.from - act.start_time, song.to - act.start_time];
			const from = (interp(st.t, st.d, a) / total) * length;
			const to = (interp(st.t, st.d, b) / total) * length;
			if (to - from < 1) continue;
			songs.push({ song, from, to, speed: stretchStats(st, a, b).speed, color: '#6250d6' });
		}
	}

	const holder = h('div', { class: 'map live' });
	container.replaceChildren(holder);
	const lats = coords.map((p) => p[0]);
	const lngs = coords.map((p) => p[1]);
	const map = new gl.Map({
		container: holder,
		style: MAP_STYLES[0][1],
		bounds: [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
		// Room at the top for the buttons that sit over the map.
		fitBoundsOptions: { padding: holder.clientWidth < 520 ? { top: 70, bottom: 34, left: 34, right: 56 } : { top: 70, bottom: 50, left: 60, right: 70 } },
		// Scrolling the page past the map must not zoom it: zooming takes ctrl or two fingers.
		cooperativeGestures: true,
	});
	map.addControl(new gl.NavigationControl({ visualizePitch: true }), 'top-right');
	map.addControl(new gl.FullscreenControl(), 'top-right');

	// Sources and layers go with the style, so they are laid again each time the style is changed.
	let tilted = false;
	const lay = () => {
		if (map.getSource('road')) return;
		map.addSource('road', { type: 'geojson', data: line(coords.map((p) => [p[1], p[0]])) });
		map.addSource('songs', { type: 'geojson', data: { type: 'FeatureCollection', features: songs.map((q) => line(stretch(q.from + length * 0.002, q.to - length * 0.002), { color: q.color })) } });
		const round = { 'line-cap': 'round', 'line-join': 'round' };
		map.addLayer({ id: 'road-case', type: 'line', source: 'road', layout: round, paint: { 'line-color': '#fff', 'line-width': 6, 'line-opacity': 0.9 } });
		map.addLayer({ id: 'road', type: 'line', source: 'road', layout: round, paint: { 'line-color': '#3a3a3a', 'line-width': 2, 'line-dasharray': [0.5, 2.5] } });
		map.addLayer({ id: 'songs-case', type: 'line', source: 'songs', layout: round, paint: { 'line-color': '#fff', 'line-width': 11 } });
		map.addLayer({ id: 'songs', type: 'line', source: 'songs', layout: round, paint: { 'line-color': ['get', 'color'], 'line-width': 6.5 } });
		if (!map.getSource('heights')) map.addSource('heights', { type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize: 512, maxzoom: 14 });
		map.setTerrain(tilted ? { source: 'heights', exaggeration: 1.4 } : null);
	};
	map.on('style.load', lay);

	// The covers, each in the middle of its stretch, and the two ends of the route.
	const dot = (cls, where) => new gl.Marker({ element: h('span', { class: `end-dot ${cls}` }) }).setLngLat(where).addTo(map);
	dot('finish', [coords[coords.length - 1][1], coords[coords.length - 1][0]]);
	dot('begin', [coords[0][1], coords[0][0]]);
	for (const q of songs) {
		if (!q.song.image) continue;
		q.pin = h('span', { class: 'pin' }, h('img', { src: q.song.image, alt: '', referrerpolicy: 'no-referrer' }));
		const tell = (evt) => showTip(evt, [tipSong(q.song, q.speed != null ? (RUNS.includes(act.type) ? fmt.pace(q.speed) : fmt.speed(q.speed)) : '')]);
		q.pin.addEventListener('pointermove', tell);
		q.pin.addEventListener('pointerdown', tell);
		q.pin.addEventListener('pointerleave', hideTip);
		new gl.Marker({ element: q.pin }).setLngLat(at((q.from + q.to) / 2)).addTo(map);
	}
	// A cover is shown once its stretch is long enough on screen to hold it, so zooming in brings more of them out.
	const fit = () => {
		const perPixel = (78271.517 * Math.cos(coords[0][0] * rad)) / 2 ** map.getZoom();
		for (const q of songs) if (q.pin) q.pin.hidden = (q.to - q.from) / perPixel < 24;
	};
	map.on('zoom', fit);
	map.on('load', fit);

	// Each song wears the colour of its cover.
	Promise.all(songs.map((q) => coverColor(q.song.image).then((color) => {
		if (!color) return;
		q.color = color;
		if (q.pin) q.pin.style.borderColor = color;
	}))).then(() => {
		const source = map.getSource('songs');
		if (source) source.setData({ type: 'FeatureCollection', features: songs.map((q) => line(stretch(q.from + length * 0.002, q.to - length * 0.002), { color: q.color })) });
	});

	// Which map, and whether it is tilted with the hills raised.
	const kinds = MAP_STYLES.map(([label, style], i) =>
		h('button', {
			'aria-pressed': String(i === 0),
			onclick: () => {
				kinds.forEach((b, k) => b.setAttribute('aria-pressed', String(k === i)));
				map.setStyle(style);
			},
		}, label));
	const tilt = h('button', {
		class: 'tilt', 'aria-pressed': 'false', title: 'Tilt the map and raise the hills',
		onclick: () => {
			tilted = !tilted;
			tilt.setAttribute('aria-pressed', String(tilted));
			map.setTerrain(tilted ? { source: 'heights', exaggeration: 1.4 } : null);
			map.easeTo({ pitch: tilted ? 62 : 0, bearing: tilted ? -20 : 0, duration: 900 });
		},
	}, '3D');
	holder.append(h('div', { class: 'map-ui' }, h('div', { class: 'seg', role: 'group', 'aria-label': 'Map style' }, kinds), tilt));

	// The map holds a graphics context; it is given back once the page has moved on.
	const watch = setInterval(() => {
		if (holder.isConnected) return;
		clearInterval(watch);
		map.remove();
	}, 2000);
}

/**
 * The route with the songs laid along it. Each song colours the stretch of
 * road it played over (violet where it was faster than the activity's average,
 * grey where slower) and its cover sits in the middle of that stretch. Road
 * with no music is a thin dashed line.
 *
 * The route has no times of its own, so a song is placed by distance: how far
 * in the activity was when it began and ended, as a share of the whole.
 */
function routeStill(container, polyline, act, streams, fmt) {
	const coords = decodeRoute(polyline);
	if (coords.length < 2) return;
	const st = streams && streams.t && streams.t.length > 1 && streams.d[streams.d.length - 1] > 0 ? streams : null;
	// Web Mercator, the projection the map tiles are drawn in: the world is a square one unit across.
	const xs = coords.map((p) => (p[1] + 180) / 360);
	const ys = coords.map((p) => (1 - Math.log(Math.tan((p[0] * Math.PI) / 180) + 1 / Math.cos((p[0] * Math.PI) / 180)) / Math.PI) / 2);
	const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];

	responsive(container, (width) => {
		const height = width < 520 ? 260 : 360;
		const pad = width < 520 ? 34 : 48;
		// The zoom that fits the route is rarely a whole number: tiles of the zoom above are drawn a little smaller, which keeps them sharp.
		const zoom = Math.min(18, Math.log2(Math.min((width - 2 * pad) / (x1 - x0 || 1e-9), (height - 2 * pad) / (y1 - y0 || 1e-9)) / 256));
		const z = Math.max(0, Math.min(19, Math.ceil(zoom)));
		const world = 256 * 2 ** zoom;
		const tile = 256 * 2 ** (zoom - z);
		const left = ((x0 + x1) / 2) * world - width / 2;
		const top = ((y0 + y1) / 2) * world - height / 2;
		const pts = coords.map((_, i) => [xs[i] * world - left, ys[i] * world - top]);

		// The streets underneath are OpenStreetMap's own tiles.
		const ground = h('div', { class: 'tiles', 'aria-hidden': 'true' });
		const n = 2 ** z;
		for (let ty = Math.floor(top / tile); ty * tile < top + height; ty++) {
			if (ty < 0 || ty >= n) continue;
			for (let tx = Math.floor(left / tile); tx * tile < left + width; tx++) {
				const img = h('img', { src: `https://tile.openstreetmap.org/${z}/${((tx % n) + n) % n}/${ty}.png`, alt: '', draggable: 'false' });
				Object.assign(img.style, { left: `${Math.round(tx * tile - left)}px`, top: `${Math.round(ty * tile - top)}px`, width: `${Math.ceil(tile) + 1}px`, height: `${Math.ceil(tile) + 1}px` });
				ground.append(img);
			}
		}
		const credit = h('p', { class: 'credit' }, '© ', h('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener' }, 'OpenStreetMap contributors'));

		// How far along the line each point is, in pixels.
		const along = [0];
		for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
		const length = along[along.length - 1] || 1;
		const at = (dist) => {
			const d = Math.max(0, Math.min(length, dist));
			let i = 1;
			while (i < pts.length - 1 && along[i] < d) i++;
			const f = (d - along[i - 1]) / (along[i] - along[i - 1] || 1);
			return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
		};
		const stretch = (from, to) => {
			const inside = pts.filter((_, i) => along[i] > from && along[i] < to);
			return [at(from), ...inside, at(to)].map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('');
		};

		const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, height, role: 'img', 'aria-label': 'The route, with each song over the stretch it played on' });
		const whole = stretch(0, length);
		svg.append(s('path', { class: 'road-under', d: whole }), s('path', { class: 'road', d: whole }));

		const covers = [];
		if (st) {
			const total = st.d[st.d.length - 1];
			const average = stretchStats(st, 0, st.t[st.t.length - 1]).speed;
			for (const song of act.songs) {
				const [a, b] = [song.from - act.start_time, song.to - act.start_time];
				const from = (interp(st.t, st.d, a) / total) * length;
				const to = (interp(st.t, st.d, b) / total) * length;
				const speed = stretchStats(st, a, b).speed;
				if (to - from < 2) continue;
				const up = speed != null && average != null && speed >= average;
				// A hair's gap at each end keeps one song apart from the next.
				const d = stretch(from + 1.5, to - 1.5);
				const line = s('path', { class: 'song', d });
				coverColor(song.image).then((color) => color && (line.style.stroke = color));
				svg.append(s('path', { class: 'song-under', d }), line);
				covers.push({ song, up, speed, at: at((from + to) / 2), size: Math.max(0, Math.min(width < 520 ? 26 : 34, (to - from) * 0.9)) });
			}
		}

		const [start, end] = [pts[0], pts[pts.length - 1]];
		svg.append(s('circle', { class: 'end', cx: end[0], cy: end[1], r: 6 }), s('circle', { class: 'start', cx: start[0], cy: start[1], r: 6 }));

		// Covers go on last so they sit over the road, the slower ones under the faster.
		covers.sort((p, q) => p.up - q.up);
		for (const c of covers) {
			if (c.size < 13 || !c.song.image) continue;
			const [cx, cy] = c.at;
			const r = Math.round(c.size / 4);
			const img = s('image', { href: c.song.image, x: cx - c.size / 2, y: cy - c.size / 2, width: c.size, height: c.size, preserveAspectRatio: 'xMidYMid slice' });
			img.style.clipPath = `inset(0 round ${r}px)`;
			const ring = s('rect', { class: 'ring', x: cx - c.size / 2 - 2.5, y: cy - c.size / 2 - 2.5, width: c.size + 5, height: c.size + 5, rx: r + 2.5 });
			coverColor(c.song.image).then((color) => color && (ring.style.stroke = color));
			const hit = s('rect', { class: 'hit', x: cx - c.size / 2 - 4, y: cy - c.size / 2 - 4, width: c.size + 8, height: c.size + 8 });
			const tell = (evt) =>
				showTip(evt, [tipSong(c.song, c.speed != null ? (RUNS.includes(act.type) ? fmt.pace(c.speed) : fmt.speed(c.speed)) : '')]);
			hit.addEventListener('pointermove', tell);
			hit.addEventListener('pointerdown', tell);
			hit.addEventListener('pointerleave', hideTip);
			svg.append(ring, img, hit);
		}
		const frame = h('div', { class: 'map' }, ground, svg, credit);
		frame.style.height = `${height}px`;
		return frame;
	});
}

// --- spectrum: songs placed along one scale ---------------------------------------------

/**
 * Album covers set out along a line by a single measure (pace, heart rate),
 * with the person's own average marked. Covers that would overlap stack upward.
 * `o`: { range: [lo, hi], avg, avgLabel, left, right, describe(item) }.
 */
export function spectrum(container, items, o) {
	const [lo, hi] = o.range;
	responsive(container, (width) => {
		const size = width < 480 ? 30 : 40;
		const gap = size + 4;
		const pad = size / 2 + 2;
		const x = (v) => pad + ((v - lo) / (hi - lo || 1)) * (width - 2 * pad);

		const lanes = [];
		const placed = [...items].sort((a, b) => a.value - b.value).map((item) => {
			const px = x(item.value);
			let lane = lanes.findIndex((last) => px - last >= gap);
			if (lane < 0) lane = lanes.push(px) - 1;
			else lanes[lane] = px;
			return { item, px, lane };
		});
		const base = Math.max(1, lanes.length) * gap + 4;
		const root = h('div', { class: 'spectrum', style: { height: `${base + 34}px` } }, h('i', { class: 'line', style: { top: `${base + 6}px` } }));

		if (o.avg != null) {
			root.append(
				h('i', { class: 'avg', style: { left: `${x(o.avg)}px`, height: `${base + 12}px` } }),
				h('span', { class: 'avg-label', style: { left: `${Math.min(width - 70, Math.max(70, x(o.avg)))}px`, top: `${base + 14}px` } }, o.avgLabel),
			);
		}
		root.append(h('span', { class: 'end', style: { left: '0', top: `${base + 14}px` } }, o.left), h('span', { class: 'end', style: { right: '0', top: `${base + 14}px` } }, o.right));

		for (const { item, px, lane } of placed) {
			const cover = h('button', { class: 'cover', type: 'button', 'aria-label': `${item.name}, ${o.describe(item)}`, style: { left: `${px - size / 2}px`, top: `${base - (lane + 1) * gap}px`, width: `${size}px`, height: `${size}px` } },
				item.image ? h('img', { src: item.image, alt: '', referrerpolicy: 'no-referrer' }) : (item.name || '?')[0]);
			const tipFor = (evt) => showTip(evt, [h('div', { class: 'r' }, h('b', null, item.name)), h('div', { class: 't' }, item.artist), h('div', { class: 't' }, o.describe(item))]);
			cover.addEventListener('pointermove', tipFor);
			cover.addEventListener('pointerleave', hideTip);
			cover.addEventListener('focus', () => {
				const r = cover.getBoundingClientRect();
				tipFor({ clientX: r.left + r.width / 2, clientY: r.top });
			});
			cover.addEventListener('blur', hideTip);
			root.append(cover);
		}
		return root;
	});
}
