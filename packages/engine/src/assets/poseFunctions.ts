/*
 * The animations that are functions, and the registry the bake looks them up in.
 *
 * A cycle can be worked out as a function of its phase — a stride is a handful
 * of harmonics of one angle, a wing beat is four bones lagging each other round
 * a cycle, a gait is a foot path with the leg solved back from it. That is a
 * good way to DERIVE a cycle and a poor way to ship one: it cannot be opened
 * and nudged, and the parameters that make it general are the same ones a blend
 * tree expresses better.
 *
 * So the function stays a function and the clip is what is kept. `bakeClip`
 * samples one into keys, `tools/bake-clips.mjs` writes them, and an entity
 * file names the file. Nothing the game loads resolves a function any more:
 * the format has one kind of animation in it, and this is the machinery on the
 * authoring side of that line.
 *
 * Registration is a registry rather than an import because of which way round
 * the packages point: the engine owns the mechanism and knows nothing about a
 * character, and the functions belong to whoever has characters.
 */

import type { SparsePose } from '../anim/pose.js';
import type { RigAsset } from './rig.js';

/** What a pose function is handed when an entity asks for one. */
export interface PoseFunctionContext {
	readonly rig: RigAsset;
	/** The `args` from the file, whatever the function chooses to read. */
	readonly args: Readonly<Record<string, number>>;
	/**
	 * The cycle this one is being built for, in seconds — the file's own
	 * `duration` where it stated one, and `duration` below where it did not.
	 *
	 * Handed over because a cyclic function has to turn seconds into a phase
	 * and cannot ask anyone else what its cycle is: a walk and a run are the
	 * same function at 0.95 and 0.66 seconds, and the difference is exactly
	 * this number.
	 */
	readonly duration: number;
}

/** The pose at `t` seconds, written into `out` and returned. */
export type PoseSampler = (t: number, out: SparsePose) => SparsePose;

export interface PoseFunction {
	readonly id: string;
	/**
	 * One cycle, in seconds. A function of the arguments where the arguments
	 * decide it — a run is the same stride taken faster — so a file need only
	 * state a duration when it wants a different one.
	 */
	readonly duration: number | ((args: Readonly<Record<string, number>>) => number);
	/** Whether the end of a cycle is the start of it again. */
	readonly loop?: boolean;
	/**
	 * Where in the cycle (0..1) each foot lands. One number per foot, the
	 * first being the one the phase sync and the speed measurement line up on.
	 */
	readonly contacts?: readonly number[];
	/** A fresh sampler. Fresh, because each one keeps a scratch pose. */
	build(context: PoseFunctionContext): PoseSampler;
}

/**
 * The pose functions an asset file may name.
 *
 * Registering the same id twice is an error rather than a replacement: two
 * functions answering to `stride` is a mistake nobody would find by looking at
 * either of them.
 */
export class PoseFunctionRegistry {
	private readonly functions = new Map<string, PoseFunction>();

	register(...functions: readonly PoseFunction[]): this {
		for (const fn of functions) {
			if (this.functions.has(fn.id)) throw new Error(`two pose functions called '${fn.id}'`);
			this.functions.set(fn.id, fn);
		}
		return this;
	}

	get(id: string): PoseFunction | undefined {
		return this.functions.get(id);
	}

	get ids(): string[] {
		return [...this.functions.keys()].sort();
	}
}
