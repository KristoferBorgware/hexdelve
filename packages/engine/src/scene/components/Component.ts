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
 * the engine's. Beside them is what any component may say about itself:
 * `parameters.ts`, where a field declares that somebody else may set it, and
 * `inspect.ts`, the walk an editor reads a whole subtree with.
 */

import type { GameObject } from '../GameObject.js';
import { liveParameters, writeParameter, type LiveParameter } from './parameters.js';

/** A component constructor, as `addComponent` takes it. */
export type ComponentClass<T extends Component, A extends unknown[] = []> = new (
	object: GameObject,
	...args: A
) => T;

export abstract class Component {
	constructor(readonly object: GameObject) {}

	/**
	 * The class name, as an editor lists it.
	 *
	 * The name a script is also named by in a prefab, since a script class and
	 * the entry that asks for it are called the same thing.
	 */
	get typeName(): string {
		return this.constructor.name;
	}

	/**
	 * The fields this component exposes, each with the value it holds.
	 *
	 * What a tree view puts controls on. A component exposes a field by
	 * declaring it with `param()` and exposes nothing otherwise, so this is the
	 * class's own answer rather than a reading of everything the instance
	 * happens to carry — see `parameters.ts`.
	 */
	parameters(): LiveParameter[] {
		return liveParameters(this);
	}

	/**
	 * Set one exposed field, and answer whether it was one.
	 *
	 * False for a name the class never declared, which is a thing to report
	 * rather than a thing to throw over: it arrives from a prefab or from
	 * somebody typing in an editor.
	 *
	 * `Script` overrides this to have the host remember the value, because a
	 * hot reload builds a new instance and a field somebody set has to survive
	 * that. Any override should call this one.
	 */
	setParameter(key: string, value: unknown): boolean {
		return writeParameter(this, key, value);
	}

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
