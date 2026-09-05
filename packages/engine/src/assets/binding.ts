/*
 * What a component record's file references loaded to.
 *
 * A component names files — a rig, a mesh, a clip, a tree — and the factory
 * that builds it needs the loaded thing rather than the string it was written
 * as. Reading a file takes a fetch and `instantiate` is synchronous, so the
 * library resolves every path in an entity's object tree while it loads the
 * entity, and hangs the result on the record it came from.
 *
 * `rig` is the one that is not a file this record named. It is the rig IN SCOPE
 * where the record sits: the one a mesh checks its bone names against, the one
 * an `attach` looks its bone up in, the one an `animator` poses. An object's
 * own `rig` component sets it and its children inherit it, so a sword hanging
 * under a hand is measured against the hand's rig without repeating the path.
 *
 * A record naming no files gets `NO_ASSETS` and reads the same way as one that
 * did, which is what lets a factory ask without first asking whether it may.
 */

import type { ParticleEffect } from '../particles/effect.js';
import type { AnimationAsset } from './animation.js';
import type { BlendTreeAsset } from './blendtree.js';
import type { MeshAsset } from './mesh.js';
import type { RigAsset } from './rig.js';

/** The loaded side of one component record. */
export interface ComponentAssets {
	/** The rig in scope here, or null where nothing above has named one. */
	readonly rig: RigAsset | null;
	/** This record's own mesh. Only a `mesh` component has one. */
	readonly mesh: MeshAsset | null;
	/** This record's own particle effect. Only a `particles` component has one. */
	readonly effect: ParticleEffect | null;
	/** By the name the file gave each. Only an `animator` has any. */
	readonly animations: ReadonlyMap<string, AnimationAsset>;
	readonly blendTrees: ReadonlyMap<string, BlendTreeAsset>;
}

const NO_ANIMATIONS: ReadonlyMap<string, AnimationAsset> = new Map();
const NO_TREES: ReadonlyMap<string, BlendTreeAsset> = new Map();

/** A record that named no files, and one that has not been bound to any. */
export const NO_ASSETS: ComponentAssets = Object.freeze({
	rig: null,
	mesh: null,
	effect: null,
	animations: NO_ANIMATIONS,
	blendTrees: NO_TREES,
});

/** The same, carrying the rig that was in scope and nothing else. */
export function assetsUnder(rig: RigAsset | null): ComponentAssets {
	if (rig === null) return NO_ASSETS;
	return { rig, mesh: null, effect: null, animations: NO_ANIMATIONS, blendTrees: NO_TREES };
}
