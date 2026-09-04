/*
 * Reading a parsed asset file, with somewhere to point when it is wrong.
 *
 * `parseYaml` gives back nested plain values. Walking those by hand is how a
 * loader ends up throwing "Cannot read properties of undefined" at whoever
 * mistyped `offest`, so nothing in this directory touches a `YamlValue`
 * directly. Everything goes through `Node`, which carries the file it came
 * from and the path it is at, and every accessor can therefore fail with the
 * one sentence the author needs:
 *
 *     humanoid.rig.yaml: bones[4].offset: expected 3 numbers, found 2
 *
 * Scalars are read through `evaluateExpression`, so anywhere a number is
 * wanted a string holding arithmetic will do — see expression.ts for why that
 * matters more than it sounds like it should.
 */

import { evaluateExpression, parseYaml, type Scope, type YamlMap, type YamlValue } from '@hexdelve/shared';

export class AssetError extends Error {
	readonly file: string;
	readonly at: string;

	constructor(file: string, at: string, message: string) {
		super(`${file}: ${at}: ${message}`);
		this.name = 'AssetError';
		this.file = file;
		this.at = at;
	}
}

export type Vec3 = readonly [number, number, number];

/** One value in an asset file, and where it lives. */
export class Node {
	readonly file: string;
	readonly at: string;
	readonly value: YamlValue;
	readonly scope: Scope;

	constructor(file: string, at: string, value: YamlValue, scope: Scope = {}) {
		this.file = file;
		this.at = at;
		this.value = value;
		this.scope = scope;
	}

	/** The root of a file. */
	static parse(source: string, file: string): Node {
		return new Node(file, '<root>', parseYaml(source, file));
	}

	/** The same node, with more names available to its expressions. */
	withScope(scope: Scope): Node {
		return new Node(this.file, this.at, this.value, { ...this.scope, ...scope });
	}

	get present(): boolean {
		return this.value !== null;
	}

	/** Whether this is a mapping, for the few places that accept two shapes. */
	get isMap(): boolean {
		return this.value !== null && typeof this.value === 'object' && !Array.isArray(this.value);
	}

	fail(message: string): never {
		throw new AssetError(this.file, this.at, message);
	}

	/* ------------------------------------------------------------ mappings -- */

	/**
	 * This node as a mapping.
	 *
	 * An ABSENT node reads as an empty one, so `entity.get('view').get('focusY')`
	 * is simply absent rather than an error about `view` — the whole point of
	 * an optional section being optional. A node that is present but is a list
	 * or a scalar is still a mistake and still says so.
	 */
	private asMap(): YamlMap {
		const value = this.value;
		if (value === null) return EMPTY;
		if (typeof value !== 'object' || Array.isArray(value)) {
			this.fail(`expected a mapping, found ${describe(value)}`);
		}
		return value;
	}

	keys(): string[] {
		return Object.keys(this.asMap());
	}

	/** A child, present or not. Reading a missing one fails where it is used. */
	get(key: string): Node {
		const map = this.asMap();
		const child = Object.prototype.hasOwnProperty.call(map, key) ? map[key]! : null;
		return new Node(this.file, join(this.at, key), child, this.scope);
	}

	/** A child that has to be there. */
	need(key: string): Node {
		const child = this.get(key);
		if (!child.present) {
			const known = this.keys().join(', ');
			child.fail(`required, and missing; this mapping has ${known || 'no keys'}`);
		}
		return child;
	}

	entries(): [string, Node][] {
		return this.keys().map((key) => [key, this.get(key)]);
	}

	/** The entries of a mapping, or none at all — an absent section is empty. */
	entriesOrEmpty(): [string, Node][] {
		return this.present ? this.entries() : [];
	}

	/** Refuse a key nobody reads, since a typo is otherwise silent. */
	only(...allowed: readonly string[]): this {
		if (!this.present) return this;
		for (const key of this.keys()) {
			if (allowed.includes(key)) continue;
			this.get(key).fail(`unknown key; this file accepts ${[...allowed].sort().join(', ')}`);
		}
		return this;
	}

	/* ------------------------------------------------------------ sequences -- */

	list(): Node[] {
		const value = this.value;
		if (!Array.isArray(value)) this.fail(`expected a list, found ${describe(value)}`);
		return value.map((item, i) => new Node(this.file, `${this.at}[${i}]`, item, this.scope));
	}

	/** A list, or nothing at all — which is not the same as an empty list. */
	listOrEmpty(): Node[] {
		return this.present ? this.list() : [];
	}

	/* -------------------------------------------------------------- scalars -- */

	text(): string {
		const value = this.value;
		if (typeof value !== 'string') this.fail(`expected a string, found ${describe(value)}`);
		return value;
	}

	textOr(fallback: string): string {
		return this.present ? this.text() : fallback;
	}

	/** A word from a fixed set, so a misspelling names its alternatives. */
	choice<T extends string>(allowed: readonly T[]): T {
		const value = this.text();
		if (!(allowed as readonly string[]).includes(value)) {
			this.fail(`'${value}' is not one of ${allowed.join(', ')}`);
		}
		return value as T;
	}

	/** A number, or a string of arithmetic that evaluates to one. */
	number(): number {
		const value = this.value;
		if (typeof value === 'number') {
			if (!Number.isFinite(value)) this.fail('expected a finite number');
			return value;
		}
		if (typeof value === 'string') {
			try {
				return evaluateExpression(value, this.scope);
			} catch (error) {
				this.fail(error instanceof Error ? error.message : String(error));
			}
		}
		return this.fail(`expected a number, found ${describe(value)}`);
	}

	numberOr(fallback: number): number {
		return this.present ? this.number() : fallback;
	}

	flag(fallback: boolean): boolean {
		if (!this.present) return fallback;
		const value = this.value;
		if (typeof value !== 'boolean') this.fail(`expected true or false, found ${describe(value)}`);
		return value;
	}

	vec3(): Vec3 {
		const items = this.list();
		if (items.length !== 3) this.fail(`expected 3 numbers, found ${items.length}`);
		return [items[0]!.number(), items[1]!.number(), items[2]!.number()];
	}

	vec3Or(fallback: Vec3): Vec3 {
		return this.present ? this.vec3() : fallback;
	}

	/**
	 * Every key except the ones named, as plain values.
	 *
	 * The escape hatch for a record whose shape is not this reader's to know.
	 * A script component's fields belong to the script it names — the reader
	 * has never heard of `speed`, and checking it against the class that
	 * declared it is the host's job, done by name and with a list of what the
	 * script does have. Everywhere else, `only` is the right tool and this is
	 * the wrong one.
	 */
	rest(...except: readonly string[]): Record<string, unknown> {
		const out: Record<string, unknown> = {};
		for (const [key, child] of this.entriesOrEmpty()) {
			if (!except.includes(key)) out[key] = child.raw();
		}
		return out;
	}

	/** This node's value, as the file wrote it. */
	raw(): unknown {
		return this.value;
	}

	/** A map of name to number — a blend mask, a palette, a set of metrics. */
	numbers(): Record<string, number> {
		const out: Record<string, number> = {};
		for (const [key, child] of this.entries()) out[key] = child.number();
		return out;
	}
}

const EMPTY: YamlMap = Object.freeze({});

function join(at: string, key: string): string {
	return at === '<root>' ? key : `${at}.${key}`;
}

function describe(value: YamlValue): string {
	if (value === null) return 'nothing';
	if (Array.isArray(value)) return 'a list';
	switch (typeof value) {
		case 'object':
			return 'a mapping';
		case 'string':
			return `the string '${value}'`;
		default:
			return String(value);
	}
}
