/*
 * mxgmn's overlapping model, on hexes.
 *
 * The tiled model needs somebody to write down which tiles may touch. That is
 * fine when tiles are pictures an artist drew, and it was wrong here: a hex
 * cell is the atom of this game, so a "wall between two floor tiles" had to
 * live on an EDGE, which is not a thing a character can stand on, path around,
 * or be blocked by. There is no such thing as half a hexagon.
 *
 * The overlapping model has no tiles at all in that sense. A **pattern** is a
 * cell together with everything within `reach` of it, read out of a sample
 * dungeon; a wave cell holds a pattern, and two neighbouring cells' patterns
 * must AGREE about the cells they both cover. Nothing is authored but the
 * sample, adjacency is not declared but derived, and every value in the whole
 * system is one hexagon being floor or being rock.
 *
 * ## Why the overlap constrains anything
 *
 * A pattern at `c` covers `c` and its neighbours. A pattern at `c + v` covers
 * `c + v` and its neighbours. The two footprints share four cells at reach 1:
 * `c` itself, `c + v` itself, and the two cells adjacent to both — because two
 * neighbouring hexes have exactly two common neighbours. So placing one pattern
 * fixes four sevenths of what its neighbour is allowed to be, and the wave
 * propagates hard.
 *
 * It is also what makes the output well defined. The value at `c` is asserted
 * by `c`'s own pattern and again by every neighbour's, and the overlap rule is
 * exactly the statement that all of them say the same thing. So reading the
 * centre of each observed pattern is not one arbitrary choice among seven; it
 * is the only answer consistent with the whole wave.
 *
 * ## Symmetry
 *
 * The original rotates and reflects the SAMPLE and then extracts patterns; this
 * extracts patterns and then rotates and reflects those. The pattern set is the
 * same, because a rotation of a window of the sample is a window of the rotated
 * sample. The weights differ by a hair at the sample's border, where a window
 * that fits one way round may not fit the other — and a hex sample drawn as a
 * rectangle has no orientation worth preserving anyway.
 *
 * Rotating a pattern is permuting its ring. That is the entire operation, and
 * it is the one thing that is simpler on hexes than on squares: a square
 * pattern rotation is an index shuffle over `N * N` cells that has to be got
 * right, and this is `(k + turn) % 6` on a ring, plus a fixed centre.
 */

import { AXIAL_DIRECTIONS, axialKey, type Axial } from '@hexdelve/shared';

import type { Propagator } from './model.js';
import { readSample, sampleToAxial, type Sample } from './sample.js';

/** How far a pattern sees. 1 is a cell and its six neighbours; 2 is 19 cells. */
export type Reach = 1 | 2;

export type Symmetry = 'as drawn' | 'rotations' | 'rotations and mirrors';

export interface Pattern {
	/** One byte per offset of the shape, in the shape's own order. 1 is floor. */
	readonly cells: Uint8Array;
	/** How often it, or something identical to it, was seen. */
	weight: number;
}

export interface PatternSet {
	readonly shape: readonly Axial[];
	readonly patterns: readonly Pattern[];
	readonly weights: readonly number[];
	readonly propagator: Propagator;
	/** Index of the pattern that is solid everywhere, for pinning and salvage. */
	readonly solid: number;
	/** Whether each pattern's own centre is floor — the value it puts on a cell. */
	readonly isFloor: Uint8Array;
}

/**
 * The offsets a pattern covers: the centre, then each ring outwards.
 *
 * The ORDER is the whole design of this function. Each ring of radius `k` is
 * walked so that turning the plane one sixth carries index `i` onto index
 * `i + k` within that ring — so rotating a pattern is a cyclic shift per ring
 * and nothing else. Written the obvious way, as a scan over a bounding box,
 * rotation becomes a lookup through a coordinate map for every cell of every
 * pattern, which is both slower and a place for a sign to be wrong that nothing
 * would notice: a pattern set rotated the wrong way is still closed under
 * rotation and still produces levels.
 *
 * Centre first is load-bearing too, in one place: {@link learn} reads
 * `cells[0]` as the value a pattern puts on its own cell.
 */
export function patternShape(reach: Reach): Axial[] {
	const shape: Axial[] = [{ q: 0, r: 0 }];

	for (let radius = 1; radius <= reach; radius++) {
		for (let k = 0; k < 6; k++) {
			// Start at the corner `radius` steps along direction k and walk
			// towards the next corner, which is two sixths round — that is the
			// side of a hexagon, and `radius` steps of it land exactly on
			// corner k + 1. Interpolating between the two corners instead is
			// the mistake to avoid: it walks a chord rather than the ring and
			// quietly puts ring-1 cells in ring 2.
			const corner = AXIAL_DIRECTIONS[k]!;
			const along = AXIAL_DIRECTIONS[(k + 2) % 6]!;
			for (let step = 0; step < radius; step++) {
				shape.push({
					q: corner.q * radius + along.q * step,
					r: corner.r * radius + along.r * step,
				});
			}
		}
	}

	return shape;
}

/**
 * Where each ring starts in the shape, and how long it is — which is all a
 * rotation needs to know.
 */
function ringSpans(reach: Reach): { start: number; length: number; shift: number }[] {
	const spans: { start: number; length: number; shift: number }[] = [];
	let start = 1;
	for (let radius = 1; radius <= reach; radius++) {
		spans.push({ start, length: radius * 6, shift: radius });
		start += radius * 6;
	}
	return spans;
}

/**
 * Every distinct window of the sample, counted.
 *
 * Windows are taken only where the whole shape lands inside the sample. The
 * original offers a periodic option that wraps the sample instead; that is
 * right for a texture and wrong for a drawing of a dungeon, where wrapping
 * would teach the model that the left wall is next to the right wall.
 */
export function learn(
	sample: Sample = readSample(),
	reach: Reach = 1,
	symmetry: Symmetry = 'rotations',
): PatternSet {
	const shape = patternShape(reach);
	const spans = ringSpans(reach);
	const turns = symmetry === 'as drawn' ? 1 : 6;
	const mirrors = symmetry === 'rotations and mirrors';

	// Where each shape offset sits, so the propagator can find the overlap.
	const index = new Map<string, number>();
	shape.forEach((offset, i) => index.set(axialKey(offset.q, offset.r), i));

	const bySignature = new Map<string, Pattern>();
	const patterns: Pattern[] = [];

	const add = (cells: Uint8Array): void => {
		const signature = cells.join('');
		const held = bySignature.get(signature);
		if (held) {
			held.weight++;
			return;
		}
		const pattern: Pattern = { cells, weight: 1 };
		bySignature.set(signature, pattern);
		patterns.push(pattern);
	};

	const at = (q: number, r: number): number | null => {
		// Back out of axial into the offset grid the sample was drawn in.
		const row = r;
		const col = q + ((row - (row & 1)) >> 1);
		if (row < 0 || row >= sample.height || col < 0 || col >= sample.width) return null;
		return sample.floor[col + row * sample.width]!;
	};

	for (let row = 0; row < sample.height; row++) {
		for (let col = 0; col < sample.width; col++) {
			const centre = sampleToAxial(col, row);

			const window = new Uint8Array(shape.length);
			let inside = true;
			for (let i = 0; i < shape.length; i++) {
				const value = at(centre.q + shape[i]!.q, centre.r + shape[i]!.r);
				if (value === null) {
					inside = false;
					break;
				}
				window[i] = value;
			}
			if (!inside) continue;

			for (let turn = 0; turn < turns; turn++) {
				const turned = rotate(window, spans, turn);
				add(turned);
				if (mirrors) add(mirror(turned, spans));
			}
		}
	}

	const weights = patterns.map((pattern) => pattern.weight);
	const isFloor = Uint8Array.from(patterns, (pattern) => pattern.cells[0]!);
	const solid = patterns.findIndex((pattern) => pattern.cells.every((value) => value === 0));

	return {
		shape,
		patterns,
		weights,
		propagator: buildPropagator(patterns, shape, index),
		solid: solid < 0 ? 0 : solid,
		isFloor,
	};
}

/**
 * Turn a pattern `turn` sixths about its own centre — a cyclic shift per ring.
 *
 * The centre does not move, and every ring rotates within itself by its own
 * radius' worth of indices, which is exactly what {@link patternShape}'s
 * ordering was built to make true.
 */
function rotate(cells: Uint8Array, spans: RingSpans, turn: number): Uint8Array {
	if (turn === 0) return cells.slice();
	const out = new Uint8Array(cells.length);
	out[0] = cells[0]!;
	for (const { start, length, shift } of spans) {
		const by = (((turn * shift) % length) + length) % length;
		for (let i = 0; i < length; i++) out[start + ((i + by) % length)] = cells[start + i]!;
	}
	return out;
}

/**
 * And mirror it, which on a ring is reversing it.
 *
 * Reflection through the axis the ring starts on: index 0 of each ring stays
 * put and the rest run backwards. On a hex that is a genuine lattice symmetry,
 * so the reflected pattern is a pattern the sample could have contained.
 */
function mirror(cells: Uint8Array, spans: RingSpans): Uint8Array {
	const out = new Uint8Array(cells.length);
	out[0] = cells[0]!;
	for (const { start, length } of spans) {
		for (let i = 0; i < length; i++) out[start + ((length - i) % length)] = cells[start + i]!;
	}
	return out;
}

type RingSpans = ReturnType<typeof ringSpans>;

/** Rotate an axial offset by `turn` sixths. Six of these is the identity. */
export function turnAxial(offset: Axial, turn: number): Axial {
	let { q, r } = offset;
	const steps = ((turn % 6) + 6) % 6;
	for (let i = 0; i < steps; i++) {
		const nq = -r;
		const nr = q + r;
		q = nq;
		r = nr;
	}
	return { q, r };
}

/**
 * `allowed[d][t]` — every pattern that may sit one step in direction `d` from
 * pattern `t`, which is every pattern that agrees with it on their overlap.
 *
 * The overlap is worked out from the shape rather than hard-coded, so reach 2
 * needs no new code: for each offset `o` the second pattern covers, if `v + o`
 * is also covered by the first, both have an opinion about that cell and the
 * two must match.
 */
function buildPropagator(
	patterns: readonly Pattern[],
	shape: readonly Axial[],
	index: Map<string, number>,
): Propagator {
	const T = patterns.length;
	const propagator: Int32Array[][] = [];

	for (let d = 0; d < 6; d++) {
		const v = AXIAL_DIRECTIONS[d]!;

		// The shared cells, as pairs of indices into the two patterns.
		const overlap: [number, number][] = [];
		for (let j = 0; j < shape.length; j++) {
			const offset = shape[j]!;
			const mine = index.get(axialKey(offset.q + v.q, offset.r + v.r));
			if (mine !== undefined) overlap.push([mine, j]);
		}

		const perPattern: Int32Array[] = [];
		for (let t1 = 0; t1 < T; t1++) {
			const a = patterns[t1]!.cells;
			const matches: number[] = [];
			for (let t2 = 0; t2 < T; t2++) {
				const b = patterns[t2]!.cells;
				let agrees = true;
				for (const [i, j] of overlap) {
					if (a[i] !== b[j]) {
						agrees = false;
						break;
					}
				}
				if (agrees) matches.push(t2);
			}
			perPattern.push(Int32Array.from(matches));
		}
		propagator.push(perPattern);
	}

	return propagator;
}
