/*
 * The ground, as everything that walks on it sees it.
 *
 * The terrain is a SCRIPT — `packages/client/scripts/Terrain.ts` — because how
 * many hexagons of it there are, how high a terrace is and where the hill sits
 * are numbers somebody moves in an editor, and the prisms are worked out from
 * them rather than authored. Scripts are compiled apart from this module graph,
 * so nothing here can import that class. This is the shape it satisfies,
 * declared on the side that asks it questions.
 *
 * ## Why this seam matters more than the other three
 *
 * `PlayerOrders`, `HuntOrders` and `TurnOrder` are read by one caller each. This
 * one is read by everything that moves: a route is laid across it, a foot is
 * planted on it, a step is refused by it. It is the question "can I stand
 * there", and on a grid that question is the whole of collision.
 *
 * Null is still an ordinary answer — a bench previewing a body has no ground —
 * and a caller that gets one is looking at a world nothing can walk in, which
 * is exactly what a bench is.
 */

import type { GameObject, Scene } from '@hexdelve/engine';
import type { Axial } from '@hexdelve/shared';

/** The name the entity file writes, and the class the script exports. */
export const TERRAIN = 'Terrain';

/** One hexagon of ground: where it is on the grid, and how high it stands. */
export interface Tile {
	readonly q: number;
	readonly r: number;
	/** Terraces above the base. Neighbours differing by one are a slope. */
	readonly level: number;
	/** World Y of the surface — what a foot rests on. */
	readonly top: number;
	readonly x: number;
	readonly z: number;
}

export interface TerrainQuery {
	/** How many rings of hexagons there are. */
	readonly radius: number;
	/** World Y of a tile at level zero. */
	readonly baseY: number;
	/** How much one terrace lifts a tile. */
	readonly stepH: number;

	readonly tiles: ReadonlyMap<string, Tile>;

	tileAt(q: number, r: number): Tile | null;

	/** The surface under a point, or the base where there is no tile. */
	groundAt(x: number, z: number): number;

	/**
	 * Whether a step onto `cell`, having come from `from`, is one that can be
	 * taken.
	 *
	 * How big a step counts as climbable is the caller's business rather than
	 * the ground's: it is the difference between a man, who must walk up a
	 * terrace, and a bat, which beats its wings and clears two. So `maxClimb`
	 * comes in with the question and the same ground answers both.
	 */
	passable(cell: Axial, from: Axial | null, maxClimb: number): boolean;

	/**
	 * Mark the tiles under a placed thing solid, so routes go round it.
	 *
	 * Called by whatever stands on the ground rather than known here: a smithy
	 * knows its own footprint, and a terrain that carried a list of buildings
	 * would be a second place for them to be written down.
	 */
	block(footprint: Footprint): void;

	/** Mark one hexagon solid — for a thing that occupies exactly its own tile. */
	blockCell(q: number, r: number): void;
}

/** A rectangle of ground something stands on, in that thing's own space. */
export interface Footprint {
	readonly x: number;
	readonly z: number;
	readonly yaw: number;
	readonly halfX: number;
	readonly halfZ: number;
	/** Extra clearance beyond the walls, so nothing paths flush against them. */
	readonly margin: number;
}

/** The key a tile is held under, and the one thing both sides must agree on. */
export function tileKey(q: number, r: number): string {
	return `${q},${r}`;
}

/** The terrain in a scene, or null where nothing put any there. */
export function terrainOf(scene: Scene): TerrainQuery | null {
	return terrainNear(scene.root);
}

/**
 * The terrain in whatever world an object is in.
 *
 * Walks up to the topmost object and searches from there, because a COMPONENT
 * has no scene to ask — only a script does. Everything that stands on the
 * ground is somewhere under the same root as the ground itself, so the root is
 * the one handle both share.
 */
export function terrainNear(object: GameObject): TerrainQuery | null {
	let top = object;
	while (top.parent) top = top.parent;
	for (const one of top.walk()) {
		const found = one.getComponentNamed(TERRAIN);
		if (found) return found as unknown as TerrainQuery;
	}
	return null;
}

/** The terrain on one object, for a component that was built beside it. */
export function terrainOn(object: GameObject): TerrainQuery | null {
	return (object.getComponentNamed(TERRAIN) as unknown as TerrainQuery | null) ?? null;
}
