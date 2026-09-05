/*
 * A prefab while it is being edited.
 *
 * `PrefabNode` is what the loader reads: frozen, and carrying for each
 * component the parsed `Node` it came from. Neither suits a tree somebody is
 * dragging objects around in, so the bench holds this instead — the same shape
 * with the fields as a plain record, an identity on every node, and operations
 * that return a new tree rather than editing one in place.
 *
 * ## Why every node carries an id
 *
 * Selection and React both need to say WHICH object, and a prefab has nothing
 * else that can: two children may share a name, an index changes the moment
 * anything is inserted above it, and a path through the tree stops naming the
 * same object the instant it moves. The id is made here, means nothing outside
 * this session, and is not written to the file.
 *
 * ## Why the operations copy
 *
 * A view re-renders when the tree it was handed is a different object. Editing
 * in place and asking for a redraw works until something holds a subtree across
 * a change — which is what an undo stack and a memoised row both do.
 */

import type { Emittable, PrefabNode } from '@hexdelve/engine';

/**
 * Three numbers as a file writes them.
 *
 * Not `Vec3` from `@hexdelve/shared`, which is a `Float32Array` for doing
 * maths with. A draft holds what will be written to YAML and read back by a
 * person, so it holds an ordinary array.
 */
export type Triple = [number, number, number];

/** One component on an object: a type, and whatever that type reads. */
export interface DraftComponent {
	readonly id: string;
	readonly type: string;
	/** Everything but `type`, as the file would carry it. */
	readonly fields: Readonly<Record<string, unknown>>;
}

/** One object in a prefab, and everything under it. */
export interface DraftNode {
	readonly id: string;
	readonly name: string;
	/** Metres, in the parent's space. */
	readonly at: Triple;
	/** Euler XYZ, in the parent's space. */
	readonly euler: Triple;
	readonly components: readonly DraftComponent[];
	readonly children: readonly DraftNode[];
}

let counter = 0;

/** An identity for this session. Not a name, and never written to a file. */
function nextId(prefix: string): string {
	counter += 1;
	return `${prefix}${counter}`;
}

const ZERO = (): Triple => [0, 0, 0];

export function draftFromPrefab(node: PrefabNode): DraftNode {
	return {
		id: nextId('o'),
		name: node.name,
		at: [...node.at] as Triple,
		euler: [...node.euler] as Triple,
		components: node.components.map((one) => ({
			id: nextId('c'),
			type: one.type,
			fields: one.fields.rest('type'),
		})),
		children: node.children.map(draftFromPrefab),
	};
}

/**
 * The tree as the file carries it.
 *
 * The same omissions the reader's defaults allow: a zero transform and an empty
 * child list are left out, and `components` is kept even when empty, because a
 * component list is what an object is for and an absent one reads as an
 * oversight rather than as a decision.
 */
export function draftToEmittable(node: DraftNode): Emittable {
	const zero = (v: Triple) => v.every((one) => one === 0);
	return {
		name: node.name,
		...(zero(node.at) ? {} : { at: [...node.at] }),
		...(zero(node.euler) ? {} : { euler: [...node.euler] }),
		components: node.components.map((one) => ({
			type: one.type,
			...(one.fields as Record<string, Emittable>),
		})),
		...(node.children.length === 0 ? {} : { children: node.children.map(draftToEmittable) }),
	};
}

/** A new object with nothing on it. */
export function emptyNode(name: string): DraftNode {
	return { id: nextId('o'), name, at: ZERO(), euler: ZERO(), components: [], children: [] };
}

export function newComponent(type: string, fields: Record<string, unknown> = {}): DraftComponent {
	return { id: nextId('c'), type, fields };
}

/* ------------------------------------------------------------------ finding */

export function findNode(root: DraftNode, id: string): DraftNode | null {
	if (root.id === id) return root;
	for (const child of root.children) {
		const found = findNode(child, id);
		if (found) return found;
	}
	return null;
}

/** The object one hangs from, or null for the root. */
export function parentOf(root: DraftNode, id: string): DraftNode | null {
	for (const child of root.children) {
		if (child.id === id) return root;
		const found = parentOf(child, id);
		if (found) return found;
	}
	return null;
}

/** Every id from one node down, itself included. */
export function subtreeIds(node: DraftNode, into: string[] = []): string[] {
	into.push(node.id);
	for (const child of node.children) subtreeIds(child, into);
	return into;
}

/** The names from the root down to one object, for a breadcrumb. */
export function pathTo(root: DraftNode, id: string): string[] | null {
	if (root.id === id) return [root.name];
	for (const child of root.children) {
		const under = pathTo(child, id);
		if (under) return [root.name, ...under];
	}
	return null;
}

/* ------------------------------------------------------------------ editing */

/** Rebuild the tree with one node replaced by whatever `edit` returns. */
function mapNode(root: DraftNode, id: string, edit: (node: DraftNode) => DraftNode): DraftNode {
	if (root.id === id) return edit(root);
	let changed = false;
	const children = root.children.map((child) => {
		const next = mapNode(child, id, edit);
		if (next !== child) changed = true;
		return next;
	});
	return changed ? { ...root, children } : root;
}

export function renameNode(root: DraftNode, id: string, name: string): DraftNode {
	return mapNode(root, id, (node) => ({ ...node, name }));
}

export function setTransform(
	root: DraftNode,
	id: string,
	part: 'at' | 'euler',
	axis: 0 | 1 | 2,
	value: number,
): DraftNode {
	return mapNode(root, id, (node) => {
		const next = [...node[part]] as Triple;
		next[axis] = value;
		return { ...node, [part]: next };
	});
}

/** Hang a new object under one, at the end. */
export function addChild(root: DraftNode, parentId: string, child: DraftNode): DraftNode {
	return mapNode(root, parentId, (node) => ({ ...node, children: [...node.children, child] }));
}

/**
 * Take one object out, with everything under it.
 *
 * The root cannot go: a prefab is one object and what hangs off it, so a tree
 * with no root is not an empty prefab but no prefab at all.
 */
export function removeNode(root: DraftNode, id: string): DraftNode {
	if (root.id === id) return root;
	return {
		...root,
		children: root.children.filter((child) => child.id !== id).map((child) => removeNode(child, id)),
	};
}

/**
 * Whether an object can be hung under another.
 *
 * False for the root, which has nowhere to go, and false for anything at or
 * under the object being moved: a tree that contained itself would recurse the
 * next time anything walked it, and the walk that found out would be the
 * renderer's.
 */
export function canMove(root: DraftNode, id: string, toParent: string): boolean {
	if (id === root.id) return false;
	const moving = findNode(root, id);
	if (!moving || !findNode(root, toParent)) return false;
	return !subtreeIds(moving).includes(toParent);
}

/**
 * Move one object under another, at an index among its children.
 *
 * An index past the end appends, which is what a drop below the last row means.
 */
export function moveNode(root: DraftNode, id: string, toParent: string, index = -1): DraftNode {
	if (!canMove(root, id, toParent)) return root;
	const moving = findNode(root, id);
	if (!moving) return root;

	const without = removeNode(root, id);
	return mapNode(without, toParent, (node) => {
		const children = [...node.children];
		children.splice(index < 0 || index > children.length ? children.length : index, 0, moving);
		return { ...node, children };
	});
}

/** Move one object up or down among its siblings. */
export function reorderNode(root: DraftNode, id: string, by: -1 | 1): DraftNode {
	const parent = parentOf(root, id);
	if (!parent) return root;
	const at = parent.children.findIndex((child) => child.id === id);
	const to = at + by;
	if (at < 0 || to < 0 || to >= parent.children.length) return root;
	return mapNode(root, parent.id, (node) => {
		const children = [...node.children];
		const [moving] = children.splice(at, 1);
		children.splice(to, 0, moving!);
		return { ...node, children };
	});
}

/* ------------------------------------------------------------- components -- */

export function addComponent(root: DraftNode, id: string, component: DraftComponent): DraftNode {
	return mapNode(root, id, (node) => ({ ...node, components: [...node.components, component] }));
}

export function removeComponent(root: DraftNode, id: string, componentId: string): DraftNode {
	return mapNode(root, id, (node) => ({
		...node,
		components: node.components.filter((one) => one.id !== componentId),
	}));
}

/**
 * Set one field on one component, or take it out.
 *
 * `undefined` removes it, which is how a control says "leave this to whatever
 * the component's own default is" — a field written with the default in it and
 * a field absent are the same to the loader, and only the second one stays
 * right when the default changes.
 */
export function setField(
	root: DraftNode,
	id: string,
	componentId: string,
	key: string,
	value: unknown,
): DraftNode {
	return mapNode(root, id, (node) => ({
		...node,
		components: node.components.map((one) => {
			if (one.id !== componentId) return one;
			const fields = { ...one.fields };
			if (value === undefined) delete fields[key];
			else fields[key] = value;
			return { ...one, fields };
		}),
	}));
}
