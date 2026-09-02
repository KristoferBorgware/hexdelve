/*
 * tools/check-picking.mjs — does a point on the screen map back to the point
 * in the world that is drawn there?
 *
 *     node tools/check-picking.mjs
 *
 * This exists because of a bug you could see but not easily name: the aim
 * marker followed the cursor left and right correctly and moved only a third
 * as far up and down. The cause was a camera basis derived a second time by
 * hand, with the horizontal half of the up vector negated — so the picking ray
 * and the picture disagreed about where the camera was pointing, and nothing
 * anywhere threw.
 *
 * The check is a round trip, and it is only possible because both halves are
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

import { OrbitCamera, ISO_PITCH } from '../packages/engine/dist/index.js';

/** A point through a column-major mat4, divided through by w. */
function project(m, x, y, z) {
	const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
	const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
	const cz = m[2] * x + m[6] * y + m[10] * z + m[14];
	const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
	return { x: cx / cw, y: cy / cw, z: cz / cw };
}

const PLANE_Y = 0.31;

let worst = 0;
let worstCase = '';
let checked = 0;

for (const projection of ['orthographic', 'perspective']) {
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

					for (const [px, pz] of [
						[1.7, -2.3],
						[3.2, -1.1],
						[-0.4, -4.0],
						[1.7, 0.6],
						[0.2, -2.3],
					]) {
						const ndc = project(vp, px, PLANE_Y, pz);
						// Off screen at this angle: nothing to check.
						if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) continue;

						const back = camera.groundPoint(ndc.x, ndc.y, aspect, PLANE_Y);
						checked++;
						if (!back) {
							console.error(`FAIL  no hit for a point that is on screen`);
							process.exit(1);
						}
						const off = Math.hypot(back.x - px, back.z - pz);
						if (off > worst) {
							worst = off;
							worstCase = `${projection} yaw ${yaw} pitch ${pitch.toFixed(2)} zoom ${zoom} aspect ${aspect.toFixed(2)} at (${px}, ${pz})`;
						}
					}
				}
			}
		}
	}
}

console.log(`round-tripped ${checked} screen points across both projections`);
console.log(`worst distance between what went in and what came out: ${worst.toExponential(3)} m`);

/*
 * A tenth of a millimetre. The matrices are Float32Array, and the eye sits
 * sixty metres out, so single precision alone is worth a few microns here —
 * a shallow pitch amplifies it further, because the ray travels further to
 * reach the ground. That is the floor; anything above it is a real
 * disagreement. For scale, the bug this was written for was out by metres.
 */
if (worst > 1e-4) {
	console.error(`FAIL  picking and the projection disagree — at ${worstCase}`);
	process.exit(1);
}
console.log('ok    picking agrees with the matrix the renderer draws with');
