// SVG charts, drawn by hand so there is no build step and nothing to load.

const SVG = 'http://www.w3.org/2000/svg';

export function h(tag, props, ...kids) {
	const el = document.createElement(tag);
	apply(el, props);
	return add(el, kids);
}

function s(tag, props, ...kids) {
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

function showTip(evt, nodes) {
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

/** Redraws when the container changes width. */
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
}

// --- run chart ----------------------------------------------------------------

/**
 * Pace through one run with the song that was playing behind it, and heart
 * rate in its own panel underneath (never a second axis on the pace plot).
 */
export function runChart(container, run, fmt) {
	const { t, d, m, hr } = run.streams;
	const n = t.length;

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
	if (known.length < 2) return container.replaceChildren(h('p', { class: 'dim' }, 'Not enough data to draw this run.'));

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

		const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, height, role: 'img', 'aria-label': 'Pace through the run with the song playing at each moment' });

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
		const paceLo = unit / hi;
		const paceHi = unit / lo;
		const stepS = [10, 15, 20, 30, 60, 120].find((v) => (paceHi - paceLo) / v <= 5) || 120;
		for (let p = Math.ceil(paceLo / stepS) * stepS; p <= paceHi; p += stepS) {
			const yy = y(unit / p);
			svg.append(s('line', { class: 'grid', x1: L, x2: width - R, y1: yy, y2: yy }), s('text', { x: L - 8, y: yy + 4, 'text-anchor': 'end' }, clock(p)));
		}
		svg.append(s('text', { x: 0, y: 10 }, `Pace, min/${fmt.unit}`));

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
			svg.append(s('text', { class: 'strong', x: mid, y: Math.max(12, yy), 'text-anchor': anchor }, `${word} ${fmt.pace(song.speed)}`));
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
				tipRow('var(--pace)', speed[i] == null ? 'Stopped' : fmt.pace(speed[i]), speed[i] == null ? '' : 'pace'),
				beat != null && tipRow('var(--heart)', beat, 'bpm'),
				song && h('div', { class: 'song' }, h('b', null, song.name), h('div', { class: 't' }, `${song.artist} · ${fmt.pace(song.speed)} average`)),
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

// --- scatter ------------------------------------------------------------------

/** One dot per run: how often the song changed against how far the run went. */
export function changesChart(container, points, fmt, describe, open) {
	const maxX = Math.max(...points.map((p) => p.rate));
	const minX = Math.min(...points.map((p) => p.rate));
	const maxY = Math.max(...points.map((p) => p.distance_m)) / fmt.unitMeters;
	const x0 = Math.floor(minX);
	const x1 = Math.ceil(maxX + 0.01);
	const yStep = [2, 5, 10].find((v) => maxY / v <= 5) || 20;
	const y1 = Math.ceil(maxY / yStep) * yStep;

	responsive(container, (width) => {
		const L = 44;
		const R = 12;
		const T = 30;
		const H = width < 520 ? 200 : 240;
		const height = T + H + 44;
		const x = (v) => L + ((v - x0) / (x1 - x0)) * (width - L - R);
		const y = (v) => T + H - (v / y1) * H;
		const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, height, role: 'img', 'aria-label': 'Run distance against how often the song changed' });

		for (let v = 0; v <= y1; v += yStep) {
			svg.append(s('line', { class: v === 0 ? 'axis' : 'grid', x1: L, x2: width - R, y1: y(v), y2: y(v) }), s('text', { x: L - 8, y: y(v) + 4, 'text-anchor': 'end' }, v));
		}
		const xStep = x1 - x0 > 8 ? 2 : 1;
		for (let v = x0; v <= x1; v += xStep) svg.append(s('text', { x: x(v), y: T + H + 18, 'text-anchor': 'middle' }, v));
		svg.append(s('text', { x: 0, y: 10 }, `Distance, ${fmt.unit}`), s('text', { x: (L + width - R) / 2, y: T + H + 38, 'text-anchor': 'middle' }, 'Songs per 10 minutes'));

		const dots = points.map((p) => {
			const el = s('circle', { class: 'pt', cx: x(p.rate), cy: y(p.distance_m / fmt.unitMeters), r: 5 });
			svg.append(el);
			return el;
		});

		// The pointer only has to be nearest to a dot, not on it.
		let active = -1;
		const nearest = (evt) => {
			const box = svg.getBoundingClientRect();
			const px = evt.clientX - box.left;
			const py = evt.clientY - box.top;
			let best = -1;
			let bestD = 40 * 40;
			points.forEach((p, i) => {
				const dist = (x(p.rate) - px) ** 2 + (y(p.distance_m / fmt.unitMeters) - py) ** 2;
				if (dist < bestD) (bestD = dist), (best = i);
			});
			return best;
		};
		const hit = s('rect', { class: 'hit link', x: 0, y: 0, width, height: T + H + 4 });
		hit.addEventListener('pointermove', (evt) => {
			const i = nearest(evt);
			if (i !== active) {
				dots[active]?.classList.remove('on');
				dots[i]?.classList.add('on');
				active = i;
			}
			if (i < 0) return hideTip();
			const p = points[i];
			showTip(evt, [
				h('div', { class: 't' }, describe(p)),
				tipRow(null, fmt.dist(p.distance_m), `at ${fmt.pace(p.speed)}`),
				tipRow(null, p.rate.toFixed(1), 'songs per 10 min'),
			]);
		});
		hit.addEventListener('pointerleave', () => {
			dots[active]?.classList.remove('on');
			active = -1;
			hideTip();
		});
		hit.addEventListener('click', (evt) => {
			const i = nearest(evt);
			if (i >= 0) open(points[i]);
		});
		svg.append(hit);
		return svg;
	});
}

// --- activity overlap -----------------------------------------------------------

const clockTime = (ts) => new Date(ts * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
export const minSec = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

/**
 * An activity laid out left to right in time, with each song that played
 * during it as a block underneath, as wide as the time it played for.
 */
export function overlapChart(container, act) {
	const total = Math.max(1, act.elapsed_s);
	responsive(container, (width) => {
		const label = width < 520 ? 0 : 64;
		const W = width - label;
		const x = (ts) => ((ts - act.start_time) / total) * W;
		const lane = (name, track) => h('div', { class: 'lane' }, label ? h('span', { class: 'name', style: { width: `${label}px` } }, name) : null, track);

		// Clock times along the top.
		const step = [300, 600, 900, 1800, 3600, 7200, 14400].find((v) => total / v <= (W < 420 ? 3 : 7)) || 14400;
		const axis = h('div', { class: 'track ticks', style: { width: `${W}px` } });
		for (let sec = 0; sec <= total; sec += step) {
			const left = x(act.start_time + sec);
			if (sec > 0 && left > W - 34) break;
			axis.append(h('span', { class: sec === 0 ? 'first' : null, style: { left: `${left}px` } }, clockTime(act.start_time + sec)));
		}

		const activity = h('div', { class: 'track', style: { width: `${W}px` } }, h('div', { class: 'block act', style: { left: '0px', width: `${W}px` } }, h('span', null, act.name)));

		const songs = h('div', { class: 'track', style: { width: `${W}px` } });
		if (!act.songs.length) songs.append(h('div', { class: 'none' }, 'No songs were captured during this activity.'));
		for (const song of act.songs) {
			// A 2px gap of surface separates neighbouring songs.
			const w = Math.max(3, x(song.to) - x(song.from) - 2);
			const block = h('div', { class: 'block song', tabindex: '0', style: { left: `${x(song.from)}px`, width: `${w}px` } });
			if (w >= 28 && song.image) block.append(h('img', { src: song.image, alt: '', referrerpolicy: 'no-referrer' }));
			// Only name a song when the name fits its block.
			if (w >= (song.image ? 36 : 12) + song.name.length * 6.8) block.append(h('span', null, song.name));
			const tipFor = (evt) =>
				showTip(evt, [
					h('div', { class: 'r' }, h('b', null, song.name)),
					h('div', { class: 't' }, song.artist),
					h('div', { class: 't' }, `${clockTime(song.from)} – ${clockTime(song.to)} · played for ${minSec(song.to - song.from)}`),
				]);
			block.addEventListener('pointermove', tipFor);
			block.addEventListener('pointerdown', tipFor);
			block.addEventListener('pointerleave', hideTip);
			block.addEventListener('focus', () => {
				const r = block.getBoundingClientRect();
				tipFor({ clientX: r.left + r.width / 2, clientY: r.top });
			});
			block.addEventListener('blur', hideTip);
			songs.append(block);
		}

		return h('div', { class: 'overlap' }, lane('', axis), lane('Strava', activity), lane('Spotify', songs));
	});
}
