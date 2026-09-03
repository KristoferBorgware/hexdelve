/*
 * The dungeon the overlapping model learns from.
 *
 * This is the whole tileset. There are no tiles, no sockets, no weights and no
 * adjacency table written down anywhere — there is a picture of a dungeon, and
 * everything the solver knows is read out of it. Wanting different levels means
 * drawing a different dungeon here, which is the authoring loop the socket
 * tileset never managed: thirteen rows of `rrrrr.` are a specification of a
 * dungeon, and this is one.
 *
 * ODD-R OFFSET, not axial. A rectangle of characters is a rectangle of hexes,
 * so what is drawn below is what the sample looks like. Axial would shear every
 * row half a cell right of the one above it, and a straight wall would have to
 * be typed as a diagonal — which is not a coordinate system anybody can author
 * in. {@link sampleToAxial} does the conversion at the one place it belongs.
 *
 * What the drawing needs to contain is not a good dungeon; it is every LOCAL
 * arrangement a good dungeon is made of, in roughly the proportions it has
 * them. The model only ever sees a cell and its neighbours, so what it learns
 * from the picture below is: rock is mostly next to rock; a corridor is one
 * cell wide with rock either side; corridors bend by sixty degrees and meet in
 * threes; a room is floor with a boundary that curves; and a corridor enters a
 * room through a mouth. Everything above that scale — how many rooms, how far
 * apart, whether the level is connected — it cannot see and does not learn.
 * That is the model's real limit, and the reason the stitcher exists.
 */

/** `#` solid, `.` floor. Anything else is a mistake and is checked for. */
export const ROCK = '#';
export const FLOOR = '.';

/**
 * Chambers, one-wide corridors, junctions, and the mouths where they meet.
 *
 * DENSE, with walls one to three cells thick and never a solid block, and that
 * is the correction that mattered most. The first two drafts were dungeons with
 * open rock around them, on the reasoning that a level is mostly not level.
 * Both produced almost nothing — a tenth of the disc walkable, in specks.
 *
 * Two things go wrong at once, and they compound. The sample's proportions ARE
 * the pattern weights, so every window of open rock counts once more towards
 * the all-solid pattern; on the second draft that one pattern held a third of
 * the total weight. And the all-solid pattern is the most PERMISSIVE thing in
 * the set — at reach 2 it accepted 22 neighbours where the average pattern
 * accepted 2.8 — because agreeing about a window of nothing is easy. A tile
 * that is both the most likely and the least constrained is a sink: the wave
 * falls into it and does not come back out.
 *
 * So a sample is not a level. It is a catalogue of the local arrangements a
 * level is made of, and rock ten cells from anything is not an arrangement —
 * it is the same window over and over, drowning every window that says
 * something. Everything below is within two cells of a floor.
 */
export const DUNGEON_SAMPLE: readonly string[] = [
	'###############################',
	'###############################',
	'##.....###....###....###.....##',
	'##......##.....#.....##......##',
	'##......##.....#.....##......##',
	'##.......#.....#.....#.......##',
	'###......###...#...###......###',
	'####......##...#...##......####',
	'##.........#...#...#.........##',
	'#...........#..#..#...........#',
	'#....####....#.#.#....####....#',
	'#....#..##...#.#.#...##..#....#',
	'#....#...#...#.#.#...#...#....#',
	'#....#...##..#.#.#..##...#....#',
	'#....#....#..#.#.#..#....#....#',
	'#....##...#..###.###.#...##...#',
	'##....#...#..........#...#....#',
	'###...#...####...####...##...##',
	'####..#......#...#......#..####',
	'###...##.....#...#.....##...###',
	'##.....#.....#...#.....#.....##',
	'##.....#.....#####.....#.....##',
	'##.....##.......#......##....##',
	'###.....#.......#.......#....##',
	'####....###.....#.....###...###',
	'#####....####...#...####...####',
	'######....##########...########',
	'###############################',
];

export interface Sample {
	/** One value per cell, indexed `col + row * width`. True where floor. */
	readonly floor: Uint8Array;
	readonly width: number;
	readonly height: number;
}

/** Read the art above into a grid, refusing anything ragged or misspelt. */
export function readSample(rows: readonly string[] = DUNGEON_SAMPLE): Sample {
	const height = rows.length;
	if (height === 0) throw new Error('the sample is empty');
	const width = rows[0]!.length;

	const floor = new Uint8Array(width * height);
	for (let row = 0; row < height; row++) {
		const line = rows[row]!;
		// A row a character short shifts every cell below it and produces a
		// sample that still parses and quietly means something else.
		if (line.length !== width) {
			throw new Error(`sample row ${row} is ${line.length} wide, expected ${width}`);
		}
		for (let col = 0; col < width; col++) {
			const character = line[col]!;
			if (character === FLOOR) floor[col + row * width] = 1;
			else if (character !== ROCK) throw new Error(`sample row ${row} has '${character}'`);
		}
	}

	return { floor, width, height };
}

/**
 * Odd-r offset to axial.
 *
 * Odd rows shift half a cell right in world space, so the column index of a
 * cell on an odd row already accounts for half of the axial `q` it needs; the
 * other half is the row's own contribution. This is the standard conversion and
 * the only place in the project that needs it — everything else has been axial
 * from the start, and only a human typing a rectangle wants offset coordinates.
 */
export function sampleToAxial(col: number, row: number): { q: number; r: number } {
	return { q: col - ((row - (row & 1)) >> 1), r: row };
}
