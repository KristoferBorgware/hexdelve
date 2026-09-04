/*
 * Working out what a swing hit.
 *
 * A system script, so there is one of it, and it is the only thing in the game
 * that knows the rule. That is the point of putting it here rather than in
 * whatever swung: the sword announces that a swing happened and where, this
 * answers the question of what was in front of it, and the thing that was hit
 * hears about it as damage. None of the three knows the other two.
 *
 *     Player      emit(Swing, { at, facing, reach, amount })
 *     Combat      @on(Swing) -> registry.nearest(...) -> target.send(Damage)
 *     Character   @on(Damage) -> hp -= amount
 *
 * Adding a second way to deal damage — a trap, a spell, a falling rock — is a
 * fourth script that emits `Swing` or sends `Damage`, and no change to the
 * other three. That is the whole reason for the seam.
 *
 * ## The rule, and what is deliberately crude about it
 *
 * Nearest character inside the reach, in front of the swinger. One target per
 * swing, no sweep, no arc that thickens with the weapon, no line of sight.
 * Every one of those is a real thing to want and none of them is knowable yet:
 * the yard has two creatures and no walls, so a cleverer rule would be tuned
 * against a situation that does not exist. It is written to be replaced.
 */

import { on, param, Script } from '@hexdelve/scripting';

import { CharacterRegistry } from './CharacterRegistry.js';
import { Damage, Swing } from './events.js';

/** Half the arc a blow covers, in radians. Beyond this it went past. */
const HALF_ARC = Math.PI / 3;

export class Combat extends Script {
	/**
	 * How far off dead-ahead still counts as a hit, as a fraction of the arc.
	 *
	 * One rather than a raw angle so the parameter reads as a dial: 0 is a
	 * needle straight ahead, 1 is the full sixty degrees either side.
	 */
	spread = param(1, { min: 0, max: 1, step: 0.05, hint: 'How wide a blow reaches' });

	@on(Swing)
	resolve(swing: {
		by: string;
		at: { x: number; z: number };
		facing: number;
		reach: number;
		amount: number;
	}): void {
		const registry = this.scene.script(CharacterRegistry);
		if (!registry) return;

		const swinger = registry.all.find((one) => one.object.name === swing.by) ?? undefined;
		const target = registry.nearest(swing.at.x, swing.at.z, swing.reach, swinger);
		if (!target || !target.alive) return;
		if (swinger && target.faction === swinger.faction) return;

		const dx = target.transform.worldX - swing.at.x;
		const dz = target.transform.worldZ - swing.at.z;
		if (!inFront(dx, dz, swing.facing, HALF_ARC * this.spread)) return;

		target.object.send(Damage, { amount: swing.amount, from: swing.by });
	}
}

/**
 * Whether a direction is inside an arc about a heading.
 *
 * The yard's headings are an angle about +Y with 0 down +Z, which is what
 * `Transform.yaw` means, so the bearing to the target is `atan2(dx, dz)` in
 * that order. Wrapped into (-pi, pi] before comparing, because the difference
 * between 179 degrees and -179 degrees is two, not three hundred and fifty-eight.
 */
function inFront(dx: number, dz: number, facing: number, halfArc: number): boolean {
	if (dx === 0 && dz === 0) return true; // Standing on it. Everything is in front.
	let off = Math.atan2(dx, dz) - facing;
	off = Math.atan2(Math.sin(off), Math.cos(off));
	return Math.abs(off) <= halfArc;
}
