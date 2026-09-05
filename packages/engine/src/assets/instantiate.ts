/*
 * Turning a prefab into objects, and the one place the engine admits it does
 * not know what a component is.
 *
 * The engine can read a prefab, walk it, place its objects and hang their
 * children off each other. What it cannot do is build an `item` or an `actor`,
 * because it has never heard of either — those are the game's, and a format
 * that had to be taught each one would be a format the client could not add to.
 * So a `ComponentRegistry` maps a type name to a factory, the client fills it
 * in, and this file dispatches.
 *
 * That dispatch is the whole of the engine's ignorance, and it is deliberate:
 * `@hexdelve/engine` knows how to draw hexagonal prisms and how to keep a tree,
 * and nothing in it knows what a bat is.
 *
 * ## The order of a spawn
 *
 * Objects first, then components, and children after their parent's components
 * — which is the ordering `GameObject.destroy` runs backwards.
 *
 *   1. the object exists, named and placed
 *   2. its components are built, in the order the file lists them
 *   3. its children are built the same way, under it
 *
 * A factory can therefore reach anything above it (`getComponentInParent` finds
 * a parent's actor, already built) and must not reach anything below it (a
 * child's components do not exist yet). That is not a limitation to work
 * around; it is what makes the file order mean something.
 */

import { GameObject } from '../scene/GameObject.js';
import type { Scene } from '../scene/Scene.js';
import { NO_ASSETS, type ComponentAssets } from './binding.js';
import { AssetError, type Node } from './document.js';
import { unknownComponent, type ComponentSpec, type PrefabNode } from './prefab.js';

/**
 * What a factory is given: the object it is attaching to, the record it was
 * declared with, and the run it is part of.
 */
export interface ComponentContext {
	readonly object: GameObject;
	/** The record, minus `type`. Read it with the same `Node` API asset files use. */
	readonly fields: Node;
	/**
	 * What the file references in that record loaded to.
	 *
	 * Empty for a record that named none, and for a prefab nothing resolved —
	 * a system, which has no assets to name. See assets/binding.ts.
	 */
	readonly assets: ComponentAssets;
	/** Which file this came from, for an error that names it. */
	readonly file: string;
	/**
	 * Whatever the caller passed to `instantiate`.
	 *
	 * The engine never looks inside it. It is how a factory reaches the things
	 * only the caller has — the entity being spawned, the world it is standing
	 * on, the deps a behaviour needs — without any of those becoming an engine
	 * concept.
	 */
	readonly extras: unknown;
}

export type ComponentFactory = (context: ComponentContext) => void;

/**
 * The types this build knows how to build.
 *
 * A map with a refusal on it, and the refusal is the point: a prefab naming a
 * type nobody registered fails by name, listing what there was, rather than
 * spawning an object that is quietly missing its behaviour.
 */
export class ComponentRegistry {
	private readonly factories = new Map<string, ComponentFactory>();

	register(type: string, factory: ComponentFactory): this {
		if (this.factories.has(type)) throw new Error(`component type '${type}' is already registered`);
		this.factories.set(type, factory);
		return this;
	}

	has(type: string): boolean {
		return this.factories.has(type);
	}

	get types(): string[] {
		return [...this.factories.keys()].sort();
	}

	/** Build one component onto an object, or say what was registered instead. */
	build(spec: ComponentSpec, context: ComponentContext): void {
		const factory = this.factories.get(spec.type);
		if (!factory) throw unknownComponent(context.file, spec.type, this.types);
		try {
			factory(context);
		} catch (error) {
			if (error instanceof AssetError) throw error;
			const why = error instanceof Error ? error.message : String(error);
			throw new AssetError(context.file, `components.${spec.type}`, why);
		}
	}
}

export interface InstantiateOptions {
	/** Where the copy goes. Defaults to the scene's root. */
	readonly parent?: GameObject;
	/** What to call the root, if not what the prefab calls it. */
	readonly name?: string;
	/** Handed to every factory, untouched. */
	readonly extras?: unknown;
	/** For the error messages. */
	readonly file?: string;
}

/**
 * Spawn a copy of a prefab, and return its root.
 *
 * A copy: nothing here is shared with the prefab or with any other copy, so
 * two wanderers can stand in different places. What IS shared is everything the
 * asset files own — a mesh is built once and drawn from many transforms, which
 * is the whole reason a mesh and an object are different things.
 */
export function instantiate(
	prefab: PrefabNode,
	scene: Scene,
	registry: ComponentRegistry,
	options: InstantiateOptions = {},
): GameObject {
	const file = options.file ?? '<prefab>';
	const parent = options.parent ?? scene.root;
	return spawn(prefab, parent, registry, file, options.extras, options.name);
}

function spawn(
	node: PrefabNode,
	parent: GameObject,
	registry: ComponentRegistry,
	file: string,
	extras: unknown,
	nameOverride?: string,
): GameObject {
	const object = parent.add(new GameObject(nameOverride ?? node.name));

	object.transform.setPosition(node.at[0], node.at[1], node.at[2]);
	if (node.euler[0] || node.euler[1] || node.euler[2]) {
		object.transform.setEuler(node.euler[0], node.euler[1], node.euler[2]);
	}

	for (const spec of node.components) {
		registry.build(spec, { object, fields: spec.fields, assets: spec.assets ?? NO_ASSETS, file, extras });
	}
	for (const child of node.children) spawn(child, object, registry, file, extras);

	return object;
}
