/*
 * A tree of objects and what each one exposes, for something to draw controls
 * from.
 *
 * An editor showing a prefab shows two things: the hierarchy, and — for the
 * object selected in it — every component with the fields that component
 * offers. Both are already in the scene graph; this is one walk that puts them
 * in the shape a view wants, so a view is a view and does not also have to know
 * how a parameter is declared.
 *
 * ## The live component is in the view
 *
 * Alongside the values rather than instead of them. The editor runs the game in
 * its own page, so the thing under the tree view is the running object: a
 * control writes with `component.setParameter(...)` and the change is in the
 * next frame. A snapshot with no references would have to be re-associated on
 * every write, by an id nothing needs otherwise.
 *
 * What that costs is that a view is a reading of one moment. Objects are
 * destroyed and hot reloads replace script instances, so a view is taken when
 * the selection changes and taken again when the world says something changed.
 * It is not a model to hold and edit.
 */

import type { GameObject } from '../GameObject.js';
import type { Component } from './Component.js';
import type { LiveParameter } from './parameters.js';

/** One component of one object: what it is, and what it offers. */
export interface ComponentView {
	readonly component: Component;
	/** The class name — for a script, the name a prefab asks for it by. */
	readonly type: string;
	/** Empty for a component that declares nothing, which is most of them. */
	readonly parameters: readonly LiveParameter[];
}

/** One object: what a tree view puts on a row, and what hangs under it. */
export interface ObjectView {
	readonly object: GameObject;
	readonly id: number;
	readonly name: string;
	readonly components: readonly ComponentView[];
	readonly children: readonly ObjectView[];
}

/** What one component offers, with the values it currently holds. */
export function inspectComponent(component: Component): ComponentView {
	return {
		component,
		type: component.typeName,
		parameters: component.parameters(),
	};
}

/** The same for every component on one object, in attachment order. */
export function inspectComponents(object: GameObject): ComponentView[] {
	return object.components.map(inspectComponent);
}

/**
 * One object, its components, and everything under it.
 *
 * The whole subtree, because a prefab is small and a view that fetched a level
 * at a time would need a second call for every twist of a triangle. A scene is
 * inspected by inspecting its root.
 */
export function inspectObject(object: GameObject): ObjectView {
	return {
		object,
		id: object.id,
		name: object.name,
		components: inspectComponents(object),
		children: object.children.map(inspectObject),
	};
}
