/*
 * The half of level generation that is the same whatever carved the rock.
 *
 * A stack's own algorithm decides one thing: which cells are floor, and which
 * edges between them are open. Everything after that — is it connected, what is
 * the largest piece, where are the two ends, how do you get from one to the
 * other — is the same question for a noise band and for a wave function, and
 * asking it in one place is what keeps the bench an honest comparison. If the
 * cave stack had its own idea of "connected" the two numbers on screen would
 * not mean the same thing.
 *
 * The order matters and is worth stating: symmetrise, then flood, then prune,
 * then pick ends, then route. Pruning before flooding would have nothing to
 * prune by; picking ends before pruning would sometimes pick an end in a pocket
 * that is about to be filled in.
 */

import {
	AXIAL_DIRECTIONS,
	axialDisc,
	axialKey,
	type Axial,
} from '@hexdelve/shared';

import type { Level, LevelCell, LevelSettings, LevelStack } from './types.js';

/** A cell while it is still being carved. Same fields, all of them writable. */
export interface DraftCell {
	q: number;
	r: number;
	kind: 'rock' | 'floor';
	open: number;
	tile: string;
	region: number;
	color: number;
}

export const ROCK_COLOR = 0x36322c;

/** A hex disc of solid rock, which is where every stack starts. */
export function solidDraft(radius: number): Map<string, DraftCell> {
	const draft = new Map<string, DraftCell>();
	for (const cell of axialDisc(radius)) {
		draft.set(axialKey(cell.q, cell.r), {
			q: cell.q,
			r: cell.r,
			kind: 'rock',
			open: 0,
			tile: '',
			region: -1,
			color: ROCK_COLOR,
		});
	}
	return draft;
}

/** Every edge to a floor neighbour, for a carve with no notion of walls. */
export const ALL_EDGES = 0b111111;

/**
 * The result of a carve, before the finish.
 *
 * `attempts` is here because one stack can fail: a wave function that paints
 * itself into a contradiction has to be run again on a different seed, and how
 * many times it took is a real property of the algorithm rather than noise. A
 * stack that cannot fail reports 1 and the readout says the same thing about
 * both.
 */
export interface Carved {
	readonly cells: Map<string, DraftCell>;
	readonly attempts: number;
}

/**
 * Turn a carve into a level: make the edges agree, find the components, keep
 * the biggest, and put the entry and the exit as far apart as the floor allows.
 */
export function finishLevel(
	stack: LevelStack,
	settings: LevelSettings,
	carved: Carved,
	startedAt: number,
): Level {
	const cells = carved.cells;

	symmetrise(cells);
	let regions = flood(cells);

	if (settings.prune && regions.count > 1) {
		for (const cell of cells.values()) {
			if (cell.kind === 'floor' && cell.region !== regions.largest) {
				cell.kind = 'rock';
				cell.open = 0;
				cell.tile = '';
				cell.color = ROCK_COLOR;
			}
		}
		// Sealing a pocket takes its neighbours' doors with it, so the masks
		// have to agree again before anything counts them.
		symmetrise(cells);
		regions = flood(cells);
	}

	const ends = farthestPair(cells, regions.largest);
	const route = ends ? walk(cells, ends.entry, ends.exit) : [];

	let floor = 0;
	for (const cell of cells.values()) if (cell.kind === 'floor') floor++;

	return {
		stack: stack.id,
		seed: settings.seed,
		radius: settings.radius,
		cells: cells as ReadonlyMap<string, LevelCell>,
		entry: ends?.entry ?? null,
		exit: ends?.exit ?? null,
		route,
		steps: stack.steps,
		stats: {
			cells: cells.size,
			floor,
			rock: cells.size - floor,
			regions: regions.count,
			largest: regions.size,
			route: route.length > 0 ? route.length - 1 : 0,
			attempts: carved.attempts,
			ms: Math.round((performance.now() - startedAt) * 100) / 100,
		},
	};
}

/**
 * An edge is open only if BOTH sides say so.
 *
 * Every stack could be trusted to write symmetric masks and none of them should
 * have to be. A one-way door is not a feature this project has, and the way it
 * would show up is a route the player cannot walk back along — a bug that looks
 * exactly like a rendering mistake from the outside.
 */
function symmetrise(cells: Map<string, DraftCell>): void {
	for (const cell of cells.values()) {
		if (cell.kind !== 'floor') {
			cell.open = 0;
			continue;
		}
		let open = 0;
		for (let d = 0; d < 6; d++) {
			if ((cell.open & (1 << d)) === 0) continue;
			const step = AXIAL_DIRECTIONS[d]!;
			const other = cells.get(axialKey(cell.q + step.q, cell.r + step.r));
			if (!other || other.kind !== 'floor') continue;
			if ((other.open & (1 << ((d + 3) % 6))) === 0) continue;
			open |= 1 << d;
		}
		cell.open = open;
	}
}

interface Regions {
	/** How many separate walkable components there are. */
	count: number;
	/** The id of the biggest, or -1 if there is no floor at all. */
	largest: number;
	/** How many cells are in it. */
	size: number;
}

/** Label every floor cell with its connected component, walking open edges only. */
function flood(cells: Map<string, DraftCell>): Regions {
	for (const cell of cells.values()) cell.region = -1;

	let count = 0;
	let largest = -1;
	let size = 0;

	for (const start of cells.values()) {
		if (start.kind !== 'floor' || start.region !== -1) continue;
		const id = count++;
		let filled = 0;
		const queue: DraftCell[] = [start];
		start.region = id;
		while (queue.length) {
			const cell = queue.pop()!;
			filled++;
			for (const next of openNeighbours(cells, cell)) {
				if (next.region !== -1) continue;
				next.region = id;
				queue.push(next);
			}
		}
		if (filled > size) {
			size = filled;
			largest = id;
		}
	}

	return { count, largest, size };
}

function openNeighbours(cells: Map<string, DraftCell>, cell: DraftCell): DraftCell[] {
	const out: DraftCell[] = [];
	for (let d = 0; d < 6; d++) {
		if ((cell.open & (1 << d)) === 0) continue;
		const step = AXIAL_DIRECTIONS[d]!;
		const next = cells.get(axialKey(cell.q + step.q, cell.r + step.r));
		if (next && next.kind === 'floor') out.push(next);
	}
	return out;
}

/**
 * The two ends of the level, by the double sweep: breadth-first from anywhere
 * to the furthest cell, then breadth-first from THAT to the furthest again.
 *
 * On a tree the pair it finds is exactly the diameter; on a graph with loops it
 * can fall a step or two short, and a dungeon is somewhere between the two. It
 * is two flood fills either way, which is what makes it affordable to run on
 * every keystroke of a slider — the alternative, all-pairs, is not.
 *
 * Which end is the entrance is then decided by distance from the middle, so a
 * party comes in near the rim and walks inwards to the stairs rather than the
 * other way round. It is cosmetic and it is consistent, which is the point:
 * two runs of the same seed put the entrance in the same place.
 */
function farthestPair(
	cells: Map<string, DraftCell>,
	region: number,
): { entry: Axial; exit: Axial } | null {
	if (region < 0) return null;
	let seed: DraftCell | null = null;
	for (const cell of cells.values()) {
		if (cell.region === region) {
			seed = cell;
			break;
		}
	}
	if (!seed) return null;

	const a = furthestFrom(cells, seed);
	const b = furthestFrom(cells, a);
	const distA = Math.abs(a.q) + Math.abs(a.r) + Math.abs(a.q + a.r);
	const distB = Math.abs(b.q) + Math.abs(b.r) + Math.abs(b.q + b.r);
	const entry = distA >= distB ? a : b;
	const exit = entry === a ? b : a;
	return { entry: { q: entry.q, r: entry.r }, exit: { q: exit.q, r: exit.r } };
}

/** Breadth-first over open edges; the last cell reached is a furthest one. */
function furthestFrom(cells: Map<string, DraftCell>, start: DraftCell): DraftCell {
	const seen = new Set<string>([axialKey(start.q, start.r)]);
	let frontier: DraftCell[] = [start];
	let furthest = start;

	while (frontier.length) {
		const next: DraftCell[] = [];
		for (const cell of frontier) {
			furthest = cell;
			for (const neighbour of openNeighbours(cells, cell)) {
				const key = axialKey(neighbour.q, neighbour.r);
				if (seen.has(key)) continue;
				seen.add(key);
				next.push(neighbour);
			}
		}
		frontier = next;
	}

	return furthest;
}

/**
 * The shortest way from one end to the other, through open edges.
 *
 * Breadth-first rather than the shared A*, because `findPath` reasons about
 * cells and this graph's obstacles live on the EDGES between them: a door the
 * tileset left shut is invisible to a predicate that is only ever asked about
 * the cell on the far side of it.
 */
function walk(cells: Map<string, DraftCell>, from: Axial, to: Axial): Axial[] {
	const start = cells.get(axialKey(from.q, from.r));
	const goal = axialKey(to.q, to.r);
	if (!start) return [];

	const cameFrom = new Map<string, string>();
	const seen = new Set<string>([axialKey(from.q, from.r)]);
	let frontier: DraftCell[] = [start];
	let found = false;

	while (frontier.length && !found) {
		const next: DraftCell[] = [];
		for (const cell of frontier) {
			const key = axialKey(cell.q, cell.r);
			if (key === goal) {
				found = true;
				break;
			}
			for (const neighbour of openNeighbours(cells, cell)) {
				const nextKey = axialKey(neighbour.q, neighbour.r);
				if (seen.has(nextKey)) continue;
				seen.add(nextKey);
				cameFrom.set(nextKey, key);
				next.push(neighbour);
			}
		}
		frontier = next;
	}

	if (!seen.has(goal)) return [];

	const path: Axial[] = [];
	let key: string | undefined = goal;
	while (key) {
		const cell = cells.get(key)!;
		path.push({ q: cell.q, r: cell.r });
		key = cameFrom.get(key);
	}
	return path.reverse();
}
