/*
 * Something attached to a game object.
 *
 * A component reaches its object and, through it, everything else. It is not a
 * node: it has no transform, no children and no place of its own, and acts
 * entirely through the object that owns it. That distinction is what keeps the
 * tree a tree.
 *
 * The folder holds the components the ENGINE defines, and there are two: this
 * and `Script`. A game's own — an actor, an item, a thing that follows a bone —
 * live in the game, because `actor` and `item` are its vocabulary rather than
 * the engine's.
 */

import type { GameObject } from '../GameObject.js';

/** A component constructor, as `addComponent` takes it. */
export type ComponentClass<T extends Component, A extends unknown[] = []> = new (
	object: GameObject,
	...args: A
) => T;

export abstract class Component {
	constructor(readonly object: GameObject) {}

	/** After it has been attached and the object knows about it. */
	onAttach(): void {}

	/** Once a frame, in tree order, parents before children. */
	update(_dt: number): void {}

	/**
	 * When it is removed, or its object is destroyed.
	 *
	 * Always called exactly once, and always before the object stops being
	 * reachable — so a component can still find its neighbours and take itself
	 * out of whatever registered it.
	 */
	onDetach(): void {}
}
