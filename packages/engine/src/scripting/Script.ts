/*
 * The base class game behaviour is written as — and an ordinary component.
 *
 * Derive from it, put the file in the client's `scripts/` directory, and name
 * it from a prefab:
 *
 *     - { type: script, script: Wander, speed: 3 }
 *
 * It sits in its object's component list beside a `Model` or an `Item`, which
 * is what makes `object.getComponent(Wander)` work and what stops "is it a
 * script?" being a question anything else has to ask. A script reaches the
 * object model directly: `this.object` is the `GameObject`, `this.scene` is
 * the `Scene`, and every lookup on them — `getComponent`,
 * `getComponentInParent`, `find` — is the one everything else uses.
 *
 * ## The lifecycle, and the one part of it that is unusual
 *
 *   onLoad     once, after the script is attached and its parameters set.
 *              Also again after every hot reload, because a reload replaces
 *              the instance — a script cannot tell the difference and must not
 *              need to.
 *   tick       once a frame, with the seconds since the last one.
 *   onDestroy  when the component goes, and BEFORE each hot reload. Whatever a
 *              script registered somewhere in `onLoad` it takes back here, and
 *              a reload therefore leaves no trace of the version it replaced.
 *
 * Event handlers are the exception, and deliberately so: a method marked `@on`
 * is subscribed and unsubscribed by the host, because it can enumerate them.
 * See `events.ts` for why that is worth a decorator.
 *
 * That symmetry is the whole reason hot reload can work at all. A script that
 * cleans up after itself can be swapped for a new one mid-frame; a script that
 * leaves something behind cannot, and will double whatever it left every time
 * the file is saved.
 *
 * ## What a reload means for anything holding a script
 *
 * A reload builds a NEW instance and puts it where the old one was. Anything
 * that cached the old one is holding a corpse. Scripts are safe by
 * construction — `onLoad` runs again on the new instance, so a lookup cached
 * there is refreshed — but code that is NOT rebuilt by a reload (the game's
 * own components, the simulation, a listener) must look a script up when it
 * needs it rather than hold one.
 *
 * ## Why `update` and `onDetach` are not for overriding
 *
 * They are `Component`'s hooks and this class spends them: `update` is where a
 * script that throws is muted rather than left shouting sixty times a second,
 * and `onDetach` is where the host is told the script is gone. A script that
 * overrode either would silently lose the discipline the whole scripting layer
 * rests on, so the pair it gets instead is `tick` and `onDestroy`.
 */

import { Component } from '../scene/GameObject.js';
import type { GameObject } from '../scene/GameObject.js';
import type { Scene } from '../scene/Scene.js';

import type { GameEvent, Payload } from './events.js';

/** What the host gives a script once it has been built. */
export interface ScriptBinding {
	readonly scene: Scene;
	/** Broadcast to every script in the scene that handles it. */
	readonly emit: (event: GameEvent<unknown>, payload: unknown) => void;
	/** Announce to the scripts on one object, and to nothing else. */
	readonly send: (target: GameObject, event: GameEvent<unknown>, payload: unknown) => void;
	/** Where a script's own messages go, tagged with which script said them. */
	readonly log: (message: string) => void;
	/** Told when this script threw, so the host can report it. */
	readonly failed: (where: string, error: unknown, detail?: string) => void;
	/**
	 * Told when the component has been detached.
	 *
	 * The host has to know, because a registration it keeps for a script whose
	 * class is missing has no component to hear it from — see `ScriptHost`.
	 */
	readonly detached: () => void;
}

export abstract class Script extends Component {
	private bound: ScriptBinding | null = null;
	/** Set by the first throw, cleared by the next reload building a new one. */
	private muted = false;

	/**
	 * Give this script its place in the world.
	 *
	 * Called by the host, and not part of what a script is written against —
	 * a script that calls this is a script doing something wrong.
	 */
	bind(binding: ScriptBinding): void {
		this.bound = binding;
	}

	private get binding(): ScriptBinding {
		if (!this.bound) {
			throw new Error(
				`${this.constructor.name} is not attached to anything; scripts are built by the host`,
			);
		}
		return this.bound;
	}

	/** The scene it is in, for finding things that are not underneath it. */
	get scene(): Scene {
		return this.binding.scene;
	}

	/** Shorthand for `object.transform`. */
	get transform(): GameObject['transform'] {
		return this.object.transform;
	}

	/** Say something, tagged with which script said it and on what. */
	protected log(message: string): void {
		this.binding.log(message);
	}

	/**
	 * Announce something to the whole scene.
	 *
	 * Every script anywhere that declared `@on` for this event hears it. To
	 * reach one thing rather than everything, send to it.
	 */
	protected emit<P>(event: GameEvent<P>, ...payload: Payload<P>): void {
		this.binding.emit(event as GameEvent<unknown>, payload[0]);
	}

	/** Announce something to the scripts on one object, and to nothing else. */
	protected send<P>(target: GameObject, event: GameEvent<P>, ...payload: Payload<P>): void {
		this.binding.send(target, event as GameEvent<unknown>, payload[0]);
	}

	onLoad(): void {}

	tick(_dt: number): void {}

	onDestroy(): void {}

	/**
	 * `Component.update`, spent on the failure rule. Do not override.
	 *
	 * A script that throws is muted until the next reload: left running it
	 * throws every frame and the console becomes useless, and killed outright
	 * it cannot be fixed by saving the file.
	 */
	override update(dt: number): void {
		if (this.muted || !this.bound) return;
		try {
			this.tick(dt);
		} catch (error) {
			this.fail('tick', error);
		}
	}

	/**
	 * `Component.onDetach`, spent on the teardown pair. Do not override.
	 *
	 * `onDestroy` first, while the object is still reachable — a script that
	 * put itself in a register has to be able to find its way back out — and
	 * the host after, so it stops counting a script that is gone.
	 */
	override onDetach(): void {
		try {
			this.onDestroy();
		} catch (error) {
			this.bound?.log(`onDestroy threw: ${why(error)}`);
		}
		this.bound?.detached();
	}

	/**
	 * Stop calling this script, and say why.
	 *
	 * `where` is the method, and `detail` is what it was doing — which for a
	 * handler is the event it was answering, since `poked` on its own does not
	 * say what arrived. The host uses this for the handlers it calls itself.
	 */
	fail(where: string, error: unknown, detail?: string): void {
		this.muted = true;
		this.bound?.failed(where, error, detail);
	}

	/** Whether it has thrown and is waiting for a reload. */
	get isMuted(): boolean {
		return this.muted;
	}
}

function why(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
