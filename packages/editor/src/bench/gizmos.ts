/*
 * Where the objects of a prefab are, and how they are drawn.
 *
 * A prefab is a tree of transforms and mostly nothing else: an object with no
 * mesh on it draws nothing, which is exactly the case somebody building a
 * hierarchy is looking at. A grip on a hand and an empty named `muzzle` have no
 * appearance at all, so without markers the tree view is the only evidence they
 * exist and the viewport is a picture of a creature with nothing to select in
 * it.
 *
 * So every object gets an origin and a set of axes, drawn over the scene rather
 * than into it. They are not part of the entity and must not read as part of
 * it — an axis buried in a shoulder is worse than no axis, because it looks
 * like geometry.
 */

import { HEX_FLAG_UNLIT, type HexInstances } from '@hexdelve/engine';
import { quat, vec3, type Quat, type Vec3 } from '@hexdelve/shared';

import type { DraftNode } from './entitydraft.js';

/** One object, placed, with enough to draw it and to hit-test it later. */
export interface PlacedNode {
	readonly id: string;
	readonly name: string;
	readonly depth: number;
	/** In the prefab's own space, before the stand is turned. */
	readonly position: Vec3;
	readonly rotation: Quat;
}

/**
 * The tree, flattened into world transforms.
 *
 * The composition a scene graph does, done here instead, because the thing
 * being drawn is a document rather than a scene: the draft is edited between
 * frames and instantiating it to read three positions off it would rebuild
 * every component on every keystroke.
 */
export function placeNodes(
	root: DraftNode,
	parentPosition: Vec3 = vec3.vec3(),
	parentRotation: Quat = quat.identity(quat.quat()),
	depth = 0,
	into: PlacedNode[] = [],
): PlacedNode[] {
	const rotation = quat.multiply(
		quat.quat(),
		parentRotation,
		quat.fromEulerXYZ(quat.quat(), root.euler[0], root.euler[1], root.euler[2]),
	);
	const offset = quat.rotateVec3(
		vec3.vec3(),
		parentRotation,
		vec3.vec3(root.at[0], root.at[1], root.at[2]),
	);
	const position = vec3.add(vec3.vec3(), parentPosition, offset);

	into.push({ id: root.id, name: root.name, depth, position, rotation });
	for (const child of root.children) placeNodes(child, position, rotation, depth + 1, into);
	return into;
}

/** How long an axis reaches, in metres. Short enough to sit inside a torso. */
const AXIS_LENGTH = 0.16;
const AXIS_THICKNESS = 0.008;

/** X, Y, Z. The three the transform fields are labelled with, in that order. */
const AXIS_COLOURS = [0xe0574b, 0x62c462, 0x4a90e2] as const;

/** The origin marker, bigger and yellow when the object is the selected one. */
const ORIGIN_COLOUR = 0xbfc7cc;
const SELECTED_COLOUR = 0xffc94a;

/**
 * One object's marker, turned with the stand.
 *
 * The turntable is applied here rather than being folded into the placement,
 * because the placement is what the inspector's numbers mean — the prefab's own
 * space — and only the drawing turns.
 */
export function emitGizmo(
	out: HexInstances,
	node: PlacedNode,
	turntable: number,
	selected: boolean,
): void {
	const spin = quat.fromYaw(quat.quat(), turntable);
	const at = quat.rotateVec3(vec3.vec3(), spin, node.position);
	const rotation = quat.multiply(quat.quat(), spin, node.rotation);

	const size = selected ? 0.05 : 0.03;
	out.push(at[0], at[1], at[2], size, size, size, selected ? SELECTED_COLOUR : ORIGIN_COLOUR, {
		alpha: selected ? 0.95 : 0.7,
		flags: HEX_FLAG_UNLIT,
		rotation,
	});

	// Axes only on the selected object. Three per object across a whole tree is
	// a thicket, and the question they answer — which way is this one facing —
	// is only ever asked about the one being edited.
	if (!selected) return;

	const half = AXIS_LENGTH / 2;
	for (let axis = 0; axis < 3; axis++) {
		const along = vec3.vec3(axis === 0 ? half : 0, axis === 1 ? half : 0, axis === 2 ? half : 0);
		const centre = vec3.add(vec3.vec3(), at, quat.rotateVec3(vec3.vec3(), rotation, along));
		out.push(
			centre[0],
			centre[1],
			centre[2],
			axis === 0 ? half : AXIS_THICKNESS,
			axis === 1 ? half : AXIS_THICKNESS,
			axis === 2 ? half : AXIS_THICKNESS,
			AXIS_COLOURS[axis]!,
			{ alpha: 0.95, flags: HEX_FLAG_UNLIT, rotation },
		);
	}
}

/** Every marker in a tree, with one of them picked out. */
export function emitGizmos(
	out: HexInstances,
	placed: readonly PlacedNode[],
	turntable: number,
	selectedId: string | null,
): void {
	for (const node of placed) emitGizmo(out, node, turntable, node.id === selectedId);
}
