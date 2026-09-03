/*
 * Stack three: rooms and corridors — the shape a modern ARPG level has.
 *
 * The other two stacks both make ONE KIND OF SPACE and vary it. The noise band
 * makes passage everywhere and widens it; the wave function makes tiles that
 * happen to clump. Neither builds a level out of PLACES. This one does nothing
 * else: it decides where the rooms are first, as points, then what shape each
 * room is, then which rooms are joined, and only then does any hexagon become
 * floor. The picture that comes out is blobs of floor with rock between them
 * and one-tile passages running between the blobs, which is the thing every
 * other approach here has been failing to produce.
 *
 * Every room is a cluster of whole hexagons and every corridor is a chain of
 * them. There is no such thing as half a tile in this stack, and no wall that
 * lives on an edge rather than in a cell — a wall is rock, and rock is a
 * hexagon, the same as everything else on the grid.
 *
 * Four steps, and the third is the one worth reading twice.
 *
 * SCATTER. Room sites are thrown at the disc and rejected if they land too
 * close to one already placed — dart throwing, the cheap half of Poisson-disc
 * sampling. The rejection radius is derived from the room size rather than set,
 * so two rooms can never overlap and there is always rock between them for a
 * corridor to run through. Turning the room count up past what the disc can
 * hold gives fewer rooms rather than a worse level, and the readout says how
 * many it actually got.
 *
 * GROW. A cell is floor if it is within a room's reach, and the reach is the
 * room's size pushed about by a coherent noise field — the same value noise the
 * cave stack carves with, read at a coarse scale. Coherent rather than
 * per-cell, and that is the whole difference between a room with lobes and a
 * room with a fringe: white noise on a boundary produces single stray hexes and
 * bites, and reads as damage. A field that varies smoothly over several tiles
 * produces the bulges an eroded chamber has.
 *
 * LINK. Which rooms are joined is a graph problem and this is where the choice
 * lives. Every edge is a corridor somebody has to walk, so the two failures are
 * a level that is a corridor hairball and a level that is a single line of
 * rooms. See {@link linkRooms}.
 *
 * DIG. Each chosen edge is walked from one room's site to the other, one hex at
 * a time, and any rock on the way becomes corridor. Walking from the SITES
 * rather than from the boundaries is deliberate: the walk crosses each room's
 * own floor for free, so a corridor always meets a room somewhere on its actual
 * edge rather than at a point computed from a circle the room is not.
 */

import {
	AXIAL_DIRECTIONS,
	axialDistance,
	axialKey,
	axialToWorld,
	makeRandom,
	type Axial,
	type Random,
} from '@hexdelve/shared';

import {
	ALL_EDGES,
	finishLevel,
	ROCK_COLOR,
	solidDraft,
	type Carved,
	type DraftCell,
} from './build.js';
import { fbm } from './noise.js';
import {
	readChoice,
	readParam,
	type Level,
	type LevelSettings,
	type LevelStack,
} from './types.js';

/** Offsets so the room shapes, the site scatter and the walk do not correlate. */
const SHAPE_SEED_OFFSET = 5501;
const WALK_SEED_OFFSET = 7717;

/** How many rock cells normally sit between two rooms, so a corridor fits. */
const ROOM_GAP = 2;

/**
 * Tiles per lattice cell of the boundary noise, and how many octaves of it.
 *
 * ONE octave, and the scale is the reason. Two octaves at this scale puts the
 * second one at a wavelength of under two tiles, which is finer than the grid
 * it is being sampled on: the reach then changes by more than a tile's worth
 * between neighbouring cells, and a room grows single stray hexes off its edge
 * with gaps behind them. That is the fringe-not-lobes failure exactly, and it
 * is not fixed by turning `ragged` down — it is fixed by not asking the field
 * for detail the grid cannot hold.
 */
const SHAPE_SCALE = 4.5;
const SHAPE_OCTAVES = 1;

const ROOM_SHADES = [0x8a7c62, 0x93856a, 0x81755c, 0x9a8b6f];
const CORRIDOR_COLOR = 0x796e5b;

export const ROOM_STACK: LevelStack = {
	id: 'rooms-graph',
	label: 'Rooms — sites and a graph',
	blurb:
		'Scatter room sites, grow each into a blob of hexes with a noisy edge, ' +
		'then decide which rooms are joined with a graph — a spanning tree for ' +
		'the guarantee, and a Gabriel or relative-neighbourhood graph for the ' +
		'loops on top of it. Corridors are one hex wide.',
	source: 'Poisson-disc scatter, Prim, Gabriel / relative neighbourhood graphs',
	steps: [
		'scatter room sites, rejecting any too close to another',
		'grow each into a blob: size, pushed about by coherent noise',
		'link the sites with a minimum spanning tree — the guarantee',
		'add back some of the Gabriel or neighbourhood edges — the loops',
		'walk each link and dig one-hex corridors through the rock',
		'mark entry and exit at the two ends of the level',
	],
	params: [
		{
			key: 'rooms',
			label: 'Rooms',
			hint: 'How many to try to place. The disc may not hold them all.',
			min: 3,
			max: 40,
			step: 1,
			value: 14,
			integer: true,
		},
		{
			key: 'size',
			label: 'Size',
			hint: 'Room reach in tiles, before the noise pushes it about.',
			min: 1.5,
			max: 8,
			step: 0.25,
			value: 2.25,
		},
		{
			key: 'ragged',
			label: 'Ragged',
			hint: 'How far the noise moves a room edge. 0 is a plain hex blob.',
			min: 0,
			max: 0.8,
			step: 0.02,
			value: 0.34,
		},
		{
			key: 'loops',
			label: 'Loops',
			hint: 'Share of the extra graph edges kept beyond the spanning tree.',
			min: 0,
			max: 1,
			step: 0.05,
			value: 0.35,
		},
		{
			key: 'wiggle',
			label: 'Wiggle',
			hint: 'Chance a corridor takes a sideways step instead of a direct one.',
			min: 0,
			max: 0.6,
			step: 0.02,
			value: 0.16,
		},
		{
			key: 'graph',
			label: 'Extra links',
			hint: 'Where the loops come from. Gabriel is the more generous of the two.',
			min: 0,
			max: 2,
			step: 1,
			value: 2,
			choices: ['tree only', 'neighbourhood', 'gabriel'],
		},
	],
	generate: build,
};

interface Room {
	readonly site: Axial;
	readonly x: number;
	readonly z: number;
	readonly reach: number;
	readonly color: number;
}

function build(settings: LevelSettings): Level {
	const startedAt = performance.now();

	const wanted = readParam(ROOM_STACK, settings.params, 'rooms');
	const size = readParam(ROOM_STACK, settings.params, 'size');
	const ragged = readParam(ROOM_STACK, settings.params, 'ragged');
	const loops = readParam(ROOM_STACK, settings.params, 'loops');
	const wiggle = readParam(ROOM_STACK, settings.params, 'wiggle');
	const graph = readChoice(ROOM_STACK, settings.params, 'graph');

	const cells = solidDraft(settings.radius);
	const random = makeRandom(settings.seed | 0);

	// One ring of rim, sealed: the same edge the other two stacks keep, and the
	// same reason — a corridor may not run off the boundary into nothing, and
	// the stitcher in the finish may not route round the outside.
	const interior = settings.radius - 1;
	for (const cell of cells.values()) {
		if (ring(cell) > interior) cell.sealed = true;
	}

	const rooms = scatterRooms(random, interior, wanted, size, ragged);
	growRooms(cells, rooms, settings.seed, ragged, interior);
	shedSpecks(cells);

	const links = linkRooms(rooms, graph, loops, random);
	const walk = makeRandom((settings.seed + WALK_SEED_OFFSET) | 0);
	for (const [a, b] of links) dig(cells, rooms[a]!.site, rooms[b]!.site, wiggle, walk);

	const carved: Carved = { cells, attempts: 1 };
	return finishLevel(ROOM_STACK, settings, carved, startedAt);
}

function ring(cell: { q: number; r: number }): number {
	return (Math.abs(cell.q) + Math.abs(cell.r) + Math.abs(cell.q + cell.r)) / 2;
}

/**
 * Throw sites at the disc, keeping the ones that land far enough from the rest.
 *
 * The separation is `2 * size + ROOM_GAP` — twice the room's NOMINAL reach,
 * not its worst case. Using the worst case is the obvious thing and it is
 * wrong twice over. It doubles the exclusion radius to guard against a
 * coincidence that needs the noise field at its extreme in the exact spot two
 * rooms face each other, and the result is a disc that holds three rooms when
 * it was asked for twelve. And the coincidence it is guarding against is not a
 * fault: two rooms whose edges bulge into each other merge into one larger
 * lobed chamber, which is the shape a hand-drawn dungeon has and one nothing
 * else in this stack can produce.
 *
 * So the guarantee is weaker and honest: rooms are normally separated by at
 * least `ROOM_GAP` rock cells, and occasionally two of them join.
 *
 * Sizes are drawn per room and the big ones are placed FIRST. Both halves of
 * that matter. One size for every room reads as machinery — a dozen identical
 * blobs is the one thing a hand-drawn dungeon never looks like — and placing
 * them in the order they were drawn strands the large ones, because by the time
 * a big room is tried the disc is full of small ones and the only gaps left are
 * small. Sorted, the hard placements happen while there is still room to make
 * them.
 *
 * Dart throwing rather than a real Poisson-disc sampler because the number of
 * rooms is a dozen, not a thousand. The budget is shared across the whole
 * scatter rather than fixed per room, which matters at the end: the last few
 * sites are the hard ones, and a per-room budget spends its attempts on the
 * easy early placements and gives up exactly when it should be trying hardest.
 */
function scatterRooms(
	random: Random,
	interior: number,
	wanted: number,
	size: number,
	ragged: number,
): Room[] {
	const rooms: Room[] = [];

	// Drawn up front so they can be sorted, and so the sequence of random
	// numbers does not depend on how many attempts a placement happened to
	// take — which is what keeps a seed meaning one level.
	const reaches = Array.from({ length: wanted }, () => size * (0.7 + random() * 0.65));
	reaches.sort((a, b) => b - a);

	const budget = wanted * 40;
	let attempt = 0;

	for (const reach of reaches) {
		// A room is kept its own reach inside the rim, and here the WORST case
		// is the right bound — a room bulging past the boundary would be cut
		// off square against it, which reads as a bug rather than as a wall.
		const margin = Math.max(0, interior - reach * (1 + ragged));

		while (attempt < budget) {
			attempt++;
			const site = randomCell(random, margin);

			let clear = true;
			for (const room of rooms) {
				if (axialDistance(site, room.site) < reach + room.reach + ROOM_GAP) {
					clear = false;
					break;
				}
			}
			if (!clear) continue;

			const { x, z } = axialToWorld(site.q, site.r);
			rooms.push({
				site,
				x,
				z,
				reach,
				color: ROOM_SHADES[Math.floor(random() * ROOM_SHADES.length)]!,
			});
			break;
		}
	}

	return rooms;
}

/** A uniform cell of the disc of this radius. Rejection, because a hex disc. */
function randomCell(random: Random, radius: number): Axial {
	for (;;) {
		const q = Math.round((random() * 2 - 1) * radius);
		const r = Math.round((random() * 2 - 1) * radius);
		if (ring({ q, r }) <= radius) return { q, r };
	}
}

/**
 * Turn every cell within a room's noisy reach into that room's floor.
 *
 * The noise is read at the CELL's own world position rather than at an angle
 * round the room, so two rooms whose edges pass near each other bulge the same
 * way rather than independently — which is what makes a level look eroded out
 * of one rock rather than assembled from parts. It costs nothing: it is the
 * same field sampled at the same place either way.
 */
function growRooms(
	cells: Map<string, DraftCell>,
	rooms: readonly Room[],
	seed: number,
	ragged: number,
	interior: number,
): void {
	const shapeSeed = (seed + SHAPE_SEED_OFFSET) | 0;

	for (const cell of cells.values()) {
		if (ring(cell) > interior) continue;

		const { x, z } = axialToWorld(cell.q, cell.r);
		const noise =
			ragged === 0
				? 0
				: fbm(x / SHAPE_SCALE, 0, z / SHAPE_SCALE, 1, SHAPE_OCTAVES, shapeSeed);

		for (const room of rooms) {
			const reach = room.reach * (1 + ragged * noise);
			if (axialDistance(cell, room.site) > reach) continue;
			cell.kind = 'floor';
			// Every edge, because in this stack a wall is a ROCK HEXAGON and
			// nothing else. There is no such thing here as two floor cells with
			// something between them, so the finish's symmetrise has only to
			// drop the edges facing rock.
			cell.open = ALL_EDGES;
			cell.tile = 'room';
			cell.color = room.color;
			break;
		}
	}
}

/**
 * Fill back any room cell left standing on its own.
 *
 * The smooth field above makes these rare rather than impossible: a room whose
 * edge runs along a line of cells all within a hair of its reach can still
 * leave one hanging off a corner. One cell of floor with one neighbour is not a
 * room and not a corridor — it is a bump on a wall that a player can walk into
 * and out of, and it is the kind of thing that reads as a bug in the generator
 * even though nothing is wrong.
 *
 * Run BEFORE the corridors are dug, on purpose. A corridor legitimately has
 * cells with two neighbours and its ends legitimately have one, so a pass that
 * ran afterwards would have to learn the difference. Running first means it
 * never has to: everything that exists yet is a room.
 */
function shedSpecks(cells: Map<string, DraftCell>): void {
	const lonely: DraftCell[] = [];

	for (const cell of cells.values()) {
		if (cell.kind !== 'floor') continue;
		let neighbours = 0;
		for (const step of AXIAL_DIRECTIONS) {
			const other = cells.get(axialKey(cell.q + step.q, cell.r + step.r));
			if (other?.kind === 'floor') neighbours++;
		}
		if (neighbours <= 1) lonely.push(cell);
	}

	// Collected first, then filled: shedding as it walks would let one removal
	// strand its neighbour, and whether it did would depend on the map's
	// iteration order rather than on the shape.
	for (const cell of lonely) {
		cell.kind = 'rock';
		cell.open = 0;
		cell.tile = '';
		cell.color = ROCK_COLOR;
	}
}

/**
 * Which rooms are joined.
 *
 * This is the whole character of the level and it is two decisions, not one.
 *
 * The **spanning tree** is the guarantee. Prim's over the complete graph of
 * sites gives the cheapest set of corridors that reaches every room, and
 * because it is a tree it can never be redundant. It is also, on its own, a
 * bad level: a tree has exactly one route between any two rooms, so every
 * dead end is a walk back the way you came and the map has no shape to
 * remember.
 *
 * The **extra edges** are what fix that, and where they come from matters more
 * than how many there are. Taking them from the complete graph gives corridors
 * that cut clean across the map between rooms that are nowhere near each other
 * — which is why the two options here are both PROXIMITY graphs:
 *
 *   neighbourhood   the relative neighbourhood graph. `a—b` survives only if
 *                   no third room is closer to BOTH of them than they are to
 *                   each other. Sparse, and every edge is unarguably a link
 *                   between neighbours.
 *   gabriel         `a—b` survives if no third room lies inside the circle
 *                   that has `ab` as its diameter. A superset of the
 *                   neighbourhood graph and of the spanning tree, so it offers
 *                   strictly more to choose from — the more generous of the
 *                   two, and the better default.
 *
 * Both are computed straight from the definition in O(n^3) rather than by
 * building a Delaunay triangulation and filtering it. With a dozen rooms that
 * is a few thousand comparisons, and a Delaunay implementation is several
 * hundred lines that would earn their place at a thousand sites and not at
 * twelve.
 *
 * `loops` is then the share of those candidates, chosen at random, that are
 * added on top of the tree. Zero is the bare tree; one is the whole proximity
 * graph.
 */
function linkRooms(
	rooms: readonly Room[],
	graph: string,
	loops: number,
	random: Random,
): [number, number][] {
	const n = rooms.length;
	if (n < 2) return [];

	const distance = (a: number, b: number): number => {
		const dx = rooms[a]!.x - rooms[b]!.x;
		const dz = rooms[a]!.z - rooms[b]!.z;
		return Math.hypot(dx, dz);
	};

	/* ------------------------------------- the tree: Prim, on a dense graph -- */

	const inTree = new Set<string>();
	const links: [number, number][] = [];
	const reached = new Set<number>([0]);

	while (reached.size < n) {
		let best = Infinity;
		let from = -1;
		let to = -1;
		for (const a of reached) {
			for (let b = 0; b < n; b++) {
				if (reached.has(b)) continue;
				const d = distance(a, b);
				if (d < best) {
					best = d;
					from = a;
					to = b;
				}
			}
		}
		if (to < 0) break;
		reached.add(to);
		links.push([from, to]);
		inTree.add(edgeKey(from, to));
	}

	if (graph === 'tree only' || loops <= 0) return links;

	/* --------------------------------------- the loops: a proximity graph -- */

	const extra: [number, number][] = [];
	for (let a = 0; a < n; a++) {
		for (let b = a + 1; b < n; b++) {
			if (inTree.has(edgeKey(a, b))) continue;
			if (graph === 'gabriel' ? gabriel(rooms, a, b) : neighbourly(rooms, a, b)) {
				extra.push([a, b]);
			}
		}
	}

	// Shuffled and cut rather than filtered by a coin per edge, so the count is
	// exactly the share asked for instead of that share on average — a slider
	// that sometimes does nothing at 0.1 is a slider nobody trusts.
	shuffle(extra, random);
	const keep = Math.round(extra.length * loops);
	for (let i = 0; i < keep; i++) links.push(extra[i]!);

	return links;
}

const edgeKey = (a: number, b: number): string => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** No third room inside the circle with `ab` as its diameter. */
function gabriel(rooms: readonly Room[], a: number, b: number): boolean {
	const midX = (rooms[a]!.x + rooms[b]!.x) / 2;
	const midZ = (rooms[a]!.z + rooms[b]!.z) / 2;
	const radius = Math.hypot(rooms[a]!.x - rooms[b]!.x, rooms[a]!.z - rooms[b]!.z) / 2;

	for (let c = 0; c < rooms.length; c++) {
		if (c === a || c === b) continue;
		if (Math.hypot(rooms[c]!.x - midX, rooms[c]!.z - midZ) < radius) return false;
	}
	return true;
}

/** No third room closer to both `a` and `b` than they are to each other. */
function neighbourly(rooms: readonly Room[], a: number, b: number): boolean {
	const span = Math.hypot(rooms[a]!.x - rooms[b]!.x, rooms[a]!.z - rooms[b]!.z);

	for (let c = 0; c < rooms.length; c++) {
		if (c === a || c === b) continue;
		const toA = Math.hypot(rooms[c]!.x - rooms[a]!.x, rooms[c]!.z - rooms[a]!.z);
		const toB = Math.hypot(rooms[c]!.x - rooms[b]!.x, rooms[c]!.z - rooms[b]!.z);
		if (Math.max(toA, toB) < span) return false;
	}
	return true;
}

function shuffle<T>(list: T[], random: Random): void {
	for (let i = list.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[list[i], list[j]] = [list[j]!, list[i]!];
	}
}

/**
 * Walk from one site to the other, turning the rock on the way into corridor.
 *
 * At each step the directions that get closest to the target are collected and
 * one is taken at random. On a hex grid there are usually two of them, so the
 * walk already wanders a little without being asked to — which is why a hex
 * corridor looks hand-drawn where a square one looks like a staircase.
 * `wiggle` is the chance of taking a SIDEWAYS step instead: one that gets no
 * closer, and so bends the corridor round.
 *
 * Cells already floor are left exactly as they are. That is what makes a
 * corridor stop at a room rather than draw a stripe across it, and it costs
 * nothing to arrange because the walk begins inside one room and ends inside
 * the other.
 */
function dig(
	cells: Map<string, DraftCell>,
	from: Axial,
	to: Axial,
	wiggle: number,
	random: Random,
): void {
	let at: Axial = from;
	// The walk always closes on the target, but a sideways step does not, so
	// the cap is what stops a pathological `wiggle` running forever.
	const limit = axialDistance(from, to) * 4 + 24;

	for (let step = 0; step < limit; step++) {
		if (at.q === to.q && at.r === to.r) return;

		const here = axialDistance(at, to);
		const direct: Axial[] = [];
		const sideways: Axial[] = [];

		for (const move of AXIAL_DIRECTIONS) {
			const next = { q: at.q + move.q, r: at.r + move.r };
			const cell = cells.get(axialKey(next.q, next.r));
			// Off the disc or into the sealed rim: not a step, at any price.
			if (!cell || cell.sealed) continue;
			const d = axialDistance(next, to);
			if (d < here) direct.push(next);
			else if (d === here) sideways.push(next);
		}

		const wander = wiggle > 0 && sideways.length > 0 && random() < wiggle;
		const choices = wander ? sideways : direct.length > 0 ? direct : sideways;
		if (choices.length === 0) return;

		at = choices[Math.floor(random() * choices.length)]!;
		const cell = cells.get(axialKey(at.q, at.r))!;
		if (cell.kind === 'rock') {
			cell.kind = 'floor';
			cell.open = ALL_EDGES;
			cell.tile = 'corridor';
			cell.color = CORRIDOR_COLOR;
		}
	}
}
