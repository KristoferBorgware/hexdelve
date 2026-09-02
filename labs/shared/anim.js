/*
 * labs/shared/anim.js — a small keyframe animation system.
 *
 * Deliberately engine-free: there is no reference to THREE, to any renderer or
 * to any scene graph in this file. It deals in plain data only, so the same
 * clips and the same player would drive a canvas2d stick figure, a WebGPU
 * renderer, or a server-side simulation.
 *
 *   pose      { boneName: { rot:[x,y,z], pos:[x,y,z] } }
 *             Every value is a DELTA from the skeleton's rest transform, so
 *             the rest pose is the empty object and fading a clip out relaxes
 *             back to rest.
 *
 *   clip      { name, duration, loop, tracks, events }
 *             tracks[bone].rot / .pos are key lists; events fire once per pass.
 *
 *   Player    layers of clips with crossfades and per-bone masks; produces one
 *             dense pose per frame (flat Float32Arrays, no allocation).
 *
 * Conventions
 *   - Time is seconds. Angles are radians, Euler XYZ.
 *   - For a looping clip the pose at t = duration IS the pose at t = 0; do not
 *     author a closing key, the wrap segment interpolates back to the first.
 *
 * Loaded as a plain script, not an ES module, so that a lab can be opened by
 * double-clicking its index.html: browsers refuse module imports over file://
 * because every file: URL is its own opaque origin.
 */

var Hexdelve = Hexdelve || {};

Hexdelve.anim = (function () {
'use strict';

const DEG = Math.PI / 180;

/* -------------------------------------------------------------- authoring -- */

// Keys are authored compactly as [t, x, y, z, ease?].
// ease: 'auto' (Catmull-Rom-ish, the default), 'linear', 'step', or 'flat'
// ('flat' zeroes the tangents at that key — use it for holds and hard stops).
function normKeys(raw) {
	return raw
		.map((k) => ({ t: k[0], v: [k[1], k[2], k[3]], e: k[4] || 'auto' }))
		.sort((a, b) => a.t - b.t);
}

function buildClip(spec) {
	const { name, duration, loop = 'loop', events = [] } = spec;
	const looping = loop === 'loop';
	const tracks = {};
	for (const boneName in spec.tracks) {
		const src = spec.tracks[boneName];
		const track = {};
		for (const ch of ['rot', 'pos']) {
			if (!src[ch]) continue;
			let keys = normKeys(src[ch]);
			// A looping clip closes onto its own first key.
			if (looping) keys = keys.filter((k) => k.t < duration - 1e-6);
			if (keys.length) track[ch] = keys;
		}
		if (track.rot || track.pos) tracks[boneName] = track;
	}
	return {
		name,
		duration,
		loop,
		tracks,
		events: events.map((e) => ({ t: e.t, name: e.name })).sort((a, b) => a.t - b.t),
	};
}

// Pose-major authoring: a list of { t, p: { bone: [x,y,z] | {rot,pos}, ... } }.
// A bone left out of a pose simply gets no key there, so it interpolates
// straight through — which is how animators actually work.
function poseClip(name, duration, loop, poses, events = []) {
	const tracks = {};
	for (const pose of poses) {
		for (const boneName in pose.p) {
			const entry = pose.p[boneName];
			const isArray = Array.isArray(entry);
			const rot = isArray ? entry : entry.rot;
			const pos = isArray ? null : entry.pos;
			const ease = (isArray ? pose.e : entry.e || pose.e) || undefined;
			if (!tracks[boneName]) tracks[boneName] = {};
			const track = tracks[boneName];
			if (rot) {
				if (!track.rot) track.rot = [];
				track.rot.push([pose.t, rot[0], rot[1], rot[2], ease]);
			}
			if (pos) {
				if (!track.pos) track.pos = [];
				track.pos.push([pose.t, pos[0], pos[1], pos[2], ease]);
			}
		}
	}
	return buildClip({ name, duration, loop, tracks, events });
}

// Left/right mirror of a single authored pose. Used to write half a symmetric
// cycle (a walk, a run) and generate the other half.
function mirrorPose(p) {
	const out = {};
	for (const boneName in p) {
		const entry = p[boneName];
		const isArray = Array.isArray(entry);
		const rot = isArray ? entry : entry.rot;
		const pos = isArray ? null : entry.pos;
		let name = boneName;
		if (boneName.endsWith('L')) name = boneName.slice(0, -1) + 'R';
		else if (boneName.endsWith('R')) name = boneName.slice(0, -1) + 'L';
		const m = {};
		if (rot) m.rot = [rot[0], -rot[1], -rot[2]];
		if (pos) m.pos = [-pos[0], pos[1], pos[2]];
		out[name] = isArray ? m.rot : m;
	}
	return out;
}

/* --------------------------------------------------------------- sampling -- */

function hermite(v0, v1, m0, m1, h, u) {
	const u2 = u * u;
	const u3 = u2 * u;
	return (
		(2 * u3 - 3 * u2 + 1) * v0 +
		(u3 - 2 * u2 + u) * h * m0 +
		(-2 * u3 + 3 * u2) * v1 +
		(u3 - u2) * h * m1
	);
}

// Which segment does t fall in? Handles the wrap segment of a looping clip,
// where the last key interpolates back around to the first.
function locate(keys, t, duration, looping) {
	const n = keys.length;
	const firstT = keys[0].t;
	const lastT = keys[n - 1].t;
	if (looping) {
		const h = firstT + duration - lastT;
		if (t >= lastT) return { a: n - 1, b: 0, u: h > 1e-9 ? (t - lastT) / h : 0, h };
		if (t < firstT) return { a: n - 1, b: 0, u: h > 1e-9 ? (t + duration - lastT) / h : 0, h };
	} else {
		if (t <= firstT) return { a: 0, b: 0, u: 0, h: 0 };
		if (t >= lastT) return { a: n - 1, b: n - 1, u: 0, h: 0 };
	}
	let lo = 0;
	let hi = n - 1;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (keys[mid].t <= t) lo = mid;
		else hi = mid;
	}
	const h = keys[hi].t - keys[lo].t;
	return { a: lo, b: hi, u: h > 1e-9 ? (t - keys[lo].t) / h : 0, h };
}

// Finite-difference tangent (units per second), time-aware so that unevenly
// spaced keys — which is the whole point of keyframing — stay smooth.
function tangent(keys, i, c, duration, looping) {
	const n = keys.length;
	let pt;
	let pv;
	let nt;
	let nv;
	if (i === 0) {
		const k = looping ? keys[n - 1] : keys[0];
		pt = looping ? k.t - duration : k.t;
		pv = k.v[c];
	} else {
		pt = keys[i - 1].t;
		pv = keys[i - 1].v[c];
	}
	if (i === n - 1) {
		const k = looping ? keys[0] : keys[n - 1];
		nt = looping ? k.t + duration : k.t;
		nv = k.v[c];
	} else {
		nt = keys[i + 1].t;
		nv = keys[i + 1].v[c];
	}
	const dt = nt - pt;
	return dt > 1e-6 ? (nv - pv) / dt : 0;
}

function evalTrack(keys, t, duration, looping, out, off) {
	const n = keys.length;
	if (n === 1) {
		out[off] = keys[0].v[0];
		out[off + 1] = keys[0].v[1];
		out[off + 2] = keys[0].v[2];
		return;
	}
	const seg = locate(keys, t, duration, looping);
	const a = keys[seg.a];
	const b = keys[seg.b];
	for (let c = 0; c < 3; c++) {
		let v;
		if (seg.h <= 1e-9 || a.e === 'step') {
			v = a.v[c];
		} else if (a.e === 'linear') {
			v = a.v[c] + (b.v[c] - a.v[c]) * seg.u;
		} else {
			const m0 = a.e === 'flat' ? 0 : tangent(keys, seg.a, c, duration, looping);
			const m1 = b.e === 'flat' ? 0 : tangent(keys, seg.b, c, duration, looping);
			v = hermite(a.v[c], b.v[c], m0, m1, seg.h, seg.u);
		}
		out[off + c] = v;
	}
}

// Sparse sample — allocates, so it is for tools (baking, measuring), not for
// the per-frame path.
function samplePose(clip, t) {
	const looping = clip.loop === 'loop';
	const out = {};
	for (const boneName in clip.tracks) {
		const track = clip.tracks[boneName];
		const entry = {};
		if (track.rot) {
			const v = [0, 0, 0];
			evalTrack(track.rot, t, clip.duration, looping, v, 0);
			entry.rot = v;
		}
		if (track.pos) {
			const v = [0, 0, 0];
			evalTrack(track.pos, t, clip.duration, looping, v, 0);
			entry.pos = v;
		}
		out[boneName] = entry;
	}
	return out;
}

/* ------------------------------------------------------------ dense poses -- */

function createPose(boneCount) {
	return { rot: new Float32Array(boneCount * 3), pos: new Float32Array(boneCount * 3) };
}

function copyPose(dst, src) {
	dst.rot.set(src.rot);
	dst.pos.set(src.pos);
}

function clearPose(pose) {
	pose.rot.fill(0);
	pose.pos.fill(0);
}

function lerpPose(dst, a, b, w) {
	for (let i = 0; i < dst.rot.length; i++) {
		dst.rot[i] = a.rot[i] + (b.rot[i] - a.rot[i]) * w;
		dst.pos[i] = a.pos[i] + (b.pos[i] - a.pos[i]) * w;
	}
}

// Same, but each bone's blend weight is scaled by a mask — this is what lets a
// clip play on the upper body only while another drives the legs.
function lerpPoseMasked(dst, a, b, w, mask) {
	for (let bone = 0; bone < mask.length; bone++) {
		const bw = w * mask[bone];
		const o = bone * 3;
		for (let c = 0; c < 3; c++) {
			dst.rot[o + c] = a.rot[o + c] + (b.rot[o + c] - a.rot[o + c]) * bw;
			dst.pos[o + c] = a.pos[o + c] + (b.pos[o + c] - a.pos[o + c]) * bw;
		}
	}
}

// Dense (flat arrays, what the player and blend tree produce) → sparse (what
// solveWorld and the IK solver read). Reuse `out` to keep it allocation-free.
function denseToSparse(boneNames, dense, out = {}) {
	for (let i = 0; i < boneNames.length; i++) {
		const name = boneNames[i];
		let entry = out[name];
		if (!entry) {
			entry = { rot: [0, 0, 0], pos: [0, 0, 0] };
			out[name] = entry;
		}
		const o = i * 3;
		entry.rot[0] = dense.rot[o];
		entry.rot[1] = dense.rot[o + 1];
		entry.rot[2] = dense.rot[o + 2];
		entry.pos[0] = dense.pos[o];
		entry.pos[1] = dense.pos[o + 1];
		entry.pos[2] = dense.pos[o + 2];
	}
	return out;
}

// ... and back, for a pose that was produced as a function rather than sampled
// from a clip (walk.js, stride.js): the blender and the masks work in the flat
// buffers, so a pose function's output has to be poured into one to be layered
// under a clip. Bones the function did not touch are left at rest.
function sparseToDense(boneNames, sparse, out) {
	out.rot.fill(0);
	out.pos.fill(0);
	for (let i = 0; i < boneNames.length; i++) {
		const entry = sparse[boneNames[i]];
		if (!entry) continue;
		const o = i * 3;
		if (entry.rot) {
			out.rot[o] = entry.rot[0];
			out.rot[o + 1] = entry.rot[1];
			out.rot[o + 2] = entry.rot[2];
		}
		if (entry.pos) {
			out.pos[o] = entry.pos[0];
			out.pos[o + 1] = entry.pos[1];
			out.pos[o + 2] = entry.pos[2];
		}
	}
	return out;
}

function makeMask(boneNames, weights, fallback = 0) {
	const mask = new Float32Array(boneNames.length);
	for (let i = 0; i < boneNames.length; i++) {
		const w = weights[boneNames[i]];
		mask[i] = w === undefined ? fallback : w;
	}
	return mask;
}

function bindClip(clip, index) {
	const bound = [];
	for (const boneName in clip.tracks) {
		const i = index.get(boneName);
		if (i === undefined) continue;
		bound.push({ i, rot: clip.tracks[boneName].rot || null, pos: clip.tracks[boneName].pos || null });
	}
	return bound;
}

function sampleInto(entry, t, pose) {
	clearPose(pose);
	const looping = entry.clip.loop === 'loop';
	for (const track of entry.bound) {
		if (track.rot) evalTrack(track.rot, t, entry.clip.duration, looping, pose.rot, track.i * 3);
		if (track.pos) evalTrack(track.pos, t, entry.clip.duration, looping, pose.pos, track.i * 3);
	}
}

const smoothstep = (u) => u * u * (3 - 2 * u);

/* ----------------------------------------------------------------- player -- */

class Layer {
	constructor(player, mask) {
		this.player = player;
		this.mask = mask || null;
		this.weight = 1;
		this.paused = false;
		this.cur = null;
		this.prev = null;
		this.fade = 1;
		this.fadeDur = 0;
		const n = player.bones.length;
		this.a = createPose(n);
		this.b = createPose(n);
		this.out = createPose(n);
	}

	play(name, { fade = 0.22, speed = 1, restart = false, time = 0 } = {}) {
		const entry = this.player.clips.get(name);
		if (!entry) throw new Error(`anim: no clip named "${name}"`);
		if (this.cur && this.cur.entry === entry && !restart) {
			this.cur.speed = speed;
			return this;
		}
		this.prev = this.cur && this.fade >= 1 ? this.cur : this.prev;
		this.cur = { entry, time, speed, finished: false };
		this.fadeDur = this.prev ? fade : 0;
		this.fade = this.fadeDur > 0 ? 0 : 1;
		return this;
	}

	get clip() {
		return this.cur ? this.cur.entry.clip : null;
	}

	get time() {
		return this.cur ? this.cur.time : 0;
	}

	set time(t) {
		if (this.cur) this.cur.time = t;
	}

	get finished() {
		return this.cur ? this.cur.finished : false;
	}

	advance(state, dt, emit) {
		const clip = state.entry.clip;
		const d = clip.duration;
		const step = dt * state.speed;
		const t0 = state.time;
		let t1 = t0 + step;
		if (clip.loop === 'loop') {
			if (emit) this.emitEvents(clip, t0, t1, d, state);
			if (d > 0) {
				t1 %= d;
				if (t1 < 0) t1 += d;
			}
		} else {
			if (t1 >= d) {
				t1 = d;
				state.finished = true;
			}
			if (emit) this.emitEvents(clip, t0, t1, 0, state);
		}
		state.time = t1;
	}

	emitEvents(clip, t0, t1, duration, state) {
		const fn = this.player.onEvent;
		if (!fn || !clip.events.length) return;
		for (const e of clip.events) {
			if (duration > 0) {
				let et = e.t;
				while (et <= t0) et += duration;
				while (et <= t1) {
					fn(e.name, clip, this, state);
					et += duration;
				}
			} else if (e.t > t0 && e.t <= t1) {
				fn(e.name, clip, this, state);
			}
		}
	}

	update(dt) {
		if (!this.cur) return null;
		const step = this.paused ? 0 : dt;
		this.advance(this.cur, step, true);
		sampleInto(this.cur.entry, this.cur.time, this.b);
		if (this.prev && this.fade < 1) {
			this.advance(this.prev, step, false);
			this.fade = this.fadeDur > 0 ? Math.min(1, this.fade + dt / this.fadeDur) : 1;
			sampleInto(this.prev.entry, this.prev.time, this.a);
			lerpPose(this.out, this.a, this.b, smoothstep(this.fade));
		} else {
			this.prev = null;
			this.fade = 1;
			copyPose(this.out, this.b);
		}
		return this.out;
	}
}

class Player {
	constructor(boneNames) {
		this.bones = boneNames.slice();
		this.index = new Map(this.bones.map((n, i) => [n, i]));
		this.clips = new Map();
		this.layers = [];
		this.pose = createPose(this.bones.length);
		this.onEvent = null;
	}

	add(clip) {
		this.clips.set(clip.name, { clip, bound: bindClip(clip, this.index) });
		return this;
	}

	has(name) {
		return this.clips.has(name);
	}

	get(name) {
		const entry = this.clips.get(name);
		return entry ? entry.clip : null;
	}

	layer(mask = null) {
		const l = new Layer(this, mask);
		this.layers.push(l);
		return l;
	}

	update(dt) {
		let base = true;
		for (const layer of this.layers) {
			const p = layer.update(dt);
			if (!p || layer.weight <= 0) continue;
			if (base) {
				copyPose(this.pose, p);
				base = false;
			} else if (layer.mask) {
				lerpPoseMasked(this.pose, this.pose, p, layer.weight, layer.mask);
			} else {
				lerpPose(this.pose, this.pose, p, layer.weight);
			}
		}
		if (base) clearPose(this.pose);
		return this.pose;
	}
}

/* ------------------------------------------------------------------ bake -- */

// Fit the fewest keys that reproduce a sampled curve within `tol`, using the
// same interpolation the player will use at runtime. Greedy worst-point
// insertion: the classic curve-fit, and the reason a baked clip is a handful
// of keys rather than one key per frame.
function fitKeys(seq, duration, looping, tol) {
	const n = seq.length;
	const keep = looping ? [0, Math.floor(n / 2)] : [0, n - 1];
	const kept = new Uint8Array(n);
	kept[keep[0]] = 1;
	kept[keep[1]] = 1;
	const probe = [0, 0, 0];
	let worstErr = 0;
	for (let guard = 0; guard < 256; guard++) {
		const keys = keep.map((i) => ({ t: seq[i].t, v: seq[i].v, e: 'auto' }));
		let worst = -1;
		worstErr = 0;
		for (let i = 0; i < n; i++) {
			if (kept[i]) continue;
			evalTrack(keys, seq[i].t, duration, looping, probe, 0);
			const err = Math.max(
				Math.abs(probe[0] - seq[i].v[0]),
				Math.abs(probe[1] - seq[i].v[1]),
				Math.abs(probe[2] - seq[i].v[2]),
			);
			if (err > worstErr) {
				worstErr = err;
				worst = i;
			}
		}
		if (worstErr <= tol || worst < 0) break;
		kept[worst] = 1;
		keep.push(worst);
		keep.sort((a, b) => a - b);
	}
	return { keys: keep.map((i) => [seq[i].t, seq[i].v[0], seq[i].v[1], seq[i].v[2]]), error: worstErr };
}

const NEAR_ZERO = 1e-4;

// Turn a pose function into a clip. This is how the walk in lab 02 becomes
// keyframe data without anyone posing it by hand.
function bakeClip({
	name,
	duration,
	loop = 'loop',
	sample,
	samples = 180,
	tolerance = 0.5 * DEG,
	events = [],
}) {
	const looping = loop === 'loop';
	const raw = [];
	for (let i = 0; i < samples; i++) raw.push({ t: (i / samples) * duration, pose: sample((i / samples) * duration) });
	if (!looping) raw.push({ t: duration, pose: sample(duration) });

	const channels = new Map(); // bone -> Set of channels
	for (const frame of raw) {
		for (const boneName in frame.pose) {
			const entry = frame.pose[boneName];
			const set = channels.get(boneName) || new Set();
			if (entry.rot) set.add('rot');
			if (entry.pos) set.add('pos');
			channels.set(boneName, set);
		}
	}

	const tracks = {};
	let keyCount = 0;
	let maxError = 0;
	for (const [boneName, set] of channels) {
		for (const ch of set) {
			const seq = raw.map((frame) => ({
				t: frame.t,
				v: (frame.pose[boneName] && frame.pose[boneName][ch]) || [0, 0, 0],
			}));
			const moves = seq.some((s) => Math.abs(s.v[0]) > NEAR_ZERO || Math.abs(s.v[1]) > NEAR_ZERO || Math.abs(s.v[2]) > NEAR_ZERO);
			if (!moves) continue;
			const fit = fitKeys(seq, duration, looping, tolerance);
			if (!tracks[boneName]) tracks[boneName] = {};
			tracks[boneName][ch] = fit.keys;
			keyCount += fit.keys.length;
			maxError = Math.max(maxError, fit.error);
		}
	}

	return {
		clip: buildClip({ name, duration, loop, tracks, events }),
		stats: { samples: raw.length, keys: keyCount, maxError },
	};
}

/* ----------------------------------------------- forward kinematics (tiny) -- */

function quatFromEulerXYZ(x, y, z) {
	const c1 = Math.cos(x / 2);
	const c2 = Math.cos(y / 2);
	const c3 = Math.cos(z / 2);
	const s1 = Math.sin(x / 2);
	const s2 = Math.sin(y / 2);
	const s3 = Math.sin(z / 2);
	return [
		s1 * c2 * c3 + c1 * s2 * s3,
		c1 * s2 * c3 - s1 * c2 * s3,
		c1 * c2 * s3 + s1 * s2 * c3,
		c1 * c2 * c3 - s1 * s2 * s3,
	];
}

function quatMul(a, b) {
	return [
		a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
		a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
		a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
		a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
	];
}

function quatConjugate(q) {
	return [-q[0], -q[1], -q[2], q[3]];
}

// Shortest arc taking unit vector `from` onto unit vector `to`.
function quatFromUnitVectors(from, to) {
	let r = from[0] * to[0] + from[1] * to[1] + from[2] * to[2] + 1;
	let x;
	let y;
	let z;
	if (r < 1e-6) {
		// Opposed: any perpendicular axis will do.
		r = 0;
		if (Math.abs(from[0]) > Math.abs(from[2])) {
			x = -from[1];
			y = from[0];
			z = 0;
		} else {
			x = 0;
			y = -from[2];
			z = from[1];
		}
	} else {
		x = from[1] * to[2] - from[2] * to[1];
		y = from[2] * to[0] - from[0] * to[2];
		z = from[0] * to[1] - from[1] * to[0];
	}
	const len = Math.sqrt(x * x + y * y + z * z + r * r) || 1;
	return [x / len, y / len, z / len, r / len];
}

function quatSlerp(a, b, t) {
	let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
	let bb = b;
	if (cos < 0) {
		bb = [-b[0], -b[1], -b[2], -b[3]];
		cos = -cos;
	}
	if (cos > 0.9995) {
		const out = [
			a[0] + (bb[0] - a[0]) * t,
			a[1] + (bb[1] - a[1]) * t,
			a[2] + (bb[2] - a[2]) * t,
			a[3] + (bb[3] - a[3]) * t,
		];
		const len = Math.hypot(out[0], out[1], out[2], out[3]) || 1;
		return [out[0] / len, out[1] / len, out[2] / len, out[3] / len];
	}
	const theta = Math.acos(cos);
	const sin = Math.sin(theta);
	const wa = Math.sin((1 - t) * theta) / sin;
	const wb = Math.sin(t * theta) / sin;
	return [a[0] * wa + bb[0] * wb, a[1] * wa + bb[1] * wb, a[2] * wa + bb[2] * wb, a[3] * wa + bb[3] * wb];
}

// Back to Euler XYZ, the order the poses are written in.
function eulerFromQuatXYZ(q) {
	const [x, y, z, w] = q;
	const x2 = x + x;
	const y2 = y + y;
	const z2 = z + z;
	const xx = x * x2;
	const xy = x * y2;
	const xz = x * z2;
	const yy = y * y2;
	const yz = y * z2;
	const zz = z * z2;
	const wx = w * x2;
	const wy = w * y2;
	const wz = w * z2;
	const m11 = 1 - (yy + zz);
	const m12 = xy - wz;
	const m13 = xz + wy;
	const m22 = 1 - (xx + zz);
	const m23 = yz - wx;
	const m32 = yz + wx;
	const m33 = 1 - (xx + yy);
	const ey = Math.asin(Math.max(-1, Math.min(1, m13)));
	if (Math.abs(m13) < 0.9999999) {
		return [Math.atan2(-m23, m33), ey, Math.atan2(-m12, m11)];
	}
	return [Math.atan2(m32, m22), ey, 0];
}

function quatRotate(q, v) {
	const [x, y, z, w] = q;
	const ix = w * v[0] + y * v[2] - z * v[1];
	const iy = w * v[1] + z * v[0] - x * v[2];
	const iz = w * v[2] + x * v[1] - y * v[0];
	const iw = -x * v[0] - y * v[1] - z * v[2];
	return [
		ix * w + iw * -x + iy * -z - iz * -y,
		iy * w + iw * -y + iz * -x - ix * -z,
		iz * w + iw * -z + ix * -y - iy * -x,
	];
}

// World transform per bone, in the actor's local space. Parents must precede
// their children in `skeleton`.
function solveWorld(skeleton, pose, out = {}) {
	for (const bone of skeleton) {
		const p = pose[bone.name];
		const r = (p && p.rot) || null;
		const d = (p && p.pos) || null;
		const lq = r ? quatFromEulerXYZ(r[0], r[1], r[2]) : [0, 0, 0, 1];
		const lp = [
			bone.offset[0] + (d ? d[0] : 0),
			bone.offset[1] + (d ? d[1] : 0),
			bone.offset[2] + (d ? d[2] : 0),
		];
		if (bone.parent) {
			const par = out[bone.parent];
			const rp = quatRotate(par.q, lp);
			out[bone.name] = { q: quatMul(par.q, lq), p: [par.p[0] + rp[0], par.p[1] + rp[1], par.p[2] + rp[2]] };
		} else {
			out[bone.name] = { q: lq, p: lp };
		}
	}
	return out;
}

// How fast the ground must move under a locomotion cycle for the feet not to
// slide: while a foot is planted it must travel backwards through the body's
// space at exactly the speed the body travels forwards.
//
// Only contact counts. A walk has a foot down at all times, but a run has a
// flight phase where the lower foot is still swinging forwards — counting that
// would cancel out most of the stride and report a run as slower than a walk.
// So the threshold adapts: measure the lower foot's height over the cycle and
// treat only the bottom of that range as contact.
function measureGroundSpeed(skeleton, sample, duration, feet = ['footL', 'footR'], samples = 96) {
	const dt = duration / samples;
	const frames = [];
	for (let i = 0; i <= samples; i++) {
		const t = (i * dt) % duration;
		const world = solveWorld(skeleton, sample(t));
		frames.push({
			heights: feet.map((f) => world[f].p[1]),
			depths: feet.map((f) => world[f].p[2]),
		});
	}

	// Each foot is judged on its own contact interval. Picking "whichever foot
	// is lower" instead splits one contact across two feet at the hand-over and
	// mixes a planted foot's travel with a swinging one's.
	let total = 0;
	let weight = 0;
	for (let f = 0; f < feet.length; f++) {
		let lowest = Infinity;
		let highest = -Infinity;
		for (const frame of frames) {
			lowest = Math.min(lowest, frame.heights[f]);
			highest = Math.max(highest, frame.heights[f]);
		}
		const threshold = lowest + Math.max(0.015, 0.2 * (highest - lowest));
		let distance = 0;
		let contact = 0;
		for (let i = 0; i < samples; i++) {
			const a = frames[i];
			const b = frames[i + 1];
			if (a.heights[f] > threshold || b.heights[f] > threshold) continue;
			distance += a.depths[f] - b.depths[f];
			contact += dt;
		}
		if (contact > 1e-4) {
			total += (distance / contact) * contact;
			weight += contact;
		}
	}
	return weight > 1e-4 ? total / weight : 0;
}

/* ------------------------------------------------------------------ public -- */

return {
	DEG,
	buildClip,
	poseClip,
	mirrorPose,
	samplePose,
	createPose,
	copyPose,
	clearPose,
	lerpPose,
	lerpPoseMasked,
	denseToSparse,
	sparseToDense,
	makeMask,
	bindClip,
	sampleBound: sampleInto,
	Player,
	bakeClip,
	solveWorld,
	measureGroundSpeed,
	quat: {
		fromEulerXYZ: quatFromEulerXYZ,
		toEulerXYZ: eulerFromQuatXYZ,
		mul: quatMul,
		rotate: quatRotate,
		conjugate: quatConjugate,
		fromUnitVectors: quatFromUnitVectors,
		slerp: quatSlerp,
	},
};
})();
