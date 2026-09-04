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
import { handlersOf, type EventHandler, type GameEvent } from './events.js';
import type { ScriptRuntime } from './handles.js';
import type { Script, ScriptBinding } from './Script.js';
import type { GameObject } from '@hexdelve/engine';

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
	readonly binding: Omit<ScriptBinding, 'log' | 'emit'>;
	instance: Script | null;
	/** Only what somebody actually set. See `parameters.ts` for why. */
	readonly overrides: Record<string, unknown>;
	/** What the live instance's class declared with `@on`. Empty when unloaded. */
	handlers: readonly EventHandler[];
	muted: boolean;
}

export class ScriptHost implements ScriptRuntime {
	private readonly registrations = new Map<number, Registration>();
	/**
	 * Which registrations answer which event, by event NAME.
	 *
	 * Filled when a script is built and emptied when it is unloaded, both from
	 * the one list its class declared — which is the whole reason `@on` is a
	 * decorator. Nothing a script does can leave a subscription behind, because
	 * no script ever makes one.
	 */
	private readonly subscribers = new Map<string, Set<number>>();
	/**
	 * Listeners that are not scripts, by event name.
	 *
	 * The game itself has to hear what the scripts decided — a blow that landed
	 * is hit points in a script and a shower of motes in the renderer, and the
	 * second of those is not a script's business. These are added and removed by
	 * hand, unlike a script's, because nothing here is reloaded and there is no
	 * class to read them off.
	 */
	private readonly listeners = new Map<string, Set<(payload: never) => void>>();
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
		binding: Omit<ScriptBinding, 'log' | 'emit'>,
		overrides: Readonly<Record<string, unknown>> = {},
	): number {
		const registration: Registration = {
			id: this.nextId++,
			typeName,
			binding,
			instance: null,
			overrides: { ...overrides },
			handlers: [],
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

	/**
	 * The live script behind an id, or null.
	 *
	 * Null while its class is missing or its file is half-written, which is an
	 * ordinary state rather than an error. Nothing should HOLD what this
	 * returns: a hot reload replaces the instance, and a caller keeping one is
	 * keeping the version that was replaced.
	 */
	scriptAt(id: number): Script | null {
		return this.registrations.get(id)?.instance ?? null;
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

	/**
	 * Announce something to every script in the scene that handles it.
	 *
	 * Order is registration order, which is spawn order: the systems go into
	 * the scene before the cast, so a system hears an event before the things
	 * that came after it. Nothing should depend on that, and it is written down
	 * so that anything which does is doing it knowingly.
	 */
	emit(event: GameEvent<unknown>, payload: unknown): void {
		this.deliver(event, payload, null);
	}

	/**
	 * Listen from outside the scripts, and stop listening.
	 *
	 * For the game's own code, which is not a script and has no class for the
	 * host to read handlers off. The returned function removes it; a caller that
	 * drops it has leaked a listener, which is exactly the bookkeeping `@on`
	 * exists to spare a script.
	 *
	 * A listener hears every announcement of the event, whether it was broadcast
	 * or sent to one object — the payload says which thing it was about, and
	 * filtering on that is the caller's business.
	 */
	on<P>(event: GameEvent<P>, handler: (payload: P) => void): () => void {
		let group = this.listeners.get(event.name);
		if (!group) this.listeners.set(event.name, (group = new Set()));
		group.add(handler as (payload: never) => void);
		return () => {
			group.delete(handler as (payload: never) => void);
			if (group.size === 0) this.listeners.delete(event.name);
		};
	}

	/** Announce something to the scripts on one object, and to nothing else. */
	send(target: GameObject, event: GameEvent<unknown>, payload: unknown): void {
		this.deliver(event, payload, target);
	}

	/**
	 * The first live script of a class, on one object or anywhere.
	 *
	 * How a script asks a system a question, where an event announces an
	 * answer. Null when the class is not running — which is an ordinary state,
	 * not an error: a system whose file is half-written has no instance, and a
	 * caller that cannot find it should carry on rather than throw.
	 */
	instance<T>(constructor: abstract new () => T, on?: GameObject): T | null {
		for (const registration of this.registrations.values()) {
			const instance = registration.instance;
			if (!instance) continue;
			if (on && registration.binding.object.raw !== on) continue;
			if (instance instanceof constructor) return instance as T;
		}
		return null;
	}

	/* ------------------------------------------------------------ internals -- */

	/**
	 * Hand one event to whoever declared it.
	 *
	 * The subscriber set is copied before it is walked. A handler may destroy
	 * the thing it was told about — the whole point of `Damage` is that it
	 * sometimes is — and destroying it unsubscribes it, which would otherwise
	 * be a set modified while it was being iterated.
	 */
	private deliver(event: GameEvent<unknown>, payload: unknown, on: GameObject | null): void {
		this.tell(event, payload);

		const listening = this.subscribers.get(event.name);
		if (!listening || listening.size === 0) return;

		for (const id of [...listening]) {
			const registration = this.registrations.get(id);
			const instance = registration?.instance;
			if (!registration || !instance || registration.muted) continue;
			if (on && registration.binding.object.raw !== on) continue;

			for (const handler of registration.handlers) {
				if (handler.event !== event.name) continue;
				const method = (instance as unknown as Record<string, unknown>)[handler.method];
				if (typeof method !== 'function') continue;
				try {
					(method as (value: unknown) => void).call(instance, payload);
				} catch (error) {
					// The same rule as `tick`, and for the same reason: an event
					// that arrives sixty times a second would otherwise fill the
					// console with one script's bug.
					registration.muted = true;
					this.log(
						`${this.where(registration)}.${handler.method} threw on '${event.name}',` +
							` muted until reload: ${why(error)}`,
					);
				}
			}
		}
	}

	/**
	 * Hand one event to the listeners that are not scripts.
	 *
	 * Before the scripts, so the game sees what was announced rather than what
	 * a handler left behind — a `Damage` listener that draws where the blow
	 * landed should draw it whether or not the thing it hit survived being told.
	 *
	 * A listener that throws is reported and skipped. It cannot be muted the way
	 * a script can, because there is no reload that would bring it back.
	 */
	private tell(event: GameEvent<unknown>, payload: unknown): void {
		const group = this.listeners.get(event.name);
		if (!group) return;
		for (const handler of [...group]) {
			try {
				(handler as (value: unknown) => void)(payload);
			} catch (error) {
				this.log(`a listener for '${event.name}' threw: ${why(error)}`);
			}
		}
	}

	/** Put a built script's declared handlers into the subscriber index. */
	private subscribe(registration: Registration): void {
		const instance = registration.instance;
		if (!instance) return;
		registration.handlers = handlersOf(instance.constructor);
		for (const handler of registration.handlers) {
			let listening = this.subscribers.get(handler.event);
			if (!listening) this.subscribers.set(handler.event, (listening = new Set()));
			listening.add(registration.id);
		}
	}

	/** And take exactly those back out again. */
	private unsubscribe(registration: Registration): void {
		for (const handler of registration.handlers) {
			const listening = this.subscribers.get(handler.event);
			listening?.delete(registration.id);
			if (listening?.size === 0) this.subscribers.delete(handler.event);
		}
		registration.handlers = [];
	}

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
			emit: (event, payload) => this.emit(event, payload),
			log: (message) => this.log(`${this.where(registration)}: ${message}`),
		});
		applyParameters(instance, registration.overrides, (bad, known) =>
			this.log(`${this.where(registration)} has no parameter '${bad}'; it has ${list(known)}`),
		);

		registration.instance = instance;
		// Before `onLoad`, so a script that announces something as it starts is
		// heard by scripts that were built before it.
		this.subscribe(registration);
		try {
			instance.onLoad();
		} catch (error) {
			registration.muted = true;
			this.log(`${this.where(registration)}.onLoad threw, muted until reload: ${why(error)}`);
		}
	}

	private unload(registration: Registration): void {
		const instance = registration.instance;
		this.unsubscribe(registration);
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
