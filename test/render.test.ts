/*
 * Does the yard still look like the yard?
 *
 * Every other test in this project proves something about the code without
 * ever looking at a picture: the shaders compile, the pipelines build, a
 * screen point maps back to the ground it came from, a blend tree blends. None
 * of them would notice if a change to the lighting turned the whole yard
 * black, or if a sign flip in the shadow matrix put every shadow on the wrong
 * side of every building. Before this, the only thing catching that was
 * somebody opening the page and looking.
 *
 * So a picture is kept in the repository and compared against. WebGL2 only,
 * because that is the backend that renders reliably on a build machine — see
 * backends.test.ts for the two-backend comparison, which needs a working
 * WebGPU device and usually does not get one.
 *
 * The comparison is deliberately not exact, and not naively tolerant either:
 * see harness/image-diff.mjs, which explains why a plain per-pixel comparison
 * cannot separate a different rasteriser from a moved sun, and what it does
 * instead.
 *
 * When the picture is meant to change, regenerate it:
 *
 *     npm run build && UPDATE_REFERENCE=1 npm test -- render
 *
 * and look at the result before committing it. A reference nobody looked at is
 * a reference that certifies whatever bug was present when it was made.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { harnessAvailable, withHarness, WIDTH, HEIGHT } from './harness/render-harness.mjs';
import { readPng, writePng } from './harness/png.mjs';
import {
	ALLOWED_FRACTION,
	CHANNEL_TOLERANCE,
	compareFrames,
	distinctColours,
} from './harness/image-diff.mjs';

const REFERENCE = resolve(import.meta.dirname, 'reference', 'yard-webgl2.png');

const update = process.env['UPDATE_REFERENCE'] === '1';
const writeImages = process.env['WRITE_IMAGES'] === '1';

const reason = await harnessAvailable();

describe.skipIf(reason !== null)('the yard', () => {
	it('renders through WebGL2 as it did', async () => {
		const outcome = await withHarness(async (capture) => {
			const shot = await capture('webgl2');
			/*
			 * WebGL2 is software-rasterised here and has no device to lose, so
			 * a refusal to render is a code problem, not an environment one.
			 */
			if (!shot.ok) throw new Error(`WebGL2 would not render: ${shot.why}`);
			expect([shot.width, shot.height]).toEqual([WIDTH, HEIGHT]);

			// Before comparing anything: is this a picture at all? A frame that
			// failed to draw comes back as a clear-coloured rectangle, which
			// would sail past any comparison if the reference were ever
			// regenerated from one.
			const colours = distinctColours(shot.pixels, 64);
			expect(colours, 'nothing drew').toBeGreaterThanOrEqual(64);

			if (update) {
				mkdirSync(dirname(REFERENCE), { recursive: true });
				writePng(REFERENCE, shot.width, shot.height, shot.pixels);
				console.log(`wrote ${REFERENCE} (${shot.width}x${shot.height}, ${colours}+ colours)`);
				console.log('      Look at it before committing it.');
				return;
			}

			expect(
				existsSync(REFERENCE),
				`no reference at ${REFERENCE} — regenerate with UPDATE_REFERENCE=1`,
			).toBe(true);

			const reference = readPng(REFERENCE);
			expect(
				[reference.width, reference.height],
				'the reference is a different size — regenerate it',
			).toEqual([shot.width, shot.height]);

			const { pixels, differing, fraction, worst, mean, diff } = compareFrames(
				shot.pixels,
				reference.pixels,
				shot.width,
				shot.height,
			);

			console.log(`${pixels} pixels compared against the reference`);
			console.log(`  mean distance:  ${mean.toFixed(2)}`);
			console.log(`  worst distance: ${worst}`);
			console.log(
				`  over tolerance (${CHANNEL_TOLERANCE}): ${differing} (${(fraction * 100).toFixed(3)}%, allowed ${ALLOWED_FRACTION * 100}%)`,
			);

			if (writeImages || fraction > ALLOWED_FRACTION) {
				writePng('/tmp/render-actual.png', shot.width, shot.height, shot.pixels);
				writePng('/tmp/render-reference.png', reference.width, reference.height, reference.pixels);
				writePng('/tmp/render-diff.png', shot.width, shot.height, diff);
				console.log('  images written to /tmp/render-{actual,reference,diff}.png');
			}

			expect(
				fraction,
				'the yard no longer looks like the stored picture. Open /tmp/render-diff.png: ' +
					'red is where they differ. If the change was intended, regenerate with ' +
					'UPDATE_REFERENCE=1.',
			).toBeLessThanOrEqual(ALLOWED_FRACTION);
		});

		// null is the harness saying there was no browser after all, which the
		// skip above should already have caught.
		expect(outcome, 'the harness found no browser').not.toBeNull();
	});
});

if (reason) console.log(`render: skipped — ${reason}`);
