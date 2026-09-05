/*
 * Whose turn it is, and when the clock is allowed to move at all.
 *
 * A system script, so there is one of it, and it is the only thing in the game
 * that decides who acts next. Everything else says what it costs: a creature
 * announces an action and what it spent, and this hands out the energy that
 * paid for it.
 *
 *   the schedule   winds the game turn forward until somebody can afford to
 *                  act, and hands that creature back
 *   the creature   `beginTurn()` — decides, starts, and says what it cost
 *   this           charges it, and goes round again
 *
 * ## The two conditions, which are the whole of a turn-based world
 *
 * Nothing is handed a turn while anything is still playing out its last one,
 * so only ever one creature is moving — which is what makes a blow impossible
 * to throw at something that has since stepped aside. And nothing is handed a
 * turn at all while the man has asked for nothing, so the yard holds still
 * with the bat's wings out until you decide. The second is a question about
 * his ORDERS rather than a pause flag, so there is no state to get out of step
 * with what he is actually doing.
 *
 * ## Why the members are read rather than listed
 *
 * Everything in the scene that acts, in the order the scene holds them. That
 * order is the tie-break: the man is spawned first, so among creatures ready
 * on the same game turn the strictly faster ones go before him and the rest
 * after — which is Angband's own rule, arrived at by putting him in the list
 * first rather than by a comparison anywhere.
 *
 * A third creature is therefore an entity file and nothing else.
 */

import { on, param, Script } from '@hexdelve/engine';

import { Died } from './events.js';
import {
	ActorBehaviour,
	playerOrders,
	Schedule,
	type TurnTaker,
} from '@hexdelve/client';

export class Turns extends Script {
	/**
	 * How many turns one frame may resolve before giving up and trying again.
	 *
	 * There is a real reason for a cap rather than a `while (true)`: a turn that
	 * takes no time on screen — a sleeping bat, a man hemmed in — does not stop
	 * the loop, so a state where nobody can ever do anything visible would spin
	 * here. The cap turns that from a hung tab into a slow frame, and the fact
	 * that the number is never approached in practice is worth more than the
	 * cleverness of proving it cannot be.
	 */
	perFrame = param(64, { min: 1, max: 512, step: 1, hint: 'Turns resolved in one frame' });

	/** How many actions have been taken, for the readout. */
	actions = 0;

	/** The last one, as the readout names it. */
	last = 'nobody has moved';

	private order: Schedule<TurnTaker> | null = null;

	/**
	 * The schedule, built the first time it is asked for.
	 *
	 * Not in `onLoad`, because the systems are spawned before the cast: at load
	 * there is nothing in the scene to put in it. The first tick is the earliest
	 * moment the answer exists.
	 */
	get schedule(): Schedule<TurnTaker> {
		return (this.order ??= new Schedule<TurnTaker>(this.actors()));
	}

	private actors(): ActorBehaviour[] {
		return this.scene.root.getComponentsInChildren(ActorBehaviour);
	}

	/** Whether the man has asked for anything. Nothing moves while he has not. */
	private get wanted(): boolean {
		for (const actor of this.actors()) {
			const orders = playerOrders(actor.object);
			if (orders) return orders.hasOrders;
		}
		return false;
	}

	override tick(): void {
		const schedule = this.schedule;
		for (let guard = 0; guard < this.perFrame; guard++) {
			if (schedule.members.some((member) => member.busy)) return;
			if (!this.wanted) return;
			const who = schedule.next();
			if (!who) return;
			const action = who.beginTurn();
			schedule.spend(who, action.cost);
			this.actions++;
			this.last = `${who.name} · ${action.kind}`;
		}
	}

	/**
	 * A creature that has run out of hit points stops taking turns, and falls.
	 *
	 * `Character` announces the death; what to DO about it is this. The first
	 * half is the rule and the second is the picture, and they are together
	 * because they are the same sentence — a thing that has stopped acting is a
	 * thing lying on the grass.
	 */
	@on(Died)
	fallen(death: { who: string }): void {
		// By the OBJECT's name, which is what a script sees, rather than the
		// schedule member's: the man is `player` in the scene and `you` in the
		// readout, and the two are different words on purpose.
		const gone = this.schedule.members.find(
			(member) => (member as ActorBehaviour).object.name === death.who,
		) as ActorBehaviour | undefined;
		if (!gone || !this.schedule.remove(gone)) return;
		this.last = `${gone.name} fell`;
		gone.fell();
	}
}
