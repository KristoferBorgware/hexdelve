/*
 * A creature's blows: what one takes off, whether it meant anything, the tally.
 *
 * One of these sits on anything that fights, and it is the rule half of a
 * melee. The body it sits beside knows when its blade is at the point of its
 * arc, where the point got to and which arc it swept — all three measured off
 * the clip as it plays — and hands them over as a `Strike`. Everything after
 * that is here:
 *
 *     the body     melee.begin() when it commits, melee.land(blow, target)
 *                  at the instant of contact
 *     Melee        the hexagon still holds the enemy? -> emit(Swing)
 *     Combat       what was in front of it -> send(Damage) / emit(Landed|Missed)
 *     Melee        @on(Landed) / @on(Missed) -> the tally and the readout line
 *
 * So how hard a thing hits, and what it says about hitting, come out of its
 * entity file rather than out of the code that draws it. A second creature that
 * fights is a `Melee` line in that file and no new code at all.
 *
 * ## The one test that is here rather than in Combat
 *
 * Whether the hexagon aimed at still holds the enemy. That is not the combat
 * question — `Combat` asks what was actually in front of the blade, in world
 * units, off the geometry that travelled with the announcement. This asks
 * whether the ORDER still means anything, and on a grid where nothing moves
 * while somebody is acting it has a certain answer. A blow at an empty hexagon
 * is never announced, so a swing that happens to sweep past a bystander does
 * not land on them.
 */

import { on, param, Script } from '@hexdelve/engine';
import { ActorBehaviour, NOWHERE, type Strike } from '@hexdelve/client';
import type { Axial } from '@hexdelve/shared';

import { Character } from './Character.js';
import { Landed, Missed, Swing } from './events.js';

export class Melee extends Script {
	/** Said when the blow connected, in the voice of whatever threw it. */
	hit = param('hit it', { label: 'On a hit' });

	/**
	 * Said when it was thrown at a hexagon with nothing on it.
	 *
	 * Also stands in for `Combat`'s own 'cut air', so a creature that does not
	 * cut does not report cutting: the rule says a blow found nothing and this
	 * says what that sounds like coming from a bat.
	 */
	whiff = param('cut air', { label: 'On a whiff' });

	/** Blows thrown, and what came of them. */
	thrown = 0;
	hits = 0;
	missed = 0;

	/** What came of the last one, in words. */
	message = '';

	/**
	 * What one blow takes off, off the `Character` beside this.
	 *
	 * How hard a thing hits is a fact about the creature rather than about its
	 * blows, and it is already written in its entity file next to what it can
	 * take. A second number here would be a second place to edit it, and the
	 * two would disagree the first time somebody edited one.
	 *
	 * Zero without a character to ask, which is a creature that cannot be hurt
	 * throwing blows that do not hurt.
	 */
	get damage(): number {
		return this.object.getComponent(Character)?.power ?? 0;
	}

	/** A blow begun. Counted here because a tally of cuts is a rule's, not a pose's. */
	begin(): void {
		this.thrown++;
	}

	/**
	 * Contact.
	 *
	 * The geometry travels with the announcement rather than being looked up at
	 * the other end, because it is measured off the clip as it plays: a rule
	 * carrying its own numbers would disagree with the picture, and the
	 * disagreement would be invisible.
	 */
	land(blow: Strike, target: Axial | null): void {
		const enemy = this.object.getComponent(ActorBehaviour)?.opponent?.cell ?? NOWHERE;
		if (!target || enemy.q !== target.q || enemy.r !== target.r) {
			this.report(false, this.whiff);
			return;
		}

		this.emit(Swing, {
			by: this.object.name,
			at: blow.at,
			facing: blow.facing,
			reach: blow.reach,
			amount: this.damage,
		});
	}

	@on(Landed)
	landed(news: { by: string }): void {
		if (news.by === this.object.name) this.report(true, this.hit);
	}

	@on(Missed)
	fell(news: { by: string; why: string }): void {
		if (news.by !== this.object.name) return;
		// 'cut air' is the rule's word for finding nothing and this creature
		// has its own; anything else Combat says is a reason it alone knows.
		this.report(false, news.why === 'cut air' ? this.whiff : news.why);
	}

	/**
	 * The tally and the readout line.
	 *
	 * The line goes on the behaviour beside this rather than being kept here,
	 * because the readout shows one line per creature and the turn it started
	 * writes the same one. Whichever spoke last is what is on screen.
	 */
	private report(hit: boolean, message: string): void {
		if (hit) this.hits++;
		else this.missed++;
		this.message = message;
		const actor = this.object.getComponent(ActorBehaviour);
		if (actor) actor.message = message;
	}
}
