/*
 * Stack one: chamfer's cave carve, brought down onto a flat hex plane.
 *
 * chamfer hollows its planet by reading a three-octave value-noise field at
 * every block in the crust and opening the ones whose reading lands inside a
 * narrow band either side of zero. That rule is copied here exactly — same
 * noise (see `noise.ts`), same band, same normalisation — and only the domain
 * changes: instead of a block at a radius, the sample is the world position of
 * a hex tile on the y = 0 plane.
 *
 * That one change is the interesting part, and it is worth being precise about
 * why. chamfer's own note on `caveDensity` says the shape it carves is not a
 * network of corridors but ONE FOLDED SHEET, because the zero set of a scalar
 * field in three dimensions is a set of SURFACES and the band around a surface
 * is a slab. Its passages are consequently wide, everywhere-connected, and
 * impossible to narrow without shattering.
 *
 * In two dimensions the same sentence gives the opposite answer. The zero set
 * of a field on a plane is a set of CURVES, and the band around a curve is a
 * RIBBON — which is a corridor. So the algorithm that could not make a narrow
 * connected passage on the planet makes almost nothing else here: winding
 * corridors of a width the threshold sets directly, joining at Y-junctions
 * where two contours meet, with occasional wide chambers where a contour is
 * locally flat. The thing chamfer works around is the thing this wants.
 *
 * What it will not give you is a room. Every space is a widening of a passage,
 * nothing has a straight wall, and there is no vocabulary in the algorithm for
 * "a chamber with four exits" — which is exactly the gap stack two fills.
 */

import { axialToWorld, makeRandom, type Axial } from '@hexdelve/shared';

import { finishLevel, solidDraft, type Carved } from './build.js';
import { fbm } from './noise.js';
import { readParam, type Level, type LevelSettings, type LevelStack } from './types.js';

/** The floor's own seed offset, so the shading is not the carve read twice. */
const SHADE_SEED_OFFSET = 977;

const FLOOR_SHADES = [0x6e6455, 0x776c5c, 0x655c4e, 0x7f7462];

export const CAVE_STACK: LevelStack = {
	id: 'cave-noise',
	label: 'Cave — noise band',
	blurb:
		'The carve chamfer hollows its planet with, read on the ground plane. ' +
		'A tile is open where a three-octave value-noise field lands inside a ' +
		'narrow band either side of zero — on a plane that band is the ribbon ' +
		'round a contour, which is a corridor.',
	source: 'chamfer — packages/engine/src/generation/terrain/caveDensity.ts',
	steps: [
		'sample fBm value noise at each tile',
		'open the tiles inside the band |n| < threshold',
		'force a rim of rock so the level has an edge',
		'open every edge between two floors',
		'keep the largest component, mark entry and exit',
	],
	params: [
		{
			key: 'scale',
			label: 'Scale',
			hint: 'Tiles per lattice cell. Larger is longer, lazier passages.',
			min: 2,
			max: 16,
			step: 0.5,
			value: 7,
		},
		{
			key: 'threshold',
			label: 'Width',
			hint: 'Half-width of the band. This is the corridor width, directly.',
			min: 0.02,
			max: 0.4,
			step: 0.005,
			value: 0.19,
		},
		{
			key: 'octaves',
			label: 'Octaves',
			hint: 'Detail in the field. More makes passages ragged rather than wider.',
			min: 1,
			max: 5,
			step: 1,
			value: 3,
			integer: true,
		},
		{
			key: 'rim',
			label: 'Rim',
			hint: 'Rings of solid rock kept round the edge, so the level closes.',
			min: 0,
			max: 4,
			step: 1,
			value: 1,
			integer: true,
		},
	],
	generate: carve,
};

function carve(settings: LevelSettings): Level {
	const startedAt = performance.now();

	const scale = readParam(CAVE_STACK, settings.params, 'scale');
	const threshold = readParam(CAVE_STACK, settings.params, 'threshold');
	const octaves = readParam(CAVE_STACK, settings.params, 'octaves');
	const rim = readParam(CAVE_STACK, settings.params, 'rim');

	const cells = solidDraft(settings.radius);
	const shade = makeRandom((settings.seed + SHADE_SEED_OFFSET) | 0);
	const open = settings.radius - rim;

	for (const cell of cells.values()) {
		// The rim is the flat-plane stand-in for chamfer's `ceiling`: there,
		// nothing opens within a few metres of the surface so a passage reaches
		// daylight through a mouth in a hillside rather than by removing the
		// ground under a player. Here it stops a corridor from running off the
		// edge of the world into nothing.
		const ring = (Math.abs(cell.q) + Math.abs(cell.r) + Math.abs(cell.q + cell.r)) / 2;
		if (ring > open) {
			// Sealed, not merely rock: the stitcher digs through anything that
			// is not, and a tunnel routed round the outside of the level would
			// join it up by removing the edge that made it a place.
			cell.sealed = true;
			continue;
		}

		const { x, z } = axialToWorld(cell.q, cell.r);
		// Sampled at the tile's own world position over the lattice scale —
		// exactly chamfer's `x * radius / scale`, with the radius that turns a
		// direction into a position dropped, because on a plane there is none.
		const n = fbm(x / scale, 0, z / scale, 1, octaves, settings.seed | 0);
		if (n <= -threshold || n >= threshold) continue;

		cell.kind = 'floor';
		cell.tile = 'cave';
		cell.color = FLOOR_SHADES[Math.floor(shade() * FLOOR_SHADES.length)]!;
	}

	const carved: Carved = { cells, attempts: 1 };
	return finishLevel(CAVE_STACK, settings, carved, startedAt);
}

/** The field at one tile, for anything that wants to draw the carve itself. */
export function caveFieldAt(cell: Axial, seed: number, scale: number, octaves: number): number {
	const { x, z } = axialToWorld(cell.q, cell.r);
	return fbm(x / scale, 0, z / scale, 1, octaves, seed | 0);
}
