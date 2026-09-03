/*
 * tools/check-tiles.mjs — is the dungeon tileset the tileset it says it is?
 *
 *     node tools/check-tiles.mjs
 *
 * The wave function is the part of level generation that fails without telling
 * anyone. Every mistake available in a tileset produces levels: a rotation that
 * turns the wrong way gives corridors that bend the wrong way, an asymmetric
 * propagator gives supporter counts that drift and a solver that bans tiles it
 * had no reason to, and a tile with no legal neighbour in some direction is
 * simply never placed. None of them throws. All of them look like a plausible
 * dungeon on screen, which is exactly why looking at one is not a check.
 *
 * So this asserts the four things the solver assumes and the panel draws:
 *
 *   the edge mapping   edge `d` faces the neighbour `AXIAL_DIRECTIONS[d]` is,
 *                      which is what the bench's edge walls and the tileset
 *                      glyphs both stand on
 *   the rotations      each spec expands to its own cardinality — a straight
 *                      hall is three tiles, a chamber is one — because a sign
 *                      error in the rotation shows up here and nowhere else
 *   the symmetry       `t2` may follow `t1` across `d` exactly when `t1` may
 *                      follow `t2` across `d + 3`; the propagation counters are
 *                      meaningless without it
 *   no orphans         every tile has a legal neighbour in all six directions
 *
 * mxgmn's own model prints a warning for the last of those and carries on. It
 * is a hard failure here: a tile that cannot be placed is a tile whose weight
 * is a lie, and the whole character of the output is those weights.
 */

import { AXIAL_DIRECTIONS, axialToWorld } from '../packages/shared/dist/index.js';
import {
	buildPropagator,
	DUNGEON_TILES,
	expandTiles,
	openMask,
} from '../packages/client/dist/levelgen/index.js';

/** How many distinct rotations each spec must have. Six over its own period. */
const EXPECTED_ROTATIONS = {
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

let failed = 0;

function ok(message) {
	console.log(`  ok    ${message}`);
}

function fail(message) {
	console.error(`  FAIL  ${message}`);
	failed++;
}

/* ------------------------------------------------------- the edge mapping -- */

console.log('Edge d faces the neighbour the grid puts in direction d.');
{
	// The glyph and the bench both place edge `d` between corners `d + 1` and
	// `d + 2` of the engine's unit hex. That has to point at the neighbour.
	const corner = (k) => [Math.sin((Math.PI / 3) * k), Math.cos((Math.PI / 3) * k)];
	let worst = 0;
	for (let d = 0; d < 6; d++) {
		const [ax, ay] = corner((d + 1) % 6);
		const [bx, by] = corner((d + 2) % 6);
		const mx = (ax + bx) / 2;
		const my = (ay + by) / 2;
		const midLength = Math.hypot(mx, my);

		const step = AXIAL_DIRECTIONS[d];
		const { x, z } = axialToWorld(step.q, step.r);
		const stepLength = Math.hypot(x, z);

		worst = Math.max(worst, Math.hypot(mx / midLength - x / stepLength, my / midLength - z / stepLength));
	}
	if (worst < 1e-12) ok(`every edge faces its own neighbour (worst ${worst.toExponential(1)})`);
	else fail(`edge ${worst.toExponential(2)} away from the neighbour it is the socket for`);
}

/* --------------------------------------------------------- the rotations -- */

console.log('\nA spec expands to six rotations over its own period, and no more.');
const tiles = expandTiles();
{
	const counts = new Map();
	for (const tile of tiles) counts.set(tile.spec.name, (counts.get(tile.spec.name) ?? 0) + 1);

	let wrong = 0;
	for (const spec of DUNGEON_TILES) {
		const want = EXPECTED_ROTATIONS[spec.name];
		const got = counts.get(spec.name) ?? 0;
		if (want === undefined) {
			fail(`${spec.name} is in the tileset but not in this check — add it`);
			wrong++;
		} else if (got !== want) {
			fail(`${spec.name} expanded to ${got} rotations, expected ${want}`);
			wrong++;
		}
	}
	if (!wrong) ok(`${DUNGEON_TILES.length} specs expanded to ${tiles.length} tiles`);

	// And a rotation really is a rotation: turning k steps must carry the
	// socket on edge d - k onto edge d, for every tile the expansion kept.
	let carried = 0;
	for (const tile of tiles) {
		const base = [...tile.spec.edges].map((c) => (c === 'c' ? 1 : c === 'r' ? 2 : 0));
		for (let d = 0; d < 6; d++) {
			if (tile.sockets[d] !== base[(d - tile.rotation + 6) % 6]) carried++;
		}
	}
	if (carried) fail(`${carried} sockets did not survive their own rotation`);
	else ok('every rotation carries edge d - k onto edge d');
}

/* ---------------------------------------------------------- the symmetry -- */

console.log('\nAdjacency is a rule, so it agrees with itself both ways round.');
const propagator = buildPropagator(tiles);
{
	const allowed = propagator.map((perDirection) => perDirection.map((row) => new Set(row)));
	let broken = 0;
	for (let d = 0; d < 6; d++) {
		const back = (d + 3) % 6;
		for (let t1 = 0; t1 < tiles.length; t1++) {
			for (const t2 of allowed[d][t1]) {
				if (!allowed[back][t2].has(t1)) broken++;
			}
		}
	}
	const pairs = propagator.reduce((sum, perDirection) => sum + perDirection.reduce((n, row) => n + row.length, 0), 0);
	if (broken) fail(`${broken} adjacencies hold one way and not the other`);
	else ok(`${pairs / 6} legal pairs per direction, symmetric in all six`);
}

/* ----------------------------------------------------------- no orphans -- */

console.log('\nEvery tile can be placed: it has a neighbour in all six directions.');
{
	let orphans = 0;
	for (let t = 0; t < tiles.length; t++) {
		for (let d = 0; d < 6; d++) {
			if (propagator[d][t].length === 0) {
				fail(`${tiles[t].name} has no legal neighbour across edge ${d}`);
				orphans++;
			}
		}
	}
	if (!orphans) ok(`all ${tiles.length} tiles are placeable`);
}

/* ------------------------------------------------ the mask the level uses -- */

console.log('\nThe open mask the level is built from is the sockets it came from.');
{
	let wrong = 0;
	for (const tile of tiles) {
		const mask = openMask(tile);
		for (let d = 0; d < 6; d++) {
			const open = (mask & (1 << d)) !== 0;
			if (open !== (tile.sockets[d] !== 0)) wrong++;
		}
	}
	if (wrong) fail(`${wrong} edges are open in the mask and shut in the sockets, or the reverse`);
	else ok('the mask matches the sockets on every edge of every tile');
}

console.log(
	failed === 0
		? '\nok    the tileset is what it says it is'
		: `\nFAIL  ${failed} problem${failed === 1 ? '' : 's'} in the tileset`,
);
process.exit(failed === 0 ? 0 : 1);
