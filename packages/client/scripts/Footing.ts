/*
 * How a thing sits on the ground, and what ground it takes up.
 *
 * Two halves of one sentence. A building stands ON the terrain, so its height
 * is the height of the tile under it rather than a number in a scene file — a
 * scene says where a thing is on the map, and moving a slider that makes the
 * hill taller must not leave the smithy hanging in the air. And a building
 * OCCUPIES the tiles under it, so routes go round rather than through.
 *
 * The footprint is the thing's own, declared beside its mesh, because that is
 * where it is known: a terrain carrying a list of what is standing on it would
 * be a second place for the same rectangles to be written down, and the second
 * place is the one that goes stale.
 *
 * ## Once, on load
 *
 * Both halves are settled when the object arrives and never again. Nothing here
 * moves — a smithy that walked would want a different script — so a `tick` that
 * re-checked would be work every frame to reach the same answer.
 */

import { param, Script } from '@hexdelve/engine';
import { terrainOf } from '@hexdelve/client';
import { worldToAxial } from '@hexdelve/shared';

export class Footing extends Script {
	/** Half the ground it covers, along its own X and Z. */
	halfX = param(1, { min: 0, max: 20, step: 0.05, label: 'Half X' });
	halfZ = param(1, { min: 0, max: 20, step: 0.05, label: 'Half Z' });

	/**
	 * Clearance beyond the walls, so nothing paths flush against them.
	 *
	 * Zero for a thing that occupies exactly what it covers — the anvil, which
	 * is a stump on one hexagon.
	 */
	margin = param(0, { min: 0, max: 4, step: 0.05, label: 'Margin' });

	override onLoad(): void {
		const terrain = terrainOf(this.scene);
		if (!terrain) return; // A bench has no ground, and a thing on none stands where it is.

		const { transform } = this.object;
		const x = transform.position[0]!;
		const z = transform.position[2]!;

		const cell = worldToAxial(x, z);
		const tile = terrain.tileAt(cell.q, cell.r);
		if (tile) transform.position[1] = tile.top;

		terrain.block({
			x,
			z,
			yaw: transform.yaw,
			halfX: this.halfX,
			halfZ: this.halfZ,
			margin: this.margin,
		});
	}
}
