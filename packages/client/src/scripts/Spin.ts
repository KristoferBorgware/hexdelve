/*
 * Turn whatever this is attached to, slowly.
 *
 * The smallest script that is a real one: it has a parameter a prefab can set,
 * it does something visible, and it reads the object it is on rather than
 * anything global. Useful for a bench, and useful as the thing to edit when
 * checking that a save reaches a running game.
 */

import { param, Script } from '@hexdelve/scripting';

export class Spin extends Script {
	/** Radians a second. Negative turns the other way. */
	speed = param(1, { min: -6, max: 6, step: 0.1, hint: 'Radians a second' });

	override tick(dt: number): void {
		this.transform.yaw += this.speed * dt;
	}
}
