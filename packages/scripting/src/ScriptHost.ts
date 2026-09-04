/*
 * The thing that owns running scripts, and swaps them out underneath.
 *
 * A `ScriptComponent` holds a number. Everything else — which class that number
 * means, whether an instance of it currently exists, what its parameters were
 * set to, whether it threw last frame — is here. That indirection is the whole
 * trick: a hot reload replaces every instance behind its id, and the components
 * that point at them never notice.
 *
 *     component ---id---> registration ---> instance (replaced on every reload)
 *                              |
 *                              +--> typeName, parameters (kept across reloads)
 *
 * ## Where the classes come from
 *
 * A `ScriptProvider`, and there are two. The client's is a table of classes
 * bundled at build time, which costs nothing and cannot reload. The editor's
 * compiles TypeScript in the browser and can, which is why the interface exists
 * at all: the game is the same either way, and only the editor pays for the
 * compiler.
 *
 * ## Failure discipline
 *
 * Three rules, and each is there because the alternative is worse than the bug.
 *
 *   a script that throws in `tick` is MUTED until the next reload. Left
 *   running it throws sixty times a second and the console becomes useless;
 *   killed outright it cannot be fixed by saving the file.
 *
 *   a script whose class is missing stays REGISTERED, with no instance. Its
 *   file may be halfway through being written. When it compiles, it starts.
 *
 *   a reload that fails to produce a class the provider had before does not
 *   destroy the registration. It is the same case as the one above, arrived at
 *   from the other direction.
 */

import {
	applyParameters,
	parametersOf,
	readParameters,
	resolveParameters,
	type ParameterMeta,
	type ScriptClass,
} from './parameters.js';
import type { Script, ScriptBinding } from './Script.js';

/** Where a host gets its classes. */
export interface ScriptProvider {
	/** The class for a name, or null if this provider has not got one. */
	resolve(typeName: string): ScriptClass<Script> | null;
	/** Every name it can currently resolve, for an error that lists them. */
	readonly names: readonly string[];
}

export interface ScriptHostOptions {
	/** Where the host's own complaints go. Defaults to the console. */
	readonly log?: (message: string) => void;
}

/** One exposed field, with the value it currently holds. */
export interface LiveParameter extends ParameterMeta {
	readonly value: unknown;
}

interface Registration {
	readonly id: number;
	readonly typeName: string;
	readonly binding: Omit<ScriptBinding, 'log'>;
	instance: Script | null;
	/** Only what somebody actually set. See `parameters.ts` for why. */
	readonly overrides: Record<string, unknown>;
	muted: boolean;
}

export class ScriptHost {
	private readonly registrations = new Map<number, Registration>();
	private readonly log: (message: string) => void;
	private provider: ScriptProvider;
	private nextId = 1;

	constructor(provider: ScriptProvider, options: ScriptHostOptions = {}) {
		this.provider = provider;
		this.log = options.log ?? ((message) => console.warn(`[script] ${message}`));
	}

	/** How many scripts are registered, and how many of those are running. */
	get census(): { registered: number; live: number; muted: number } {
		let live = 0;
		let muted = 0;
		for (const one of this.registrations.values()) {
			if (one.instance) live++;
			if (one.muted) muted++;
		}
		return { registered: this.registrations.size, live, muted };
	}

	/**
	 * Register a script by type name and try to build it.
	 *
	 * Returns an id even when the class is not there. A prefab may name a
	 * script whose file has not compiled yet, and refusing to spawn the object
	 * over it would make one broken script take out a whole scene.
	 */
	register(
		typeName: string,
		binding: Omit<ScriptBinding, 'log'>,
		overrides: Readonly<Record<string, unknown>> = {},
	): number {
		const registration: Registration = {
			id: this.nextId++,
			typeName,
			binding,
			instance: null,
			overrides: { ...overrides },
			muted: false,
		};
		this.registrations.set(registration.id, registration);
		this.build(registration);
		return registration.id;
	}

	/** Advance one script. Silent for one that is missing or muted. */
	tick(id: number, dt: number): void {
		const registration = this.registrations.get(id);
		if (!registration?.instance || registration.muted) return;
		try {
			registration.instance.tick(dt);
		} catch (error) {
			registration.muted = true;
			this.log(`${this.where(registration)}.tick threw, muted until reload: ${why(error)}`);
		}
	}

	/** Tear one down and forget it. */
	destroy(id: number): void {
		const registration = this.registrations.get(id);
		if (!registration) return;
		this.registrations.delete(id);
		this.unload(registration);
	}

	/** The exposed fields of one live script, with their current values. */
	parameters(id: number): LiveParameter[] {
		const registration = this.registrations.get(id);
		if (!registration?.instance) return [];
		const values = readParameters(registration.instance);
		return parametersOf(registration.instance.constructor as ScriptClass).map((meta) => ({
			...meta,
			value: values[meta.key] ?? registration.overrides[meta.key] ?? meta.default,
		}));
	}

	/** Set one field, and remember it across every reload from here on. */
	setParameter(id: number, key: string, value: unknown): void {
		const registration = this.registrations.get(id);
		if (!registration) return;
		registration.overrides[key] = value;
		if (registration.instance) {
			applyParameters(registration.instance, { [key]: value }, (bad, known) =>
				this.log(`${this.where(registration)} has no parameter '${bad}'; it has ${list(known)}`),
			);
		}
	}

	/**
	 * Swap in a new set of classes.
	 *
	 * Every instance is destroyed and rebuilt in place, keeping its id and the
	 * overrides somebody set. A field nobody set adopts whatever the new code
	 * says, which is what makes editing a default in the source take effect.
	 */
	reload(provider: ScriptProvider = this.provider): void {
		this.provider = provider;
		for (const registration of this.registrations.values()) {
			this.unload(registration);
			registration.muted = false;
		}
		for (const registration of this.registrations.values()) this.build(registration);

		const { registered, live } = this.census;
		this.log(`reloaded: ${live} of ${registered} script(s) running`);
	}

	/* ------------------------------------------------------------ internals -- */

	private build(registration: Registration): void {
		const constructor = this.provider.resolve(registration.typeName);
		if (!constructor) {
			this.log(
				`no script named '${registration.typeName}' on '${registration.binding.object.name}';` +
					` this build has ${list(this.provider.names)}`,
			);
			return;
		}

		let instance: Script;
		try {
			instance = new constructor();
		} catch (error) {
			this.log(`${this.where(registration)} would not construct: ${why(error)}`);
			return;
		}

		// The markers become their defaults before anything reads a field. See
		// parameters.ts for why a declaration is a value here rather than a
		// decorator.
		resolveParameters(instance);
		instance.attach({
			...registration.binding,
			log: (message) => this.log(`${this.where(registration)}: ${message}`),
		});
		applyParameters(instance, registration.overrides, (bad, known) =>
			this.log(`${this.where(registration)} has no parameter '${bad}'; it has ${list(known)}`),
		);

		registration.instance = instance;
		try {
			instance.onLoad();
		} catch (error) {
			registration.muted = true;
			this.log(`${this.where(registration)}.onLoad threw, muted until reload: ${why(error)}`);
		}
	}

	private unload(registration: Registration): void {
		const instance = registration.instance;
		if (!instance) return;
		registration.instance = null;
		try {
			instance.onDestroy();
		} catch (error) {
			this.log(`${this.where(registration)}.onDestroy threw: ${why(error)}`);
		}
	}

	/** `Wander on player` — which script, on which object. */
	private where(registration: Registration): string {
		return `${registration.typeName} on '${registration.binding.object.name}'`;
	}
}

function list(names: readonly string[]): string {
	return names.length ? [...names].sort().join(', ') : 'nothing';
}

function why(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
