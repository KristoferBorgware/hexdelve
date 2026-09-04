/*
 * What the bench can put on the stand, out of the asset files.
 *
 * This file used to be the catalogue: it imported four bodies, three rigs and
 * six clips from `@hexdelve/client`, wrote out the durations of the pose
 * functions by hand and listed every animation per subject. It is now an
 * adapter and nothing else — the manifest says what exists, each entity says
 * what belongs to it, and everything below turns those into the shape the
 * bench's transport wants.
 *
 * That is the whole point of the move. Adding a creature used to mean editing
 * this list; it now means adding a file to `public/assets/entities` and a line
 * to the manifest, and the bench shows it without being told.
 *
 * The transport still wants the smallest thing every animation has in common —
 * a duration, and a function from a time to a pose — because a keyframed clip,
 * a pose function and a blend tree are all one of those. The asset types
 * already carry exactly that, so the adapting is mostly renaming.
 */

import type { BoneTip, Model, Skeleton } from '@hexdelve/engine';
import type { AnimationAsset, BlendTreeAsset, EntityAsset } from '@hexdelve/client';

import { treeAnimation, type BenchAnimation } from './animation.js';
import { calibratedParameters } from './trees.js';

export type { BenchAnimation, BenchParameter, BenchTreeAnimation } from './animation.js';
export { initialParameters, isTree } from './animation.js';

export interface BenchRig {
	readonly id: string;
	readonly label: string;
	readonly skeleton: Skeleton;
	readonly tips: readonly BoneTip[];
	readonly animations: readonly BenchAnimation[];
	/** The body. Built once, on first use — the prisms never change. */
	model(): Model;
	/** Roughly where the middle of the creature is, for the camera to look at. */
	readonly focusY: number;
	/** And how far out to stand to see all of it. */
	readonly frameDistance: number;
}

/** One loaded animation, as the transport wants it. */
function benchAnimation(animation: AnimationAsset): BenchAnimation {
	return {
		id: animation.name,
		label: animation.label,
		duration: animation.duration,
		loop: animation.loop,
		kind: animation.kind,
		sample: (t, out) => animation.sample(t, out),
	};
}

/**
 * One loaded blend tree, as the transport wants it.
 *
 * The tree is asked for once here rather than per frame, because a tree owns a
 * playhead: two of them would be two subjects fighting over which frame is
 * being looked at. The skeleton goes in only when the rig has feet, since a
 * ground speed read off a bat would be a number about nothing.
 */
function benchTree(tree: BlendTreeAsset, skeleton: Skeleton, walks: boolean) {
	return treeAnimation({
		id: tree.id,
		label: tree.label,
		tree: tree.tree(),
		parameters: calibratedParameters(tree, skeleton),
		...(walks ? { skeleton } : {}),
	});
}

/**
 * A loaded entity, as a bench subject.
 *
 * Trees first in the list, then the animations, which is the order that makes
 * the bench worth having: the point of a tree being next to its own leaves is
 * being able to look at one and then the other.
 */
export function benchRig(entity: EntityAsset): BenchRig | null {
	const rig = entity.rig;
	if (!rig) return null; // A prop has no bones, and belongs on the other bench.

	const walks = rig.feet !== null;
	const animations: BenchAnimation[] = [
		...[...entity.blendTrees.values()].map((tree) => benchTree(tree, rig.skeleton, walks)),
		...[...entity.animations.values()].map(benchAnimation),
	];

	let built: Model | null = null;
	return {
		id: entity.id,
		label: entity.name,
		skeleton: rig.skeleton,
		tips: rig.tips,
		focusY: rig.view.focusY,
		frameDistance: rig.view.frameDistance,
		model: () => (built ??= entity.mesh.model()),
		animations,
	};
}

/** Every character in a manifest, in the order it lists them. */
export function benchRigs(entities: readonly EntityAsset[]): BenchRig[] {
	const out: BenchRig[] = [];
	for (const entity of entities) {
		const rig = benchRig(entity);
		if (rig) out.push(rig);
	}
	return out;
}

export function findRig(rigs: readonly BenchRig[], id: string): BenchRig | undefined {
	return rigs.find((rig) => rig.id === id);
}
