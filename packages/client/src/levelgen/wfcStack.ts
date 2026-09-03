/*
 * Stack two: wave function collapse, with a tileset written for dungeons.
 *
 * The solver next door is mxgmn's, six-sided; the tileset beside it is this
 * project's own. This file is the part that makes the two into a level: it
 * weights the tiles from the panel's knobs, pins the rim to rock so the disc
 * has an edge, runs the wave, and — because a wave function CAN fail — runs it
 * again on the next seed until one comes out whole.
 *
 * The retry deserves a word, because it is not a workaround. WFC has no
 * backtracking: an observation is never taken back, so a run that paints itself
 * into a corner has no move except to start over. mxgmn's `Program.cs` does the
 * same thing — `for (int k = 0; k < tries; k++) if (model.Run(seed, limit))` —
 * and the honest way to report it is the attempt count, which is why the bench
 * shows it beside the timing. A tileset whose weights are wrong does not look
 * wrong on screen; it looks like twenty attempts.
 *
 * What comes out that the noise carve cannot produce: rooms with straight
 * walls, corridors exactly one tile wide, and doors, because those are three
 * distinct socket vocabularies that can only meet where a tile says they may.
 * What it produces that a dungeon does not want: no guarantee of connection
 * whatsoever. The wave is a LOCAL constraint system — every adjacency is legal
 * and nothing anywhere says the level is one piece — so the shared finish has
 * real work to do here, and the region count in the readout is the number worth
 * watching while the weights are tuned.
 */

import { axialKey, type Axial } from '@hexdelve/shared';

import { finishLevel, solidDraft, type Carved, type DraftCell } from './build.js';
import { HexWave, type Heuristic } from './wfc/model.js';
import {
	buildPropagator,
	DUNGEON_TILES,
	expandTiles,
	openMask,
	type TileSpec,
} from './wfc/tileset.js';
import {
	readChoice,
	readParam,
	type Level,
	type LevelSettings,
	type LevelStack,
} from './types.js';

/** Which specs answer to the `Rooms` knob. */
const ROOM_FAMILY = new Set(['chamber', 'chamber-wall', 'chamber-bay', 'chamber-nub']);

export const WFC_STACK: LevelStack = {
	id: 'wfc-hex',
	label: 'WFC — hex tiles',
	blurb:
		"mxgmn's simple tiled model on six neighbours, over a tileset of hex " +
		'cells whose six edges carry a wall, a corridor or a room socket. ' +
		'Rooms, corridors and doors all fall out of one rule: corridors and ' +
		'rooms are not allowed to meet except through a tile that has both.',
	source: 'mxgmn/WaveFunctionCollapse — Model.cs, SimpleTiledModel.cs',
	steps: [
		'expand 13 tile specs into their distinct hex rotations',
		'derive the propagator from the edge sockets',
		'pin the rim to rock, so the level closes',
		'collapse: observe the lowest-entropy cell, propagate, repeat',
		'retry on the next seed if it contradicts',
		'keep the largest component, mark entry and exit',
	],
	params: [
		{
			key: 'rock',
			label: 'Rock',
			hint: 'Weight on the solid tile. Higher digs less.',
			min: 0.25,
			max: 8,
			step: 0.25,
			value: 4.5,
		},
		{
			key: 'rooms',
			label: 'Rooms',
			hint: 'Weight on the chamber tiles against the corridor tiles.',
			min: 0.2,
			max: 4,
			step: 0.1,
			value: 1,
		},
		{
			key: 'rim',
			label: 'Rim',
			hint: 'Rings of rock pinned round the edge before the wave runs.',
			min: 1,
			max: 4,
			step: 1,
			value: 1,
			integer: true,
		},
		{
			key: 'attempts',
			label: 'Attempts',
			hint: 'Seeds to burn on contradictions before showing the best failure.',
			min: 1,
			max: 40,
			step: 1,
			value: 12,
			integer: true,
		},
		{
			key: 'heuristic',
			label: 'Heuristic',
			hint: 'Which cell to collapse next. Entropy is the one that behaves.',
			min: 0,
			max: 2,
			step: 1,
			value: 0,
			choices: ['entropy', 'mrv', 'scanline'],
		},
	],
	generate: collapse,
};

function collapse(settings: LevelSettings): Level {
	const startedAt = performance.now();

	const rockWeight = readParam(WFC_STACK, settings.params, 'rock');
	const roomWeight = readParam(WFC_STACK, settings.params, 'rooms');
	const rim = readParam(WFC_STACK, settings.params, 'rim');
	const maxAttempts = readParam(WFC_STACK, settings.params, 'attempts');
	const heuristic = readChoice(WFC_STACK, settings.params, 'heuristic') as Heuristic;

	const specs: TileSpec[] = DUNGEON_TILES.map((spec) => ({
		...spec,
		weight: spec.weight * weightScale(spec, rockWeight, roomWeight),
	}));
	const tiles = expandTiles(specs);
	const propagator = buildPropagator(tiles);

	// The pin is the disc's edge. Anything within `rim` of the boundary is
	// rock, so a corridor that runs outwards has to turn or end rather than be
	// cut off by the domain — the same job the original's `ground` flag does
	// for the bottom row of a landscape.
	const edge = settings.radius - rim;
	const pin = (cell: Axial): string | null =>
		(Math.abs(cell.q) + Math.abs(cell.r) + Math.abs(cell.q + cell.r)) / 2 > edge ? 'rock' : null;

	let attempts = 0;
	let result = null as ReturnType<HexWave['run']> | null;

	while (attempts < maxAttempts) {
		const wave = new HexWave({
			radius: settings.radius,
			tiles,
			propagator,
			// A fresh seed per attempt, derived rather than random, so a level
			// that took four goes takes the same four goes next time.
			seed: (settings.seed + attempts * 0x9e3779b1) | 0,
			heuristic,
			pin,
		});
		attempts++;
		result = wave.run();
		if (result.ok) break;
	}

	const cells = solidDraft(settings.radius);
	for (const cell of cells.values()) {
		// The same rim, marked so the stitcher goes round it rather than
		// through it. Pinning it to rock is what the solver was told; sealing it
		// is what everything after the solver is told.
		if (pin(cell) === 'rock') cell.sealed = true;
	}
	const settled = result;
	if (settled) {
		settled.cells.forEach((cell, i) => {
			const draft = cells.get(axialKey(cell.q, cell.r));
			if (!draft) return;
			const tile = tiles[settled.observed[i]!]!;
			paint(draft, tile.name, tile.spec, openMask(tile));
		});
	}

	const carved: Carved = { cells, attempts };
	return finishLevel(WFC_STACK, settings, carved, startedAt);
}

function weightScale(spec: TileSpec, rockWeight: number, roomWeight: number): number {
	if (spec.name === 'rock') return rockWeight;
	if (ROOM_FAMILY.has(spec.name)) return roomWeight;
	return 1;
}

function paint(draft: DraftCell, name: string, spec: TileSpec, open: number): void {
	draft.kind = spec.kind;
	draft.tile = name;
	draft.color = spec.color;
	draft.open = spec.kind === 'floor' ? open : 0;
}
