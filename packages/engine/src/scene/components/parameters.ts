/*
 * The fields a component exposes, and why they cannot simply be read off it.
 *
 * What a component DOES is code and belongs in a file. Its TUNING is not: how
 * fast this particular wanderer walks, how far this particular bat will chase,
 * which bone a prop hangs from, are values a prefab or an editor should be able
 * to set without anybody editing the class. So a component marks the fields it
 * is willing to have set:
 *
 *     export class Wander extends Script {
 *       speed = param(1.5, { min: 0, max: 6 });
 *     }
 *
 * and a prefab sets them by name:
 *
 *     - { type: script, script: Wander, speed: 3 }
 *
 * Scripts are the common case and not the only one: any component may declare
 * them, and `GameObject.attachComponent` resolves the markers of anything
 * attached to it.
 *
 * ## What is exposed, and what is not
 *
 * A declared field, and nothing else. A method is not exposed, a getter is not
 * exposed, and a plain field is not exposed — `param()` is the whole of the
 * opt-in, and a class that declares none exposes none. An editor showing a
 * component therefore shows what the class offered rather than everything it
 * happens to hold.
 *
 * Unity draws the same line by a rule instead of a marker: a public instance
 * FIELD of a serialisable type is in the inspector, as is a private one marked
 * `[SerializeField]`. A property is not a field, so `public float CurrentHealth
 * { get; set; }` is not in it; a method is not a field, so `CanPickup()` is not
 * in it; and `public UnityAction<float, GameObject> OnDamaged` holds functions
 * rather than data, so neither is that. `[Tooltip("...")]` labels a field that
 * is already exposed rather than exposing one, which is what `hint` is here.
 *
 * The line is in the same place. It is drawn per field rather than per type,
 * because a rule about types needs a list of the types it accepts, and that
 * list is a thing to maintain.
 *
 * ## Why this is not a decorator
 *
 * `@serialize() speed = 1.5` is the obvious spelling, and what it would cost
 * here is worth writing down, because the answer is not "decorators do not
 * work".
 *
 * Decorators DO work here. Scripts are compiled by esbuild and by nothing else,
 * and `@on(Damage)` in `events.ts` is one — see its header for what a decorator
 * buys where it fits. What follows is why it does not fit a parameter, and the
 * answer is about FIELDS rather than about decorators.
 *
 * The kind esbuild implements is the LEGACY design, `(target, key)`. A legacy
 * decorator on a field is handed the prototype and the name and nothing else.
 * It never sees `= 1.5`. So the default would have to be written twice —
 * `@serialize({ default: 1.5 }) speed = 1.5` — and the two would drift, which
 * is exactly the duplication this file exists to remove.
 *
 * And a field under ES2022 semantics is defined on the INSTANCE, so an accessor
 * a decorator installed on the prototype is shadowed and never runs. Undoing
 * that means `useDefineForClassFields: false`, a change to how every class field
 * in this repository initialises, made for one file's syntax.
 *
 * A method has neither problem: it is already on the prototype, and it carries
 * no value to lose. That is the whole of the difference between this file and
 * `events.ts`.
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

import { GameObject } from '../GameObject.js';

/**
 * A literal widened back to its kind.
 *
 * `param('foe')` infers `T` as the literal type `'foe'`, and a field typed
 * `'foe'` is worse than useless: the entity file sets the wanderer's to
 * `player`, so the type would forbid a value the game actually produces, and
 * `this.faction === 'player'` would not compile. A parameter's type is its
 * KIND — a number, a flag, a string — because its whole purpose is that
 * somebody else supplies the value.
 */
export type Widen<T> = T extends number
	? number
	: T extends boolean
		? boolean
		: T extends string
			? string
			: never;

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

/**
 * One exposed field of one instance, with the value that instance holds.
 *
 * What a control is drawn from: the type says which control, the options say
 * how it is labelled and bounded, the default says what "unset" looks like,
 * and the value is what the slider sits at.
 */
export interface LiveParameter extends ParameterMeta {
	readonly value: unknown;
}

/**
 * A component class built from nothing but the object it goes on.
 *
 * Which every script is, and what `parametersOf` needs: a class it can build a
 * throwaway instance of to see what fields it declared. A component whose
 * constructor wants more than its object is fine and simply learns its schema
 * the other way, from the first instance somebody attaches — see
 * `learnParameters`.
 */
export type ComponentType<T extends object = object> = new (object: GameObject) => T;

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
): Widen<T> {
	return new Marker(value, options) as unknown as Widen<T>;
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
	learnParameters(instance);

	const target = instance as Record<string, unknown>;
	for (const key of Object.keys(target)) {
		const value = target[key];
		if (value instanceof Marker) target[key] = value.value;
	}
}

/**
 * Read a class's exposed fields off one instance of it, and remember them.
 *
 * The other way round from `parametersOf`, which builds an instance of its own
 * to look at. A component whose constructor takes more than its object — one
 * handed the mesh it draws — cannot be built that way, so the schema is taken
 * from the first instance that is resolved instead.
 *
 * Markers are gone after resolution, so this runs before it and only once per
 * class: a second instance finds the schema already known and reads nothing.
 */
export function learnParameters(instance: object): ParameterMeta[] {
	const constructor = instance.constructor as ComponentType;
	const known = cached.get(constructor);
	if (known) return known;

	const meta: ParameterMeta[] = [];
	const target = instance as Record<string, unknown>;
	for (const key of Object.keys(target)) {
		const value = target[key];
		if (!(value instanceof Marker)) continue;
		meta.push({ key, type: inferType(value.value), default: value.value, options: value.options });
	}
	cached.set(constructor, meta);
	return meta;
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
export function parametersOf(constructor: ComponentType): ParameterMeta[] {
	const hit = cached.get(constructor);
	if (hit) return hit;

	/*
	 * A probe instance, because the markers only exist once the field
	 * initialisers have run. There is no way to ask a class what its fields
	 * are without building one, which is why this is built rather than read.
	 */
	let probe: object;
	try {
		// On an object of its own, which is thrown away with it. A component is
		// built with the object it goes on; handing the probe a real one costs a
		// name and two arrays, and means a field initialiser that reads
		// `this.object` does not have to be written around.
		probe = new constructor(new GameObject('probe'));
	} catch {
		// A constructor that throws has no schema to offer. The host reports the
		// throw properly when it tries to build a real one.
		cached.set(constructor, []);
		return [];
	}

	// The probe's markers are still markers, which is what `learnParameters`
	// reads. Nothing resolves them: the probe is discarded here.
	return learnParameters(probe);
}

/** Just the names, in declaration order. */
export function parameterKeys(constructor: ComponentType): string[] {
	return parametersOf(constructor).map((one) => one.key);
}

/**
 * Copy values onto an instance, for every key it actually declared.
 *
 * Anything else is refused rather than written, and the refusal is the useful
 * part: a prefab setting `speeed: 3` should say so, not silently do nothing.
 * Where the refusal goes differs by caller — an attach throws, because the
 * prefab is wrong and the object is being built; a hot reload logs, because a
 * frame is running and a typo in an editor is a thing being typed.
 */
export function applyParameters(
	instance: object,
	values: Readonly<Record<string, unknown>>,
	onUnknown?: (key: string, known: readonly string[]) => void,
): void {
	const keys = parameterKeys(instance.constructor as ComponentType);
	const target = instance as Record<string, unknown>;
	for (const [key, value] of Object.entries(values)) {
		if (keys.includes(key)) target[key] = value;
		else onUnknown?.(key, keys);
	}
}

/** Set one declared field, or answer false because it was not declared. */
export function writeParameter(instance: object, key: string, value: unknown): boolean {
	if (!parameterKeys(instance.constructor as ComponentType).includes(key)) return false;
	(instance as Record<string, unknown>)[key] = value;
	return true;
}

/** The current values of an instance's exposed fields. */
export function readParameters(instance: object): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const key of parameterKeys(instance.constructor as ComponentType)) {
		out[key] = (instance as Record<string, unknown>)[key];
	}
	return out;
}

/** An instance's exposed fields, each with the value it currently holds. */
export function liveParameters(instance: object): LiveParameter[] {
	const target = instance as Record<string, unknown>;
	return parametersOf(instance.constructor as ComponentType).map((meta) => ({
		...meta,
		value: target[meta.key],
	}));
}
