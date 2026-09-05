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

import type { EntityDocument, AnimationRequest } from './entity.js';
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
 * Two, which lets `{ procedural: stride, args: { amp: 1 }, label: Walk }` sit
 * on its line — an animation entry is a single declaration and the args are
 * part of it — while keeping an object tree in block form, since a whole
 * prefab on one line is a prefab nobody can read or diff.
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
 * and is an ordinary character on a line of its own. A blurb reading
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

/** One `animations` entry, in whichever of the three shapes it was read as. */
function writeAnimation(request: AnimationRequest): Emittable {
	const options = {
		...(request.label === null ? {} : { label: request.label }),
		...(request.sync === null ? {} : { sync: request.sync }),
		...(request.contacts === null ? {} : { contacts: [...request.contacts] }),
	};

	if (request.kind === 'procedural') {
		return {
			procedural: request.procedural,
			...(Object.keys(request.args).length === 0 ? {} : { args: { ...request.args } }),
			...(request.duration === null ? {} : { duration: request.duration }),
			...options,
		};
	}

	// A clip with nothing said about it is the path and nothing else, which is
	// how most of them are written and what the reader accepts bare.
	if (Object.keys(options).length === 0) return request.path;
	return { clip: request.path, ...options };
}

/**
 * A whole entity file.
 *
 * The key order is the schema's rather than the order a document happens to
 * carry, so two files written from here are diffable against each other and a
 * save never reorders what it did not change.
 */
export function writeEntity(document: EntityDocument): string {
	const animations = Object.fromEntries(
		document.animations.map((one) => [one.name, writeAnimation(one)]),
	);
	const blendTrees = Object.fromEntries(document.blendTrees.map((one) => [one.name, one.path]));

	return emitYaml({
		id: document.id,
		name: document.name,
		kind: document.kind,
		...(document.tags.length === 0 ? {} : { tags: [...document.tags] }),
		...(document.blurb === null ? {} : { blurb: document.blurb }),
		...(document.rig === null ? {} : { rig: document.rig }),
		mesh: document.mesh,
		...(document.animations.length === 0 ? {} : { animations }),
		...(document.blendTrees.length === 0 ? {} : { blendTrees }),
		...(document.attach === null ? {} : { attach: { ...document.attach } }),
		...(document.ground === null ? {} : { ground: { ...document.ground } }),
		...(Object.keys(document.view).length === 0 ? {} : { view: { ...document.view } }),
		object: writePrefabNode(document.prefab),
	});
}
