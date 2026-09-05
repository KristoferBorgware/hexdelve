/*
 * The animations an object can be put in, and the trees that arrange them.
 *
 * The entity file names them; this is what they arrive as. `walk` is an
 * `AnimationAsset` whether it came from a clip file or from a pose function,
 * which is the point of the name — a blend tree refers to `walk` and neither
 * the tree nor anything reading it has to know which of the two it was.
 *
 * It poses the `Rig` on its own object. That is a component finding another
 * component on the same object rather than being handed one, for the reason
 * everything else here does it: the object is the thing they have in common,
 * and a second reference to the same rig is a second thing to keep in step.
 */

import type { AnimationAsset } from '../../assets/animation.js';
import type { BlendTreeAsset } from '../../assets/blendtree.js';
import type { Clip } from '../../anim/clip.js';
import type { SparsePose } from '../../anim/pose.js';
import type { GameObject } from '../GameObject.js';
import { Component } from './Component.js';
import { Rig } from './Rig.js';

export class Animator extends Component {
	readonly animations: ReadonlyMap<string, AnimationAsset>;
	readonly blendTrees: ReadonlyMap<string, BlendTreeAsset>;

	constructor(
		object: GameObject,
		animations: ReadonlyMap<string, AnimationAsset>,
		blendTrees: ReadonlyMap<string, BlendTreeAsset>,
	) {
		super(object);
		this.animations = animations;
		this.blendTrees = blendTrees;
	}

	/** The bones this poses. Null on an object that has none to pose. */
	get rig(): Rig | null {
		return this.object.getComponent(Rig);
	}

	/**
	 * One animation by name.
	 *
	 * A miss is an error rather than a null: a man with no `slash` cannot swing,
	 * and finding that out when he does would be worse than finding it out when
	 * he is asked for it. What there was instead is half of a useful message.
	 */
	animation(name: string): AnimationAsset {
		const found = this.animations.get(name);
		if (!found) {
			const had = [...this.animations.keys()].join(', ') || 'none';
			throw new Error(`'${this.object.name}' has no animation '${name}'; it has ${had}`);
		}
		return found;
	}

	/**
	 * The same, where the keys themselves are wanted rather than a pose.
	 *
	 * Every animation an entity file names is a clip, so the refusal below is
	 * for an animation built in code and handed over — which a bench does, and
	 * which has no keys to read.
	 */
	clip(name: string): Clip {
		const animation = this.animation(name);
		if (!animation.clip) {
			throw new Error(`'${this.object.name}' animation '${name}' has no keys to read`);
		}
		return animation.clip;
	}

	tree(name: string): BlendTreeAsset {
		const found = this.blendTrees.get(name);
		if (!found) {
			const had = [...this.blendTrees.keys()].join(', ') || 'none';
			throw new Error(`'${this.object.name}' has no blend tree '${name}'; it has ${had}`);
		}
		return found;
	}

	/** Sample one animation straight into a pose, for anything not using a tree. */
	sample(name: string, t: number, out: SparsePose): SparsePose {
		return this.animation(name).sample(t, out);
	}
}
