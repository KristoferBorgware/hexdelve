/*
 * Keyframe clips: authoring, and sampling them.
 *
 * A clip is plain data — a list of times and values per bone per channel — and
 * sampling is Hermite interpolation between the two keys that straddle a time.
 * Nothing here knows what a renderer is.
 *
 * Two conventions worth stating, because both are load-bearing:
 *
 *   - Time is seconds, angles radians, Euler XYZ.
 *   - For a looping clip the pose at t = duration IS the pose at t = 0. Do not
 *     author a closing key; the wrap segment interpolates back to the first.
 */

import { clearPose, type DensePose } from './pose.js';

export type Easing = 'auto' | 'linear' | 'step' | 'flat';

export interface Key {
	readonly t: number;
	readonly v: readonly [number, number, number];
	readonly e: Easing;
}

export interface Track {
	rot?: Key[];
	pos?: Key[];
}

export interface ClipEvent {
	readonly t: number;
	readonly name: string;
}

export interface Clip {
	readonly name: string;
	readonly duration: number;
	readonly loop: 'loop' | 'hold';
	readonly tracks: Record<string, Track>;
	readonly events: readonly ClipEvent[];
}

/** Keys are authored compactly as [t, x, y, z, ease?]. */
export type RawKey = [number, number, number, number, Easing?];

export interface ClipSpec {
	name: string;
	duration: number;
	loop?: 'loop' | 'hold';
	tracks: Record<string, { rot?: RawKey[]; pos?: RawKey[] }>;
	events?: ClipEvent[];
}

function normaliseKeys(raw: RawKey[]): Key[] {
	return raw
		.map((k) => ({ t: k[0], v: [k[1], k[2], k[3]] as [number, number, number], e: k[4] ?? 'auto' }))
		.sort((a, b) => a.t - b.t);
}

export function buildClip(spec: ClipSpec): Clip {
	const loop = spec.loop ?? 'loop';
	const looping = loop === 'loop';
	const tracks: Record<string, Track> = {};

	for (const boneName in spec.tracks) {
		const source = spec.tracks[boneName]!;
		const track: Track = {};
		for (const channel of ['rot', 'pos'] as const) {
			const raw = source[channel];
			if (!raw) continue;
			let keys = normaliseKeys(raw);
			// A looping clip closes onto its own first key.
			if (looping) keys = keys.filter((k) => k.t < spec.duration - 1e-6);
			if (keys.length) track[channel] = keys;
		}
		if (track.rot || track.pos) tracks[boneName] = track;
	}

	return {
		name: spec.name,
		duration: spec.duration,
		loop,
		tracks,
		events: [...(spec.events ?? [])].sort((a, b) => a.t - b.t),
	};
}

export type PoseEntry = readonly [number, number, number] | { rot?: readonly number[]; pos?: readonly number[]; e?: Easing };

export interface PoseKey {
	t: number;
	e?: Easing;
	p: Record<string, PoseEntry>;
}

/**
 * Pose-major authoring: a list of { t, p: { bone: [x,y,z] | {rot,pos} } }.
 *
 * A bone left out of a pose simply gets no key there, so it interpolates
 * straight through — which is how animators actually work, and why the clip
 * tables only ever mention the bones that are doing something.
 */
export function poseClip(
	name: string,
	duration: number,
	loop: 'loop' | 'hold',
	poses: PoseKey[],
	events: ClipEvent[] = [],
): Clip {
	const tracks: Record<string, { rot?: RawKey[]; pos?: RawKey[] }> = {};

	for (const pose of poses) {
		for (const boneName in pose.p) {
			const entry = pose.p[boneName]!;
			const isArray = Array.isArray(entry);
			const rot = isArray ? (entry as readonly number[]) : (entry as { rot?: readonly number[] }).rot;
			const pos = isArray ? undefined : (entry as { pos?: readonly number[] }).pos;
			const ease = (isArray ? pose.e : (entry as { e?: Easing }).e ?? pose.e) ?? undefined;

			const track = (tracks[boneName] ??= {});
			if (rot) {
				(track.rot ??= []).push([pose.t, rot[0]!, rot[1]!, rot[2]!, ease]);
			}
			if (pos) {
				(track.pos ??= []).push([pose.t, pos[0]!, pos[1]!, pos[2]!, ease]);
			}
		}
	}

	return buildClip({ name, duration, loop, tracks, events });
}

/** Left/right mirror of one authored pose, for writing half a symmetric cycle. */
export function mirrorPose(p: Record<string, PoseEntry>): Record<string, PoseEntry> {
	const out: Record<string, PoseEntry> = {};
	for (const boneName in p) {
		const entry = p[boneName]!;
		const isArray = Array.isArray(entry);
		const rot = isArray ? (entry as readonly number[]) : (entry as { rot?: readonly number[] }).rot;
		const pos = isArray ? undefined : (entry as { pos?: readonly number[] }).pos;

		let name = boneName;
		if (boneName.endsWith('L')) name = `${boneName.slice(0, -1)}R`;
		else if (boneName.endsWith('R')) name = `${boneName.slice(0, -1)}L`;

		const mirroredRot = rot ? ([rot[0]!, -rot[1]!, -rot[2]!] as [number, number, number]) : undefined;
		const mirroredPos = pos ? ([-pos[0]!, pos[1]!, pos[2]!] as [number, number, number]) : undefined;
		out[name] = isArray
			? mirroredRot!
			: { ...(mirroredRot ? { rot: mirroredRot } : {}), ...(mirroredPos ? { pos: mirroredPos } : {}) };
	}
	return out;
}

/* --------------------------------------------------------------- sampling -- */

function hermite(v0: number, v1: number, m0: number, m1: number, h: number, u: number): number {
	const u2 = u * u;
	const u3 = u2 * u;
	return (
		(2 * u3 - 3 * u2 + 1) * v0 +
		(u3 - 2 * u2 + u) * h * m0 +
		(-2 * u3 + 3 * u2) * v1 +
		(u3 - u2) * h * m1
	);
}

interface Segment {
	a: number;
	b: number;
	u: number;
	h: number;
}

/**
 * Which segment does `t` fall in?
 *
 * The wrap case is the interesting one: for a looping clip the span between
 * the last key and the first is a real segment of length
 * `firstT + duration - lastT`, and a time before the first key belongs to it
 * just as much as a time after the last one does.
 */
function locate(keys: Key[], t: number, duration: number, looping: boolean): Segment {
	const n = keys.length;
	const firstT = keys[0]!.t;
	const lastT = keys[n - 1]!.t;

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
		if (keys[mid]!.t <= t) lo = mid;
		else hi = mid;
	}
	const h = keys[hi]!.t - keys[lo]!.t;
	return { a: lo, b: hi, u: h > 1e-9 ? (t - keys[lo]!.t) / h : 0, h };
}

/**
 * Finite-difference tangent, in units per second.
 *
 * Time-aware rather than index-aware, so unevenly spaced keys — which is the
 * whole point of keyframing — stay smooth across the gap.
 */
function tangent(keys: Key[], i: number, c: number, duration: number, looping: boolean): number {
	const n = keys.length;
	let pt: number;
	let pv: number;
	let nt: number;
	let nv: number;

	if (i === 0) {
		const k = looping ? keys[n - 1]! : keys[0]!;
		pt = looping ? k.t - duration : k.t;
		pv = k.v[c]!;
	} else {
		pt = keys[i - 1]!.t;
		pv = keys[i - 1]!.v[c]!;
	}

	if (i === n - 1) {
		const k = looping ? keys[0]! : keys[n - 1]!;
		nt = looping ? k.t + duration : k.t;
		nv = k.v[c]!;
	} else {
		nt = keys[i + 1]!.t;
		nv = keys[i + 1]!.v[c]!;
	}

	const dt = nt - pt;
	return dt > 1e-6 ? (nv - pv) / dt : 0;
}

export function evalTrack(
	keys: Key[],
	t: number,
	duration: number,
	looping: boolean,
	out: Float32Array | number[],
	offset: number,
): void {
	const n = keys.length;
	if (n === 1) {
		out[offset] = keys[0]!.v[0];
		out[offset + 1] = keys[0]!.v[1];
		out[offset + 2] = keys[0]!.v[2];
		return;
	}

	const segment = locate(keys, t, duration, looping);
	const a = keys[segment.a]!;
	const b = keys[segment.b]!;

	for (let c = 0; c < 3; c++) {
		let v: number;
		if (segment.h <= 1e-9 || a.e === 'step') {
			v = a.v[c]!;
		} else if (a.e === 'linear') {
			v = a.v[c]! + (b.v[c]! - a.v[c]!) * segment.u;
		} else {
			// 'flat' zeroes the tangent at that key, which is what makes a hold
			// hold instead of overshooting on its way in.
			const m0 = a.e === 'flat' ? 0 : tangent(keys, segment.a, c, duration, looping);
			const m1 = b.e === 'flat' ? 0 : tangent(keys, segment.b, c, duration, looping);
			v = hermite(a.v[c]!, b.v[c]!, m0, m1, segment.h, segment.u);
		}
		out[offset + c] = v;
	}
}

/**
 * Sparse sample. This allocates, so it is for tools — measuring a reach off a
 * clip at startup — rather than for the per-frame path.
 */
export function samplePose(clip: Clip, t: number): Record<string, { rot?: number[]; pos?: number[] }> {
	const looping = clip.loop === 'loop';
	const out: Record<string, { rot?: number[]; pos?: number[] }> = {};
	for (const boneName in clip.tracks) {
		const track = clip.tracks[boneName]!;
		const entry: { rot?: number[]; pos?: number[] } = {};
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

/* ------------------------------------------------------------------ bound -- */

interface BoundTrack {
	readonly i: number;
	readonly rot: Key[] | null;
	readonly pos: Key[] | null;
}

/**
 * A clip with its bone names already resolved to indices.
 *
 * Binding once at startup is what keeps the per-frame sample free of string
 * lookups: a clip is then a short list of (index, keys) and sampling writes
 * straight into the dense buffer.
 */
export interface BoundClip {
	readonly clip: Clip;
	readonly bound: BoundTrack[];
}

export function bindClip(clip: Clip, index: Map<string, number>): BoundClip {
	const bound: BoundTrack[] = [];
	for (const boneName in clip.tracks) {
		const i = index.get(boneName);
		if (i === undefined) continue;
		bound.push({ i, rot: clip.tracks[boneName]!.rot ?? null, pos: clip.tracks[boneName]!.pos ?? null });
	}
	return { clip, bound };
}

export function sampleBound(entry: BoundClip, t: number, pose: DensePose): void {
	clearPose(pose);
	const looping = entry.clip.loop === 'loop';
	for (const track of entry.bound) {
		if (track.rot) evalTrack(track.rot, t, entry.clip.duration, looping, pose.rot, track.i * 3);
		if (track.pos) evalTrack(track.pos, t, entry.clip.duration, looping, pose.pos, track.i * 3);
	}
}
