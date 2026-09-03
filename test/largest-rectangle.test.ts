/*
 * Does the histogram method find the largest empty rectangle?
 *
 * This one is checkable against the truth rather than against a property,
 * because the naive answer exists: four nested loops around a fifth that tests
 * the candidate. It is O((w*h)^3) and unusable at the size a level wants, which
 * is the whole reason for the clever version — but on a nine-by-nine bitmap it
 * is instant and it is definitionally right. So the fast one is checked against
 * the slow one over a few thousand random bitmaps, which is worth far more than
 * any number of hand-written cases.
 *
 * The parts most likely to be wrong, and what catches each:
 *
 *   the defaults    a bar with nothing shorter to its right must be able to
 *                   reach the last column, which is what `nextLower` defaulting
 *                   to `width` buys. Get it wrong and the answer is a little
 *                   too small on exactly the bitmaps where the best rectangle
 *                   touches an edge.
 *   ties            equal heights are treated as strictly lower in both
 *                   directions, so neither of a pair believes it can reach past
 *                   the other. The maximum is still right; a comparison against
 *                   brute force is the only thing that says so.
 *   the y of it     the height counts UPWARDS from the row being scanned, so
 *                   the rectangle's top is that many rows above it. An
 *                   off-by-one here still returns the right AREA, which is why
 *                   the returned rectangle is checked for being empty and in
 *                   bounds rather than only for its size.
 */

import { describe, expect, it } from 'vitest';
import { area, largestRectangle, type Rect } from '@hexdelve/client';

/** The definition, four nested loops and all. */
function brute(
	blocked: Uint8Array,
	width: number,
	height: number,
	minWidth: number,
	minHeight: number,
): number {
	let best = 0;
	for (let y0 = 0; y0 < height; y0++) {
		for (let x0 = 0; x0 < width; x0++) {
			for (let y1 = y0; y1 < height; y1++) {
				for (let x1 = x0; x1 < width; x1++) {
					const w = x1 - x0 + 1;
					const h = y1 - y0 + 1;
					if (w < minWidth || h < minHeight) continue;
					if (w * h <= best) continue;
					let empty = true;
					for (let y = y0; y <= y1 && empty; y++) {
						for (let x = x0; x <= x1; x++) {
							if (blocked[x + y * width]) {
								empty = false;
								break;
							}
						}
					}
					if (empty) best = w * h;
				}
			}
		}
	}
	return best;
}

function isEmptyAndInside(rect: Rect, blocked: Uint8Array, width: number, height: number): boolean {
	if (rect.x < 0 || rect.y < 0) return false;
	if (rect.x + rect.width > width || rect.y + rect.height > height) return false;
	for (let y = rect.y; y < rect.y + rect.height; y++) {
		for (let x = rect.x; x < rect.x + rect.width; x++) {
			if (blocked[x + y * width]) return false;
		}
	}
	return true;
}

describe('largestRectangle', () => {
	it('finds nothing in an empty or fully blocked bitmap', () => {
		expect(largestRectangle(new Uint8Array(0), 0, 0)).toBeNull();
		expect(largestRectangle(new Uint8Array(9).fill(1), 3, 3)).toBeNull();
	});

	it('takes the whole bitmap when nothing is blocked', () => {
		const rect = largestRectangle(new Uint8Array(35), 7, 5)!;
		expect(rect).toEqual({ x: 0, y: 0, width: 7, height: 5 });
	});

	it('agrees with the definition on random bitmaps', () => {
		// A deterministic sequence, so a failure is a failure anyone can repeat.
		let seed = 12345;
		const random = (): number => {
			seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
			return seed / 0x7fffffff;
		};

		for (let trial = 0; trial < 3000; trial++) {
			const width = 1 + Math.floor(random() * 9);
			const height = 1 + Math.floor(random() * 9);
			const blocked = new Uint8Array(width * height);
			const density = random() * 0.6;
			for (let i = 0; i < blocked.length; i++) blocked[i] = random() < density ? 1 : 0;

			const minWidth = 1 + Math.floor(random() * 3);
			const minHeight = 1 + Math.floor(random() * 3);

			const got = largestRectangle(blocked, width, height, minWidth, minHeight);
			const want = brute(blocked, width, height, minWidth, minHeight);

			expect(got ? area(got) : 0, `trial ${trial}`).toBe(want);
			if (got) {
				expect(got.width).toBeGreaterThanOrEqual(minWidth);
				expect(got.height).toBeGreaterThanOrEqual(minHeight);
				// The rectangle it named, not merely a number of the right size.
				expect(isEmptyAndInside(got, blocked, width, height), `trial ${trial}`).toBe(true);
			}
		}
	});

	it('is linear enough to run on a level-sized bitmap', () => {
		// The point of the histogram method. The naive version on this bitmap is
		// (200*200)^3 candidate tests, which is not a number of tests.
		const width = 200;
		const height = 200;
		const blocked = new Uint8Array(width * height);
		for (let i = 0; i < blocked.length; i += 37) blocked[i] = 1;

		const started = performance.now();
		const rect = largestRectangle(blocked, width, height)!;
		expect(performance.now() - started).toBeLessThan(500);
		expect(isEmptyAndInside(rect, blocked, width, height)).toBe(true);
	});
});
