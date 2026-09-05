/*
 * A clip, sampled off something that is not one.
 *
 * The inverse of clip.ts. Sampling turns keys into a pose at a time; this
 * turns a pose at a time back into keys, so a cycle worked out as a function
 * can become a file somebody edits by hand.
 *
 * ## Why this is not "sample every frame"
 *
 * A clip in this project is pose-major and readable: a handful of moments,
 * each naming only the bones that are doing something, with a comment saying
 * what the moment is. Sampling a cycle at a fixed rate produces the opposite —
 * every bone at every instant, a table nobody can read and nobody will edit —
 * and a baked clip nobody will edit is a worse thing than the function it came
 * from, because at least the function said why.
 *
 * So the keys are placed where the curve needs them:
 *
 *   anchors    the moments that MEAN something — a foot landing, a foot
 *              leaving — which a gait already declares as its contact
 *              schedule. These are kept whatever the error says, because a key
 *              on the contact is what lets someone edit the contact.
 *   refine     everywhere else, a key goes in only where the interpolation
 *              between the keys already placed disagrees with the source by
 *              more than `tolerance`. The disagreement is measured through the
 *              SAME Hermite the runtime uses, so what is measured is what will
 *              be played.
 *   thin       then each bone gives back the keys it turns out not to need.
 *              The times stay shared, so the pose list stays short, but a bone
 *              that is doing nothing interesting between two moments says
 *              nothing at either.
 *
 * What comes out is a clip that reproduces its source to a stated tolerance,
 * and a report saying where it is worst. That number is the whole warrant for
 * the bake: without it "the clip looks like the function" is an opinion.
 */

import { poseClip, samplePose, type Clip, type ClipEvent, type PoseEntry, type PoseKey } from './clip.js';
import type { SparsePose } from './pose.js';

/** The pose at `t` seconds, written into `out` and returned. */
export type BakeSampler = (t: number, out: SparsePose) => SparsePose;

export interface BakeOptions {
	/**
	 * Phases (0..1) that get a key whatever the error says, and that thinning
	 * may not take away. A gait's contact schedule belongs here.
	 */
	readonly anchors?: readonly number[];
	/**
	 * How far a baked channel may sit from its source, in radians for a
	 * rotation and metres for a translation. The two share a number because at
	 * the magnitudes a rig works in they are the same size of quantity.
	 */
	readonly tolerance?: number;
	/** How many phases the error is looked for at. More is slower and stricter. */
	readonly probes?: number;
	/** Decimal places kept. A file is read by people, and full precision is not. */
	readonly precision?: number;
	/** A bone whose every value stays inside this of rest is left out entirely. */
	readonly rest?: number;
	/** A ceiling on refinement, so a discontinuous source stops rather than runs. */
	readonly maxKeys?: number;
}

export interface BakeError {
	readonly bone: string;
	readonly channel: 'rot' | 'pos';
	/** Where in the cycle, 0..1. */
	readonly phase: number;
	readonly error: number;
}

export interface BakeReport {
	readonly keys: number;
	readonly bones: number;
	/** The worst the clip disagrees with what it was baked from. */
	readonly worst: BakeError;
	/** True when refinement stopped at `maxKeys` rather than at the tolerance. */
	readonly exhausted: boolean;
}

export interface Baked {
	readonly clip: Clip;
	readonly poses: readonly PoseKey[];
	readonly report: BakeReport;
}

const CHANNELS = ['rot', 'pos'] as const;
type Channel = (typeof CHANNELS)[number];

const round = (value: number, places: number): number => {
	const scale = 10 ** places;
	// -0 reads as a mistake in a file, and is the same rotation as 0.
	const out = Math.round(value * scale) / scale;
	return out === 0 ? 0 : out;
};

interface Sampled {
	/** phase (0..1) -> bone -> channel -> three numbers */
	readonly at: Map<number, SparsePose>;
	readonly phases: readonly number[];
}

/** The source, read once at every phase anything will ask about. */
function readSource(sample: BakeSampler, duration: number, phases: readonly number[]): Sampled {
	const at = new Map<number, SparsePose>();
	for (const phase of phases) {
		const out: SparsePose = {};
		sample(phase * duration, out);
		// The sampler reuses its scratch, so this has to be a copy.
		const frozen: SparsePose = {};
		for (const bone in out) {
			const entry = out[bone]!;
			frozen[bone] = {
				...(entry.rot ? { rot: [...entry.rot] } : {}),
				...(entry.pos ? { pos: [...entry.pos] } : {}),
			};
		}
		at.set(phase, frozen);
	}
	return { at, phases };
}

function valueOf(pose: SparsePose, bone: string, channel: Channel): readonly number[] {
	return pose[bone]?.[channel] ?? ZERO;
}

const ZERO: readonly number[] = [0, 0, 0];

/** Which bones the source ever moves, and on which channels. */
function movingBones(source: Sampled, rest: number): Map<string, Set<Channel>> {
	const moving = new Map<string, Set<Channel>>();
	for (const phase of source.phases) {
		const pose = source.at.get(phase)!;
		for (const bone in pose) {
			for (const channel of CHANNELS) {
				const value = valueOf(pose, bone, channel);
				if (Math.max(Math.abs(value[0]!), Math.abs(value[1]!), Math.abs(value[2]!)) <= rest) continue;
				let channels = moving.get(bone);
				if (!channels) moving.set(bone, (channels = new Set()));
				channels.add(channel);
			}
		}
	}
	return moving;
}

/** Build the poses a key-time set implies, taking each value from the source. */
function posesFrom(
	times: readonly number[],
	source: Sampled,
	tracks: Map<string, Set<Channel>>,
	duration: number,
	precision: number,
	kept: Map<string, Set<number>> | null,
): PoseKey[] {
	const poses: PoseKey[] = [];
	for (const phase of times) {
		const pose = source.at.get(phase)!;
		const bones: Record<string, PoseEntry> = {};
		for (const [bone, channels] of tracks) {
			if (kept && !kept.get(bone)?.has(phase)) continue;
			const rot = channels.has('rot') ? valueOf(pose, bone, 'rot') : null;
			const pos = channels.has('pos') ? valueOf(pose, bone, 'pos') : null;
			const r = rot ? (rot.map((v) => round(v, precision)) as [number, number, number]) : null;
			const p = pos ? (pos.map((v) => round(v, precision)) as [number, number, number]) : null;
			if (r && !p) bones[bone] = r;
			else if (p && !r) bones[bone] = { pos: p };
			else if (r && p) bones[bone] = { rot: r, pos: p };
		}
		if (Object.keys(bones).length > 0) poses.push({ t: round(phase * duration, 6), p: bones });
	}
	return poses;
}

/** The worst a built clip disagrees with the source, over every probe. */
function worstError(clip: Clip, source: Sampled, tracks: Map<string, Set<Channel>>, duration: number): BakeError {
	let worst: BakeError = { bone: '', channel: 'rot', phase: 0, error: 0 };
	for (const phase of source.phases) {
		const played = samplePose(clip, phase * duration);
		const wanted = source.at.get(phase)!;
		for (const [bone, channels] of tracks) {
			for (const channel of channels) {
				const a = played[bone]?.[channel] ?? ZERO;
				const b = valueOf(wanted, bone, channel);
				for (let c = 0; c < 3; c++) {
					const error = Math.abs((a[c] ?? 0) - (b[c] ?? 0));
					if (error > worst.error) worst = { bone, channel, phase, error };
				}
			}
		}
	}
	return worst;
}

/**
 * Bake a cycle into keys.
 *
 * `loop` decides where the last key may sit: a looping clip closes onto its own
 * first key and must not author one at the end, and a held one has to state
 * where it finishes.
 */
export function bakeClip(
	name: string,
	duration: number,
	loop: 'loop' | 'hold',
	sample: BakeSampler,
	options: BakeOptions = {},
	events: readonly ClipEvent[] = [],
): Baked {
	const tolerance = options.tolerance ?? 0.004;
	const probes = Math.max(8, options.probes ?? 240);
	const precision = options.precision ?? 4;
	const rest = options.rest ?? 1e-6;
	const maxKeys = Math.max(4, options.maxKeys ?? 48);
	const looping = loop === 'loop';

	const wrap = (phase: number): number => {
		const p = phase % 1;
		return round(p < 0 ? p + 1 : p, 9);
	};

	// Every phase anything will ask about, sampled once. The probes are the
	// grid keys may be placed on as well as the grid error is looked for on,
	// so a key always lands on a phase the source was actually read at.
	const grid: number[] = [];
	for (let i = 0; i < probes; i++) grid.push(round(i / probes, 9));
	if (!looping) grid.push(1);
	const source = readSource(sample, duration, grid);
	const tracks = movingBones(source, rest);

	const anchors = new Set<number>([0]);
	for (const anchor of options.anchors ?? []) {
		// Onto the grid, so the key sits on a phase that was sampled.
		anchors.add(grid.reduce((best, p) => (Math.abs(p - wrap(anchor)) < Math.abs(best - wrap(anchor)) ? p : best), 0));
	}
	if (!looping) anchors.add(1);

	let times = [...anchors].sort((a, b) => a - b);
	let clip = poseClip(name, duration, loop, posesFrom(times, source, tracks, duration, precision, null), [...events]);
	let worst = worstError(clip, source, tracks, duration);
	let exhausted = false;

	// Refine: put a key where the playback is furthest from the source, and
	// keep going until nothing is further out than the tolerance.
	while (worst.error > tolerance) {
		if (times.length >= maxKeys) {
			exhausted = true;
			break;
		}
		if (times.includes(worst.phase)) break;
		times = [...times, worst.phase].sort((a, b) => a - b);
		clip = poseClip(name, duration, loop, posesFrom(times, source, tracks, duration, precision, null), [...events]);
		worst = worstError(clip, source, tracks, duration);
	}

	// Thin: every bone starts with a key at every time, and gives back the ones
	// its own curve turns out not to need. The times stay shared, so this
	// shortens each pose rather than lengthening the list.
	const kept = new Map<string, Set<number>>();
	for (const bone of tracks.keys()) kept.set(bone, new Set(times));
	for (const bone of tracks.keys()) {
		for (const phase of times) {
			if (anchors.has(phase)) continue;
			const mine = kept.get(bone)!;
			if (mine.size <= 2) break;
			mine.delete(phase);
			const trial = poseClip(name, duration, loop, posesFrom(times, source, tracks, duration, precision, kept), [...events]);
			if (worstError(trial, source, tracks, duration).error > tolerance) mine.add(phase);
		}
	}

	const poses = posesFrom(times, source, tracks, duration, precision, kept);
	const finished = poseClip(name, duration, loop, poses, [...events]);
	return {
		clip: finished,
		poses,
		report: {
			keys: times.length,
			bones: tracks.size,
			worst: worstError(finished, source, tracks, duration),
			exhausted,
		},
	};
}
