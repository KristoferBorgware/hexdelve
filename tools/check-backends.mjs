/*
 * tools/check-backends.mjs — do the two backends draw the same picture?
 *
 *     node tools/check-backends.mjs [--write-images]
 *
 * The engine's whole bargain is that nothing above the Renderer interface can
 * tell WebGPU from WebGL2. The two shaders are written twice rather than
 * generated from one source, deliberately, so that a change to the lighting
 * has to be made in both places — and without this, the only thing keeping the
 * two pictures together is whoever edited them last remembering to edit both.
 * That is not a guarantee, it is a hope.
 *
 * So: build the same scene twice through render-harness.mjs, capture a frame
 * from each off the GPU, and compare them pixel by pixel.
 *
 * This is a local script rather than a CI step, because it needs a working
 * WebGPU device and a sandboxed runner rarely has one — the machine this was
 * written on tears the device down about one frame in, and a twenty-line
 * clear-loop with no shaders at all dies there the same way. A check that
 * skips itself on every run teaches people to ignore checks. The one that runs
 * in CI is check-render.mjs, which compares WebGL2 against a stored picture.
 */

import { withHarness } from './render-harness.mjs';
import { writePng } from './png.mjs';
import { CHANNEL_TOLERANCE, compareFrames, distinctColours } from './image-diff.mjs';

const writeImages = process.argv.includes('--write-images');

/*
 * Looser than the golden check's, because two shader compilers can round a
 * gradient differently across a whole face, which is not the position jitter
 * the neighbourhood match absorbs. Still far below a shadow in the wrong place.
 */
const ALLOWED_FRACTION = 0.005;

const result = await withHarness(async (capture) => {
	const shots = {};
	for (const backend of ['webgl2', 'webgpu']) {
		shots[backend] = await capture(backend);
		const shot = shots[backend];
		console.log(shot.ok ? `captured ${backend}` : `could not capture ${backend}: ${shot.why}`);
	}

	const a = shots['webgl2'];
	const b = shots['webgpu'];

	if (!a.ok) {
		console.error('\nFAIL  WebGL2 would not render — that is not an environment problem.');
		return 1;
	}

	/*
	 * Capturing is not drawing. Before this existed the script would report
	 * "WebGL2 rendered and read back correctly" for a blank rectangle, because
	 * nothing ever looked at a pixel of it.
	 */
	const drawn = distinctColours(a.pixels, 64);
	if (drawn < 64) {
		console.error(`\nFAIL  the WebGL2 frame has only ${drawn} distinct colours — nothing drew.`);
		if (writeImages) {
			writePng('/tmp/backend-webgl2.png', a.width, a.height, a.pixels);
			console.error('      written to /tmp/backend-webgl2.png');
		}
		return 1;
	}
	console.log(`WebGL2 drew a real frame (${drawn}+ distinct colours)`);

	if (!b.ok) {
		// Not a failure: see the header. Nothing to compare against is not the
		// same as a disagreement.
		console.log('\nskipped: no usable WebGPU device here, so there is nothing to compare against.');
		return 0;
	}

	if (a.width !== b.width || a.height !== b.height) {
		console.error(`\nFAIL  different sizes: ${a.width}x${a.height} against ${b.width}x${b.height}`);
		return 1;
	}

	const { pixels, differing, fraction, worst, mean, diff } = compareFrames(
		a.pixels,
		b.pixels,
		a.width,
		a.height,
	);

	console.log(`\n${pixels} pixels compared`);
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

	if (fraction > ALLOWED_FRACTION) {
		console.error('\nFAIL  the two backends disagree about more than the frame allows.');
		console.error('      Open /tmp/backend-diff.png: red is where they differ.');
		return 1;
	}

	console.log('\nok    the two backends draw the same picture');
	return 0;
});

process.exit(result ?? 0);
