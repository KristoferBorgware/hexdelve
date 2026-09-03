/*
 * tools/check-render.mjs — does the yard still look like the yard?
 *
 *     node tools/check-render.mjs [--update] [--write-images]
 *
 * Every other check in this project proves something about the code without
 * ever looking at a picture: the shaders compile, the pipelines build, a
 * screen point maps back to the ground it came from. None of them would
 * notice if a change to the lighting turned the whole yard black, or if a
 * sign flip in the shadow matrix put every shadow on the wrong side of every
 * building. Until now the only thing catching that was somebody opening the
 * page and looking.
 *
 * So this keeps a picture in the repository and compares against it. WebGL2
 * only, because that is the backend that renders reliably on a build machine —
 * see check-backends.mjs for the two-backend comparison, which needs a working
 * WebGPU device and usually does not get one.
 *
 * The comparison is deliberately not exact, and not naively tolerant either:
 * see image-diff.mjs, which explains why a plain per-pixel comparison cannot
 * separate a different rasteriser from a moved sun, and what it does instead.
 *
 * When the picture is meant to change, regenerate it:
 *
 *     npm run build && node tools/check-render.mjs --update
 *
 * and look at the result before committing it. A reference nobody looked at
 * is a reference that certifies whatever bug was present when it was made.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { withHarness, WIDTH, HEIGHT } from './render-harness.mjs';
import { readPng, writePng } from './png.mjs';
import {
	ALLOWED_FRACTION,
	CHANNEL_TOLERANCE,
	compareFrames,
	distinctColours,
} from './image-diff.mjs';

const REFERENCE = resolve(import.meta.dirname, 'reference', 'yard-webgl2.png');

const update = process.argv.includes('--update');
const writeImages = process.argv.includes('--write-images');

const result = await withHarness(async (capture) => {
	const shot = await capture('webgl2');
	if (!shot.ok) {
		console.error(`FAIL  WebGL2 would not render: ${shot.why}`);
		console.error('      That is a code problem, not an environment one — WebGL2 is');
		console.error('      software-rasterised here and has no device to lose.');
		return 1;
	}

	if (shot.width !== WIDTH || shot.height !== HEIGHT) {
		console.error(`FAIL  captured ${shot.width}x${shot.height}, expected ${WIDTH}x${HEIGHT}`);
		return 1;
	}

	// Before comparing anything: is this a picture at all? A frame that failed
	// to draw comes back as a clear-coloured rectangle, which would sail past
	// any comparison if the reference were ever regenerated from one.
	const colours = distinctColours(shot.pixels, 64);
	if (colours < 64) {
		console.error(`FAIL  the frame has only ${colours} distinct colours — nothing drew.`);
		if (writeImages) {
			writePng('/tmp/render-actual.png', shot.width, shot.height, shot.pixels);
			console.error('      written to /tmp/render-actual.png');
		}
		return 1;
	}

	if (update) {
		mkdirSync(dirname(REFERENCE), { recursive: true });
		writePng(REFERENCE, shot.width, shot.height, shot.pixels);
		console.log(`wrote ${REFERENCE}`);
		console.log(`      ${shot.width}x${shot.height}, ${colours}+ distinct colours`);
		console.log('      Look at it before committing it.');
		return 0;
	}

	if (!existsSync(REFERENCE)) {
		console.error(`FAIL  no reference at ${REFERENCE}`);
		console.error('      Generate one with: node tools/check-render.mjs --update');
		return 1;
	}

	const reference = readPng(REFERENCE);
	if (reference.width !== shot.width || reference.height !== shot.height) {
		console.error(
			`FAIL  the reference is ${reference.width}x${reference.height}, the frame is ${shot.width}x${shot.height}`,
		);
		console.error('      Regenerate it with --update.');
		return 1;
	}

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

	if (fraction > ALLOWED_FRACTION) {
		console.error('\nFAIL  the yard no longer looks like the stored picture.');
		console.error('      Open /tmp/render-diff.png: red is where they differ.');
		console.error('      If the change was intended, regenerate with:');
		console.error('        node tools/check-render.mjs --update');
		return 1;
	}

	console.log('\nok    the yard renders as it did');
	return 0;
});

// A null result is the harness saying there is no browser here, which it has
// already explained. Skipping is not failing.
process.exit(result ?? 0);
