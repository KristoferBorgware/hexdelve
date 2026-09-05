/*
 * The same events the scripts declare, as the client's own tokens.
 *
 * The scripts are compiled apart from this package's module graph — that is
 * what lets them use syntax the applications cannot, and it means neither side
 * can import the other. So each declares the events it needs, and the two agree
 * because the host matches an event by its NAME.
 *
 * This is the only duplication in the arrangement, and it is deliberate rather
 * than overlooked. The alternative is a third package that both depend on,
 * which would put the scripts back inside a build every application performs
 * and undo the whole reason they are outside one.
 *
 * `test/scripting.test.ts` reads both files and fails if a name declared over
 * there has no counterpart here, so the two cannot drift quietly.
 *
 * ## What the client uses them for
 *
 * Listening, mostly. A blow that lands is hit points in a script and a shower
 * of motes in the renderer, and the second is not a script's business:
 * `host.on(Damage, ...)` is how the game hears what the rules decided. The one
 * it announces is `Swing`, because only the thing swinging knows when the blade
 * is at the point of its arc.
 */

import { defineEvent } from '@hexdelve/engine';

/*
 * The reach is `player.ts`'s, because that is where it is measured — off the
 * clip, as the blade sweeps. A second definition of the same four numbers here
 * would be one more thing to keep in step for no gain. The type import is
 * erased, so nothing circular survives to run.
 */
import type { Reach } from './player.js';

/** Where something is, in world units. */
export interface Point {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

/** A blow landing on somebody. */
export interface Blow {
	readonly amount: number;
	readonly from: string;
	readonly at: Point;
}

export const Damage = defineEvent<Blow>('damage');
export const Died = defineEvent<{ readonly who: string }>('died');

export const Swing = defineEvent<{
	readonly by: string;
	readonly at: Point;
	readonly facing: number;
	readonly reach: Reach;
	readonly amount: number;
}>('swing');

export const Missed = defineEvent<{ readonly by: string; readonly why: string }>('missed');
export const Landed = defineEvent<{ readonly by: string; readonly on: string }>('landed');

export type { Reach };
