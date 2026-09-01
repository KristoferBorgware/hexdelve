/*
 * labs/shared/hexgrid.js — axial hex coordinates and A* over them.
 *
 * Engine-free. Pointy-top hexes on the axial (q, r) system, laid out the same
 * way every lab in this project draws them:
 *
 *     x = √3 · size · (q + r/2)        z = 1.5 · size · r
 *
 * Six neighbours, no diagonals, no special cases — which is the whole reason
 * the project uses hexes. Distance is exact rather than an approximation, so
 * it makes an admissible A* heuristic for free.
 */

var Hexdelve = Hexdelve || {};

Hexdelve.hexgrid = (function () {
'use strict';

const SQRT3 = Math.sqrt(3);

const DIRECTIONS = [
	{ q: 1, r: 0 },
	{ q: 1, r: -1 },
	{ q: 0, r: -1 },
	{ q: -1, r: 0 },
	{ q: -1, r: 1 },
	{ q: 0, r: 1 },
];

const keyOf = (q, r) => q + ',' + r;

function axialToWorld(q, r, size = 1) {
	return { x: SQRT3 * size * (q + r / 2), z: 1.5 * size * r };
}

// Nearest cell to a world point, by rounding in cube space and repairing the
// component that rounded furthest — the standard hex rounding.
function worldToAxial(x, z, size = 1) {
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

function distance(a, b) {
	const dq = a.q - b.q;
	const dr = a.r - b.r;
	return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

function neighbours(cell) {
	return DIRECTIONS.map((d) => ({ q: cell.q + d.q, r: cell.r + d.r }));
}

/**
 * A* from `start` to `goal`.
 *
 * @param opts.passable(cell, from)  may the character stand on `cell`, arriving
 *                                   from `from`? This is where a step too tall
 *                                   to climb becomes a cliff.
 * @param opts.cost(from, to)        step cost, default 1
 * @returns array of cells from start to goal inclusive, or null if unreachable
 */
function findPath(start, goal, opts = {}) {
	const passable = opts.passable || (() => true);
	const cost = opts.cost || (() => 1);
	const limit = opts.limit || 4000;

	if (start.q === goal.q && start.r === goal.r) return [start];
	if (!passable(goal, null)) return null;

	const startKey = keyOf(start.q, start.r);
	const cameFrom = new Map();
	const gScore = new Map([[startKey, 0]]);
	// Small grids, so a scanned list beats the bookkeeping of a real heap.
	const open = [{ cell: start, f: distance(start, goal) }];
	const closed = new Set();
	let visited = 0;

	while (open.length && visited < limit) {
		let bestIndex = 0;
		for (let i = 1; i < open.length; i++) if (open[i].f < open[bestIndex].f) bestIndex = i;
		const current = open.splice(bestIndex, 1)[0].cell;
		const currentKey = keyOf(current.q, current.r);
		if (closed.has(currentKey)) continue;
		closed.add(currentKey);
		visited++;

		if (current.q === goal.q && current.r === goal.r) {
			const path = [current];
			let k = currentKey;
			while (cameFrom.has(k)) {
				const prev = cameFrom.get(k);
				path.push(prev);
				k = keyOf(prev.q, prev.r);
			}
			return path.reverse();
		}

		for (const next of neighbours(current)) {
			const nextKey = keyOf(next.q, next.r);
			if (closed.has(nextKey) || !passable(next, current)) continue;
			const tentative = gScore.get(currentKey) + cost(current, next);
			if (gScore.has(nextKey) && tentative >= gScore.get(nextKey)) continue;
			gScore.set(nextKey, tentative);
			cameFrom.set(nextKey, current);
			open.push({ cell: next, f: tentative + distance(next, goal) });
		}
	}
	return null;
}

// Trim corners: drop a waypoint when the character could walk straight past it.
// Purely cosmetic, but it stops the path reading as a staircase.
function smoothPath(path, clear) {
	if (!path || path.length < 3) return path;
	const out = [path[0]];
	let i = 0;
	while (i < path.length - 1) {
		let furthest = i + 1;
		for (let j = path.length - 1; j > i + 1; j--) {
			if (clear(path[i], path[j])) {
				furthest = j;
				break;
			}
		}
		out.push(path[furthest]);
		i = furthest;
	}
	return out;
}

return { DIRECTIONS, axialToWorld, worldToAxial, distance, neighbours, findPath, smoothPath, keyOf };
})();
