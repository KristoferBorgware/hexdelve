/*
 * Is the dungeon tileset the tileset it says it is?
 *
 * The wave function is, like the blend tree next door, a part of this project
 * that fails without telling anyone. Every mistake available in a WFC tileset
 * still produces levels:
 *
 *   the edge mapping   edge `d` has to face the neighbour `AXIAL_DIRECTIONS[d]`
 *                      is. Get it wrong and every tile is still a plausible
 *                      hexagon with the right number of walls, rotated one
 *                      step — the levels look fine and the corridors bend the
 *                      wrong way. It is the same mapping the bench's edge walls
 *                      and the tileset glyphs both stand on.
 *   the rotations      a straight hall is three tiles and a chamber is one. A
 *                      rotation that turns the wrong way gives the same
 *                      COUNTS, which is why the direction is asserted
 *                      separately: flip the sign and 132 sockets stop
 *                      surviving their own rotation while every cardinality
 *                      still reads correct.
 *   the symmetry       `t2` may follow `t1` across `d` exactly when `t1` may
 *                      follow `t2` across `d + 3`. The solver's supporter
 *                      counts are initialised from one direction and
 *                      decremented from the other, so without this they drift
 *                      and it bans tiles it had no reason to.
 *   no orphans         a tile with no legal neighbour in some direction is
 *                      never placed. Its weight is a lie, and the whole
 *                      character of the output is those weights. mxgmn's own
 *                      model prints a warning and carries on; it is a failure
 *                      here.
 *
 * None of them throws. All of them look like a dungeon. So looking at one is
 * not a check, and this is the half a machine can make.
 */

import { describe, expect, it } from 'vitest';
import { AXIAL_DIRECTIONS, axialToWorld } from '@hexdelve/shared';
import {
	buildPropagator,
	DUNGEON_TILES,
	expandTiles,
	openMask,
	type LevelTile,
} from '@hexdelve/client';

/** How many distinct rotations each spec must have: six over its own period. */
const EXPECTED_ROTATIONS: Record<string, number> = {
	rock: 1,
	chamber: 1,
	'chamber-wall': 6,
	'chamber-bay': 6,
	'chamber-nub': 6,
	door: 6,
	mouth: 6,
	hall: 3,
	'bend-wide': 6,
	'bend-tight': 6,
	fork: 2,
	tee: 6,
	'dead-end': 6,
};

const SOCKET_OF: Record<string, number> = { '.': 0, c: 1, r: 2 };

const tiles: readonly LevelTile[] = expandTiles();
const propagator = buildPropagator(tiles);

/** Corner `k` of the engine's unit hex, which is what the glyphs are drawn from. */
function corner(k: number): [number, number] {
	const angle = (Math.PI / 3) * k;
	return [Math.sin(angle), Math.cos(angle)];
}

describe('the edge mapping', () => {
	it('puts edge d on the side facing the neighbour in direction d', () => {
		for (let d = 0; d < 6; d++) {
			// Edge `d` is the side between corners `d + 1` and `d + 2`.
			const [ax, ay] = corner((d + 1) % 6);
			const [bx, by] = corner((d + 2) % 6);
			const mx = (ax + bx) / 2;
			const my = (ay + by) / 2;
			const midLength = Math.hypot(mx, my);

			// And that has to point where the grid puts that neighbour.
			const step = AXIAL_DIRECTIONS[d]!;
			const { x, z } = axialToWorld(step.q, step.r);
			const stepLength = Math.hypot(x, z);

			expect(mx / midLength).toBeCloseTo(x / stepLength, 12);
			expect(my / midLength).toBeCloseTo(z / stepLength, 12);
		}
	});
});

describe('the rotations', () => {
	it('expands each spec to six rotations over its own period', () => {
		const counts = new Map<string, number>();
		for (const tile of tiles) counts.set(tile.spec.name, (counts.get(tile.spec.name) ?? 0) + 1);

		for (const spec of DUNGEON_TILES) {
			// A spec added without a line here is a spec nothing is asserting.
			expect(EXPECTED_ROTATIONS, `${spec.name} is not in this check`).toHaveProperty(spec.name);
			expect(counts.get(spec.name), spec.name).toBe(EXPECTED_ROTATIONS[spec.name]);
		}

		expect(tiles.length).toBe(
			Object.values(EXPECTED_ROTATIONS).reduce((sum, count) => sum + count, 0),
		);
	});

	it('turns the right way — edge d - k of the spec becomes edge d', () => {
		for (const tile of tiles) {
			const base = [...tile.spec.edges].map((character) => SOCKET_OF[character]!);
			for (let d = 0; d < 6; d++) {
				expect(tile.sockets[d], `${tile.name} edge ${d}`).toBe(base[(d - tile.rotation + 6) % 6]);
			}
		}
	});
});

describe('the propagator', () => {
	it('agrees with itself both ways round', () => {
		const allowed = propagator.map((perDirection) =>
			perDirection.map((row) => new Set<number>(row)),
		);
		for (let d = 0; d < 6; d++) {
			const back = (d + 3) % 6;
			for (let t1 = 0; t1 < tiles.length; t1++) {
				for (const t2 of allowed[d]![t1]!) {
					expect(
						allowed[back]![t2]!.has(t1),
						`${tiles[t1]!.name} takes ${tiles[t2]!.name} across ${d} but not back`,
					).toBe(true);
				}
			}
		}
	});

	it('leaves no tile without a neighbour in any of the six directions', () => {
		for (let t = 0; t < tiles.length; t++) {
			for (let d = 0; d < 6; d++) {
				expect(propagator[d]![t]!.length, `${tiles[t]!.name} across edge ${d}`).toBeGreaterThan(0);
			}
		}
	});

	it('is the socket rule and nothing else', () => {
		// The rule restated independently: two tiles may meet when the edges
		// they show each other are the same socket. If the table ever stops
		// being exactly that, it has grown a special case nobody wrote down.
		for (let d = 0; d < 6; d++) {
			const back = (d + 3) % 6;
			for (let t1 = 0; t1 < tiles.length; t1++) {
				const row = new Set<number>(propagator[d]![t1]!);
				for (let t2 = 0; t2 < tiles.length; t2++) {
					expect(row.has(t2)).toBe(tiles[t1]!.sockets[d] === tiles[t2]!.sockets[back]);
				}
			}
		}
	});
});

describe('the open mask', () => {
	it('is the sockets the tile came from', () => {
		for (const tile of tiles) {
			const mask = openMask(tile);
			for (let d = 0; d < 6; d++) {
				expect((mask & (1 << d)) !== 0, `${tile.name} edge ${d}`).toBe(tile.sockets[d] !== 0);
			}
		}
	});
});
