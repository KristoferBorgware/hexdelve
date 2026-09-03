/*
 * The animations that are functions, and how a file names one.
 *
 * Half the animation in this project has no keys at all. The stride is a
 * handful of harmonics of one phase angle and a direction of travel; the wing
 * beat is four bones lagging each other round a cycle; the hellhound's run is
 * a gait written as a function of the same. None of those is a clip, none of
 * them can be, and the reason is the point rather than a limitation — a
 * function of a heading covers the whole circle of directions where a blend
 * space over clips covers four of them.
 *
 * So a function cannot move into a YAML file, and it should not: it is code,
 * and it stays code. What moves into the file is everything AROUND it — that
 * the wanderer has a walk, that its cycle is 0.95 seconds, that it is the
 * stride at gait 0 and the run is the same function at gait 1, that its feet
 * land a quarter and three quarters of the way through. The tuning is data;
 * the curve is a function; the file names the function and hands it the
 * numbers.
 *
 *     walk: { procedural: stride, args: { gait: 0 }, duration: 0.95 }
 *     run:  { procedural: stride, args: { gait: 1 }, duration: 0.66 }
 *
 * Registration is a registry rather than an import because of which way round
 * the packages point: the engine owns the mechanism and knows nothing about a
 * character, and the client owns the stride. A file loaded with no registry
 * gets a clear error naming the function it wanted, which is the right failure
 * for an entity whose animations were never wired up.
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
