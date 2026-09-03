/*
 * The stand, which is the one thing every bench in this editor has in common.
 *
 * A bench is a subject, alone, held still — and a subject floating in a grey
 * void reads as neither still nor turning. So it gets a pad to stand on and a
 * plinth under that, and the pad is checkered, because a turntable with no
 * texture on it does not read as turning and the whole value of spinning a
 * subject is seeing that it did.
 *
 * Three shades rather than two, because a hex grid cannot be two-coloured —
 * every cell has six neighbours in a ring of odd parity. `(q - r) mod 3` is
 * the three-colouring, and it is what makes the pad read as a grid at all.
 *
 * It lives here rather than in either bench because the character bench and
 * the prop bench are looking at the same thing from the same distance, and two
 * copies of a pad would drift apart in shade, radius and shadow fit until the
 * two views no longer looked like the same room.
 */

import type { HexInstances } from '@hexdelve/engine';
import { axialDisc, axialToWorld, vec3 } from '@hexdelve/shared';

/** A hex disc of this radius in tiles. */
const PAD_RADIUS = 1;
/** How thick the pad is. Its top face is y = 0, so a subject stands on zero. */
export const PAD_DEPTH = 0.3;
const PAD_SHADES = [0x5f7053, 0x6d7f60, 0x4e5c45];
const PAD_EDGE = 0x3c4636;
/** Circumradius of the plinth, chosen to sit just outside the disc. */
const PLINTH_RADIUS = 3.05;

/** What the shadow map has to cover: the pad, and a subject standing on it. */
export const SHADOW_FIT = { center: vec3.vec3(0, 0.8, 0), radius: 3.4 };

export function emitStand(out: HexInstances): void {
	out.push(0, -PAD_DEPTH - 0.09, 0, PLINTH_RADIUS, 0.18, PLINTH_RADIUS, PAD_EDGE);
	for (const cell of axialDisc(PAD_RADIUS)) {
		const { x, z } = axialToWorld(cell.q, cell.r);
		const shade = PAD_SHADES[(((cell.q - cell.r) % 3) + 3) % 3]!;
		out.push(x, -PAD_DEPTH / 2, z, 0.985, PAD_DEPTH, 0.985, shade);
	}
}
