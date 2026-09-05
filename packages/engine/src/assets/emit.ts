/*
 * Asset files, written back out.
 *
 * Every other file in this directory reads. This one writes, because an editor
 * that can build an object tree has to be able to put it somewhere, and the
 * somewhere is the YAML the loader already reads.
 *
 * ## What it emits, and what it does not keep
 *
 * A file written here is the document, formatted: keys in the order the schema
 * lists them, and nothing else. Comments do not survive a rewrite, and neither
 * does an arithmetic expression — `tilt: pi / 2` is read as a number and
 * written back as `1.5707963267948966`, which loads to the same rotation. What
 * a rewrite guarantees is that reading the result gives the document that was
 * written, which is the property the round-trip test pins.
 *
 * ## The style
 *
 * Block mappings for structure, flow for the small records the tree already
 * writes inline — `{ type: item, lift: 0.2 }` and `[0, 0, 0]`. That is not
 * decoration: a component is one line in the files as they stand, and a writer
 * that exploded each one over four lines would make every save an unreadable
 * diff against a hand-written file.
 */

import type { ClipEvent, PoseEntry, PoseKey } from '../anim/clip.js';
import type { EntityDocument } from './entity.js';
import type { ComponentSpec, PrefabNode } from './prefab.js';

/** A value this writer can put in a file. */
export type Emittable =
	| string
	| number
	| boolean
	| null
	| readonly Emittable[]
	| { readonly [key: string]: Emittable };

/**
 * A list or map short enough to sit on one line.
 *
 * Measured in what it emits to rather than in how many entries it has: the
 * point is a line somebody can read, and `{ type: script, script: Character,
 * hp: 20, faction: player, power: 5 }` is five entries and still one thought.
 */
const INLINE_WIDTH = 96;

/**
 * How deep a value goes inline before it stops being one thought.
 *
 * Two, which lets `{ clip: ../clips/walk.clip.yaml, sync: true, contacts:
 * [0.25, 0.75] }` sit on its line — an animation entry is a single
 * declaration and its options are part of it — while keeping an object tree in
 * block form, since a whole prefab on one line is a prefab nobody can read or
 * diff.
 */
const INLINE_DEPTH = 2;

/** Something with no structure under it, which is what may go inline at all. */
function isScalar(value: Emittable): boolean {
	return value === null || typeof value !== 'object';
}

/** How many containers deep a value nests. A scalar is zero. */
function depth(value: Emittable): number {
	if (isScalar(value)) return 0;
	const children = Array.isArray(value)
		? value
		: Object.values(value as Record<string, Emittable>);
	return 1 + Math.max(0, ...children.map(depth));
}

/**
 * A number, as short as it can be written without changing it.
 *
 * `String` already gives the shortest representation that round-trips through
 * the parser, and the two cases it gets wrong for YAML are the infinities and
 * a NaN, none of which belongs in an asset file — a caller that produced one
 * has a bug upstream and is told so here rather than writing a file that will
 * not load.
 */
function emitNumber(value: number): string {
	if (!Number.isFinite(value)) throw new Error(`${value} cannot be written to an asset file`);
	return String(value);
}

/**
 * Whether a string can be written bare, in block context or inside a flow.
 *
 * The refusals are the ones that would change what the parser reads back: a
 * leading indicator, anything that would look like a number or a keyword, and
 * a `: ` or ` #` anywhere in it. Everything else — a path, a bone name, a
 * sentence with spaces in it — goes as it is, because quoting what does not
 * need quoting is how a written file stops looking like the hand-written ones
 * beside it.
 *
 * `,` and the brackets are refused only inside a flow, which is the whole of
 * the difference between the two contexts: a comma ends a value between braces
 * and is an ordinary character on a line of its own. A sentence such as
 * `Straight blade, cross guard` is the common case and quoting it would be
 * quoting for nothing.
 */
function bare(value: string, flow: boolean): boolean {
	if (value === '') return false;
	if (value !== value.trim()) return false;
	if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(value)) return false;
	if (/:\s|\s#/.test(value)) return false;
	if (flow && /[,[\]{}]/.test(value)) return false;
	// A bare word the parser would read as something other than text.
	if (/^(true|false|yes|no|on|off|null|~)$/i.test(value)) return false;
	if (value.endsWith(':')) return false;
	return Number.isNaN(Number(value));
}

function emitString(value: string, flow: boolean): string {
	if (bare(value, flow)) return value;
	return `'${value.replace(/'/g, "''")}'`;
}

function emitScalar(value: Emittable, flow: boolean): string {
	if (value === null) return 'null';
	if (typeof value === 'number') return emitNumber(value);
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (typeof value === 'string') return emitString(value, flow);
	throw new Error(`${typeof value} cannot be written to an asset file`);
}

/** One line: `[1, 2, 3]` or `{ a: 1, b: two }`. */
function emitFlow(value: Emittable): string {
	if (isScalar(value)) return emitScalar(value, true);
	if (Array.isArray(value)) return `[${value.map(emitFlow).join(', ')}]`;
	const entries = Object.entries(value as Record<string, Emittable>);
	if (entries.length === 0) return '{}';
	return `{ ${entries.map(([key, one]) => `${key}: ${emitFlow(one)}`).join(', ')} }`;
}

/**
 * True when this value should be written on the key's own line.
 *
 * A LIST goes inline only when every item is a scalar — `[0, 0, 0]` and
 * `[weapon]`. A list of records is the shape components and children take, and
 * those want one item a line whatever they measure: a component is the unit
 * somebody adds, removes and reads down a column, and a diff that moved two of
 * them on one line would say the line changed rather than which component did.
 *
 * A MAP goes inline on width and nesting alone, which is what keeps an
 * animation entry and an `attach` on their own lines.
 */
function fitsInline(value: Emittable): boolean {
	if (Array.isArray(value) && !value.every(isScalar)) return false;
	return depth(value) <= INLINE_DEPTH && emitFlow(value).length <= INLINE_WIDTH;
}

function emitValue(value: Emittable, indent: string, lines: string[]): void {
	if (Array.isArray(value)) {
		for (const one of value) {
			if (fitsInline(one)) {
				lines.push(`${indent}- ${emitFlow(one)}`);
				continue;
			}
			// The dash takes the place of the first two spaces of the item's
			// own indent, so its first key sits on the same line as the dash.
			const nested: string[] = [];
			emitValue(one, `${indent}  `, nested);
			lines.push(`${indent}- ${nested[0]!.slice(indent.length + 2)}`);
			for (const line of nested.slice(1)) lines.push(line);
		}
		return;
	}

	for (const [key, one] of Object.entries(value as Record<string, Emittable>)) {
		if (isScalar(one)) {
			lines.push(`${indent}${key}: ${emitScalar(one, false)}`);
			continue;
		}
		if (fitsInline(one)) {
			lines.push(`${indent}${key}: ${emitFlow(one)}`);
			continue;
		}
		lines.push(`${indent}${key}:`);
		// Indented under the key, list or map alike. YAML allows a list to sit
		// at its key's own indent, and the files in this tree do not.
		emitValue(one, `${indent}  `, lines);
	}
}

/** One value, as the whole of a file. */
export function emitYaml(value: Emittable): string {
	const lines: string[] = [];
	emitValue(value, '', lines);
	return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

/**
 * A clip, as the file the loader reads.
 *
 * Pose-major, because that is the shape a clip is authored in and a written
 * one has to sit beside a hand-written one without announcing which is which.
 * A pose emits only the bones that have a key at that moment, so a bone that
 * says nothing between two moments takes no room in either.
 *
 * `rig` is a path rather than an id: a clip names the skeleton its numbers
 * mean something on, and that is how every other file in the tree points at
 * one.
 */
export function writeClip(spec: ClipFile): string {
	const poses = spec.poses.map((pose) => ({
		t: pose.t,
		...(pose.e !== undefined ? { ease: pose.e } : {}),
		bones: Object.fromEntries(
			Object.entries(pose.p).map(([bone, entry]) => [bone, writePoseEntry(entry)]),
		),
	}));

	return emitYaml({
		id: spec.id,
		...(spec.name !== undefined ? { name: spec.name } : {}),
		rig: spec.rig,
		duration: spec.duration,
		loop: spec.loop,
		...(spec.events && spec.events.length > 0
			? { events: spec.events.map((event) => ({ t: event.t, name: event.name })) }
			: {}),
		poses,
	} as Emittable);
}

export interface ClipFile {
	readonly id: string;
	readonly name?: string;
	/** The rig this clip's numbers are about, as a path from the clip. */
	readonly rig: string;
	readonly duration: number;
	readonly loop: 'loop' | 'hold';
	readonly events?: readonly ClipEvent[];
	readonly poses: readonly PoseKey[];
}

/** Three numbers where that is all it is, and a mapping where it is not. */
function writePoseEntry(entry: PoseEntry): Emittable {
	if (Array.isArray(entry)) return [...entry] as Emittable;
	const record = entry as { rot?: readonly number[]; pos?: readonly number[]; e?: string };
	return {
		...(record.rot ? { rot: [...record.rot] } : {}),
		...(record.pos ? { pos: [...record.pos] } : {}),
		...(record.e !== undefined ? { ease: record.e } : {}),
	} as Emittable;
}

/**
 * A component record, flattened back to the mapping it was read from.
 *
 * `type` first because it is what the record is: a reader looking at a list of
 * them is looking for which is the actor and which is the script, and the type
 * leading every line is what makes that answerable by scanning down.
 */
export function writeComponent(spec: ComponentSpec): Emittable {
	return { type: spec.type, ...(spec.fields.rest('type') as Record<string, Emittable>) };
}

/**
 * One object and its subtree, as the mapping `readPrefabNode` reads.
 *
 * `at` and `euler` are dropped when they are zero and `children` when there are
 * none, because the reader supplies exactly those defaults — writing them would
 * put three noise lines on every object in a tree that mostly does not move.
 * `components` is written even when empty, since a component list is what an
 * object is for and an absent one reads as an oversight.
 */
export function writePrefabNode(node: PrefabNode): Emittable {
	const zero = (v: readonly number[]) => v.every((one) => one === 0);
	return {
		name: node.name,
		...(zero(node.at) ? {} : { at: [...node.at] }),
		...(zero(node.euler) ? {} : { euler: [...node.euler] }),
		components: node.components.map(writeComponent),
		...(node.children.length === 0
			? {}
			: { children: node.children.map(writePrefabNode) }),
	};
}

/**
 * A whole entity file.
 *
 * The key order is the schema's rather than the order a document happens to
 * carry, so two files written from here are diffable against each other and a
 * save never reorders what it did not change.
 *
 * `prefab` replaces the document's own object tree, which is how an editor
 * holding a tree in a shape of its own saves it without first turning it back
 * into a `PrefabNode` — a `PrefabNode` carries the parsed `Node` each component
 * was read from, and an edited tree has no such thing to carry.
 */
export function writeEntity(document: EntityDocument, prefab?: Emittable): string {
	return emitYaml({
		id: document.id,
		name: document.name,
		...(document.tags.length === 0 ? {} : { tags: [...document.tags] }),
		...(Object.keys(document.view).length === 0 ? {} : { view: { ...document.view } }),
		object: prefab ?? writePrefabNode(document.prefab),
	});
}
