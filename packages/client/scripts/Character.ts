/*
 * Something that can be hit, and that stops being there when it has been hit
 * enough.
 *
 * The smallest thing that makes a creature a participant rather than scenery.
 * It holds hit points, it says which side it is on, and it puts itself in the
 * register so that everything looking for a character can find it.
 *
 * ## The pair that has to be kept, and the pair that does not
 *
 * Joining the register is `onLoad` and leaving it is `onDestroy`, written out
 * by hand, because the register is somebody else's data structure and this
 * script is what put something in it. That is the ordinary rule: what a script
 * registers in `onLoad` it takes back in `onDestroy`, and a hot reload
 * therefore leaves no trace of the version it replaced.
 *
 * `@on(Damage)` is the exception, and the reason is that the host can see it.
 * A handler is declared on the class, so the host subscribes and unsubscribes
 * it without this script being able to forget — which is the whole argument for
 * the decorator, and it is written out in `@hexdelve/scripting`'s `events.ts`.
 */

import { on, param, Script } from '@hexdelve/scripting';

import { CharacterRegistry } from './CharacterRegistry.js';
import { Damage, Died, type Blow } from './events.js';

export class Character extends Script {
	/** What it can take before it goes. */
	hp = param(10, { min: 1, max: 200, step: 1, hint: 'Hit points' });

	/** Which side it is on. Nothing hits its own side. */
	faction = param('foe', { hint: 'player, foe, or whatever a level invents' });

	/** How hard it hits, for whatever asks it to swing. */
	power = param(3, { min: 0, max: 50, step: 1, hint: 'Damage a blow deals' });

	private remaining = 0;

	/** False once the hit points are gone. It may still be standing this frame. */
	get alive(): boolean {
		return this.remaining > 0;
	}

	/** What it has left, which is not what it started with. */
	get health(): number {
		return this.remaining;
	}

	override onLoad(): void {
		/*
		 * From the parameter rather than kept across the reload. Editing the
		 * starting health in the file and seeing it take effect is the point of
		 * the reload; a wounded creature healing on a save is the price, and it
		 * is a bench, not a save game.
		 */
		this.remaining = this.hp;
		this.registry?.add(this);
	}

	override onDestroy(): void {
		this.registry?.remove(this);
	}

	@on(Damage)
	hurt(blow: Blow): void {
		if (!this.alive) return; // Already gone. A second blow lands on nothing.
		this.remaining = Math.max(0, this.remaining - blow.amount);
		this.log(`took ${blow.amount} from ${blow.from}, ${this.remaining} left`);
		if (this.remaining === 0) this.emit(Died, { who: this.object.name });
	}

	/**
	 * The register, or null if there is not one.
	 *
	 * Null is an ordinary answer rather than a failure: a character previewed on
	 * a bench has no systems around it, and a script that threw there would make
	 * the editor's character view depend on the whole game being present.
	 */
	private get registry(): CharacterRegistry | null {
		return this.scene.script(CharacterRegistry);
	}
}
