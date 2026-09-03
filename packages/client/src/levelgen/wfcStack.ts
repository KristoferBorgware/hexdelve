/*
 * Stack two: wave function collapse, learning from a drawn dungeon.
 *
 * This was a tiled model over thirteen hand-written tiles whose six edges each
 * carried a wall, corridor or room socket. It produced dungeons and it was
 * wrong, for a reason that had nothing to do with the solver: a "wall between
 * two floor tiles" was a socket on an EDGE, and an edge is not something a
 * character can stand on, walk round or be stopped by. **There is no such thing
 * as half a hexagon.** Everything else in this project agrees — the yard's
 * `passable` asks about a cell, Angband's doors are grids — and the tiled model
 * was the one place that did not.
 *
 * So the tiles are gone and the model underneath them changed with it. In the
 * overlapping model a "tile" is a cell together with its neighbours, read out
 * of a sample; two neighbouring wave cells must agree about the cells they both
 * cover; and every value in the system is one hexagon being floor or being
 * rock. Nothing is authored but `sample.ts`, which is a picture of a dungeon.
 *
 * The trade is worth stating plainly. What was lost is the vocabulary: the old
 * tileset could say "room" and "corridor" and "door" as distinct socket kinds,
 * and this cannot say them at all — it only knows floor and rock, and any room
 * that comes out is a room because the sample had rooms in it, not because the
 * model has a concept of one. What was gained is that the tileset is now a
 * drawing, adjacency is derived instead of declared, and the output is made of
 * whole hexagons.
 *
 * What did NOT change is the solver, which is the point of `model.ts` taking
 * weights and a propagator and no tileset at all. Both of mxgmn's models are
 * the same algorithm over a different table.
 */

import { axialKey, type Axial } from '@hexdelve/shared';

import { finishLevel, solidDraft, type Carved } from './build.js';
import { HexWave, type Heuristic } from './wfc/model.js';
import { learn, type PatternSet, type Reach, type Symmetry } from './wfc/overlapping.js';
import { readSample } from './wfc/sample.js';
import {
	readChoice,
	readParam,
	type Level,
	type LevelSettings,
	type LevelStack,
} from './types.js';

const FLOOR_COLOR = 0x83765f;

/**
 * The learned pattern sets, kept.
 *
 * Learning is a scan of the sample and then an O(T^2) propagator, and at reach 2
 * with mirrors that is a few hundred patterns and tens of thousands of
 * comparisons — nothing, once, and unaffordable on every drag of a slider. The
 * sample never changes at runtime, so there are six possible answers and they
 * are worth keeping.
 */
const learned = new Map<string, PatternSet>();

function patternsFor(reach: Reach, symmetry: Symmetry): PatternSet {
	const key = `${reach}/${symmetry}`;
	const held = learned.get(key);
	if (held) return held;
	const fresh = learn(readSample(), reach, symmetry);
	learned.set(key, fresh);
	return fresh;
}

export const WFC_STACK: LevelStack = {
	id: 'wfc-hex',
	label: 'WFC — overlapping',
	blurb:
		"mxgmn's overlapping model on six neighbours. A pattern is a hex and " +
		'everything within reach of it, read out of a drawn sample; neighbouring ' +
		'cells must agree about the cells they both cover. Nothing is authored ' +
		'but the picture, and every value is one whole hexagon.',
	source: 'mxgmn/WaveFunctionCollapse — OverlappingModel.cs',
	steps: [
		'read every window of the sample dungeon as a pattern',
		'add its rotations, and count how often each was seen',
		'derive adjacency: neighbours must agree on their overlap',
		'pin the rim solid, so the level closes',
		'collapse: observe the lowest-entropy cell, propagate, repeat',
		'retry on the next seed if it contradicts',
		'read each cell off the centre of the pattern it settled on',
	],
	params: [
		{
			key: 'reach',
			label: 'Reach',
			hint: 'How far a pattern sees. 1 is seven cells, 2 is nineteen.',
			min: 1,
			max: 2,
			step: 1,
			value: 1,
			integer: true,
		},
		{
			key: 'rim',
			label: 'Rim',
			hint: 'Rings pinned solid round the edge before the wave runs.',
			min: 1,
			max: 4,
			step: 1,
			value: 2,
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
			key: 'symmetry',
			label: 'Symmetry',
			hint: 'Whether the sample also teaches its own rotations and mirrors.',
			min: 0,
			max: 2,
			step: 1,
			value: 1,
			choices: ['as drawn', 'rotations', 'rotations and mirrors'],
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

	const reach = readParam(WFC_STACK, settings.params, 'reach') as Reach;
	const rim = readParam(WFC_STACK, settings.params, 'rim');
	const maxAttempts = readParam(WFC_STACK, settings.params, 'attempts');
	const symmetry = readChoice(WFC_STACK, settings.params, 'symmetry') as Symmetry;
	const heuristic = readChoice(WFC_STACK, settings.params, 'heuristic') as Heuristic;

	const set = patternsFor(reach, symmetry);

	/*
	 * The rim is pinned by refusing every pattern whose own cell is floor.
	 *
	 * Refusing all but the fully solid pattern would be the obvious thing and is
	 * far too strong: at reach 1 that also forbids the rim's NEIGHBOURS from
	 * being floor, so a two-ring rim silently becomes four and the level shrinks
	 * away from its own edge. What the boundary needs to say is only that
	 * nothing is walkable out there.
	 */
	const edge = settings.radius - rim;
	const outside = (cell: Axial): boolean =>
		(Math.abs(cell.q) + Math.abs(cell.r) + Math.abs(cell.q + cell.r)) / 2 > edge;
	const allow = (cell: Axial, pattern: number): boolean =>
		outside(cell) ? set.isFloor[pattern] === 0 : true;

	let attempts = 0;
	let result = null as ReturnType<HexWave['run']> | null;

	while (attempts < maxAttempts) {
		const wave = new HexWave({
			radius: settings.radius,
			weights: set.weights,
			propagator: set.propagator,
			// A fresh seed per attempt, derived rather than random, so a level
			// that took four goes takes the same four next time.
			seed: (settings.seed + attempts * 0x9e3779b1) | 0,
			heuristic,
			allow,
			fallback: set.solid,
		});
		attempts++;
		result = wave.run();
		if (result.ok) break;
	}

	const cells = solidDraft(settings.radius);
	for (const cell of cells.values()) {
		if (outside(cell)) cell.sealed = true;
	}

	const settled = result;
	if (settled) {
		settled.cells.forEach((cell, i) => {
			// The centre of the pattern a cell settled on IS that cell's value.
			// Every neighbour's pattern asserts the same thing — that is what
			// the overlap rule says — so there is nothing here to reconcile.
			if (set.isFloor[settled.observed[i]!] === 0) return;
			const draft = cells.get(axialKey(cell.q, cell.r));
			if (!draft || draft.sealed) return;
			draft.kind = 'floor';
			draft.tile = 'floor';
			draft.color = FLOOR_COLOR;
		});
	}

	const carved: Carved = { cells, attempts };
	return finishLevel(WFC_STACK, settings, carved, startedAt);
}

/** The pattern set the panel draws, so the bench can show what was learned. */
export function wfcPatterns(reach: Reach = 1, symmetry: Symmetry = 'rotations'): PatternSet {
	return patternsFor(reach, symmetry);
}
