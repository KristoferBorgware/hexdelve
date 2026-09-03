/*
 * Do the level stacks produce levels you can actually walk?
 *
 * The bench answers this by eye and cannot answer it at scale: a generator is
 * a function from a seed to a shape, and looking at six of them says nothing
 * about the seventh. These are the properties that have to hold for EVERY
 * seed, and every one of them fails silently — a level with a one-way door, a
 * route that steps through a wall, or an exit stranded on the far side of the
 * map all draw perfectly well.
 *
 * Both stacks are put through the same properties on purpose. The whole claim
 * of `finishLevel` is that connectivity, the two ends and the route mean the
 * same thing whatever carved the rock, and a check that only exercised one
 * stack would not be testing that claim.
 */

import { describe, expect, it } from 'vitest';
import { AXIAL_DIRECTIONS, axialKey } from '@hexdelve/shared';
import { defaultParams, LEVEL_STACKS, type Level, type LevelStack } from '@hexdelve/client';

/** Enough seeds to catch a one-in-thirty failure, small enough to stay quick. */
const SEEDS = [1, 2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31];
const RADII = [6, 10, 14];

function generate(stack: LevelStack, seed: number, radius: number, stitch: boolean): Level {
	return stack.generate({ seed, radius, params: defaultParams(stack), stitch, prune: false });
}

describe.each(LEVEL_STACKS.map((stack) => [stack.id, stack] as const))('%s', (_id, stack) => {
	it('leaves every floor cell inside the disc and out of the rim', () => {
		// A hexagon is the atom, so there is no edge state left to get wrong —
		// what is left to check is that floor only ever appears where the stack
		// is allowed to put it.
		for (const seed of SEEDS) {
			const level = generate(stack, seed, 14, true);
			for (const cell of level.cells.values()) {
				if (cell.kind !== 'floor') continue;
				expect(cell.sealed, `floor on sealed rock at ${cell.q},${cell.r}`).toBe(false);
				const ring = (Math.abs(cell.q) + Math.abs(cell.r) + Math.abs(cell.q + cell.r)) / 2;
				expect(ring).toBeLessThanOrEqual(level.radius);
			}
		}
	});

	it('comes out in one piece once it is stitched', () => {
		// The point of the stitch, stated as the property it exists for. Both
		// stacks need it and neither can do it: the noise band cannot ask
		// whether the tile next door landed on the same side of the band, and
		// the wave function enforces adjacency and nothing else.
		for (const seed of SEEDS) {
			for (const radius of RADII) {
				const level = generate(stack, seed, radius, true);
				if (level.stats.floor === 0) continue;
				expect(level.stats.pieces, `seed ${seed} r${radius}`).toBe(1);
				// Prim's on the graph of pieces: joining n pieces takes n - 1
				// tunnels. More than that means it joined something twice.
				expect(level.stats.joins).toBe(level.stats.regions - 1);
			}
		}
	});

	it('never digs through the sealed rim', () => {
		// The rim is what gives the level an edge. A stitcher free to route
		// round the outside would join everything up by removing it.
		for (const seed of SEEDS) {
			const level = generate(stack, seed, 14, true);
			for (const cell of level.cells.values()) {
				if (cell.sealed) expect(cell.kind, `${cell.q},${cell.r}`).toBe('rock');
			}
		}
	});

	it('marks an entry and an exit you can walk between', () => {
		for (const seed of SEEDS) {
			for (const radius of RADII) {
				const level = generate(stack, seed, radius, true);
				if (level.stats.floor < 2) continue;

				expect(level.entry, `seed ${seed} r${radius}`).not.toBeNull();
				expect(level.exit).not.toBeNull();
				expect(level.route.length).toBeGreaterThan(0);

				const first = level.route[0]!;
				const last = level.route[level.route.length - 1]!;
				expect(first).toEqual(level.entry);
				expect(last).toEqual(level.exit);

				for (let i = 1; i < level.route.length; i++) {
					const from = level.route[i - 1]!;
					const to = level.route[i]!;
					const d = AXIAL_DIRECTIONS.findIndex(
						(step) => from.q + step.q === to.q && from.r + step.r === to.r,
					);
					expect(d, `route step ${i} is not a neighbour`).toBeGreaterThanOrEqual(0);
					expect(
						level.cells.get(axialKey(to.q, to.r))?.kind,
						`route step ${i} stands on rock`,
					).toBe('floor');
				}
			}
		}
	});

	it('gives the same level for the same seed', () => {
		// Every stack takes a seeded RNG and the wave function derives its
		// retry seeds rather than drawing them, so a level that took four
		// attempts must take the same four next time.
		for (const seed of SEEDS.slice(0, 4)) {
			const once = generate(stack, seed, 12, true);
			const twice = generate(stack, seed, 12, true);
			// Everything but the timing, which is wall clock and is the one
			// field in the readout that is honestly allowed to differ.
			const { ms: _first, ...a } = once.stats;
			const { ms: _second, ...b } = twice.stats;
			expect(b).toEqual(a);
			expect(twice.route).toEqual(once.route);
			for (const [key, cell] of once.cells) {
				expect(twice.cells.get(key)).toEqual(cell);
			}
		}
	});
});
