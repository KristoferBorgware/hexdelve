/*
 * Does a point on the screen map back to the point in the world drawn there?
 *
 * This exists because of a bug you could see but not easily name: the aim
 * marker followed the cursor left and right correctly and moved only a third
 * as far up and down. The cause was a camera basis derived a second time by
 * hand, with the horizontal half of the up vector negated — so the picking ray
 * and the picture disagreed about where the camera was pointing, and nothing
 * anywhere threw.
 *
 * The test is a round trip, and it is only possible because both halves are
 * available as plain functions: take a point on the ground, push it through
 * the very matrix the renderer draws with to get a position on the screen,
 * hand that back to the picker, and see whether the point comes back. If the
 * two ever disagree again about a sign, an axis or a scale, the distance
 * between what went in and what came out says so immediately.
 *
 * Swept over camera angles, zooms, aspect ratios and both projections, because
 * a sign error can hide at one azimuth and not another — the original was
 * invisible at any pitch of exactly 45 degrees.
 */

import { describe, expect, it } from 'vitest';
import { ISO_PITCH, OrbitCamera, type CameraProjection } from '@hexdelve/engine';
import type { Mat4 } from '@hexdelve/shared';

/** A point through a column-major mat4, divided through by w. */
function project(m: Mat4, x: number, y: number, z: number) {
	const cx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
	const cy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
	const cz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
	const cw = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
	return { x: cx / cw, y: cy / cw, z: cz / cw };
}

const PLANE_Y = 0.31;

/*
 * A tenth of a millimetre. The matrices are Float32Array, and the eye sits
 * sixty metres out, so single precision alone is worth a few microns here — a
 * shallow pitch amplifies it further, because the ray travels further to reach
 * the ground. That is the floor; anything above it is a real disagreement. For
 * scale, the bug this was written for was out by metres.
 */
const TOLERANCE = 1e-4;

const PROJECTIONS: readonly CameraProjection[] = ['orthographic', 'perspective'];
const GROUND: readonly (readonly [number, number])[] = [
	[1.7, -2.3],
	[3.2, -1.1],
	[-0.4, -4.0],
	[1.7, 0.6],
	[0.2, -2.3],
];

describe('picking', () => {
	for (const projection of PROJECTIONS) {
		it(`agrees with the ${projection} matrix the renderer draws with`, () => {
			let worst = 0;
			let worstCase = '';
			let checked = 0;

			for (const yaw of [0, 0.7, 1.08, 2.4, 3.9, 5.6]) {
				for (const pitch of [ISO_PITCH, 0.35, 0.9, 1.3]) {
					for (const zoom of [0.6, 1.35, 3]) {
						for (const aspect of [1, 16 / 9, 0.75]) {
							const camera = new OrbitCamera({
								projection,
								yaw,
								pitch,
								zoom,
								viewHeight: 5.5,
								distance: projection === 'orthographic' ? 60 : 26,
							});
							camera.target[0] = 1.7;
							camera.target[1] = 0.9;
							camera.target[2] = -2.3;

							// The matrix the renderer would draw this frame with.
							const vp = camera.matrix(aspect, 'negative-one-to-one');

							for (const [px, pz] of GROUND) {
								const ndc = project(vp, px!, PLANE_Y, pz!);
								// Off screen at this angle: nothing to check.
								if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) continue;

								const back = camera.groundPoint(ndc.x, ndc.y, aspect, PLANE_Y);
								checked++;
								expect(back, 'a point that is on screen has to hit the plane').not.toBeNull();

								const off = Math.hypot(back!.x - px!, back!.z - pz!);
								if (off > worst) {
									worst = off;
									worstCase = `yaw ${yaw} pitch ${pitch.toFixed(2)} zoom ${zoom} aspect ${aspect.toFixed(2)} at (${px}, ${pz})`;
								}
							}
						}
					}
				}
			}

			expect(checked, 'the sweep has to actually check something').toBeGreaterThan(100);
			expect(worst, `worst disagreement at ${worstCase}`).toBeLessThan(TOLERANCE);
		});
	}
});
