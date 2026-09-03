/*
 * What the bench's transport can drive.
 *
 * `BenchAnimation` is deliberately the smallest thing every animation in this
 * project has in common: a duration, and a function from a time to a pose. A
 * keyframed clip is one of those. So is the procedural stride, which is a
 * function of an angle and has no keys at all. And so is a blend tree, which is
 * a function of its parameters — which is why the transport did not have to
 * change to gain one.
 *
 * A tree is the only one of the three that is not a pure function of time,
 * because its cycle length moves with its parameters: blend a walk towards a
 * run and the cadence speeds up. That is expressed here by `duration` being a
 * live reading rather than a constant, and it is the bench's clock that deals
 * with the consequence — see `CharacterBench.advance`, which rescales the
 * playhead so a cycle that changes length does not move the footfall.
 */

import {
	bindClip,
	boneIndex,
	boneNames,
	createPose,
	denseToSparse,
	measureGroundSpeed,
	sampleBound,
	type BlendTree,
	type Clip,
	type GroundVelocity,
	type Skeleton,
	type SparsePose,
} from '@hexdelve/engine';

export interface BenchAnimation {
	readonly id: string;
	readonly label: string;
	/** One cycle, in seconds. A tree's moves with its parameters. */
	readonly duration: number;
	/** Whether the end of that cycle is the start of it again. */
	readonly loop: boolean;
	/** Where it came from, for the readout. */
	readonly kind: 'clip' | 'procedural' | 'tree';
	/** The pose at `t` seconds, written into `out` and returned. */
	sample(t: number, out: SparsePose): SparsePose;
}

/** One number a tree is driven by, and how to put a slider on it. */
export interface BenchParameter {
	readonly name: string;
	readonly label: string;
	readonly min: number;
	readonly max: number;
	readonly step: number;
	readonly initial: number;
	readonly unit?: string;
	readonly hint?: string;
	/**
	 * The slider's value, to the value the tree is actually given.
	 *
	 * Absent on an axis that means what it says. Present on a CALIBRATED one,
	 * where the slider is in real units and the tree's own parameter is not
	 * quite: a blend halfway between a walk and a run does not travel at the
	 * average of their speeds, so a slider in true metres per second has to
	 * bend before it reaches the tree. See `calibrateSpeed`.
	 */
	readonly toTree?: (value: number) => number;
}

export interface BenchTreeAnimation extends BenchAnimation {
	readonly kind: 'tree';
	readonly tree: BlendTree;
	readonly parameters: readonly BenchParameter[];
	/**
	 * Live parameter values. The panel writes here and the tree reads, which is
	 * what lets a slider move a pose without going through the frame loop.
	 */
	readonly params: Record<string, number>;
	/**
	 * What this cycle actually carries the body at, measured off the blended
	 * pose. Present only for a tree whose subject walks.
	 */
	measure?(): GroundVelocity;
}

export function isTree(animation: BenchAnimation): animation is BenchTreeAnimation {
	return animation.kind === 'tree';
}

/** The values a tree starts at, for a panel that has just been handed one. */
export function initialParameters(animation: BenchAnimation): Record<string, number> {
	if (!isTree(animation)) return {};
	const out: Record<string, number> = {};
	for (const parameter of animation.parameters) out[parameter.name] = parameter.initial;
	return out;
}

/**
 * A clip, bound to its skeleton once.
 *
 * Binding resolves the clip's bone names to indices, so sampling a frame is a
 * walk down a short array rather than a string lookup per bone. That matters
 * less on a bench than in the game — but the bench is meant to show what the
 * game will do with a clip, and sampling it through a different path would be
 * a poor way to check one.
 */
export function clipAnimation(clip: Clip, skeleton: Skeleton, label: string): BenchAnimation {
	const names = boneNames(skeleton);
	const bound = bindClip(clip, boneIndex(skeleton));
	const dense = createPose(names.length);

	return {
		id: clip.name,
		label,
		duration: clip.duration,
		loop: clip.loop === 'loop',
		kind: 'clip',
		sample(t, out) {
			sampleBound(bound, t, dense);
			return denseToSparse(names, dense, out);
		},
	};
}

/** A pose function, wrapped as an animation over one cycle of it. */
export function procedural(
	id: string,
	label: string,
	duration: number,
	loop: boolean,
	sample: (t: number, out: SparsePose) => SparsePose,
): BenchAnimation {
	return { id, label, duration, loop, kind: 'procedural', sample };
}

export interface TreeAnimationOptions {
	id: string;
	label: string;
	tree: BlendTree;
	parameters: readonly BenchParameter[];
	/** Supply this and the panel gets a measured ground speed to check against. */
	skeleton?: Skeleton;
}

export function treeAnimation(options: TreeAnimationOptions): BenchTreeAnimation {
	const { tree, parameters } = options;
	const params: Record<string, number> = {};
	for (const parameter of parameters) params[parameter.name] = parameter.initial;

	/*
	 * What the tree is actually handed. Kept apart from `params` because the
	 * panel's numbers and the tree's are not always the same number — a
	 * calibrated axis is in real units on the slider and in the tree's own
	 * units by the time it arrives. Reused rather than rebuilt, since this is
	 * read on every frame.
	 */
	const treeParams: Record<string, number> = {};
	const mapped = (): Record<string, number> => {
		for (const parameter of parameters) {
			const value = params[parameter.name] ?? parameter.initial;
			treeParams[parameter.name] = parameter.toTree ? parameter.toTree(value) : value;
		}
		return treeParams;
	};

	const animation: BenchTreeAnimation = {
		kind: 'tree',
		id: options.id,
		label: options.label,
		loop: true,
		tree,
		parameters,
		params,

		get duration(): number {
			// The cycle is the weighted blend of the active leaves' own lengths,
			// so it is not known until the tree has been walked. One walk is
			// cheap and allocation-free; a stale number is not honest.
			tree.resolve(mapped());
			return tree.cycle;
		},

		sample(t, out) {
			tree.resolve(mapped());
			const cycle = tree.cycle;
			tree.phase = cycle > 1e-6 ? t / cycle : 0;
			// Unsynced leaves keep their own clock, and this is it. With sync
			// off it is every leaf's clock, which is the drift the toggle shows.
			tree.elapsed = t;
			tree.evaluate();
			return tree.toSparse(out);
		},
	};

	const skeleton = options.skeleton;
	if (skeleton) {
		animation.measure = (): GroundVelocity => {
			tree.resolve(mapped());
			const cycle = tree.cycle;
			// The measurement walks the cycle, so it has to put the playhead
			// back where it found it or a paused bench would jump every poll.
			const phase = tree.phase;
			const elapsed = tree.elapsed;
			const velocity = measureGroundSpeed(
				skeleton,
				(p, out) => {
					tree.phase = p;
					tree.elapsed = p * cycle;
					tree.evaluate();
					return tree.toSparse(out);
				},
				cycle,
			);
			tree.phase = phase;
			tree.elapsed = elapsed;
			return velocity;
		};
	}

	return animation;
}
