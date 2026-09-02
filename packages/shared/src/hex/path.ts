/*
 * A* over axial hex cells.
 *
 * Six neighbours and no diagonals is the whole reason this project uses hexes:
 * there is no corner case where a diagonal step costs sqrt(2), or cuts a
 * corner it should not have, or lets a body pass between two blocked cells.
 * And `axialDistance` is exact rather than an estimate, so it is an admissible
 * heuristic for free — A* here never expands a node it did not have to.
 *
 * What counts as passable is deliberately the caller's business. The same
 * terrain answers differently for a man, who must walk up one terrace at a
 * time, and for a bat, which beats its wings and clears two — so the climb
 * limit lives in the predicate rather than in the grid.
 */

import { axialDistance, axialKey, axialNeighbours, type Axial } from './axial.js';

export interface PathOptions {
	/** May the mover stand on `cell`, arriving from `from`? `from` is null for the goal test. */
	passable?: (cell: Axial, from: Axial | null) => boolean;
	/** Step cost, default 1 for every move. */
	cost?: (from: Axial, to: Axial) => number;
	/** Give up after this many expansions, so a walled-in start cannot hang a frame. */
	limit?: number;
}

/**
 * The cells from `start` to `goal` inclusive, or null if there is no way.
 *
 * The open set is a scanned array rather than a binary heap. On a grid this
 * size the scan wins: it is a few dozen comparisons against the allocation and
 * sift-down bookkeeping of a real heap, and it keeps this readable.
 */
export function findPath(start: Axial, goal: Axial, options: PathOptions = {}): Axial[] | null {
	const passable = options.passable ?? (() => true);
	const cost = options.cost ?? (() => 1);
	const limit = options.limit ?? 4000;

	if (start.q === goal.q && start.r === goal.r) return [start];
	if (!passable(goal, null)) return null;

	const startKey = axialKey(start.q, start.r);
	const cameFrom = new Map<string, Axial>();
	const gScore = new Map<string, number>([[startKey, 0]]);
	const open: { cell: Axial; f: number }[] = [{ cell: start, f: axialDistance(start, goal) }];
	const closed = new Set<string>();
	let visited = 0;

	while (open.length && visited < limit) {
		let bestIndex = 0;
		for (let i = 1; i < open.length; i++) {
			if (open[i]!.f < open[bestIndex]!.f) bestIndex = i;
		}
		const current = open.splice(bestIndex, 1)[0]!.cell;
		const currentKey = axialKey(current.q, current.r);
		if (closed.has(currentKey)) continue;
		closed.add(currentKey);
		visited++;

		if (current.q === goal.q && current.r === goal.r) {
			const path: Axial[] = [current];
			let key = currentKey;
			while (cameFrom.has(key)) {
				const previous = cameFrom.get(key)!;
				path.push(previous);
				key = axialKey(previous.q, previous.r);
			}
			return path.reverse();
		}

		for (const next of axialNeighbours(current)) {
			const nextKey = axialKey(next.q, next.r);
			if (closed.has(nextKey) || !passable(next, current)) continue;
			const tentative = gScore.get(currentKey)! + cost(current, next);
			const known = gScore.get(nextKey);
			if (known !== undefined && tentative >= known) continue;
			gScore.set(nextKey, tentative);
			cameFrom.set(nextKey, current);
			open.push({ cell: next, f: tentative + axialDistance(next, goal) });
		}
	}

	return null;
}
