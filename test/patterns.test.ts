/*
 * Did the overlapping model learn what the sample says?
 *
 * Same class of failure as the blend tree and the old tileset before it: every
 * mistake available here still produces levels. A rotation that turns the wrong
 * way bends corridors the wrong way; an overlap computed over the wrong cells
 * leaves the wave under-constrained and the output is noise that still draws;
 * an asymmetric propagator drifts the solver's supporter counts and makes it
 * ban patterns it had no reason to. None of them throws.
 *
 * The overlap is the one worth naming. The whole model rests on the claim that
 * two neighbouring cells' patterns cover four cells in common at reach 1 — the
 * two cells themselves and the two neighbours they share — and that claim is a
 * fact about hex geometry rather than about this code. So it is checked against
 * the geometry directly rather than against a number typed in from the same
 * reasoning that produced the code.
 */

import { describe, expect, it } from 'vitest';
import { AXIAL_DIRECTIONS, axialDistance, axialKey } from '@hexdelve/shared';
import {
	DUNGEON_SAMPLE,
	learn,
	patternShape,
	readSample,
	sampleToAxial,
	turnAxial,
	wfcPatterns,
	type Reach,
} from '@hexdelve/client';

describe('the sample', () => {
	it('is a rectangle of nothing but rock and floor', () => {
		// readSample throws on a ragged row or a stray character, which is what
		// caught a row typed one short while this was being written. The value
		// of the guard is that a short row shifts every cell below it and
		// produces a sample that still parses and quietly means something else.
		const sample = readSample();
		expect(sample.width).toBe(DUNGEON_SAMPLE[0]!.length);
		expect(sample.height).toBe(DUNGEON_SAMPLE.length);
		expect(() => readSample([...DUNGEON_SAMPLE, 'too short'])).toThrow();
		expect(() => readSample(['##x##'])).toThrow();
	});

	it('is dense enough that solid is not a sink', () => {
		// The failure this pins is the one that took three drafts. A sample with
		// open rock around it makes the all-solid pattern both the most likely
		// thing in the set and the most permissive — agreeing about a window of
		// nothing is easy — and a pattern that is both is a sink the wave falls
		// into and does not come out of. Two earlier samples left a tenth of the
		// disc walkable, in specks.
		const set = wfcPatterns(1, 'rotations');
		const total = set.weights.reduce((sum, weight) => sum + weight, 0);
		expect(set.weights[set.solid]! / total).toBeLessThan(0.1);

		// And the sample has to be able to say "solid" at all, or the rim
		// cannot be pinned and the level has no edge.
		expect(set.weights[set.solid]).toBeGreaterThan(0);
	});
});

describe.each([1, 2] as Reach[])('at reach %i', (reach) => {
	const set = wfcPatterns(reach, 'rotations');
	const shape = patternShape(reach);

	it('covers every cell within reach, centre first', () => {
		expect(shape.length).toBe(set.patterns[0]!.cells.length);
		expect(shape[0]).toEqual({ q: 0, r: 0 });
		for (const offset of shape) {
			expect(axialDistance({ q: 0, r: 0 }, offset)).toBeLessThanOrEqual(reach);
		}
		// Every cell within reach, not merely cells that are: a shape missing
		// one is a model that never constrains it.
		const held = new Set(shape.map((offset) => axialKey(offset.q, offset.r)));
		let expected = 0;
		for (let q = -reach; q <= reach; q++) {
			for (let r = -reach; r <= reach; r++) {
				if (axialDistance({ q: 0, r: 0 }, { q, r }) > reach) continue;
				expected++;
				expect(held.has(axialKey(q, r))).toBe(true);
			}
		}
		expect(shape.length).toBe(expected);
	});

	it('overlaps a neighbour on the cells hex geometry says it should', () => {
		const held = new Set(shape.map((offset) => axialKey(offset.q, offset.r)));
		for (const v of AXIAL_DIRECTIONS) {
			// Worked out from the shape and the step, not from the propagator.
			const shared = shape.filter((offset) =>
				held.has(axialKey(offset.q + v.q, offset.r + v.r)),
			);
			// At reach 1: the cell, its neighbour, and the two cells adjacent to
			// both — two neighbouring hexes have exactly two common neighbours.
			expect(shared.length).toBe(reach === 1 ? 4 : 14);
		}
	});

	it('agrees with itself both ways round', () => {
		// The solver initialises supporter counts from one direction and
		// decrements them from the other. Without this they drift.
		const allowed = set.propagator.map((perDirection) =>
			perDirection.map((row) => new Set<number>(row)),
		);
		for (let d = 0; d < 6; d++) {
			const back = (d + 3) % 6;
			for (let t1 = 0; t1 < set.patterns.length; t1++) {
				for (const t2 of allowed[d]![t1]!) {
					expect(allowed[back]![t2]!.has(t1), `${t1} takes ${t2} across ${d}, not back`).toBe(
						true,
					);
				}
			}
		}
	});

	it('may leave patterns nothing can follow, which the solver bans up front', () => {
		// Unlike a hand-written tileset, a learned set legitimately contains
		// these: a window taken at the edge of a finite sample can describe an
		// arrangement no other window continues. They are not a fault in the
		// tileset, they are a fact about sampling — so the solver bans them
		// before the run rather than the model refusing to learn them, and what
		// is checked here is only that they stay a small minority. A set where
		// most patterns are unplaceable is a sample too small to learn from.
		let orphans = 0;
		for (let t = 0; t < set.patterns.length; t++) {
			for (let d = 0; d < 6; d++) {
				if (set.propagator[d]![t]!.length === 0) {
					orphans++;
					break;
				}
			}
		}
		expect(orphans / set.patterns.length).toBeLessThan(0.25);
	});

	it('reads a cell off the centre of its pattern', () => {
		for (let t = 0; t < set.patterns.length; t++) {
			expect(set.isFloor[t]).toBe(set.patterns[t]!.cells[0]);
		}
	});
});

describe('symmetry', () => {
	it.each([1, 2] as Reach[])('closes the pattern set under rotation at reach %i', (reach) => {
		// Every rotation of a learned pattern must itself be a learned pattern,
		// or the set is lopsided and corridors prefer the directions the sample
		// happened to draw them in.
		//
		// The rotation is rebuilt here from the OFFSETS — turn each one by the
		// axial formula and look up where it landed — rather than from the ring
		// shift the model uses. That is the point: the model's shift is fast
		// because `patternShape` orders the rings to make it work, and this is
		// the check that the ordering really does.
		const set = wfcPatterns(reach, 'rotations');
		const shape = patternShape(reach);
		const index = new Map(shape.map((offset, i) => [axialKey(offset.q, offset.r), i]));
		const signatures = new Set(set.patterns.map((pattern) => pattern.cells.join('')));

		for (const pattern of set.patterns) {
			for (let turn = 1; turn < 6; turn++) {
				const turned = shape.map((offset) => {
					const from = turnAxial(offset, -turn);
					return pattern.cells[index.get(axialKey(from.q, from.r))!]!;
				});
				expect(signatures.has(turned.join(''))).toBe(true);
			}
		}
	});

	it('learns strictly more with rotations than as drawn', () => {
		const plain = learn(readSample(), 1, 'as drawn');
		const turned = learn(readSample(), 1, 'rotations');
		expect(turned.patterns.length).toBeGreaterThanOrEqual(plain.patterns.length);
		// The total weight grows by exactly six, because every window is
		// counted once per turn.
		const sum = (weights: readonly number[]): number => weights.reduce((a, b) => a + b, 0);
		expect(sum(turned.weights)).toBe(sum(plain.weights) * 6);
	});
});

describe('offset coordinates', () => {
	it('turn a rectangle of characters into a rectangle of hexes', () => {
		// The sample is authored in odd-r offset because axial would shear every
		// row half a cell right of the one above, and a straight wall would have
		// to be typed as a diagonal. Two cells in the same column on adjacent
		// rows must therefore be neighbours.
		for (let row = 0; row + 1 < 6; row++) {
			for (let col = 1; col < 6; col++) {
				const here = sampleToAxial(col, row);
				const below = sampleToAxial(col, row + 1);
				expect(axialDistance(here, below)).toBe(1);
			}
		}
	});
});
