/*
 * The half of level generation that is the same whatever carved the rock.
 *
 * A stack's own algorithm decides one thing: which cells are floor. Everything
 * after that — is it connected, what is the largest piece, where are the two
 * ends, how do you get from one to the other — is the same question for a noise
 * band, a wave function and a graph of rooms, and asking it in one place is what
 * keeps the bench an honest comparison. If the cave stack had its own idea of
 * "connected" the numbers on screen would not mean the same thing.
 *
 * **A hexagon is the atom.** Two floor cells side by side are joined, full
 * stop; a wall is a rock cell and there is nothing else a wall can be. This
 * used to carry a six-bit mask per cell so a tile could have a wall on an edge,
 * which is how the old socket tileset drew a room's back — and it was wrong for
 * a reason no amount of tuning would have found: an edge is not somewhere a
 * character can stand, or path around, or be stopped by. Nothing else in the
 * project believed in it. The mask, the symmetry pass that repaired it, and the
 * slabs the bench drew for it are all gone with the tileset that wanted them.
 *
 * The order matters and is worth stating: flood, STITCH, prune, pick ends,
 * route. Flooding before stitching is what gives the stitcher its list of
 * pieces to join; pruning after it is what makes prune a fallback rather than
 * the main event; and picking ends before either would sometimes put the exit
 * in a pocket that is about to be joined or filled in.
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
	tile: string;
	region: number;
	color: number;
	/**
	 * Rock the carve says must STAY rock, whatever anyone downstream wants.
	 *
	 * There is exactly one use for it and it is the level's edge. Both stacks
	 * keep a rim of solid rock so a passage cannot run off the boundary into
	 * nothing, and a stitcher that is free to tunnel anywhere will happily route
	 * two pieces together straight through that rim — joining the level and
	 * removing the thing that made it a place rather than a fragment. So the
	 * carve marks its rim and the stitch goes round.
	 */
	sealed: boolean;
}

export const ROCK_COLOR = 0x36322c;

/** What a stitched tunnel is made of. Cooler than either stack's own floor. */
export const STITCH_COLOR = 0x565a5c;

/** The tile name a stitched cell carries, so the readout can count them. */
export const STITCH_TILE = 'stitch';

/** A hex disc of solid rock, which is where every stack starts. */
export function solidDraft(radius: number): Map<string, DraftCell> {
	const draft = new Map<string, DraftCell>();
	for (const cell of axialDisc(radius)) {
		draft.set(axialKey(cell.q, cell.r), {
			q: cell.q,
			r: cell.r,
			kind: 'rock',
			tile: '',
			region: -1,
			color: ROCK_COLOR,
			sealed: false,
		});
	}
	return draft;
}

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

	const carvedRegions = flood(cells);
	let regions = carvedRegions;
	let joined = { joins: 0, tunnelled: 0 };

	if (settings.stitch && regions.count > 1) {
		joined = stitch(cells, regions.count, regions.largest);
		// The stitch turned rock into floor, so the labels above are stale in
		// the one direction that matters: cells that were in different pieces
		// are in one.
		regions = flood(cells);
	}

	if (settings.prune && regions.count > 1) {
		for (const cell of cells.values()) {
			if (cell.kind === 'floor' && cell.region !== regions.largest) {
				cell.kind = 'rock';
				cell.tile = '';
				cell.color = ROCK_COLOR;
			}
		}
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
			// The carve's OWN count, before anything downstream tidied it. That
			// is the number a tileset gets tuned against; what the finished
			// level came out as is `pieces` below, and the two being different
			// is the whole point of the stitch.
			regions: carvedRegions.count,
			pieces: regions.count,
			largest: regions.size,
			joins: joined.joins,
			tunnelled: joined.tunnelled,
			route: route.length > 0 ? route.length - 1 : 0,
			attempts: carved.attempts,
			ms: Math.round((performance.now() - startedAt) * 100) / 100,
		},
	};
}

interface Regions {
	/** How many separate walkable components there are. */
	count: number;
	/** The id of the biggest, or -1 if there is no floor at all. */
	largest: number;
	/** How many cells are in it. */
	size: number;
}

/** Label every floor cell with the connected component it belongs to. */
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

/** The floor cells a body could step to from here. */
function openNeighbours(cells: Map<string, DraftCell>, cell: DraftCell): DraftCell[] {
	const out: DraftCell[] = [];
	for (const step of AXIAL_DIRECTIONS) {
		const next = cells.get(axialKey(cell.q + step.q, cell.r + step.r));
		if (next && next.kind === 'floor') out.push(next);
	}
	return out;
}

/**
 * Join every piece of the level to the largest, by digging.
 *
 * Both stacks that need this cannot do it. The noise band opens a tile where a
 * field crosses a band and has no way to ask whether the tile next door landed
 * on the same side of it; the wave function enforces adjacency and nothing
 * else, so every one of its levels is locally legal and globally a handful of
 * separate dungeons. **Connectivity is not a property either algorithm is able
 * to state**, which is why it belongs here — after the carve has had its say,
 * applying to whatever the carve was.
 *
 * ## One flood, not one per join
 *
 * The obvious shape is Prim's on the graph of pieces: breadth-first from
 * everything joined so far, dig to the nearest piece that is not, repeat. It is
 * correct, it reads well, and it is quadratic — one flood of the whole disc per
 * join. That is invisible at radius 14 with eight pieces and fatal at radius
 * 200 with seven hundred: **158 seconds**, measured, against about a tenth of a
 * second for everything else the level needed.
 *
 * So the flood happens once. A single breadth-first search leaves EVERY floor
 * cell at the same time and spreads through the rock, and each rock cell
 * records which piece reached it first and which way that piece lies. What that
 * builds is a Voronoi diagram of the pieces, drawn in rock — and the moment two
 * pieces' territories touch is a candidate tunnel between them, whose length is
 * how far each had come plus the step across. Every candidate any join could
 * want is found in that one pass.
 *
 * What remains is a minimum spanning tree over a few hundred pieces rather than
 * a few hundred thousand cells, and then digging the chosen tunnels — which
 * costs their own length and nothing more, because the way back to each piece
 * is already recorded.
 *
 * ## What it is allowed to do
 *
 * It digs a passage exactly one tile wide: the minimum that connects, and it
 * reads on screen as something cut rather than something found. It will not
 * touch `sealed` rock — the rim both stacks keep so a passage cannot run off
 * the boundary — because a stitcher free to route round the outside joins the
 * level up by removing the thing that made it a place. And a piece walled in
 * behind sealed rock is left for `prune`.
 */
function stitch(
	cells: Map<string, DraftCell>,
	regions: number,
	largest: number,
): { joins: number; tunnelled: number } {
	if (largest < 0 || regions < 2) return { joins: 0, tunnelled: 0 };

	const { from, candidates } = floodTerritories(cells);
	const chosen = spanPieces(candidates, regions, largest);

	let joins = 0;
	let tunnelled = 0;
	for (const link of chosen) {
		joins++;
		tunnelled += dig(cells, link, from);
	}

	return { joins, tunnelled };
}

/** One tunnel a join could use: where the two territories met, and how far. */
interface Candidate {
	readonly a: number;
	readonly b: number;
	readonly cost: number;
	/** The two rock cells that touched, one in each piece's territory. */
	readonly at: [string, string];
}

/**
 * Spread every piece through the rock at once, and note where they meet.
 *
 * `owner` is which piece reached a rock cell first and `from` is the key of the
 * cell it came from, so following `from` walks back to that piece. A cell
 * already owned is never re-owned — breadth-first means the first arrival is
 * the nearest one — but it is still *examined*, because that examination is
 * exactly how two territories are found to be adjacent.
 */
function floodTerritories(cells: Map<string, DraftCell>): { from: Map<string, string>; candidates: Map<string, Candidate> } {
	const owner = new Map<string, number>();
	const from = new Map<string, string>();
	const depth = new Map<string, number>();
	const candidates = new Map<string, Candidate>();

	let frontier: DraftCell[] = [];
	for (const cell of cells.values()) {
		if (cell.kind !== 'floor') continue;
		const key = axialKey(cell.q, cell.r);
		owner.set(key, cell.region);
		depth.set(key, 0);
		frontier.push(cell);
	}

	while (frontier.length > 0) {
		const next: DraftCell[] = [];
		for (const cell of frontier) {
			const key = axialKey(cell.q, cell.r);
			const mine = owner.get(key)!;
			const here = depth.get(key)!;

			for (const step of AXIAL_DIRECTIONS) {
				const nextKey = axialKey(cell.q + step.q, cell.r + step.r);
				const neighbour = cells.get(nextKey);
				if (!neighbour || neighbour.sealed) continue;

				const theirs = owner.get(nextKey);
				if (theirs === undefined) {
					// Unclaimed rock: this piece gets there first.
					if (neighbour.kind !== 'rock') continue;
					owner.set(nextKey, mine);
					from.set(nextKey, key);
					depth.set(nextKey, here + 1);
					next.push(neighbour);
					continue;
				}

				if (theirs === mine) continue;
				// Two territories touching. The tunnel is what each of them
				// walked to get here, plus the step between them.
				offer(candidates, {
					a: mine,
					b: theirs,
					cost: here + depth.get(nextKey)! + 1,
					at: [key, nextKey],
				});
			}
		}
		frontier = next;
	}

	return { from, candidates };
}

/** Keep only the cheapest tunnel found between any given pair of pieces. */
function offer(candidates: Map<string, Candidate>, candidate: Candidate): void {
	const key =
		candidate.a < candidate.b ? `${candidate.a}-${candidate.b}` : `${candidate.b}-${candidate.a}`;
	const held = candidates.get(key);
	if (!held || candidate.cost < held.cost) candidates.set(key, candidate);
}

/**
 * A minimum spanning tree over the pieces — Kruskal, on the candidates.
 *
 * Sorted cheapest first with a union-find behind it, which is the standard
 * shape and the right one here because the candidate list is already an edge
 * list rather than a matrix. Anything that would close a loop is skipped, so
 * the result is exactly `pieces - 1` tunnels when the pieces can all be
 * reached, and fewer when some are walled in behind sealed rock.
 */
function spanPieces(
	candidates: Map<string, Candidate>,
	regions: number,
	largest: number,
): Candidate[] {
	const parent = Array.from({ length: regions }, (_, i) => i);
	const find = (x: number): number => {
		let root = x;
		while (parent[root] !== root) root = parent[root]!;
		while (parent[x] !== root) {
			const up = parent[x]!;
			parent[x] = root;
			x = up;
		}
		return root;
	};

	const edges = [...candidates.values()].sort((a, b) => a.cost - b.cost);
	const chosen: Candidate[] = [];
	for (const edge of edges) {
		const a = find(edge.a);
		const b = find(edge.b);
		if (a === b) continue;
		parent[a] = b;
		chosen.push(edge);
	}

	// `largest` is not special to the tree — a spanning tree reaches everything
	// it can reach from anywhere — but it is what the caller means by "joined",
	// and reading it here keeps that intent in one place rather than none.
	void find(largest);
	return chosen;
}

/** Cut the tunnel a candidate names, walking back from where the two met. */
function dig(cells: Map<string, DraftCell>, link: Candidate, from: Map<string, string>): number {
	let cut = 0;

	for (const end of link.at) {
		let key: string | undefined = end;
		while (key !== undefined) {
			const cell = cells.get(key)!;
			// The walk back ends the moment it reaches the piece it started
			// from, which is floor already and wants nothing done to it.
			if (cell.kind === 'floor') break;
			cell.kind = 'floor';
			cell.tile = STITCH_TILE;
			cell.color = STITCH_COLOR;
			cut++;
			key = from.get(key);
		}
	}

	return cut;
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
 * Breadth-first rather than the shared A*, because the route is wanted for
 * drawing rather than for walking: there is no climb rule to apply and no cost
 * to weigh, and a queue is the whole algorithm.
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
