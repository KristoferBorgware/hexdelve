/*
 * The base class game behaviour is written as.
 *
 * Derive from it, put the file in the client's `scripts/` directory, and name
 * it from a prefab:
 *
 *     - { type: script, script: Wander, speed: 3 }
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
 * ## What a script may reach
 *
 * `object`, `transform` and `scene`, through the handles in `handles.ts`. Not
 * the renderer, not the pose solver, not the frame loop — a script says what a
 * character does, and everything else is a question about how the engine works
 * that scripts are deliberately kept out of.
 */

import type { GameEvent, Payload } from './events.js';
import { ScriptObject, ScriptScene, ScriptTransform } from './handles.js';

/** What the host injects once a script has been constructed. */
export interface ScriptBinding {
	readonly object: ScriptObject;
	readonly scene: ScriptScene;
	/** Broadcast to every script in the scene that handles it. */
	readonly emit: (event: GameEvent<unknown>, payload: unknown) => void;
	/** Where a script's own messages go, tagged with which script said them. */
	readonly log: (message: string) => void;
}

export abstract class Script {
	private bound: ScriptBinding | null = null;

	/**
	 * Give this script its place in the world.
	 *
	 * Called by the host, and not part of what a script is written against —
	 * a script that calls this is a script doing something wrong.
	 */
	attach(binding: ScriptBinding): void {
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

	/** The object this is attached to. */
	get object(): ScriptObject {
		return this.binding.object;
	}

	/** Shorthand for `object.transform`. */
	get transform(): ScriptTransform {
		return this.binding.object.transform;
	}

	/** The scene it is in, for finding things that are not underneath it. */
	get scene(): ScriptScene {
		return this.binding.scene;
	}

	/** Say something, tagged with which script said it and on what. */
	protected log(message: string): void {
		this.binding.log(message);
	}

	/**
	 * Announce something to the whole scene.
	 *
	 * Every script anywhere that declared `@on` for this event hears it. To
	 * reach one thing rather than everything, send to it:
	 * `target.send(Damage, { amount: 3 })`.
	 */
	protected emit<P>(event: GameEvent<P>, ...payload: Payload<P>): void {
		this.binding.emit(event as GameEvent<unknown>, payload[0]);
	}

	onLoad(): void {}

	tick(_dt: number): void {}

	onDestroy(): void {}
}
