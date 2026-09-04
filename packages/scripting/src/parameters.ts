/*
 * The fields a script exposes, and why they cannot simply be read off it.
 *
 * A script's behaviour is code and belongs in a file. Its TUNING is not: how
 * fast this particular wanderer walks, how far this particular bat will chase,
 * are numbers a prefab should be able to set without anybody editing the
 * script. So a script marks the fields it is willing to have set:
 *
 *     export class Wander extends Script {
 *       speed = param(1.5, { min: 0, max: 6 });
 *     }
 *
 * and a prefab sets them by name:
 *
 *     - { type: script, script: Wander, speed: 3 }
 *
 * ## Why this is not a decorator
 *
 * `@serialize() speed = 1.5` is the obvious spelling, and what it would cost
 * here is worth writing down, because the answer is not "decorators do not
 * work".
 *
 * There are two kinds. The TC39 STANDARD ones — `(value, context)` — are what
 * TypeScript emits by default, and oxc, which is what Vite 8 transforms with,
 * does not implement them: a file carrying one is passed through untransformed
 * and then fails to parse as JavaScript. The LEGACY ones — `(target, key)`,
 * the pre-standard design — oxc does implement, behind
 * `oxc: { transform: { decorator: { legacy: true } } }`, and they compile
 * correctly in a Vite build.
 *
 * Three things stand in the way of taking that road. Legacy decorators want
 * `useDefineForClassFields: false`, which is a change to how EVERY class field
 * in this repository initialises, made for one file's syntax. Vitest does not
 * pass that oxc option through to its own transform, so a decorated field
 * would compile in the app and fail in the tests. And the option would have to
 * be repeated in the browser compiler as well, which makes the script format
 * hostage to three build tools agreeing — the wrong shape for a file whose
 * whole point is that it can be edited and reloaded.
 *
 * So a parameter declares itself by its VALUE instead. `param(1.5, { min: 0 })`
 * returns something that is typed as a number and is, until the host resolves
 * it, a marker carrying the default and the hints. Resolving happens once, when
 * an instance is built: the marker is replaced by its default, and the class
 * learns the field's name from where the marker was sitting. TypeScript has no
 * runtime field reflection, and this is the way to get it without asking any
 * compiler for anything.
 *
 * The default therefore lives in one place, which was the point — a default
 * repeated in a decorator is the same number written twice, and the two drift.
 *
 * ## Why the overrides are kept apart from the instance
 *
 * A hot reload throws the instance away and builds a new one from new code. A
 * value somebody set has to survive that; a value nobody set has to NOT
 * survive it, or editing a default in the source would never take effect. So
 * the host keeps the overrides it was given and re-applies exactly those,
 * and everything else adopts whatever the new code says.
 */

/** What kind of field this is, inferred from what it was initialised to. */
export type ParameterType = 'number' | 'boolean' | 'string';

/** Hints for whoever puts a control on it. */
export interface ParameterOptions {
	label?: string;
	min?: number;
	max?: number;
	step?: number;
	hint?: string;
}

/** One exposed field: its name, its type, its default, and those hints. */
export interface ParameterMeta {
	readonly key: string;
	readonly type: ParameterType;
	readonly default: unknown;
	readonly options: ParameterOptions;
}

/** Anything constructible with no arguments — which every script is. */
export type ScriptClass<T extends object = object> = new () => T;

/**
 * What `param` really returns, until it is resolved.
 *
 * A class rather than a plain object so it can be told apart from a value a
 * script meant to keep — a script field holding `{ value: 1 }` is a script
 * field, and only this is a declaration.
 */
class Marker {
	constructor(
		readonly value: unknown,
		readonly options: ParameterOptions,
	) {}
}

const cached = new WeakMap<object, ParameterMeta[]>();

/**
 * Declare a field a prefab or an editor may set.
 *
 *     export class Wander extends Script {
 *       speed = param(1.5, { min: 0, max: 6, hint: 'Metres a second' });
 *     }
 *
 * Typed as whatever it was given, so the field reads and writes as a number
 * everywhere in the script. It is a marker only between construction and the
 * host resolving it, which is a window no script code runs in.
 */
export function param<T extends number | boolean | string>(
	value: T,
	options: ParameterOptions = {},
): T {
	return new Marker(value, options) as unknown as T;
}

/**
 * Replace an instance's markers with their defaults.
 *
 * Called once by the host, straight after construction and before anything
 * else touches the instance. A script whose fields were never resolved would
 * be a script doing arithmetic on a marker, so this is not optional and not
 * lazy.
 */
export function resolveParameters(instance: object): void {
	const target = instance as Record<string, unknown>;
	for (const key of Object.keys(target)) {
		const value = target[key];
		if (value instanceof Marker) target[key] = value.value;
	}
}

function inferType(value: unknown): ParameterType {
	if (typeof value === 'number') return 'number';
	if (typeof value === 'boolean') return 'boolean';
	return 'string';
}

/**
 * The exposed fields of a script class, with their types and defaults.
 *
 * Built from a probe instance, and cached per class — which is safe because a
 * hot reload produces a NEW class object, so a stale schema cannot outlive the
 * code it describes.
 */
export function parametersOf(constructor: ScriptClass): ParameterMeta[] {
	const hit = cached.get(constructor);
	if (hit) return hit;

	/*
	 * A probe instance, because the markers only exist once the field
	 * initialisers have run. There is no way to ask a class what its fields
	 * are without building one, which is why this is built rather than read.
	 */
	let probe: Record<string, unknown>;
	try {
		probe = new constructor() as Record<string, unknown>;
	} catch {
		// A constructor that throws has no schema to offer. The host reports the
		// throw properly when it tries to build a real one.
		cached.set(constructor, []);
		return [];
	}

	const meta: ParameterMeta[] = [];
	for (const key of Object.keys(probe)) {
		const value = probe[key];
		if (!(value instanceof Marker)) continue;
		meta.push({ key, type: inferType(value.value), default: value.value, options: value.options });
	}
	cached.set(constructor, meta);
	return meta;
}

/** Just the names, in declaration order. */
export function parameterKeys(constructor: ScriptClass): string[] {
	return parametersOf(constructor).map((one) => one.key);
}

/**
 * Copy values onto an instance, for every key it actually declared.
 *
 * Anything else is refused rather than written, and the refusal is the useful
 * part: a prefab setting `speeed: 3` should say so, not silently do nothing.
 */
export function applyParameters(
	instance: object,
	values: Readonly<Record<string, unknown>>,
	onUnknown?: (key: string, known: readonly string[]) => void,
): void {
	const keys = parameterKeys(instance.constructor as ScriptClass);
	const target = instance as Record<string, unknown>;
	for (const [key, value] of Object.entries(values)) {
		if (keys.includes(key)) target[key] = value;
		else onUnknown?.(key, keys);
	}
}

/** The current values of an instance's exposed fields. */
export function readParameters(instance: object): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const key of parameterKeys(instance.constructor as ScriptClass)) {
		out[key] = (instance as Record<string, unknown>)[key];
	}
	return out;
}
