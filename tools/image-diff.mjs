/*
 * tools/image-diff.mjs — comparing two renderings of the same scene.
 *
 * Both picture checks want the same thing and neither wants an exact match.
 * check-render.mjs compares a frame against one stored months ago, possibly
 * rasterised by a different build of SwiftShader; check-backends.mjs compares
 * two frames drawn by two different shader compilers. In both cases an edge
 * pixel landing one place over is the hardware, and a check that failed over
 * it would be reset until nobody read it.
 *
 * The naive fix — allow a percentage of the frame to differ — is badly behaved,
 * because the two things it must separate are not separated by area. Measured
 * on this scene:
 *
 *   comparison                       differing pixels (per-pixel, tolerance 16)
 *   the reference shifted one pixel diagonally        4.678%
 *   the sun moved by four degrees                     0.562%
 *
 * The harmless change is eight times *larger* than the regression. Any
 * threshold that forgives rasteriser jitter forgives a moved sun with room to
 * spare, which is exactly the check quietly passing when it should not.
 *
 * So a pixel is not compared against its counterpart but against its
 * counterpart's neighbourhood: it counts as different only if it differs from
 * every pixel within one of where it should be, in both directions. Jitter is
 * then not a small difference, it is no difference at all — an edge pixel that
 * moved one place over still finds itself next door. The same two comparisons:
 *
 *   the reference shifted one pixel diagonally        0.000%
 *   the sun moved by four degrees                     0.406%
 *
 * Nothing in between, which is what a threshold wants to sit in.
 */

/** How far a pixel may have moved before it counts as having changed. */
const RADIUS = 1;

/** How far a channel may drift, in counts, before a pixel differs at all. */
export const CHANNEL_TOLERANCE = 16;

/**
 * The fraction of the frame allowed to differ.
 *
 * Four times under the subtlest regression measured (a four-degree sun, at
 * 0.406%) and above a jitter floor that the neighbourhood match puts at zero,
 * so there is room for a rasteriser that disagrees by more than position
 * without there being room for a change to the picture.
 */
export const ALLOWED_FRACTION = 0.001;

function channelDistance(a, i, b, j) {
	const dr = Math.abs(a[i] - b[j]);
	const dg = Math.abs(a[i + 1] - b[j + 1]);
	const db = Math.abs(a[i + 2] - b[j + 2]);
	return dr > dg ? (dr > db ? dr : db) : dg > db ? dg : db;
}

/**
 * Compare two RGBA buffers of the same size.
 *
 * Returns the fraction of the frame that differs, the mean and worst
 * per-pixel distance, and a diff image: red where a pixel differs, and
 * elsewhere the scene in grey, darkening with the difference, so that what
 * changed can be read against where it is.
 */
export function compareFrames(a, b, width, height) {
	const diff = Buffer.alloc(width * height * 4, 255);
	let differing = 0;
	let worst = 0;
	let total = 0;

	for (let y = 0; y < height; y++) {
		const top = Math.max(0, y - RADIUS);
		const bottom = Math.min(height - 1, y + RADIUS);
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			const left = Math.max(0, x - RADIUS);
			const right = Math.min(width - 1, x + RADIUS);

			// The nearest either pixel comes to anything near the other. Both
			// directions, because a detail present in one frame and absent from
			// the other is only visible from the side that has it.
			let nearestAB = 255;
			let nearestBA = 255;
			for (let yy = top; yy <= bottom; yy++) {
				for (let xx = left; xx <= right; xx++) {
					const j = (yy * width + xx) * 4;
					const ab = channelDistance(a, i, b, j);
					if (ab < nearestAB) nearestAB = ab;
					const ba = channelDistance(b, i, a, j);
					if (ba < nearestBA) nearestBA = ba;
				}
			}

			const d = nearestAB > nearestBA ? nearestAB : nearestBA;
			total += d;
			if (d > worst) worst = d;
			if (d > CHANNEL_TOLERANCE) {
				differing++;
				diff[i] = 255;
				diff[i + 1] = 0;
				diff[i + 2] = 0;
			} else {
				diff[i] = diff[i + 1] = diff[i + 2] = 255 - d * 4;
			}
		}
	}

	const pixels = width * height;
	return { pixels, differing, fraction: differing / pixels, worst, mean: total / pixels, diff };
}

/**
 * A drawn frame has thousands of colours; a frame that never drew has one.
 *
 * Cheap, and it catches the failure a comparison cannot: a blank rectangle
 * captured and stored as the reference would then match itself forever.
 */
export function distinctColours(pixels, stopAt) {
	const seen = new Set();
	for (let i = 0; i < pixels.length && seen.size < stopAt; i += 4) {
		seen.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
	}
	return seen.size;
}
