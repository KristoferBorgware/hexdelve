/*
 * Working out what a blow hit.
 *
 * A system script, so there is one of it, and it is the only thing in the game
 * that knows the rule. That is the point of putting it here rather than in
 * whatever swung: the swinger announces that a blow was thrown and where from,
 * this answers the question of what was in front of it, and the thing that was
 * hit hears about it as damage. None of the three knows the other two.
 *
 *     the man     emit(Swing, { at, facing, reach, amount })
 *     Combat      @on(Swing) -> registry -> target.send(Damage) or emit(Missed)
 *     Character   @on(Damage) -> hp -= amount
 *
 * Adding a second way to deal damage — a trap, a spell, a falling rock — is a
 * script that emits `Swing` and no change to the other two. That is the whole
 * reason for the seam.
 *
 * ## Where the geometry comes from
 *
 * Not from here. The reach and the arc travel in the event, because they are
 * measured off the animation clip as it plays: how far the point of the blade
 * actually gets, and the bearings it sweeps between. A rule that carried its
 * own numbers would disagree with what the picture shows, and the disagreement
 * would be invisible — a blow that looked like it connected and did not.
 *
 * What IS here is the shape of the test: nearest character inside the reach,
 * inside the arc, at roughly the blade's height, not on the swinger's own side.
 * One target per blow, no sweep, no line of sight. Every one of those is a real
 * thing to want and none is knowable yet, so this is written to be replaced.
 */

import { on, param, Script } from '@hexdelve/scripting';

import { CharacterRegistry } from './CharacterRegistry.js';
import { Damage, Missed, Swing, type Point, type Reach } from './events.js';

/** How far above or below the blade a body still counts as being in the way. */
const HEIGHT_SLACK = 1.2;

/** Slack on the far end of the reach, so a blow that just gets there lands. */
const REACH_SLACK = 0.2;

export class Combat extends Script {
	/**
	 * Slack added to each end of the measured arc, in radians.
	 *
	 * The clip says where the blade swept; this says how much wider than that
	 * still counts. Zero is exactly what the animation showed.
	 */
	arcPad = param(0.35, { min: 0, max: 1.2, step: 0.05, hint: 'Slack on the swept arc' });

	@on(Swing)
	resolve(swing: {
		by: string;
		at: Point;
		facing: number;
		reach: Reach;
		amount: number;
	}): void {
		const registry = this.scene.script(CharacterRegistry);
		if (!registry) return;

		const swinger = registry.all.find((one) => one.object.name === swing.by);
		const target = registry.nearest(
			swing.at.x,
			swing.at.z,
			swing.reach.distance + REACH_SLACK,
			swinger,
		);
		if (!target || !target.alive) {
			this.emit(Missed, { by: swing.by, why: 'cut air' });
			return;
		}
		if (swinger && target.faction === swinger.faction) {
			this.emit(Missed, { by: swing.by, why: 'cut air' });
			return;
		}

		const at = target.where;
		const off = wrap(Math.atan2(at.x - swing.at.x, at.z - swing.at.z) - swing.facing);
		const inArc = off >= swing.reach.from - this.arcPad && off <= swing.reach.to + this.arcPad;
		const bladeY = swing.at.y + swing.reach.height;
		if (!inArc || Math.abs(at.y - bladeY) > HEIGHT_SLACK) {
			this.emit(Missed, { by: swing.by, why: 'the blow fell short' });
			return;
		}

		target.object.send(Damage, { amount: swing.amount, from: swing.by, at });
	}
}

/**
 * An angle wrapped into (-pi, pi].
 *
 * The difference between 179 degrees and -179 degrees is two, not three hundred
 * and fifty-eight, and every comparison against an arc depends on that.
 */
function wrap(radians: number): number {
	return Math.atan2(Math.sin(radians), Math.cos(radians));
}
