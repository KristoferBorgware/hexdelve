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
 * The order matters and is worth stating: symmetrise, flood, STITCH, prune,
 * pick ends, route. Flooding before stitching is what gives the stitcher its
 * list of pieces to join; pruning after it is what makes prune a fallback
 * rather than the main event; and picking ends before either would sometimes
 * put the exit in a pocket that is about to be joined or filled in.
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
			open: 0,
			tile: '',
			region: -1,
			color: ROCK_COLOR,
			sealed: false,
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
	const carvedRegions = flood(cells);
	let regions = carvedRegions;
	let joined = { joins: 0, tunnelled: 0 };

	if (settings.stitch && regions.count > 1) {
		joined = stitch(cells, regions.largest);
		// The stitch opened edges and turned rock into floor, so both of the
		// answers computed above are now stale in the one direction that
		// matters: cells that were in different pieces are in one.
		symmetrise(cells);
		regions = flood(cells);
	}

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

/**
 * Join every piece of the level to the largest, by digging.
 *
 * Both stacks need this and neither can do it. The noise band opens a tile
 * where a field crosses a band and has no way to ask whether the tile next
 * door ended up on the same side of it; the wave function enforces adjacency
 * and nothing else, so every one of its levels is locally legal and globally a
 * handful of separate dungeons. Connectivity is not a property either
 * algorithm is able to state, which is exactly why it belongs here — after the
 * carve has had its say, applying to whatever the carve was.
 *
 * The shape of it is Prim's algorithm on the graph of pieces, with the length
 * of the tunnel between two pieces as the edge weight. Start with the largest
 * piece joined; breadth-first outward from everything joined so far, through
 * rock, until the search first touches a piece that is not; dig back along the
 * way it came; repeat. Because the search leaves from EVERY joined cell at
 * once, each round finds the shortest tunnel from anywhere in the joined mass
 * to anywhere in anything else, which is the cheapest join available — and a
 * cheap join is a short tunnel, which is what stops the result looking like
 * somebody ruled lines across the map.
 *
 * Two things it is deliberately allowed to do:
 *
 * **It breaches walls.** A floor cell's edge to rock is shut by definition, so
 * every tunnel starts by opening one that the tileset closed. On a wave
 * function level that means a room's back wall becomes a door. That is not a
 * bug in the tileset — it is the reason this is a separate step and not a
 * constraint inside the solver. A rule that could forbid it would have to be a
 * rule about the whole level, and a wave function has no such rule to give.
 *
 * **It digs a passage exactly one tile wide.** Only the two edges along the
 * path are opened, so a tunnel arrives with walls down both sides even where it
 * runs beside open floor. That is the minimum that connects, it reads on screen
 * as something cut rather than something found, and both of those are wanted:
 * the whole value of seeing the stitch is being able to judge it.
 *
 * The only piece it can fail to reach is one walled in by `sealed` rock, and
 * the rim is the only sealed rock there is — so on a hex disc, where the
 * interior minus its rim is itself a connected disc, it always joins
 * everything. `prune` stays on as a fallback for a carve that ever changes that.
 */
function stitch(
	cells: Map<string, DraftCell>,
	largest: number,
): { joins: number; tunnelled: number } {
	let joins = 0;
	let tunnelled = 0;
	if (largest < 0) return { joins, tunnelled };

	/*
	 * Attachment is tracked per CELL, not per piece.
	 *
	 * Per piece is the obvious way and it is wrong, because a tunnel is floor
	 * that belongs to no piece: it was rock when the flood ran and carries no
	 * label. Reaching one and treating its label as a piece attaches "every
	 * unlabelled cell" in one go, the count of what is left goes wrong, and the
	 * loop stops with the level still in two halves — which is exactly what it
	 * did, on about a seventh of cave seeds.
	 */
	const attached = new Set<string>();
	let floors = 0;
	for (const cell of cells.values()) {
		if (cell.kind !== 'floor') continue;
		floors++;
		if (cell.region === largest) attached.add(axialKey(cell.q, cell.r));
	}

	while (attached.size < floors) {
		const dug = digToNearestPiece(cells, attached);
		if (!dug) break; // walled in behind sealed rock; `prune` can have it

		joins++;
		tunnelled += dug.tunnel.length;

		// The tunnel is new floor and is attached the moment it is dug, which
		// is what keeps the two counts in step.
		floors += dug.tunnel.length;
		for (const cell of dug.tunnel) attached.add(axialKey(cell.q, cell.r));
		for (const cell of cells.values()) {
			if (cell.kind === 'floor' && cell.region === dug.reached) {
				attached.add(axialKey(cell.q, cell.r));
			}
		}
	}

	return { joins, tunnelled };
}

/**
 * One round of the above: the shortest tunnel from the joined mass to anything
 * else, dug.
 *
 * `parent` is the search tree, so walking it back from the cell that was
 * reached gives the route to dig without a second search. A tunnel of length
 * zero is both possible and common — two floor cells side by side with a wall
 * between them are separate pieces, and the join is to open the wall.
 */
function digToNearestPiece(
	cells: Map<string, DraftCell>,
	attached: Set<string>,
): { reached: number; tunnel: DraftCell[] } | null {
	const parent = new Map<string, DraftCell>();
	const seen = new Set<string>();
	let frontier: DraftCell[] = [];

	for (const cell of cells.values()) {
		const key = axialKey(cell.q, cell.r);
		if (cell.kind === 'floor' && attached.has(key)) {
			seen.add(key);
			frontier.push(cell);
		}
	}

	while (frontier.length > 0) {
		const next: DraftCell[] = [];
		for (const cell of frontier) {
			for (let d = 0; d < 6; d++) {
				const step = AXIAL_DIRECTIONS[d]!;
				const key = axialKey(cell.q + step.q, cell.r + step.r);
				const neighbour = cells.get(key);
				if (!neighbour || seen.has(key)) continue;

				if (neighbour.kind === 'floor') {
					// Every attached floor cell went in as a source, so any
					// floor the search reaches belongs to a piece that is not.
					parent.set(key, cell);
					return { reached: neighbour.region, tunnel: carve(parent, neighbour) };
				}

				if (neighbour.sealed) continue;
				seen.add(key);
				parent.set(key, cell);
				next.push(neighbour);
			}
		}
		frontier = next;
	}

	return null;
}

/** Walk the search tree back, turning rock into passage and opening as it goes. */
function carve(parent: Map<string, DraftCell>, reached: DraftCell): DraftCell[] {
	const tunnel: DraftCell[] = [];
	let cell = reached;

	for (;;) {
		const previous = parent.get(axialKey(cell.q, cell.r));
		if (!previous) break;
		open(previous, cell);
		// The far end is floor already, and so is the near end once the walk
		// arrives back at the joined mass; only what is between them is dug.
		if (cell.kind === 'rock') {
			cell.kind = 'floor';
			cell.tile = STITCH_TILE;
			cell.color = STITCH_COLOR;
			tunnel.push(cell);
		}
		cell = previous;
	}

	return tunnel;
}

/** Open the edge between two neighbouring cells, from both sides. */
function open(from: DraftCell, to: DraftCell): void {
	for (let d = 0; d < 6; d++) {
		const step = AXIAL_DIRECTIONS[d]!;
		if (from.q + step.q !== to.q || from.r + step.r !== to.r) continue;
		from.open |= 1 << d;
		to.open |= 1 << ((d + 3) % 6);
		return;
	}
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
