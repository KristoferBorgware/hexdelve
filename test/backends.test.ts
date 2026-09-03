/*
 * Do the two backends draw the same picture?
 *
 * The shaders are written twice, once in WGSL and once in GLSL, so that a
 * change to the lighting has to be made in both places and the two pictures
 * cannot quietly drift apart. That argument only holds if something actually
 * compares them, and until this existed nothing did.
 *
 * It usually cannot run. A WebGPU device on a build machine is either absent
 * or torn down after about a frame, and nothing to compare against is not the
 * same as a disagreement — so a missing WebGPU picture skips rather than
 * fails. WebGL2 refusing to render is a different matter and does fail: it is
 * software-rasterised here and has no device to lose.
 */

import { describe, expect, it } from 'vitest';

import { harnessAvailable, withHarness } from './harness/render-harness.mjs';
import { writePng } from './harness/png.mjs';
import { CHANNEL_TOLERANCE, compareFrames, distinctColours } from './harness/image-diff.mjs';

/*
 * Looser than the golden test's, because two shader compilers can round a
 * gradient differently across a whole face, which is not the position jitter
 * the neighbourhood match absorbs. Still far below a shadow in the wrong place.
 */
const ALLOWED_FRACTION = 0.005;

const writeImages = process.env['WRITE_IMAGES'] === '1';
const reason = await harnessAvailable();

describe.skipIf(reason !== null)('the two backends', () => {
	it('draw the same picture, where there is a WebGPU device to ask', async () => {
		await withHarness(async (capture) => {
			const a = await capture('webgl2');
			const b = await capture('webgpu');

			if (!a.ok) throw new Error(`WebGL2 would not render: ${a.why}`);

			/*
			 * Capturing is not drawing. Before this existed the check would
			 * report "WebGL2 rendered and read back correctly" for a blank
			 * rectangle, because nothing ever looked at a pixel of it.
			 */
			const drawn = distinctColours(a.pixels, 64);
			expect(drawn, 'the WebGL2 frame is blank — nothing drew').toBeGreaterThanOrEqual(64);
			console.log(`WebGL2 drew a real frame (${drawn}+ distinct colours)`);

			if (!b.ok) {
				console.log(`no usable WebGPU device here (${b.why}) — nothing to compare against.`);
				return;
			}

			expect([b.width, b.height]).toEqual([a.width, a.height]);

			const { pixels, differing, fraction, worst, mean, diff } = compareFrames(
				a.pixels,
				b.pixels,
				a.width,
				a.height,
			);

			console.log(`${pixels} pixels compared`);
			console.log(`  mean distance:  ${mean.toFixed(2)}`);
			console.log(`  worst distance: ${worst}`);
			console.log(
				`  over tolerance (${CHANNEL_TOLERANCE}): ${differing} (${(fraction * 100).toFixed(3)}%, allowed ${ALLOWED_FRACTION * 100}%)`,
			);

			if (writeImages || fraction > ALLOWED_FRACTION) {
				writePng('/tmp/backend-webgl2.png', a.width, a.height, a.pixels);
				writePng('/tmp/backend-webgpu.png', b.width, b.height, b.pixels);
				writePng('/tmp/backend-diff.png', a.width, a.height, diff);
				console.log('  images written to /tmp/backend-{webgl2,webgpu,diff}.png');
			}

			expect(
				fraction,
				'the two backends disagree about more than the frame allows. ' +
					'Open /tmp/backend-diff.png: red is where they differ.',
			).toBeLessThanOrEqual(ALLOWED_FRACTION);
		});
	});
});

if (reason) console.log(`backends: skipped — ${reason}`);
