/*
 * The largest empty rectangle in a bitmap, in O(w * h).
 *
 * The naive version is four nested loops around a fifth that tests the
 * candidate — O((w*h)^3) — and it is unusable at the sizes a level wants. This
 * is the histogram method, and it is worth writing down because it is not the
 * kind of algorithm anyone derives at the keyboard.
 *
 * ## The idea
 *
 * Walk the bitmap row by row keeping one running count per column: zero where
 * the cell is blocked, otherwise one more than the row above. That number says
 * how far straight up you can go from here without hitting anything — so after
 * each row you are holding a HISTOGRAM, and every rectangle whose bottom edge
 * lies on this row is a rectangle under that histogram.
 *
 * Treat each column as a base point of height `h`. The rectangle it can be the
 * bottom of extends left and right for as long as the neighbouring bars are at
 * least `h` tall, which is to say: up to, but not including, the next bar
 * strictly shorter than it on either side. So the answer for that column is
 * `h * (nextLower - prevLower - 1)`, and the answer for the bitmap is the best
 * of those over every column of every row.
 *
 * ## Finding the next lower bar without looking
 *
 * Scanning outwards from each column would work and would cost a factor of the
 * width. Instead both directions are precomputed in one pass each with a
 * MONOTONIC STACK: push column indices while the heights are not decreasing,
 * and when one finally decreases, unwind — every index that comes off has just
 * found its next lower bar, which is the column that forced the unwind. Each
 * index is pushed once and popped once, so the pass is linear.
 *
 * The defaults are the part to get right. A bar with nothing shorter to its
 * right can extend to the last column, so `nextLower` defaults to `width` and
 * the arithmetic above gives the right answer without a special case; going the
 * other way, `prevLower` defaults to `-1` for the same reason.
 *
 * Ties are broken as *strictly* lower in both directions. Two bars of equal
 * height therefore each think they can only reach the other, and the wider
 * rectangle they jointly support is found from whichever of them the scan
 * reaches — so the maximum is still correct, and no case has to be added for it.
 */

export interface Rect {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export function area(rect: Rect): number {
	return rect.width * rect.height;
}

export function rectContains(rect: Rect, x: number, y: number): boolean {
	return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
}

/**
 * The biggest rectangle of unblocked cells, or null if there is not one.
 *
 * `blocked` is one byte per cell, row-major, non-zero where a cell may not be
 * used. `minWidth` and `minHeight` reject rectangles too small to be worth
 * having before they are compared, which is what lets a caller ask for "the
 * biggest room-shaped thing here" rather than "the biggest thing here".
 */
export function largestRectangle(
	blocked: Uint8Array,
	width: number,
	height: number,
	minWidth = 1,
	minHeight = 1,
): Rect | null {
	if (width <= 0 || height <= 0) return null;

	const heights = new Int32Array(width);
	const prevLower = new Int32Array(width);
	const nextLower = new Int32Array(width);
	const stack = new Int32Array(width);

	let best: Rect | null = null;
	let bestArea = 0;

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			heights[x] = blocked[x + y * width] ? 0 : heights[x]! + 1;
		}

		// Rightwards: the first column strictly shorter than this one, or past
		// the end when there is none.
		let top = 0;
		for (let x = 0; x < width; x++) {
			while (top > 0 && heights[stack[top - 1]!]! > heights[x]!) {
				nextLower[stack[--top]!] = x;
			}
			stack[top++] = x;
		}
		while (top > 0) nextLower[stack[--top]!] = width;

		// And leftwards, which is the same walk backwards.
		top = 0;
		for (let x = width - 1; x >= 0; x--) {
			while (top > 0 && heights[stack[top - 1]!]! > heights[x]!) {
				prevLower[stack[--top]!] = x;
			}
			stack[top++] = x;
		}
		while (top > 0) prevLower[stack[--top]!] = -1;

		for (let x = 0; x < width; x++) {
			const barHeight = heights[x]!;
			if (barHeight < minHeight) continue;

			const barWidth = nextLower[x]! - prevLower[x]! - 1;
			if (barWidth < minWidth) continue;

			const size = barHeight * barWidth;
			if (size <= bestArea) continue;

			bestArea = size;
			best = {
				x: prevLower[x]! + 1,
				// The bar's height counts upwards from the row being scanned,
				// so the rectangle's top is that many rows above it.
				y: y - barHeight + 1,
				width: barWidth,
				height: barHeight,
			};
		}
	}

	return best;
}
