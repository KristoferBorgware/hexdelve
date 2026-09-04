/*
 * The one place everything looks to find a character.
 *
 * A wanderer is spawned when a wanderer is wanted and there can be two. A
 * register of them cannot be either of those things: the whole of what makes it
 * useful is that everything looking for a character looks in the same place. So
 * it lives on the system prefab, which is instantiated once when the client or
 * the editor starts, and a script reaches it with
 * `this.scene.script(CharacterRegistry)`.
 *
 * ## Why a lookup rather than an event
 *
 * Everything else here is announced. This is not, because an event is
 * fire-and-forget and cannot hand anything back, and every question worth
 * asking a register has an answer: who is standing there, who is nearest, who
 * is left. Announcing is for telling somebody what happened; a handle is for
 * asking.
 *
 * ## What is not in it
 *
 * No hit points, no factions, no positions of its own. Those belong to the
 * character, and a register that copied them would be a second version of the
 * truth that goes stale the moment anything moves. It holds handles and asks
 * the characters themselves.
 */

import { Script } from '@hexdelve/scripting';

import type { Character } from './Character.js';

export class CharacterRegistry extends Script {
	/**
	 * By object id, so a character taken out and put back is one entry rather
	 * than two, and so removing is not a scan.
	 */
	private readonly members = new Map<number, Character>();

	/** Everyone standing. */
	get all(): readonly Character[] {
		return [...this.members.values()];
	}

	get count(): number {
		return this.members.size;
	}

	/**
	 * Take a character on.
	 *
	 * Called by the character itself in `onLoad`, and given up in `onDestroy`.
	 * That pairing is the character's to keep — see `Character` for why it is
	 * not an event, and `events.ts` for the one place the host keeps it instead.
	 */
	add(member: Character): void {
		this.members.set(member.object.id, member);
	}

	remove(member: Character): void {
		this.members.delete(member.object.id);
	}

	/** Everyone but one — the usual question, since nothing hits itself. */
	others(than: Character): Character[] {
		return this.all.filter((member) => member !== than);
	}

	/**
	 * The nearest character to a point, within a distance, excluding one.
	 *
	 * Distance is measured flat, ignoring height: everything in the yard stands
	 * on the ground and two things a terrace apart are still next to each other
	 * as far as a sword is concerned.
	 */
	nearest(x: number, z: number, within: number, except?: Character): Character | null {
		let best: Character | null = null;
		let bestDistance = within;
		for (const member of this.members.values()) {
			if (member === except || !member.object.alive) continue;
			const dx = member.where.x - x;
			const dz = member.where.z - z;
			const distance = Math.hypot(dx, dz);
			if (distance <= bestDistance) {
				best = member;
				bestDistance = distance;
			}
		}
		return best;
	}

	/** Anyone still alive, for a rule that ends when a side is gone. */
	living(faction: string): Character[] {
		return this.all.filter((member) => member.faction === faction && member.alive);
	}
}
