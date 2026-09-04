/*
 * The thing that owns running scripts, and swaps them out underneath.
 *
 * A script is an ordinary component: it sits in its object's list, it is found
 * with `getComponent`, and nothing outside this file has to know it is
 * special. What this file owns is the two things a component cannot own for
 * itself — WHICH CLASS a name means, and what happens when that class is
 * replaced while the game runs.
 *
 *     registration ---> object, type name, parameters somebody set
 *                  \--> the instance, which a reload throws away and rebuilds
 *
 * The registration outlives the instance, and that is the whole trick. A
 * reload builds a new instance from the new class and puts it where the old
 * one was — same object, same place in the component list, same parameters —
 * so a hot reload is invisible to everything except the script itself, which
 * gets `onDestroy` and then `onLoad` and is told nothing.
 *
 * It also outlives NO instance: a prefab may name a script whose file has not
 * compiled yet, and the registration is what remembers to build it when the
 * file appears. That is the one case where a script exists as an intention
 * rather than as a component, and it is why `detached` is on the binding — the
 * host cannot learn from a component that was never attached.
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
 *   a script that throws in `tick` or in a handler is MUTED until the next
 *   reload. Left running it throws sixty times a second and the console
 *   becomes useless; killed outright it cannot be fixed by saving the file.
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
import { Script } from '../scene/components/Script.js';
import type { GameObject } from '../scene/GameObject.js';
import type { Scene } from '../scene/Scene.js';

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

/** What the host remembers about one script, instance or no instance. */
interface Registration {
	readonly object: GameObject;
	readonly scene: Scene;
	readonly typeName: string;
	instance: Script | null;
	/** Only what somebody actually set. See `parameters.ts` for why. */
	readonly overrides: Record<string, unknown>;
	/** What the live instance's class declared with `@on`. Empty when unloaded. */
	handlers: readonly EventHandler[];
}

export class ScriptHost {
	private readonly registrations = new Set<Registration>();
	/** Which registration a live instance belongs to, for the calls that arrive
	 * with a script rather than with a name — a detach, a parameter edit. */
	private readonly byInstance = new Map<Script, Registration>();
	/**
	 * Which registrations answer which event, by event NAME.
	 *
	 * Filled when a script is built and emptied when it is unloaded, both from
	 * the one list its class declared — which is the whole reason `@on` is a
	 * decorator. Nothing a script does can leave a subscription behind, because
	 * no script ever makes one.
	 */
	private readonly subscribers = new Map<string, Set<Registration>>();
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
	/** True while a reload is swapping instances, when a detach is not a death. */
	private swapping = false;

	constructor(provider: ScriptProvider, options: ScriptHostOptions = {}) {
		this.provider = provider;
		this.log = options.log ?? ((message) => console.warn(`[script] ${message}`));
	}

	/** How many scripts are registered, and how many of those are running. */
	get census(): { registered: number; live: number; muted: number } {
		let live = 0;
		let muted = 0;
		for (const one of this.registrations) {
			if (one.instance) live++;
			if (one.instance?.isMuted) muted++;
		}
		return { registered: this.registrations.size, live, muted };
	}

	/**
	 * Put a script on an object, by the name a prefab called it.
	 *
	 * Returns the instance, or null when this build has no class of that name —
	 * which is not a failure. A prefab may name a script whose file has not
	 * compiled yet, and refusing to spawn the object over it would make one
	 * broken script take out a whole scene. The registration stays either way,
	 * so the next reload builds it if the class turns up.
	 */
	attach(
		object: GameObject,
		typeName: string,
		options: { scene: Scene; parameters?: Readonly<Record<string, unknown>> },
	): Script | null {
		const registration: Registration = {
			object,
			scene: options.scene,
			typeName,
			instance: null,
			overrides: { ...options.parameters },
			handlers: [],
		};
		this.registrations.add(registration);
		this.build(registration);
		return registration.instance;
	}

	/**
	 * Swap in a new set of classes.
	 *
	 * Every instance is destroyed and rebuilt where it stood, keeping the
	 * overrides somebody set. A field nobody set adopts whatever the new code
	 * says, which is what makes editing a default in the source take effect.
	 */
	reload(provider: ScriptProvider = this.provider): void {
		this.provider = provider;
		this.swapping = true;
		try {
			for (const registration of [...this.registrations]) {
				// An object destroyed while its script had no instance has no
				// component to have told us. This is where that is noticed.
				if (registration.object.isDestroyed) {
					this.forget(registration);
					continue;
				}
				this.rebuild(registration);
			}
		} finally {
			this.swapping = false;
		}

		const { registered, live } = this.census;
		this.log(`reloaded: ${live} of ${registered} script(s) running`);
	}

	/** The exposed fields of one live script, with their current values. */
	parameters(script: Script): LiveParameter[] {
		const registration = this.byInstance.get(script);
		if (!registration) return [];
		const values = readParameters(script);
		return parametersOf(script.constructor as ScriptClass).map((meta) => ({
			...meta,
			value: values[meta.key] ?? registration.overrides[meta.key] ?? meta.default,
		}));
	}

	/** Set one field, and remember it across every reload from here on. */
	setParameter(script: Script, key: string, value: unknown): void {
		const registration = this.byInstance.get(script);
		if (!registration) return;
		registration.overrides[key] = value;
		applyParameters(script, { [key]: value }, (bad, known) =>
			this.log(`${this.where(registration)} has no parameter '${bad}'; it has ${list(known)}`),
		);
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

	/** Announce something to the scripts on one object, and to nothing else. */
	send(target: GameObject, event: GameEvent<unknown>, payload: unknown): void {
		this.deliver(event, payload, target);
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

		for (const registration of [...listening]) {
			const instance = registration.instance;
			if (!instance || instance.isMuted) continue;
			if (on && registration.object !== on) continue;

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
					instance.fail(handler.method, error, `on '${event.name}'`);
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
			listening.add(registration);
		}
	}

	/** And take exactly those back out again. */
	private unsubscribe(registration: Registration): void {
		for (const handler of registration.handlers) {
			const listening = this.subscribers.get(handler.event);
			listening?.delete(registration);
			if (listening?.size === 0) this.subscribers.delete(handler.event);
		}
		registration.handlers = [];
	}

	/** Build the instance and attach it. Quiet, and null, when there is no class. */
	private build(registration: Registration): void {
		const instance = this.construct(registration);
		if (!instance) return;

		registration.instance = instance;
		this.byInstance.set(instance, registration);
		// Before `onLoad`, so a script that announces something as it starts is
		// heard by scripts that were built before it.
		this.subscribe(registration);
		registration.object.attachComponent(instance);
		this.start(instance);
	}

	/**
	 * Replace the instance with one built from the current classes.
	 *
	 * In place: `replaceComponent` keeps the script where it was in the list,
	 * because components update in that order and `getComponent` answers with
	 * the first match. A remove and an append would reorder the object on every
	 * save, which is the sort of thing that is noticed a week later as "it only
	 * happens after I edit that file".
	 */
	private rebuild(registration: Registration): void {
		const old = registration.instance;
		const next = this.construct(registration);

		if (!next) {
			/*
			 * Nothing to put there: the class this was built from is not in the
			 * new bundle. Whatever was running comes out, and the registration
			 * stays — the file may be halfway through being written, and the next
			 * reload that produces the class starts it again.
			 *
			 * Cleared BEFORE the component is detached, so that nothing reached
			 * from `onDestroy` finds a host still claiming this script is live.
			 */
			this.unsubscribe(registration);
			if (old) {
				this.byInstance.delete(old);
				registration.instance = null;
				registration.object.removeComponent(old);
			}
			return;
		}

		this.unsubscribe(registration);
		if (old) this.byInstance.delete(old);
		registration.instance = next;
		this.byInstance.set(next, registration);
		this.subscribe(registration);

		if (old) registration.object.replaceComponent(old, next);
		else registration.object.attachComponent(next);
		this.start(next);
	}

	/** Construct one, parameters applied, bound, and not yet attached. */
	private construct(registration: Registration): Script | null {
		const constructor = this.provider.resolve(registration.typeName);
		if (!constructor) {
			/*
			 * A build with NO classes is not a build missing this one.
			 *
			 * It is the ordinary state of a world the editor has just made: an
			 * editor-hosted client fetches no bundle and gets its classes from
			 * the compile that follows a moment later. The reload reports what
			 * it started.
			 *
			 * A build that has SOME classes and not this one is a typo in a
			 * prefab, or a file that will not compile, and gets a line naming
			 * what it does have.
			 */
			if (this.provider.names.length > 0) {
				this.log(
					`no script named '${registration.typeName}' on '${registration.object.name}';` +
						` this build has ${list(this.provider.names)}`,
				);
			}
			return null;
		}

		let instance: Script;
		try {
			instance = new constructor(registration.object);
		} catch (error) {
			this.log(`${this.where(registration)} would not construct: ${why(error)}`);
			return null;
		}

		// The markers become their defaults before anything reads a field. See
		// parameters.ts for why a declaration is a value here rather than a
		// decorator.
		resolveParameters(instance);
		instance.bind({
			scene: registration.scene,
			emit: (event, payload) => this.emit(event, payload),
			send: (target, event, payload) => this.send(target, event, payload),
			log: (message) => this.log(`${this.where(registration)}: ${message}`),
			failed: (where, error, detail) =>
				this.log(
					`${this.where(registration)}.${where} threw${detail ? ` ${detail}` : ''},` +
						` muted until reload: ${why(error)}`,
				),
			detached: () => this.detached(registration),
		});
		applyParameters(instance, registration.overrides, (bad, known) =>
			this.log(`${this.where(registration)} has no parameter '${bad}'; it has ${list(known)}`),
		);
		return instance;
	}

	/** `onLoad`, under the same rule as every other thing a script runs. */
	private start(instance: Script): void {
		try {
			instance.onLoad();
		} catch (error) {
			instance.fail('onLoad', error);
		}
	}

	/**
	 * A script's component has been detached.
	 *
	 * During a reload that is the old half of a swap and means nothing. Any
	 * other time the object has been destroyed, or somebody removed the
	 * component, and the registration goes with it.
	 */
	private detached(registration: Registration): void {
		if (this.swapping) return;
		this.forget(registration);
	}

	private forget(registration: Registration): void {
		this.unsubscribe(registration);
		if (registration.instance) this.byInstance.delete(registration.instance);
		registration.instance = null;
		this.registrations.delete(registration);
	}

	/** `Wander on player` — which script, on which object. */
	private where(registration: Registration): string {
		return `${registration.typeName} on '${registration.object.name}'`;
	}
}

function list(names: readonly string[]): string {
	return names.length ? [...names].sort().join(', ') : 'nothing';
}

function why(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
