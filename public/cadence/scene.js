// The picture behind the front page: a runner crossing a playlist. The ground is the music, a row of leaning bars in each
// song's color, and its height is the pace: the faster the run, the higher it stands, so the line the runner leaves behind
// is the pace chart Cadence draws, with the songs underneath. Feet land on the beat. One song, the yellow one, is the fast one.
// Nothing here is an image but the covers. It is one canvas, drawn a frame at a time, and it began as the Cadence card on
// garvitgupta.com (js/cadence-tile.js there). Add ?freeze=14 to the address to hold it at 14 seconds.
//
// scene(host, { room, covers, units }) lays the canvas behind everything in `host`. The run keeps to the foot of it, as tall
// as `room` (an empty element left for it below the words). `covers` is a promise of cover addresses, and `units()` says
// 'mi' or 'km' whenever it is asked. `foot()`, if given, is how many pixels to keep clear at the very bottom.
export function scene(host, opts) {
	var cv = document.createElement("canvas"), ctx = cv.getContext("2d");
	cv.setAttribute("aria-hidden", "true");
	host.prepend(cv);

	var TALL = 424;              // drawn as if the run were this tall, and scaled to fit the room it is given
	var BW = 696;                // how wide the strip then is, in those units: wider on a wide page
	var RX = 286;                 // where the runner is, across
	var LEAN = Math.tan(11 * Math.PI / 180);   // the logo's bars lean this far
	var YELLOW = "#ffd24a", WHITE = "#fcfcfb";
	// The runner's headphones come in a different color each time the page loads: the cup, and the band over the head.
	var PODS = [
		{ cup: "#8e5cf7", band: "#b08cff" },   // purple
		{ cup: "#3f8fe0", band: "#8fc0f2" },   // blue
		{ cup: "#f0803f", band: "#f7b08a" },   // orange
		{ cup: "#3fae74", band: "#8fd6ae" },   // green
		{ cup: "#ea6a80", band: "#f5a8b5" },   // pink
		{ cup: "#2f3648", band: "#6a7388" }    // midnight
	];
	PODS = PODS[Math.floor(Math.random() * PODS.length)];

	// The playlist, round and round: six places, and a cover dealt to each when the covers arrive. v is how fast the run goes
	// to it (0 to 1), bpm sets the beat and so the stride, and hue colors its bars until the cover lends its own. The fourth is the fast one.
	var SONGS = [
		{ hue: 172, v: 0.30, bpm: 150, dur: 3.2 },
		{ hue: 18, v: 0.46, bpm: 158, dur: 3.2 },
		{ hue: 318, v: 0.18, bpm: 144, dur: 3.0 },
		{ hue: 46, v: 1.00, bpm: 180, dur: 4.6, hot: true },
		{ hue: 200, v: 0.52, bpm: 164, dur: 3.2 },
		{ hue: 268, v: 0.32, bpm: 152, dur: 3.0 }
	];
	var T = 0;
	SONGS.forEach(function (s, i) {
		s.i = i; s.at = T; T += s.dur;
		s.tint = s.hot ? YELLOW : "hsl(" + s.hue + " 90% 86%)"; s.cover = s.hot ? YELLOW : "hsl(" + s.hue + " 68% 58%)";
	});
	function wear(s, address) {
		var img = new Image();
		img.crossOrigin = "anonymous";
		img.onload = function () {
			s.img = img;
			if (s.hot) return;
			try {   // the cover's own color, made pale, for the song's bars
				var c = document.createElement("canvas").getContext("2d");
				c.canvas.width = c.canvas.height = 8; c.drawImage(img, 0, 0, 8, 8);
				var d = c.getImageData(0, 0, 8, 8).data, best = -1, hue = s.hue;
				for (var q = 0; q < d.length; q += 4) {   // its most vivid patch
					var r = d[q] / 255, g = d[q + 1] / 255, b = d[q + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), ch = mx - mn;
					if (ch * mx > best && ch > 0.08) { best = ch * mx; hue = 60 * (mx === r ? ((g - b) / ch + 6) % 6 : mx === g ? (b - r) / ch + 2 : (r - g) / ch + 4); }
				}
				s.hue = Math.round(hue); s.tint = "hsl(" + s.hue + " 90% 86%)";
			} catch (e) {}
			if (frozen) draw();
		};
		img.src = address;
	}
	var frozen = false;
	Promise.resolve(opts.covers).then(function (list) { SONGS.forEach(function (s, i) { if (list && list[i]) wear(s, list[i]); }); }).catch(function () {});

	// The whole loop worked out once, sixty times a second: the speed, which song, how far along the ground, how many beats in.
	var DT = 1 / 60, N = Math.round(T / DT), V = [], SI = [], X = [0], B = [0];
	function songAt(t) { for (var i = SONGS.length - 1; i >= 0; i--) if (t >= SONGS[i].at) return SONGS[i]; return SONGS[0]; }
	function scroll(v) { return 150 + 370 * v; }   // how fast the ground goes by
	(function () {
		var v = SONGS[0].v, bpm = SONGS[0].bpm, BP = [];
		for (var pass = 0; pass < 2; pass++) for (var i = 0; i < N; i++) {   // twice round, so the end meets the start
			var s = songAt(i * DT);
			v += (s.v - v) * DT / 0.5; bpm += (s.bpm - bpm) * DT / 0.5;
			if (pass) { V[i] = v + 0.03 * Math.sin(i * DT * 2 * Math.PI * 5 / T); BP[i] = bpm; SI[i] = s.i; }
		}
		for (i = 0; i < N; i++) { X[i + 1] = X[i] + scroll(V[i]) * DT; B[i + 1] = B[i] + BP[i] / 60 * DT; }
		var k = 2 * Math.round(B[N] / 2) / B[N];   // a whole number of strides in the loop
		for (i = 0; i <= N; i++) B[i] *= k;
	})();
	var LW = X[N];
	function cum(arr, f) { var i = Math.min(N - 1, Math.floor(f)); return arr[i] + (arr[i + 1] - arr[i]) * (f - i); }
	function vAt(f) { var i = Math.floor(f) % N, j = (i + 1) % N; return V[i] + (V[j] - V[i]) * (f - Math.floor(f)); }
	// which moment of the loop the runner is at a place on the ground
	function when(wx) {
		wx = ((wx % LW) + LW) % LW;
		var lo = 0, hi = N;
		while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (X[mid] <= wx) lo = mid; else hi = mid; }
		return lo + (wx - X[lo]) / (X[hi] - X[lo]);
	}
	function ease(x) { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); }
	function clamp(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
	var lift = 0;
	function rise(v) { return 150 + lift + 112 * ease(v); }   // how high the ground stands for a speed: always clear of the songs' dock at the foot
	function hash(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

	var SP = LW / Math.round(LW / 13), NB = Math.round(LW / SP);          // the bars, a whole number of them round the loop
	var SP2 = LW * 0.3 / Math.round(LW * 0.3 / 62), NB2 = Math.round(LW * 0.3 / SP2);   // and the big ones far behind

	var VH = 448, k = 1, dpr = 1;
	function size() {
		var r = host.getBoundingClientRect(), room = opts.room.getBoundingClientRect().height;
		if (!r.width || !room) return;
		dpr = Math.min(window.devicePixelRatio || 1, 2);
		cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
		// as large as the room under the words allows, down to a strip 380 across: on a phone held upright the runner stays big and fewer bars show
		var foot = opts.foot ? opts.foot() : 0;   // room kept clear at the very bottom, for whatever the page puts there
		k = Math.min((room - foot) / TALL, r.width / 380, 2.2); BW = r.width / k; VH = r.height / k; lift = foot / k;
		RX = Math.round(BW * 0.5);   // the runner in the middle, under the words
	}

	// loose things: the streaks going by, sparks off the feet, rings where a foot lands
	var streaks = [], sparks = [], rings = [];
	for (var i = 0; i < 64; i++) streaks.push({ x: hash(i) * BW, y: hash(i + 99), z: 0.25 + 0.75 * hash(i + 7), gold: hash(i + 31) < 0.3 });

	var clock = 0, lastBeat = -1, lastSong = -1, prevSong = 0, changed = -9, flash = 0;
	var now = { v: 0, f: 0, cam: 0, beats: 0, song: SONGS[0], gy: 0, hot: 0, pulse: 0 };

	function gyAt(sx) { return VH - rise(vAt(when(now.cam + sx - RX))); }

	function step(dt) {
		clock += dt;
		var tt = clock % T, f = tt / DT;
		now.f = f; now.v = vAt(f); now.cam = cum(X, f); now.beats = cum(B, f);
		now.song = SONGS[SI[Math.floor(f) % N]];
		now.hot = clamp((now.v - 0.6) / 0.35);
		now.pulse = Math.exp(-(now.beats % 1) * 5);
		now.gy = gyAt(RX);
		var sp = scroll(now.v);

		if (now.song.i !== lastSong) {
			if (lastSong >= 0) { prevSong = lastSong; changed = clock; if (now.song.hot) flash = 1; }
			lastSong = now.song.i;
		}
		flash *= Math.exp(-dt * 2.6);

		var beat = Math.floor(now.beats);
		if (beat !== lastBeat) {   // a foot lands
			lastBeat = beat;
			rings.push({ x: RX + 4, age: 0, gold: now.hot > 0.5 });
			for (var n = 4 + Math.round(8 * now.hot), j = 0; j < n; j++)
				sparks.push({ x: RX + 2, y: now.gy - 2, vx: -sp * (0.35 + 0.9 * Math.random()), vy: -(30 + 150 * Math.random()) * (0.6 + now.hot), age: 0, life: 0.35 + 0.4 * Math.random(), gold: now.hot > 0.4 });
		}
		if (now.hot > 0.5 && Math.random() < 0.6)   // and when it is fast, the runner sheds light
			sparks.push({ x: RX - 6, y: now.gy - 20 - 70 * Math.random(), vx: -sp * (0.7 + 0.5 * Math.random()), vy: -20 + 40 * Math.random(), age: 0, life: 0.5, gold: true, drift: true });

		for (j = sparks.length - 1; j >= 0; j--) {
			var p = sparks[j];
			p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; if (!p.drift) p.vy += 520 * dt;
			if (p.age > p.life || p.x < -40) sparks.splice(j, 1);
		}
		for (j = rings.length - 1; j >= 0; j--) { rings[j].age += dt; rings[j].x -= sp * dt; if (rings[j].age > 0.55) rings.splice(j, 1); }
		for (j = 0; j < streaks.length; j++) {
			var s = streaks[j];
			s.x -= sp * (0.5 + 1.9 * s.z) * dt;
			if (s.x < -160 || s.x > BW + 200) { s.x = BW + 160 * Math.random(); s.y = Math.random(); }
		}
	}

	function line(x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
	function rrect(x, y, w, h, r) {
		ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
		ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
	}

	// The runner, facing right, feet at (x, ground). ph is how far through a stride, 0 to 1, and starts as the near foot lands;
	// the far leg is half a stride behind. A stride is eight poses an eighth apart, with a smooth curve through them:
	// the thigh (degrees forward of straight down), the knee (how far it is bent), and the foot against the shin.
	var THIGH = [36, 4, -38, -44, -10, 44, 64, 54], KNEE = [8, 30, 8, 52, 112, 104, 52, 12], FOOT = [96, 118, 70, 78, 80, 80, 84, 90];
	function pose(arr, ph) {
		var x = (ph - Math.floor(ph)) * 8, i = Math.floor(x), t = x - i;
		var a = arr[(i + 7) % 8], b = arr[i % 8], c = arr[(i + 1) % 8], d = arr[(i + 2) % 8];
		return 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
	}
	function runner(x, ground, ph, lean, col, far, a, wide, reach, wear) {
		var D = Math.PI / 180, L1 = 26, L2 = 26;
		function leg(q) {
			var th = pose(THIGH, q) * reach * D, sh = th - pose(KNEE, q) * (0.55 + 0.45 * reach) * D, ft = sh + pose(FOOT, q) * D;
			var kx = L1 * Math.sin(th), ky = L1 * Math.cos(th), ax = kx + L2 * Math.sin(sh), ay = ky + L2 * Math.cos(sh);
			return [kx, ky, ax, ay, ax + 10 * Math.sin(ft), ay + 10 * Math.cos(ft)];
		}
		// an arm goes back as its own leg comes forward, elbow held bent, closing as the hand comes up
		function arm(q) {
			var f = -Math.cos(2 * Math.PI * (q - 0.7)), ua = (-10 + 46 * f * reach) * D, fa = ua + (90 + 16 * f) * D;
			var ex = 16 * Math.sin(ua), ey = 16 * Math.cos(ua);
			return [ex, ey, ex + 15 * Math.sin(fa), ey + 15 * Math.cos(fa)];
		}
		var near = leg(ph), back = leg(ph + 0.5);
		// the hips ride lowest over the planted foot and highest in the air between steps; no foot goes through the ground
		var up = 48.5 - (2.5 + 2 * reach) * Math.cos(4 * Math.PI * (ph - 0.1));
		up = Math.max(up, near[3], near[5] + 3, back[3], back[5] + 3);
		var hx = x, hy = ground - up;
		var nx = hx + 29 * Math.sin(lean), ny = hy - 29 * Math.cos(lean);
		var sx = nx - 2 * Math.sin(lean), sy = ny + 2 * Math.cos(lean);
		ctx.lineCap = "round"; ctx.lineJoin = "round";
		function limb(o, ox, oy, w, c) {
			ctx.strokeStyle = c; ctx.lineWidth = w * wide;
			ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + o[0], oy + o[1]); ctx.lineTo(ox + o[2], oy + o[3]);
			if (o.length > 4) ctx.lineTo(ox + o[4], oy + o[5]);
			ctx.stroke();
		}
		ctx.globalAlpha = a;
		limb(arm(ph + 0.5), sx, sy, 5.8, far);
		limb(back, hx, hy, 7.6, far);
		ctx.strokeStyle = col; ctx.lineWidth = 11 * wide; line(hx, hy, nx, ny);
		var cx = nx + 13 * Math.sin(lean + 0.18), cy = ny - 13 * Math.cos(lean + 0.18);
		ctx.fillStyle = col; ctx.beginPath(); ctx.arc(cx, cy, 7.8 * wide, 0, 7); ctx.fill();
		if (wear) {   // headphones, seen from the side: the band goes straight up from the ear and over the crown, the cup sits over the ear
			ctx.save(); ctx.translate(cx, cy); ctx.rotate(lean * 0.5);
			ctx.strokeStyle = PODS.band; ctx.lineWidth = 2.4; ctx.lineCap = "round";
			ctx.beginPath(); ctx.arc(0, 0, 8.4, Math.PI * 1.42, Math.PI * 1.56); ctx.stroke();
			ctx.lineWidth = 1.8; line(-0.6, -8.4, -0.6, -2.4);
			ctx.fillStyle = PODS.cup; rrect(-3.3, -2.9, 5.4, 7.8, 2.5); ctx.fill();
			ctx.restore();
		}
		limb(near, hx, hy, 7.6, col);
		limb(arm(ph), sx, sy, 5.8, col);
		ctx.globalAlpha = 1;
	}

	// Blurs what has been drawn so far inside a rounded box, by shrinking that patch to a few pixels and stretching it back.
	// (The canvas's own blur filter would do it in a line, but Safari does not have one.)
	var small = document.createElement("canvas"), tiny = document.createElement("canvas");
	function frost(x, y, w, h, r) {
		var sc = dpr * k, px = Math.round(x * sc), py = Math.round(y * sc), pw = Math.round(w * sc), ph = Math.round(h * sc);
		var sw = Math.max(1, pw >> 2), sh = Math.max(1, ph >> 2), tw = Math.max(2, pw >> 5), th = Math.max(2, ph >> 5);
		if (small.width !== sw || small.height !== sh) { small.width = sw; small.height = sh; }
		if (tiny.width !== tw || tiny.height !== th) { tiny.width = tw; tiny.height = th; }
		small.getContext("2d").drawImage(cv, px, py, pw, ph, 0, 0, sw, sh);
		tiny.getContext("2d").drawImage(small, 0, 0, tw, th);
		ctx.save(); rrect(x, y, w, h, r); ctx.clip();
		ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
		ctx.drawImage(tiny, x, y, w, h);
		ctx.restore();
	}

	function cover(song, x, y, s, a, live) {
		ctx.save(); ctx.translate(x, y); ctx.transform(1, 0, -LEAN * 0.5, 1, 0, 0); ctx.globalAlpha = a;
		ctx.fillStyle = "rgba(10,5,40,0.3)"; rrect(-s / 2 + 1, -s / 2 + 3, s, s, s * 0.22); ctx.fill();
		ctx.fillStyle = song.cover; rrect(-s / 2, -s / 2, s, s, s * 0.22); ctx.fill();
		if (song.img) { ctx.save(); ctx.clip(); ctx.drawImage(song.img, -s / 2, -s / 2, s, s); ctx.restore(); }
		if (live) {   // the one playing wears a ring: yellow, if it is the fast one
			ctx.strokeStyle = song.hot ? YELLOW : "rgba(255,255,255,0.9)"; ctx.lineWidth = 2.2;
			rrect(-s / 2, -s / 2, s, s, s * 0.22); ctx.stroke();
		}
		ctx.restore();
	}

	function draw() {
		now.gy = gyAt(RX);   // afresh, in case the page has changed size since the last step
		var v = now.v, hot = now.hot, pulse = now.pulse, song = now.song, gyR = now.gy, sp = scroll(v), j, sx, wx;
		ctx.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);

		// the air
		var g = ctx.createLinearGradient(0, 0, BW * 0.5, VH);
		g.addColorStop(0, "#6a4de6"); g.addColorStop(0.55, "#4330bd"); g.addColorStop(1, "#24146f");
		ctx.fillStyle = g; ctx.fillRect(0, 0, BW, VH);
		g = ctx.createRadialGradient(RX + 40, gyR - 60, 10, RX + 40, gyR - 60, 330);
		g.addColorStop(0, song.hot ? "rgba(255,210,74," + (0.2 + 0.14 * pulse) * (0.4 + hot) + ")" : "hsla(" + song.hue + ",90%,72%," + (0.16 + 0.1 * pulse) + ")");
		g.addColorStop(1, "rgba(0,0,0,0)");
		ctx.fillStyle = g; ctx.fillRect(0, 0, BW, VH);

		// the world: it closes in a little and shakes when the run is fast
		ctx.save();
		var z = 1 + 0.05 * ease(hot);
		ctx.translate(RX + hot * 1.3 * Math.sin(clock * 61), gyR + hot * 1.1 * Math.sin(clock * 47));
		ctx.scale(z, z); ctx.translate(-RX, -gyR);
		ctx.lineCap = "round";

		// far behind, the logo's bars, huge, drifting
		var off = now.cam * 0.3, k0 = Math.floor((off - 80) / SP2);
		for (j = k0; j * SP2 - off < BW + 120; j++) {
			var hb = hash(((j % NB2) + NB2) % NB2 + 500), len = 150 + 430 * hb, bx = j * SP2 - off, cy = VH - 60 - len / 2;
			ctx.strokeStyle = "rgba(255,255,255," + (0.035 + 0.045 * hb * pulse + 0.02 * hot) + ")"; ctx.lineWidth = 30;
			line(bx - LEAN * len / 2, cy + len / 2, bx + LEAN * len / 2, cy - len / 2);
		}

		// the air going by
		for (j = 0; j < streaks.length; j++) {
			var s = streaks[j], sl = (8 + 150 * v * v) * s.z, sy = VH - 40 - s.y * (TALL - 30);   // kept to the run, clear of the words
			ctx.strokeStyle = s.gold && hot > 0.3 ? "rgba(255,210,74," + (0.15 + 0.5 * s.z * hot) + ")" : "rgba(255,255,255," + (0.06 + 0.34 * s.z * (0.25 + v)) + ")";
			ctx.lineWidth = 0.8 + 1.4 * s.z;
			line(s.x, sy, s.x + sl, sy);
		}

		// where one song gives way to the next, a beam stands on the ground
		for (j = 0; j < SONGS.length; j++) {
			var gx = cum(X, SONGS[j].at / DT) - now.cam;
			gx = ((gx + LW / 2) % LW + LW) % LW - LW / 2 + RX;
			if (gx < -60 || gx > BW + 60) continue;
			var top = VH - TALL, bot = VH + 20;
			ctx.strokeStyle = SONGS[j].tint; ctx.globalAlpha = 0.1; ctx.lineWidth = 16; line(gx, bot, gx + LEAN * (bot - top), top);
			ctx.globalAlpha = 0.5; ctx.lineWidth = 1.6; line(gx, bot, gx + LEAN * (bot - top), top);
			ctx.globalAlpha = 1;
		}

		// the ground run so far, filled faintly under its line
		var pts = [];
		for (sx = -24; sx < RX; sx += 6) pts.push([sx, gyAt(sx), SI[Math.floor(when(now.cam + sx - RX)) % N]]);
		pts.push([RX, gyR, song.i]);
		g = ctx.createLinearGradient(0, VH - 220, 0, VH);
		g.addColorStop(0, "rgba(255,255,255,0.2)"); g.addColorStop(1, "rgba(255,255,255,0)");
		ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(pts[0][0], VH + 20);
		for (j = 0; j < pts.length; j++) ctx.lineTo(pts[j][0], pts[j][1]);
		ctx.lineTo(RX, VH + 20); ctx.fill();

		// and the ground still to come, fainter: the songs are queued, the pace is not run yet
		var ahead = [];
		for (sx = RX; sx < BW + 30; sx += 8) ahead.push([sx, gyAt(sx)]);
		g = ctx.createLinearGradient(0, VH - 220, 0, VH);
		g.addColorStop(0, "rgba(255,255,255,0.07)"); g.addColorStop(1, "rgba(255,255,255,0)");
		ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(RX, VH + 20);
		for (j = 0; j < ahead.length; j++) ctx.lineTo(ahead[j][0], ahead[j][1]);
		ctx.lineTo(BW + 30, VH + 20); ctx.fill();
		ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.lineWidth = 2; ctx.setLineDash([2, 9]); ctx.lineDashOffset = now.cam;
		ctx.beginPath(); for (j = 0; j < ahead.length; j++) ctx.lineTo(ahead[j][0], ahead[j][1]); ctx.stroke();
		ctx.setLineDash([]);

		// the music: a bar every few steps, in its song's color, lit once the runner has been over it
		k0 = Math.floor((now.cam - RX - 60) / SP);
		for (j = k0; ; j++) {
			sx = j * SP - now.cam + RX;
			if (sx > BW + 30) break;
			var f = when(j * SP), bs = SONGS[SI[Math.floor(f) % N]], id = ((j % NB) + NB) % NB;
			var lit = clamp((RX + 8 - sx) / 22), near = sx < RX + 8 ? Math.exp(-(RX - sx) / 90) : 0;
			var amp = 0.5 * hash(id) + 0.5 * (0.5 + 0.5 * Math.sin(now.beats * Math.PI + id * 1.9));
			var full = rise(vAt(f)) - 12;
			var h = full * (0.5 + 0.48 * amp + 0.08 * pulse * near) * (0.78 + 0.22 * lit);
			ctx.strokeStyle = bs.tint; ctx.lineWidth = 7;
			ctx.globalAlpha = (0.24 + 0.53 * lit + 0.23 * near) * (0.4 + 0.6 * clamp((sx + 30) / 200));
			line(sx - LEAN * 14, VH + 14, sx + LEAN * h, VH - h);
		}
		ctx.globalAlpha = 1;

		// the pace: the line the runner leaves, yellow where the fast song played
		ctx.lineJoin = "round";
		for (var pass = 0; pass < 2; pass++) for (j = 0; j < pts.length - 1;) {
			var c = pts[j][2], e = j;
			ctx.beginPath(); ctx.moveTo(pts[j][0], pts[j][1]);
			while (e < pts.length - 1 && pts[e][2] === c) { e++; ctx.lineTo(pts[e][0], pts[e][1]); }
			ctx.strokeStyle = SONGS[c].hot ? YELLOW : WHITE;
			ctx.globalAlpha = pass ? 1 : 0.2; ctx.lineWidth = pass ? 3.4 : 12; ctx.stroke();
			j = e;
		}
		ctx.globalAlpha = 1;

		// where feet landed
		for (j = 0; j < rings.length; j++) {
			var r = rings[j], q = r.age / 0.55, ry = gyAt(r.x);
			ctx.strokeStyle = r.gold ? YELLOW : WHITE; ctx.globalAlpha = 0.7 * (1 - q); ctx.lineWidth = 2.2;
			ctx.beginPath(); ctx.ellipse(r.x, ry, 6 + 34 * q, 2 + 9 * q, 0, 0, 7); ctx.stroke();
		}
		ctx.globalAlpha = 1;

		// the runner, and where they just were
		var ph = now.beats / 2, lean = 0.2 + 0.16 * v, reach = 0.8 + 0.2 * v;
		for (j = 6; j >= 1; j--) {
			var gxj = RX - j * (6 + 17 * v);
			runner(gxj, gyAt(gxj), ph - j * 0.045, lean, song.tint, song.tint, (0.05 + 0.26 * v) * (1 - j / 7), 0.92, reach);
		}
		runner(RX, gyR, ph, lean, WHITE, song.hot && hot > 0.3 ? "#ffe9a6" : "#cdc5ff", 1, 1, reach, true);

		for (j = 0; j < sparks.length; j++) {
			var sk = sparks[j];
			ctx.strokeStyle = sk.gold ? YELLOW : WHITE; ctx.globalAlpha = 0.9 * (1 - sk.age / sk.life); ctx.lineWidth = sk.drift ? 1.6 : 2;
			line(sk.x, sk.y, sk.x - sk.vx * 0.03, sk.y - sk.vy * 0.03);
		}
		ctx.globalAlpha = 1;
		ctx.restore();

		// the fast song arriving
		if (flash > 0.01) {
			g = ctx.createRadialGradient(RX, gyR - 50, 0, RX, gyR - 50, 520);
			g.addColorStop(0, "rgba(255,225,130," + 0.55 * flash + ")"); g.addColorStop(1, "rgba(255,210,74,0)");
			ctx.fillStyle = g; ctx.fillRect(0, 0, BW, VH);
		}
		g = ctx.createLinearGradient(0, VH - 70, 0, VH);
		g.addColorStop(0, "rgba(26,14,84,0)"); g.addColorStop(1, "rgba(26,14,84,0.75)");
		ctx.fillStyle = g; ctx.fillRect(0, VH - 70, BW, 70);

		// at the foot, under the runner: a dock with what is playing, and what is next queued beside it
		var slide = 1 - ease((clock - changed) / 0.5), n = SONGS.length, dy = VH - 62 - lift;
		frost(RX - 106, dy - 36, 212, 80, 22);   // frosted glass: what is behind the dock, blurred, under a dark tint
		ctx.fillStyle = "rgba(18,9,66,0.38)"; rrect(RX - 106, dy - 36, 212, 80, 22); ctx.fill();
		ctx.strokeStyle = "rgba(255,255,255,0.16)"; ctx.lineWidth = 1; ctx.stroke();
		function slot(i) { return i < 0 ? [RX - 118, dy - 4, 26] : i === 0 ? [RX - 68, dy - 4, 48] : [RX - 68 + 22 + i * 40, dy - 4, 28]; }
		for (j = 3; j >= -1; j--) {
			var a0 = slot(j), a1 = slot(j + 1), qs = SONGS[((song.i + j) % n + n) % n];
			if (j === -1 && slide < 0.01) continue;
			var al = j === -1 ? slide * slide : j === 0 ? 1 : (j === 3 ? 0.6 * (1 - slide) : 0.6);
			cover(qs, a0[0] + (a1[0] - a0[0]) * slide, a0[1], a0[2] + (a1[2] - a0[2]) * slide, al, j === 0);
		}
		var done = ((clock % T) - song.at) / song.dur;   // how far through the song
		ctx.lineCap = "round"; ctx.lineWidth = 3;
		ctx.strokeStyle = "rgba(255,255,255,0.22)"; line(RX - 90, dy + 32, RX + 90, dy + 32);
		ctx.strokeStyle = song.hot ? YELLOW : WHITE; line(RX - 90, dy + 32, RX - 90 + 180 * clamp(done), dy + 32);

		// over the runner's head, the pace: minutes a kilometre, or a mile. Through the fast song it says so, in yellow.
		var miles = opts.units() === "mi", fast = song.hot && hot > 0.5;
		var secs = Math.round((372 - 100 * v) * (miles ? 1.609344 : 1));
		var txt = (fast ? "Fastest · " : "") + Math.floor(secs / 60) + ":" + ("0" + secs % 60).slice(-2) + (miles ? " /mi" : " /km");
		ctx.font = "600 13px system-ui, -apple-system, 'Segoe UI', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
		var tw = ctx.measureText(txt).width + 24, ty = gyR - 132;
		ctx.fillStyle = fast ? YELLOW : "rgba(255,255,255,0.16)"; rrect(RX + 10 - tw / 2, ty - 13, tw, 26, 13); ctx.fill();
		ctx.fillStyle = fast ? "#2a1a6e" : WHITE; ctx.fillText(txt, RX + 10, ty + 0.5);
	}

	// running it: only while it is on screen, and held still for anyone who asks for less motion
	var freeze = parseFloat((location.search.match(/freeze=([\d.]+)/) || [])[1]);
	var still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	if (still && isNaN(freeze)) freeze = SONGS[3].at + 2.6;
	// It starts once the page has it, and stops for good when the page lets it go.
	var seen = true, last = 0, raf = 0, begun = false;
	function begin() {
		if (!host.isConnected) return void requestAnimationFrame(begin);
		size();
		if (window.ResizeObserver) new ResizeObserver(function () { size(); if (frozen) draw(); }).observe(host);
		if (!isNaN(freeze)) {
			frozen = true;
			clock = Math.max(0, freeze - 1.5);
			for (var n = 0; n < 90; n++) step(1 / 60);
			return draw();
		}
		begun = true;
		document.addEventListener("visibilitychange", go);
		if (window.IntersectionObserver) new IntersectionObserver(function (es) { seen = es[0].isIntersecting; go(); }).observe(host);
		go();
	}
	function frame(t) {
		raf = 0;
		if (!cv.isConnected) return document.removeEventListener("visibilitychange", go);
		var dt = last ? Math.min(0.05, (t - last) / 1000) : 1 / 60;
		last = t;
		step(dt); draw();
		go();
	}
	function go() { if (!begun) return; if (!raf && seen && !document.hidden) raf = requestAnimationFrame(frame); else if (!seen || document.hidden) last = 0; }
	requestAnimationFrame(begin);
}
