/*
 * Which rooms are joined — the part two stacks have in common.
 *
 * Both room stacks scatter sites and then have to decide what connects to
 * what, and it is the same decision twice, so it is here once. It is also two
 * decisions rather than one, and separating them is most of the value:
 *
 * The **minimum spanning tree** is the guarantee. Prim's over the complete
 * graph of sites gives the cheapest set of corridors that reaches every room,
 * and being a tree it can never be redundant. It is also, alone, a bad level —
 * one route between any two rooms, so every dead end is a walk back the way you
 * came and the map has no shape to remember.
 *
 * The **extra edges** fix that, and where they come from matters more than how
 * many there are. Taken from the complete graph they cut clean across the map
 * between rooms that are nowhere near each other, so both options here are
 * PROXIMITY graphs:
 *
 *   neighbourhood   the relative neighbourhood graph. `a—b` survives only if no
 *                   third site is closer to BOTH of them than they are to each
 *                   other. Sparse, and every edge is unarguably between
 *                   neighbours.
 *   gabriel         `a—b` survives if no third site lies inside the circle that
 *                   has `ab` as its diameter. A superset of the neighbourhood
 *                   graph and of the spanning tree, so it offers strictly more
 *                   to choose from — the more generous of the two.
 *
 * Both are computed straight from the definition in O(n^3) rather than by
 * building a Delaunay triangulation and filtering it. `MST ⊆ RNG ⊆ Gabriel ⊆
 * Delaunay`, so nothing is lost but the outermost layer, and a Delaunay
 * implementation is several hundred lines that would earn their place at a
 * thousand sites and not at fifty.
 */

import type { Random } from '@hexdelve/shared';

/** Anything with a position. Both stacks pass their room sites. */
export interface Node {
	readonly x: number;
	readonly z: number;
}

export type ProximityGraph = 'tree only' | 'neighbourhood' | 'gabriel';

export type Link = readonly [number, number];

/**
 * A spanning tree over the sites, plus `loops` of the extra proximity edges.
 *
 * The tree always comes first in the returned list, which matters to a caller
 * that may fail to build some of the connections: the edges that hold the level
 * together are the ones tried first.
 */
export function linkNodes(
	nodes: readonly Node[],
	graph: ProximityGraph,
	loops: number,
	random: Random,
): Link[] {
	const n = nodes.length;
	if (n < 2) return [];

	const inTree = new Set<string>();
	const links: Link[] = [];
	const reached = new Set<number>([0]);

	while (reached.size < n) {
		let best = Infinity;
		let from = -1;
		let to = -1;
		for (const a of reached) {
			for (let b = 0; b < n; b++) {
				if (reached.has(b)) continue;
				const d = distance(nodes, a, b);
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
		inTree.add(key(from, to));
	}

	if (graph === 'tree only' || loops <= 0) return links;

	const extra: Link[] = [];
	for (let a = 0; a < n; a++) {
		for (let b = a + 1; b < n; b++) {
			if (inTree.has(key(a, b))) continue;
			if (graph === 'gabriel' ? gabriel(nodes, a, b) : neighbourly(nodes, a, b)) {
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

function distance(nodes: readonly Node[], a: number, b: number): number {
	return Math.hypot(nodes[a]!.x - nodes[b]!.x, nodes[a]!.z - nodes[b]!.z);
}

const key = (a: number, b: number): string => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** No third site inside the circle with `ab` as its diameter. */
function gabriel(nodes: readonly Node[], a: number, b: number): boolean {
	const midX = (nodes[a]!.x + nodes[b]!.x) / 2;
	const midZ = (nodes[a]!.z + nodes[b]!.z) / 2;
	const radius = distance(nodes, a, b) / 2;

	for (let c = 0; c < nodes.length; c++) {
		if (c === a || c === b) continue;
		if (Math.hypot(nodes[c]!.x - midX, nodes[c]!.z - midZ) < radius) return false;
	}
	return true;
}

/** No third site closer to both `a` and `b` than they are to each other. */
function neighbourly(nodes: readonly Node[], a: number, b: number): boolean {
	const span = distance(nodes, a, b);

	for (let c = 0; c < nodes.length; c++) {
		if (c === a || c === b) continue;
		if (Math.max(distance(nodes, c, a), distance(nodes, c, b)) < span) return false;
	}
	return true;
}

export function shuffle<T>(list: T[], random: Random): void {
	for (let i = list.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[list[i], list[j]] = [list[j]!, list[i]!];
	}
}
