/*
 * Axial hex coordinates, laid out exactly as every lab in this project draws
 * them — pointy-top hexes on (q, r):
 *
 *     x = sqrt(3) * size * (q + r / 2)        z = 1.5 * size * r
 *
 * Six neighbours, no diagonals, no special cases. Distance is exact rather
 * than an approximation, which makes it an admissible A* heuristic for free.
 *
 * This is a straight port of `labs/shared/hexgrid.js`, kept to the same
 * conventions so the labs and the engine agree about where a tile is.
 */

export const SQRT3 = Math.sqrt(3);

export interface Axial {
	readonly q: number;
	readonly r: number;
}

/** The six neighbours, in order, starting east and turning anticlockwise. */
export const AXIAL_DIRECTIONS: readonly Axial[] = [
	{ q: 1, r: 0 },
	{ q: 1, r: -1 },
	{ q: 0, r: -1 },
	{ q: -1, r: 0 },
	{ q: -1, r: 1 },
	{ q: 0, r: 1 },
];

/** A map key for a cell. Cheaper than an object key and stable to compare. */
export function axialKey(q: number, r: number): string {
	return `${q},${r}`;
}

export function axialToWorld(q: number, r: number, size = 1): { x: number; z: number } {
	return { x: SQRT3 * size * (q + r / 2), z: 1.5 * size * r };
}

/**
 * The nearest cell to a world point: round in cube space, then repair the
 * component that rounded furthest — the standard hex rounding.
 */
export function worldToAxial(x: number, z: number, size = 1): Axial {
	const r = z / (1.5 * size);
	const q = x / (SQRT3 * size) - r / 2;
	const y = -q - r;

	let rq = Math.round(q);
	let rr = Math.round(r);
	const ry = Math.round(y);

	const dq = Math.abs(rq - q);
	const dr = Math.abs(rr - r);
	const dy = Math.abs(ry - y);

	if (dq > dr && dq > dy) rq = -rr - ry;
	else if (dr > dy) rr = -rq - ry;

	return { q: rq, r: rr };
}

export function axialDistance(a: Axial, b: Axial): number {
	const dq = a.q - b.q;
	const dr = a.r - b.r;
	return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function axialNeighbours(cell: Axial): Axial[] {
	return AXIAL_DIRECTIONS.map((d) => ({ q: cell.q + d.q, r: cell.r + d.r }));
}

/** Every cell within `radius` of the origin, centre first. */
export function axialDisc(radius: number): Axial[] {
	const cells: Axial[] = [];
	for (let q = -radius; q <= radius; q++) {
		const from = Math.max(-radius, -q - radius);
		const to = Math.min(radius, -q + radius);
		for (let r = from; r <= to; r++) cells.push({ q, r });
	}
	return cells;
}
