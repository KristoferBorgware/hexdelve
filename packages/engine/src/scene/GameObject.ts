/*
 * A game object: a name, a place, some children, and some components.
 *
 * Everything this project draws or moves is about to be one of these, and the
 * shape is deliberately the one Unity settled on, because the problem is the
 * same. An object is not behaviour. It is a position in a tree and a list of
 * things attached to it, and every piece of behaviour — walking, being hit,
 * being drawn — is one of those attachments. That is what stops a character
 * from being a class that grows a field every time the game learns a verb.
 *
 * ## Why a hierarchy at all
 *
 * A rig already has one, and it is not this one. Bones are how a body is
 * arranged; objects are how the WORLD is. The two meet at exactly one place — a
 * sword hanging off a hand — and keeping them apart is what lets a prop be
 * carried by a bone without the prop knowing what a bone is.
 *
 * ## Ids
 *
 * A number from a counter rather than a uuid, because the only thing an id has
 * to do here is name one object to another for the length of a session: a
 * registry entry, an event's target. Anything that has to survive being written
 * to a file is named, and a name is what the prefab carries.
 */

import type { Quat } from '@hexdelve/shared';

import { composeWorld, Transform, type Point, type WorldTransform } from './Transform.js';
import type { Component, ComponentClass } from './components/Component.js';
import { applyParameters, resolveParameters } from './components/parameters.js';

let nextId = 1;

export interface GameObjectOptions {
	name?: string;
}

export class GameObject {
	/** Unique for the life of the process. Not written to files; the name is. */
	readonly id: number = nextId++;
	name: string;

	/** Where it is, in its parent's space. */
	readonly transform = new Transform();

	/**
	 * And in the scene's, as of the last `solve`.
	 *
	 * Reused rather than reallocated, and stale until the scene is solved —
	 * which is once a frame, after the components have finished moving things.
	 */
	readonly world: { position: Point; rotation: Quat } = {
		position: [0, 0, 0],
		rotation: new Float32Array([0, 0, 0, 1]) as Quat,
	};

	private parentObject: GameObject | null = null;
	private readonly childList: GameObject[] = [];
	private readonly componentList: Component[] = [];
	private destroyed = false;

	constructor(options: GameObjectOptions | string = {}) {
		const settings = typeof options === 'string' ? { name: options } : options;
		this.name = settings.name ?? '';
	}

	get parent(): GameObject | null {
		return this.parentObject;
	}

	get children(): readonly GameObject[] {
		return this.childList;
	}

	get components(): readonly Component[] {
		return this.componentList;
	}

	/** True once it has been destroyed. A destroyed object is not reused. */
	get isDestroyed(): boolean {
		return this.destroyed;
	}

	/* ------------------------------------------------------------ hierarchy -- */

	/**
	 * Attach `child` here, taking it off whatever it was on.
	 *
	 * The transform is not adjusted. Re-parenting in this project is picking a
	 * thing up, and a sword's transform in a hand's space is the identity —
	 * keeping a world position across the move would be exactly wrong. Anything
	 * wanting the other behaviour can read `world` first and write it back.
	 */
	add(child: GameObject): GameObject {
		if (child === this) throw new Error(`'${this.name}' cannot be its own parent`);
		for (let up: GameObject | null = this; up; up = up.parentObject) {
			if (up === child) throw new Error(`'${child.name}' is already above '${this.name}'`);
		}

		child.parentObject?.remove(child);
		child.parentObject = this;
		this.childList.push(child);
		return child;
	}

	/** Detach `child`, leaving it parentless and alive. */
	remove(child: GameObject): boolean {
		const at = this.childList.indexOf(child);
		if (at < 0) return false;
		this.childList.splice(at, 1);
		child.parentObject = null;
		return true;
	}

	/** The first descendant with this name, breadth-first, or null. */
	find(name: string): GameObject | null {
		const queue: GameObject[] = [...this.childList];
		for (let i = 0; i < queue.length; i++) {
			const object = queue[i]!;
			if (object.name === name) return object;
			queue.push(...object.childList);
		}
		return null;
	}

	/** This object and everything under it, parents before children. */
	*walk(): Generator<GameObject> {
		yield this;
		for (const child of this.childList) yield* child.walk();
	}

	/* ----------------------------------------------------------- components -- */

	/** Construct `ctor(this, ...args)`, attach it, and return it. */
	addComponent<T extends Component, A extends unknown[]>(
		ctor: ComponentClass<T, A>,
		...args: A
	): T {
		return this.attachComponent(new ctor(this, ...args));
	}

	/**
	 * Attach one that is already built, setting the fields it exposes.
	 *
	 * `values` is what a prefab said, by field name — `{ bone: 'hand.R' }` —
	 * and a name the component never declared throws, because the prefab is
	 * wrong and this is the moment to find out. A component that exposes
	 * nothing takes no values.
	 *
	 * Exposed fields are markers until they are resolved, so that happens here
	 * and before `onAttach`: a component's first hook sees numbers.
	 */
	attachComponent<T extends Component>(
		component: T,
		values: Readonly<Record<string, unknown>> = {},
	): T {
		resolveParameters(component);
		applyParameters(component, values, (bad, known) => {
			throw new Error(
				`${component.typeName} on '${this.name}' has no parameter '${bad}';` +
					` it has ${known.length > 0 ? known.join(', ') : 'none'}`,
			);
		});
		this.componentList.push(component);
		component.onAttach();
		return component;
	}

	/**
	 * Put one component where another is, keeping its place in the list.
	 *
	 * Components update in list order and `getComponent` answers with the first
	 * match, so the position is part of what a component has. A hot reload,
	 * which replaces a script instance with a newly compiled one, uses this to
	 * keep the object's order across a save.
	 *
	 * The old one is detached and the new one attached, in that order, so the
	 * pair sees the same list it would see for an ordinary remove and add.
	 */
	replaceComponent(existing: Component, next: Component): boolean {
		const at = this.componentList.indexOf(existing);
		if (at < 0) return false;
		this.componentList[at] = next;
		existing.onDetach();
		next.onAttach();
		return true;
	}

	/** The first component of this type, or null. */
	getComponent<T extends Component>(ctor: abstract new (...args: never[]) => T): T | null {
		for (const component of this.componentList) {
			if (component instanceof ctor) return component;
		}
		return null;
	}

	/** Every component of this type, in the order they were attached. */
	getComponents<T extends Component>(ctor: abstract new (...args: never[]) => T): T[] {
		return this.componentList.filter((one): one is T => one instanceof ctor);
	}

	/**
	 * The first component of this type on this object or any ancestor.
	 *
	 * What a prop uses to find the body carrying it, and what a script will use
	 * to reach the actor it is a behaviour of.
	 */
	getComponentInParent<T extends Component>(ctor: abstract new (...args: never[]) => T): T | null {
		for (let up: GameObject | null = this; up; up = up.parentObject) {
			const found = up.getComponent(ctor);
			if (found) return found;
		}
		return null;
	}

	/**
	 * The first component of this type on this object or anywhere under it.
	 *
	 * Depth-first, parents before children, which is the order everything else
	 * here walks in — so "the first" means the same thing as it does in
	 * `update` and in `walk`.
	 */
	getComponentInChildren<T extends Component>(
		ctor: abstract new (...args: never[]) => T,
	): T | null {
		for (const object of this.walk()) {
			const found = object.getComponent(ctor);
			if (found) return found;
		}
		return null;
	}

	/** Every component of this type on this object and everything under it. */
	getComponentsInChildren<T extends Component>(ctor: abstract new (...args: never[]) => T): T[] {
		const found: T[] = [];
		for (const object of this.walk()) found.push(...object.getComponents(ctor));
		return found;
	}

	/** Detach one component, firing its `onDetach`. */
	removeComponent(component: Component): boolean {
		const at = this.componentList.indexOf(component);
		if (at < 0) return false;
		this.componentList.splice(at, 1);
		component.onDetach();
		return true;
	}

	/* ------------------------------------------------------------ lifecycle -- */

	/** Every component's `update`, then every child's. */
	update(dt: number): void {
		for (const component of this.componentList) component.update(dt);
		// Indexed rather than iterated: a component may destroy a sibling
		// object, and a script that spawns one during its own update should not
		// have the new object updated in the frame it was made.
		const count = this.childList.length;
		for (let i = 0; i < count && i < this.childList.length; i++) {
			this.childList[i]!.update(dt);
		}
	}

	/** Resolve `world` for this object and everything under it. */
	solve(parent: WorldTransform | null = this.parentObject?.world ?? null): void {
		composeWorld(this.world, parent, this.transform);
		for (const child of this.childList) child.solve(this.world);
	}

	/**
	 * Take this object and everything under it out of the scene.
	 *
	 * Children first, and components before the object leaves its parent, so
	 * everything torn down can still see where it was — a component that
	 * registered itself somewhere has to be able to find its way back out.
	 */
	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;

		// A copy, because each child takes itself out of this list on its way
		// down. Not spliced first: unparenting before the hooks run would hand
		// every component a parentless object, which is the one thing this
		// order exists to prevent.
		for (const child of [...this.childList]) child.destroy();
		for (const component of this.componentList.splice(0)) component.onDetach();

		this.parentObject?.remove(this);
	}
}
