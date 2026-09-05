/*
 * Writing an asset file back out, checked against every asset file there is.
 *
 * The editor's entity bench builds an object tree and saves it, which means a
 * writer, and a writer is the one piece of this whose failure is silent: a
 * missing key or a mangled string produces a file that still parses and no
 * longer means what it did. Nothing here inspects the text it produces beyond
 * a couple of style checks. What it asserts is the property that matters —
 * reading what was written gives back the document that was written — over the
 * real files rather than over fixtures, because the fixtures would be written
 * by whoever wrote the emitter and would agree with it by construction.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
	emitYaml,
	readEntity,
	writeEntity,
	writePrefabNode,
	type EntityDocument,
	type Emittable,
	type PrefabNode,
} from '@hexdelve/engine';

const entityDir = resolve(import.meta.dirname, '..', 'public', 'assets', 'entities');

async function entityFiles(): Promise<string[]> {
	return (await readdir(entityDir)).filter((name) => name.endsWith('.entity.yaml')).sort();
}

/**
 * A document as plain data, so two of them can be compared.
 *
 * A `PrefabNode` carries the parsed `Node` each component was read from, and
 * two readings of the same text hold different `Node` objects — so the prefab
 * is compared as what it writes to, which is the only part of it a file
 * preserves anyway.
 */
function plain(document: EntityDocument): unknown {
	return { ...document, prefab: writePrefabNode(document.prefab) };
}

describe('writing an entity file', () => {
	it('has files to check', async () => {
		expect((await entityFiles()).length).toBeGreaterThan(5);
	});

	it('reads back as the document it was written from', async () => {
		for (const name of await entityFiles()) {
			const source = await readFile(join(entityDir, name), 'utf8');
			const first = readEntity(source, name);

			const written = writeEntity(first);
			const again = readEntity(written, name);

			expect(plain(again), name).toEqual(plain(first));
		}
	});

	/*
	 * Written twice is written the same. A writer whose output depends on
	 * anything but its input — key insertion order, a `Set` iteration — would
	 * make every save a diff, and the way that shows up is a file that changes
	 * when nothing about it changed.
	 */
	it('writes the same bytes the second time', async () => {
		for (const name of await entityFiles()) {
			const source = await readFile(join(entityDir, name), 'utf8');
			const once = writeEntity(readEntity(source, name));
			const twice = writeEntity(readEntity(once, name));
			expect(twice, name).toBe(once);
		}
	});
});

describe('the YAML it writes', () => {
	const emit = (value: Emittable) => emitYaml(value);

	it('puts a small record on one line and a structured one under its key', () => {
		expect(emit({ object: { components: [{ type: 'item' }] } })).toBe(
			'object:\n  components:\n    - { type: item }\n',
		);
	});

	it('quotes what would otherwise read as something else', () => {
		// Each of these parses as a non-string, or as a syntax error, unquoted.
		expect(emit({ a: 'yes', b: 'null', c: '12', d: '', e: 'a: b', f: "'quoted'" })).toBe(
			"a: 'yes'\nb: 'null'\nc: '12'\nd: ''\ne: 'a: b'\nf: '''quoted'''\n",
		);
	});

	it('leaves an apostrophe inside a word alone', () => {
		// Only a LEADING quote is an indicator, so this needs nothing.
		expect(emit({ blurb: "a wanderer's sword" })).toBe("blurb: a wanderer's sword\n");
	});

	it('leaves a path and a sentence alone', () => {
		expect(emit({ mesh: '../meshes/sword.mesh.yaml', blurb: 'Straight blade, cross guard' })).toBe(
			'mesh: ../meshes/sword.mesh.yaml\nblurb: Straight blade, cross guard\n',
		);
	});

	it('keeps one level of nesting on the line and breaks deeper ones', () => {
		// An animation entry is one declaration, args included.
		expect(emit({ walk: { procedural: 'stride', args: { amp: 1 } } })).toBe(
			'walk: { procedural: stride, args: { amp: 1 } }\n',
		);
		// An object tree is not, however short it happens to be.
		expect(emit({ object: { name: 'a', children: [{ name: 'b' }] } })).toBe(
			'object:\n  name: a\n  children:\n    - { name: b }\n',
		);
	});

	it('refuses a number that would not load', () => {
		expect(() => emit({ lift: Number.NaN })).toThrow(/cannot be written/);
		expect(() => emit({ lift: Number.POSITIVE_INFINITY })).toThrow(/cannot be written/);
	});
});

describe('writing an object tree', () => {
	const node = (over: Partial<PrefabNode>): PrefabNode => ({
		name: 'thing',
		at: [0, 0, 0],
		euler: [0, 0, 0],
		components: [],
		children: [],
		...over,
	});

	it('leaves out what the reader would supply anyway', () => {
		// A tree mostly does not move, and three zero lines on every object in
		// it would bury the ones that do.
		expect(writePrefabNode(node({}))).toEqual({ name: 'thing', components: [] });
	});

	it('keeps a transform that is not the identity', () => {
		expect(writePrefabNode(node({ at: [0, 1, 0] }))).toEqual({
			name: 'thing',
			at: [0, 1, 0],
			components: [],
		});
	});
});
