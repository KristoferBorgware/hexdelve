/*
 * Stack four: boxes and doors — a level made of rooms rather than of space.
 *
 * The other three all carve. The noise band opens tiles where a field crosses a
 * band; the wave function paints patterns; even the rooms stack grows blobs and
 * lets their edges land where the noise puts them. All three produce SPACE, and
 * space with rock in it reads as a cave system however carefully it is tuned —
 * because a cave is exactly what "connected open space" means.
 *
 * A room is not open space. It is a shape with an inside, a wall all the way
 * round it, and a countable number of ways in. That is the thing this builds,
 * and nearly every decision below follows from insisting on it.
 *
 * ## Offset coordinates, and why
 *
 * An axis-aligned box needs rows and columns. Axial (q, r) is a perfectly good
 * integer lattice but its rows shear half a cell right of the one above, so a
 * box in axial space is a rhombus in the world and a room drawn that way leans.
 * ODD-R OFFSET does not shear: a rectangle of cells is a rectangle on screen,
 * with left and right edges that zigzag by half a hex, which is what a hex wall
 * looks like anyway. It is the same space the wave function's sample is drawn
 * in, and for the same reason — it is the one a human can reason about.
 *
 * ## The shape of a room
 *
 * Sites are scattered, each is given a random box, and the boxes are allowed to
 * overlap. Then they are placed one at a time, and a room is not the box it was
 * given: it is **the largest rectangle that actually fits inside that box**,
 * given everything placed so far. See {@link largestRectangle}. Placing a room
 * blocks its own cells plus a margin, so the next room cannot reach them.
 *
 * Then the same question is asked again of what is left inside the box, and a
 * second rectangle is taken if it is big enough. That single repetition is
 * where the shape vocabulary comes from: two rectangles sharing an edge are an
 * L, two meeting across a third are a T or a cross, and the two together are
 * usually neither — they are a room with an alcove, which is the shape a
 * hand-drawn dungeon is full of and a generator almost never produces.
 *
 * ## Corridors between facing edges
 *
 * A corridor here is not a path found through rock. It is a straight run along
 * one column or one row, from an edge of one room to the edge of another
 * FACING IT, and it exists only where those two edges see each other. A run
 * that would cross any third room is rejected outright — it would breach a wall
 * it was not asked to breach — and of what remains the shortest is taken.
 *
 * That rule is the whole reason the output reads as rooms and doors. A
 * pathfinder asked to join two rooms will happily enter a third on the way and
 * leave by the other side, and the moment that happens the two rooms it passed
 * through have become one L-shaped space. Straight runs between facing edges
 * cannot do that.
 */

import { axialKey, axialToWorld, makeRandom, type Axial, type Random } from '@hexdelve/shared';

import { finishLevel, solidDraft, type Carved, type DraftCell } from './build.js';
import { linkNodes, shuffle, type ProximityGraph } from './graph.js';
import { largestRectangle, type Rect } from './rect/largestRectangle.js';
import {
	readChoice,
	readParam,
	type Level,
	type LevelSettings,
	type LevelStack,
} from './types.js';

const ROOM_SHADES = [0x8b7d63, 0x94866b, 0x82765d, 0x9c8d70];
const CORRIDOR_COLOR = 0x6d6455;
const DOOR_COLOR = 0xc09a4e;

export const HALL_STACK: LevelStack = {
	id: 'boxes-doors',
	label: 'Boxes — rooms and doors',
	blurb:
		'Scatter boxes, then take the largest rectangle that actually fits in ' +
		'each one given what is already placed — twice, which gives L and cross ' +
		'shapes. Join them with straight runs between edges that face each ' +
		'other, rejecting any run that would breach a third room.',
	source: 'Poisson-disc scatter, largest rectangle in a bitmap, Prim + Gabriel',
	steps: [
		'scatter room sites, rejecting any too close to another',
		'give each a random box; the boxes may overlap',
		'place one at a time: the largest rectangle that fits, then a second',
		'block each placed room and a margin around it',
		'link the sites with a spanning tree, and close some loops',
		'join each link with the shortest straight run between facing edges',
		'mark the ends of every run as doors',
	],
	params: [
		{
			key: 'rooms',
			label: 'Rooms',
			hint: 'How many to try to place. The disc may not hold them all.',
			min: 3,
			max: 400,
			step: 1,
			value: 18,
			integer: true,
		},
		{
			key: 'size',
			label: 'Size',
			hint: 'Half the side of the box a room is cut out of, in cells.',
			min: 2,
			max: 14,
			step: 0.5,
			value: 5,
		},
		{
			key: 'ragged',
			label: 'Variety',
			hint: 'How much room boxes differ from each other in size and shape.',
			min: 0,
			max: 1,
			step: 0.05,
			value: 0.55,
		},
		{
			key: 'spacing',
			label: 'Spacing',
			hint: 'Cells of rock kept round every room, which is where corridors run.',
			min: 1,
			max: 5,
			step: 1,
			value: 2,
			integer: true,
		},
		{
			key: 'alcoves',
			label: 'Alcoves',
			hint: 'Take a second rectangle per room, for L and cross shapes.',
			min: 0,
			max: 1,
			step: 1,
			value: 1,
			integer: true,
		},
		{
			key: 'loops',
			label: 'Loops',
			hint: 'Share of the extra graph edges kept beyond the spanning tree.',
			min: 0,
			max: 1,
			step: 0.05,
			value: 0.3,
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

/* ------------------------------------------------------- offset bookkeeping -- */

/**
 * The hex disc, addressed as a rectangle of columns and rows.
 *
 * `usable` is the disc minus its rim; everything outside starts blocked, so a
 * room can never be cut off square against the boundary and a corridor can
 * never run out of the world.
 */
interface Field {
	readonly width: number;
	readonly height: number;
	readonly minCol: number;
	readonly minRow: number;
	/** Non-zero where no room may be placed: outside, or too near one already. */
	readonly blocked: Uint8Array;
	/** Which room owns a cell, or -1. Corridors are -2. */
	readonly owner: Int32Array;
}

function offsetOf(cell: Axial): { col: number; row: number } {
	return { col: cell.q + ((cell.r - (cell.r & 1)) >> 1), row: cell.r };
}

function axialOf(col: number, row: number): Axial {
	return { q: col - ((row - (row & 1)) >> 1), r: row };
}

function buildField(cells: Map<string, DraftCell>, interior: number): Field {
	let minCol = Infinity;
	let maxCol = -Infinity;
	let minRow = Infinity;
	let maxRow = -Infinity;

	for (const cell of cells.values()) {
		const { col, row } = offsetOf(cell);
		if (col < minCol) minCol = col;
		if (col > maxCol) maxCol = col;
		if (row < minRow) minRow = row;
		if (row > maxRow) maxRow = row;
	}

	const width = maxCol - minCol + 1;
	const height = maxRow - minRow + 1;
	const blocked = new Uint8Array(width * height).fill(2);
	const owner = new Int32Array(width * height).fill(-1);

	for (const cell of cells.values()) {
		const { col, row } = offsetOf(cell);
		// 2 rather than 1 outside: rooms are kept out by anything non-zero, but
		// a corridor may cross the margin round a room and may never cross the
		// rim, and the two need telling apart.
		blocked[col - minCol + (row - minRow) * width] = ring(cell) > interior ? 2 : 0;
	}

	return { width, height, minCol, minRow, blocked, owner };
}

function ring(cell: { q: number; r: number }): number {
	return (Math.abs(cell.q) + Math.abs(cell.r) + Math.abs(cell.q + cell.r)) / 2;
}

/* ------------------------------------------------------------------ rooms -- */

interface Room {
	readonly index: number;
	/** In world space, for the proximity graph. */
	readonly x: number;
	readonly z: number;
	/** One or two rectangles, in field coordinates. */
	readonly parts: Rect[];
	readonly color: number;
}

function build(settings: LevelSettings): Level {
	const startedAt = performance.now();

	const wanted = readParam(HALL_STACK, settings.params, 'rooms');
	const size = readParam(HALL_STACK, settings.params, 'size');
	const variety = readParam(HALL_STACK, settings.params, 'ragged');
	const spacing = readParam(HALL_STACK, settings.params, 'spacing');
	const alcoves = readParam(HALL_STACK, settings.params, 'alcoves') === 1;
	const loops = readParam(HALL_STACK, settings.params, 'loops');
	const graph = readChoice(HALL_STACK, settings.params, 'graph') as ProximityGraph;

	const cells = solidDraft(settings.radius);
	const interior = settings.radius - 1;
	for (const cell of cells.values()) {
		if (ring(cell) > interior) cell.sealed = true;
	}

	const field = buildField(cells, interior);
	const random = makeRandom(settings.seed | 0);
	const rooms = placeRooms(field, random, wanted, size, variety, spacing, alcoves);

	const links = linkNodes(rooms, graph, loops, random);
	const corridors = joinRooms(field, rooms, links);

	paint(cells, field, rooms, corridors);

	const carved: Carved = { cells, attempts: 1 };
	return finishLevel(HALL_STACK, settings, carved, startedAt);
}

/**
 * Scatter boxes and cut a room out of each.
 *
 * The order is the interesting part: boxes are shuffled and placed one at a
 * time, and each one sees the blocking left by all of the ones before it. So a
 * box that lands over a neighbour does not overlap it — it gets whatever it can
 * still have, which is usually a smaller rectangle pushed to one side. That is
 * where most of the variety comes from, and it costs nothing to arrange.
 */
function placeRooms(
	field: Field,
	random: Random,
	wanted: number,
	size: number,
	variety: number,
	spacing: number,
	alcoves: boolean,
): Room[] {
	const rooms: Room[] = [];
	// A box's half-extent, varied per side so rooms are not all square.
	const boxes: { col: number; row: number; halfCol: number; halfRow: number }[] = [];
	const budget = wanted * 30;

	// Sites first, on a dart-thrown Poisson-disc: two rooms whose boxes start on
	// top of each other are two rooms of which one comes out as a sliver.
	const separation = size * 1.2 + spacing;
	for (let attempt = 0; attempt < budget && boxes.length < wanted; attempt++) {
		const col = field.minCol + Math.floor(random() * field.width);
		const row = field.minRow + Math.floor(random() * field.height);

		let clear = true;
		for (const box of boxes) {
			if (Math.abs(box.col - col) < separation && Math.abs(box.row - row) < separation) {
				clear = false;
				break;
			}
		}
		if (!clear) continue;

		const vary = (): number => size * (1 - variety / 2 + random() * variety);
		boxes.push({
			col,
			row,
			halfCol: Math.max(1, Math.round(vary())),
			halfRow: Math.max(1, Math.round(vary() * 0.75)),
		});
	}

	shuffle(boxes, random);

	const minSide = 2;
	const scratch = new Uint8Array(field.width * field.height);

	for (const box of boxes) {
		const x0 = Math.max(0, box.col - box.halfCol - field.minCol);
		const y0 = Math.max(0, box.row - box.halfRow - field.minRow);
		const x1 = Math.min(field.width - 1, box.col + box.halfCol - field.minCol);
		const y1 = Math.min(field.height - 1, box.row + box.halfRow - field.minRow);
		const w = x1 - x0 + 1;
		const h = y1 - y0 + 1;
		if (w < minSide || h < minSide) continue;

		// The box's own view of the world, so the rectangle search sees only
		// what this room could possibly take.
		const view = scratch.subarray(0, w * h);
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				view[x + y * w] = field.blocked[x0 + x + (y0 + y) * field.width]!;
			}
		}

		const first = largestRectangle(view, w, h, minSide, minSide);
		if (!first) continue;

		const parts: Rect[] = [shift(first, x0, y0)];

		if (alcoves) {
			// Ask again, with the first rectangle taken out. Whatever is still
			// big enough is the alcove, the arm of the L, the other side of the
			// cross — the shape that makes the room look drawn rather than
			// stamped.
			for (let y = first.y; y < first.y + first.height; y++) {
				for (let x = first.x; x < first.x + first.width; x++) view[x + y * w] = 1;
			}
			const second = largestRectangle(view, w, h, minSide, minSide);
			// It has to actually touch the first, or it is not an alcove, it is
			// a second room that nothing connects to.
			if (second && adjacent(first, second)) parts.push(shift(second, x0, y0));
		}

		const index = rooms.length;
		for (const part of parts) claim(field, part, index);
		for (const part of parts) blockAround(field, part, spacing);

		const centre = centreOf(parts);
		const world = axialToWorld(centre.q, centre.r);
		rooms.push({
			index,
			x: world.x,
			z: world.z,
			parts,
			color: ROOM_SHADES[Math.floor(random() * ROOM_SHADES.length)]!,
		});
	}

	return rooms;
}

const shift = (rect: Rect, dx: number, dy: number): Rect => ({
	x: rect.x + dx,
	y: rect.y + dy,
	width: rect.width,
	height: rect.height,
});

/** Do two rectangles share an edge, rather than merely a corner or nothing? */
function adjacent(a: Rect, b: Rect): boolean {
	const overlapsX = a.x < b.x + b.width && b.x < a.x + a.width;
	const overlapsY = a.y < b.y + b.height && b.y < a.y + a.height;
	if (overlapsX && (a.y + a.height === b.y || b.y + b.height === a.y)) return true;
	if (overlapsY && (a.x + a.width === b.x || b.x + b.width === a.x)) return true;
	return false;
}

function claim(field: Field, rect: Rect, index: number): void {
	for (let y = rect.y; y < rect.y + rect.height; y++) {
		for (let x = rect.x; x < rect.x + rect.width; x++) {
			field.owner[x + y * field.width] = index;
		}
	}
}

function blockAround(field: Field, rect: Rect, spacing: number): void {
	const x0 = Math.max(0, rect.x - spacing);
	const y0 = Math.max(0, rect.y - spacing);
	const x1 = Math.min(field.width - 1, rect.x + rect.width - 1 + spacing);
	const y1 = Math.min(field.height - 1, rect.y + rect.height - 1 + spacing);
	for (let y = y0; y <= y1; y++) {
		for (let x = x0; x <= x1; x++) field.blocked[x + y * field.width] = 1;
	}
}

function centreOf(parts: readonly Rect[]): Axial {
	let col = 0;
	let row = 0;
	let n = 0;
	for (const part of parts) {
		col += part.x + (part.width - 1) / 2;
		row += part.y + (part.height - 1) / 2;
		n++;
	}
	return axialOf(Math.round(col / n), Math.round(row / n));
}

/* -------------------------------------------------------------- corridors -- */

interface Corridor {
	/** Field cells, in order, from one room's wall to the other's. */
	readonly cells: { x: number; y: number }[];
}

/**
 * Join each linked pair with the shortest straight run between facing edges.
 *
 * For every column both rooms occupy there is one candidate vertical run: from
 * whichever room is above, down to whichever is below. Likewise for every
 * shared row, horizontally. A candidate is thrown out if any cell on it belongs
 * to a third room, and the shortest survivor wins.
 *
 * A pair with no shared column or row cannot be joined that way at all, and
 * gets an L instead: out of one room along a column, one turn, into the other
 * along a row. Both arms are still straight runs and both are still checked
 * against every other room, so the rule that keeps rooms rooms is intact — what
 * changes is only that the corner is allowed to be somewhere other than inside
 * a wall.
 *
 * The alternative was to leave those links unbuilt and let the shared stitcher
 * have them. It works, and it looks wrong: the stitcher digs the shortest path
 * it can find through rock, wanders by design, and a wandering tunnel between
 * two square rooms reads as a mistake. At radius 100 it was digging two hundred
 * cells of it a level. A generator that produces rooms should produce the
 * corridors between them too.
 */
function joinRooms(field: Field, rooms: readonly Room[], links: readonly (readonly [number, number])[]): Corridor[] {
	const out: Corridor[] = [];
	const spans = rooms.map((room) => extents(room));

	for (const [a, b] of links) {
		const found =
			straightRun(field, spans[a]!, spans[b]!) ?? bentRun(field, spans[a]!, spans[b]!);
		if (!found) continue;
		out.push(found);
		// Later links see the corridors the earlier ones cut, so two corridors
		// cannot be laid across each other into an unintended junction.
		for (const cell of found.cells) field.owner[cell.x + cell.y * field.width] = -2;
	}

	return out;
}

/** For each column, the room's topmost and bottommost row in it, and per row. */
interface Extents {
	readonly cols: Map<number, { min: number; max: number }>;
	readonly rows: Map<number, { min: number; max: number }>;
}

function extents(room: Room): Extents {
	const cols = new Map<number, { min: number; max: number }>();
	const rows = new Map<number, { min: number; max: number }>();

	for (const part of room.parts) {
		for (let x = part.x; x < part.x + part.width; x++) {
			for (let y = part.y; y < part.y + part.height; y++) {
				const col = cols.get(x);
				if (col) {
					col.min = Math.min(col.min, y);
					col.max = Math.max(col.max, y);
				} else cols.set(x, { min: y, max: y });

				const row = rows.get(y);
				if (row) {
					row.min = Math.min(row.min, x);
					row.max = Math.max(row.max, x);
				} else rows.set(y, { min: x, max: x });
			}
		}
	}

	return { cols, rows };
}

/** Is every cell of a run free — inside the field, and owned by nobody? */
function clear(field: Field, cells: readonly { x: number; y: number }[]): boolean {
	for (const cell of cells) {
		if (cell.x < 0 || cell.y < 0 || cell.x >= field.width || cell.y >= field.height) return false;
		// Anything owned is a wall this run has no business breaching —
		// including, at the far end, the room it is aiming at, which the run
		// stops short of by construction.
		if (field.owner[cell.x + cell.y * field.width] !== -1) return false;
		// And the rim, which is not owned but is not diggable either.
		if (field.blocked[cell.x + cell.y * field.width] === 2) return false;
	}
	return true;
}

function straightRun(field: Field, a: Extents, b: Extents): Corridor | null {
	let best: Corridor | null = null;
	let bestLength = Infinity;

	const consider = (cells: { x: number; y: number }[]): void => {
		if (cells.length === 0 || cells.length >= bestLength) return;
		if (!clear(field, cells)) return;
		bestLength = cells.length;
		best = { cells };
	};

	for (const [x, span] of a.cols) {
		const other = b.cols.get(x);
		if (!other) continue;
		consider(runBetween(x, span, other, true));
	}
	for (const [y, span] of a.rows) {
		const other = b.rows.get(y);
		if (!other) continue;
		consider(runBetween(y, span, other, false));
	}

	return best;
}

/**
 * One turn: out of `a` along a column, across, and into `b` along a row.
 *
 * Tried only when no straight run exists, which is when the two rooms share
 * neither a column nor a row — they are diagonal from each other. The corner is
 * the cell where the chosen column meets the chosen row, and both arms are
 * checked exactly as a straight run is, so an L can no more cut through a third
 * room than a straight run can.
 *
 * Both orders are tried, because which one is possible depends on what is in
 * the way, and the shorter survivor wins. The search is over the outermost
 * columns and rows of each room only — a corridor wants to leave from the side
 * of the room that faces where it is going, and trying every column of a large
 * room to find that out costs a great deal to arrive at the same answer.
 */
function bentRun(field: Field, a: Extents, b: Extents): Corridor | null {
	let best: Corridor | null = null;
	let bestLength = Infinity;

	const consider = (cells: { x: number; y: number }[]): void => {
		if (cells.length === 0 || cells.length >= bestLength) return;
		if (!clear(field, cells)) return;
		bestLength = cells.length;
		best = { cells };
	};

	for (const x of edgesOf(a.cols)) {
		const column = a.cols.get(x)!;
		for (const y of edgesOf(b.rows)) {
			const row = b.rows.get(y)!;
			// Down (or up) the column to the corner, then along the row.
			const vertical = reach(x, column, y, true);
			const horizontal = reach(y, row, x, false);
			if (vertical === null || horizontal === null) continue;
			consider([...vertical, { x, y }, ...horizontal]);
		}
	}

	return best;
}

/** The extreme columns or rows of a room — the sides a corridor leaves from. */
function edgesOf(spans: Map<number, { min: number; max: number }>): number[] {
	let low = Infinity;
	let high = -Infinity;
	for (const at of spans.keys()) {
		if (at < low) low = at;
		if (at > high) high = at;
	}
	return low === high ? [low] : [low, high];
}

/** The cells from a room's edge along `fixed` towards `target`, exclusive. */
function reach(
	fixed: number,
	span: { min: number; max: number },
	target: number,
	vertical: boolean,
): { x: number; y: number }[] | null {
	let from: number;
	let to: number;
	if (target > span.max) {
		from = span.max + 1;
		to = target - 1;
	} else if (target < span.min) {
		from = target + 1;
		to = span.min - 1;
	} else {
		// The corner is level with the room, so this arm would have to start
		// inside it. That is the straight-run case and was already tried.
		return null;
	}

	const cells: { x: number; y: number }[] = [];
	for (let i = from; i <= to; i++) cells.push(vertical ? { x: fixed, y: i } : { x: i, y: fixed });
	return cells;
}

/** The cells strictly between two spans along one column or row. */
function runBetween(
	fixed: number,
	a: { min: number; max: number },
	b: { min: number; max: number },
	vertical: boolean,
): { x: number; y: number }[] {
	let from: number;
	let to: number;
	if (a.max < b.min) {
		from = a.max + 1;
		to = b.min - 1;
	} else if (b.max < a.min) {
		from = b.max + 1;
		to = a.min - 1;
	} else {
		// The spans overlap, so the rooms are alongside each other on this line
		// rather than facing along it. There is no run here.
		return [];
	}

	const cells: { x: number; y: number }[] = [];
	for (let i = from; i <= to; i++) cells.push(vertical ? { x: fixed, y: i } : { x: i, y: fixed });
	return cells;
}

/* ---------------------------------------------------------------- painting -- */

function paint(
	cells: Map<string, DraftCell>,
	field: Field,
	rooms: readonly Room[],
	corridors: readonly Corridor[],
): void {
	const at = (x: number, y: number): DraftCell | undefined => {
		const { q, r } = axialOf(x + field.minCol, y + field.minRow);
		return cells.get(axialKey(q, r));
	};

	for (const room of rooms) {
		for (const part of room.parts) {
			for (let y = part.y; y < part.y + part.height; y++) {
				for (let x = part.x; x < part.x + part.width; x++) {
					const cell = at(x, y);
					if (!cell || cell.sealed) continue;
					cell.kind = 'floor';
					cell.tile = 'room';
					cell.color = room.color;
				}
			}
		}
	}

	for (const corridor of corridors) {
		corridor.cells.forEach((point, i) => {
			const cell = at(point.x, point.y);
			if (!cell || cell.sealed) return;
			cell.kind = 'floor';
			// The ends of a run are where it meets a room, which is what a door
			// is. A run one cell long is a single door, which is right: the two
			// rooms are a wall apart and the wall has one hole in it.
			const door = i === 0 || i === corridor.cells.length - 1;
			cell.tile = door ? 'door' : 'corridor';
			cell.color = door ? DOOR_COLOR : CORRIDOR_COLOR;
		});
	}

}
