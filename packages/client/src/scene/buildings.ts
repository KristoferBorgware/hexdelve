/*
 * The buildings in the yard: an anvil, a smithy and a log house.
 *
 * Everything here stands ON the ground rather than being it. The terrain is a
 * script — see `game/terrain.ts` — and this is handed one: it reads tile
 * heights off it to sit each building on the surface, and tells it which tiles
 * are now solid so routes go round them. A building knowing its own footprint
 * is the point of that direction: a terrain carrying a list of what is on it
 * would be a second place for the same rectangles to be written down.
 *
 * All of it is baked into one instance list at build time and copied into the
 * frame with a single array set. Nothing here moves, which is why the chimneys
 * come back as a list of POSITIONS rather than as plumes: what comes out of one
 * is a particle emitter placed on it by whoever built the scene, and where a
 * building vents is the only half of that this file knows.
 */

import {
	axialToWorld,
	jitter,
	quat,
	rgbFromHex,
	SQRT3,
	worldToAxial,
	type Axial,
	type Random,
	type Rgb,
} from '@hexdelve/shared';
import { HexInstances } from '@hexdelve/engine';

import { buildCabin } from './cabin.js';
import { AXIS_X, PrismField } from './field.js';
import type { TerrainQuery } from '../game/terrain.js';

/** Where a building vents, in the world, with the facing it was placed at. */
export interface Chimney {
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly yaw: number;
}

/** What stands in the yard, once the ground is there to stand it on. */
export interface Buildings {
	/** Every prism of every building, in one list. */
	readonly statics: HexInstances;
	/** The one prop whose position other code cares about. */
	readonly anvil: { cell: Axial; x: number; z: number; faceY: number };
	/** The mouth of each chimney, for whoever wants to put smoke on it. */
	readonly chimneys: readonly Chimney[];
}

export interface BuildingsOptions {
	readonly random: Random;
}

/**
 * Put the buildings up, and mark the ground they stand on.
 *
 * The terrain has to exist first, which is not an ordering to work around but
 * the real dependency: a smithy sits at the height of the tile under it, and
 * until there is a tile there is no height to sit at.
 */
export function buildBuildings(terrain: TerrainQuery, options: BuildingsOptions): Buildings {
	const random = options.random;
	const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
	const shade = (color: number, spread = 0.05): Rgb => jitter(rgbFromHex(color), random, spread);

	const statics = new HexInstances(2048);
	const chimneys: Chimney[] = [];
	const ANVIL_CELL: Axial = { q: 0, r: 0 };
	const tileAt = (q: number, r: number) => terrain.tileAt(q, r);

	/* ----------------------------------------------------------------- anvil -- */

	const anvilPos = axialToWorld(ANVIL_CELL.q, ANVIL_CELL.r);
	const anvilFaceY = tileAt(0, 0)!.top + 0.86;

	{
		const field = new PrismField(statics, anvilPos.x, anvilFaceY, anvilPos.z);
		const stumpTop = -0.22;
		const stumpBottom = tileAt(0, 0)!.top - anvilFaceY;
		const h = stumpTop - stumpBottom;
		field.upright(0, stumpBottom, 0, 0.48, h, rgbFromHex(0x5c4127), 14);
		field.compose([0, -0.16, 0], null, [0.3, 0.12, 0.3], rgbFromHex(0x3d4045));
		field.compose([0.02, -0.208, 0], AXIS_X, [0.24, 0.72, 0.24], rgbFromHex(0x54585e));
		field.compose([0.5, -0.17, 0], AXIS_X, [0.085, 0.28, 0.085], rgbFromHex(0x484c52));
	}

	/* ---------------------------------------------------------------- smithy -- */

	const SMITHY = { x: -4.1, z: -3.5, yaw: Math.atan2(0 - -4.1, 0 - -3.5) };
	const SMITHY_HALF_X = 1.95;
	const SMITHY_HALF_Z = 1.5;

	{
		const home = worldToAxial(SMITHY.x, SMITHY.z);
		const root = { x: SMITHY.x, y: tileAt(home.q, home.r)!.top, z: SMITHY.z, yaw: SMITHY.yaw };
		const field = new PrismField(statics, root.x, root.y, root.z, root.yaw);

		const logR = 0.26;
		const step = SQRT3 * logR;
		const courses = 5;
		const sill = 0.22;
		const wallTop = sill + courses * step;
		const pitch = 0.5;
		const eaveZ = SMITHY_HALF_Z + 0.5;
		const ridgeY = wallTop + 0.3 + pitch * eaveZ;
		const wood = [0x7d5230, 0x8a5a34, 0x734b2b, 0x956441];
		const stone = [0x8d8d86, 0x94948c, 0x858680];

		// Stone sill under the timber, so the logs are not sitting in the mud.
		for (const [cx, cz, len, axis] of [
			[0, -SMITHY_HALF_Z, 2 * SMITHY_HALF_X + 0.6, 'x'],
			[-SMITHY_HALF_X, 0, 2 * SMITHY_HALF_Z + 0.6, 'z'],
			[SMITHY_HALF_X, 0, 2 * SMITHY_HALF_Z + 0.6, 'z'],
		] as [number, number, number, 'x' | 'z'][]) {
			field.lying(axis, cx, sill / 2, cz, 0.3, len, shade(pick(stone), 0.04));
		}

		// Three walls of stacked logs; the front stays open onto the anvil.
		for (let k = 0; k < courses; k++) {
			const y = sill + (k + 0.5) * step;
			const colour = (): Rgb => shade(wood[k % wood.length]!, 0.04);
			field.lying('x', 0, y, -SMITHY_HALF_Z, logR, 2 * SMITHY_HALF_X + 0.7, colour());
			const ys = sill + (k + 1) * step;
			field.lying('z', -SMITHY_HALF_X, ys, 0, logR, 2 * SMITHY_HALF_Z + 0.7, colour());
			field.lying('z', SMITHY_HALF_X, ys, 0, logR, 2 * SMITHY_HALF_Z + 0.7, colour());
		}

		// Front posts and the lintel they carry.
		for (const px of [-SMITHY_HALF_X, SMITHY_HALF_X]) {
			field.upright(px, sill, SMITHY_HALF_Z, 0.28, wallTop - sill, shade(0x5c3f24, 0.03), 10);
		}
		field.lying('x', 0, wallTop + 0.1, SMITHY_HALF_Z, 0.3, 2 * SMITHY_HALF_X + 0.7, shade(0x5c3f24, 0.03));

		// Gable roof: hexagon shingles tiled across each slope.
		const shingleR = 0.42;
		const cosT = 1 / Math.hypot(1, pitch);
		for (const sign of [1, -1]) {
			const tilt = quat.fromEulerXYZ(quat.quat(), sign * Math.atan(pitch), 0, 0);
			let row = 0;
			for (let z = 0.28; z < eaveZ + 0.2; z += 1.5 * shingleR * cosT, row++) {
				const offset = row % 2 ? (SQRT3 / 2) * shingleR : 0;
				for (let x = -SMITHY_HALF_X - 0.35 + offset; x <= SMITHY_HALF_X + 0.36; x += SQRT3 * shingleR) {
					field.compose(
						[x, ridgeY - pitch * z, sign * z],
						tilt,
						[shingleR, 0.09, shingleR],
						shade(pick([0x5c5148, 0x665a4f, 0x544a42]), 0.05),
					);
				}
			}
		}
		field.lying('x', 0, ridgeY + 0.1, 0, 0.34, 2 * SMITHY_HALF_X + 1.0, shade(0x4f3620, 0.02));

		// The forge itself, at the back wall, and its chimney past the roof.
		const forgeZ = -SMITHY_HALF_Z + 0.55;
		field.upright(-0.75, 0, forgeZ, 0.62, 0.8, shade(pick(stone), 0.05), 12);
		for (let k = 0; k < 9; k++) {
			field.upright(-0.75, 0.8 + k * 0.5, forgeZ, 0.42, 0.5, shade(pick(stone), 0.06), k % 2 ? 14 : 0);
		}
		field.upright(-0.75, 0.8 + 9 * 0.5, forgeZ, 0.52, 0.22, shade(0x5c5c58, 0.03));

		// A rack of stock and a barrel, to make it look worked in.
		field.lying('z', 1.35, 0.55, -0.2, 0.075, 1.6, shade(0x6b5334, 0.03));
		field.lying('z', 1.52, 0.55, 0.1, 0.075, 1.3, shade(0x6b5334, 0.03));
		field.upright(1.3, 0, 1.0, 0.34, 0.62, shade(0x6b4a2c, 0.04), 8);

		// The coals. Unlit, because they are the light rather than lit by it.
		field.compose([-0.75, 0.83, forgeZ], null, [0.44, 0.06, 0.44], rgbFromHex(0xff8a3c), {
			flags: 1,
		});

		addChimney(root, -0.75, 0.8 + 9 * 0.5 + 0.22, forgeZ);
		terrain.block({
			x: SMITHY.x,
			z: SMITHY.z,
			yaw: SMITHY.yaw,
			halfX: SMITHY_HALF_X,
			halfZ: SMITHY_HALF_Z,
			margin: 0.5,
		});
	}

	/* ------------------------------------------------------------- log house -- */

	const CABIN = { x: 0.2, z: 6.8, yaw: Math.atan2(0 - 0.2, 0 - 6.8) };
	const CABIN_HALF_X = 2.2;
	const CABIN_HALF_Z = 1.6;

	{
		const home = worldToAxial(CABIN.x, CABIN.z);
		const root = { x: CABIN.x, y: tileAt(home.q, home.r)!.top, z: CABIN.z, yaw: CABIN.yaw };
		const field = new PrismField(statics, root.x, root.y, root.z, root.yaw);

		const built = buildCabin(field, {
			random,
			halfX: CABIN_HALF_X,
			halfZ: CABIN_HALF_Z,
			logR: 0.24,
			courses: 5,
			base: 0.2,
			roofPalette: [0x7a5a3a, 0x6d5134, 0x84643f],
			woodpile: true,
		});

		addChimney(root, built.chimney.x, built.chimney.y, built.chimney.z);
		terrain.block({
			x: CABIN.x,
			z: CABIN.z,
			yaw: CABIN.yaw,
			halfX: CABIN_HALF_X,
			halfZ: CABIN_HALF_Z,
			margin: 0.55,
		});
	}

	/* -------------------------------------------------------------- chimneys -- */

	/**
	 * Where a chimney vents, carried out of its building's space into the world.
	 *
	 * The same trip the chimney prisms themselves made through `PrismField`,
	 * written out once more here because what comes back is a point rather than
	 * a prism — and a caller putting an emitter on it needs it in the space the
	 * scene is in.
	 */
	function addChimney(
		root: { x: number; y: number; z: number; yaw: number },
		x: number,
		y: number,
		z: number,
	): void {
		const sin = Math.sin(root.yaw);
		const cos = Math.cos(root.yaw);
		chimneys.push({
			x: root.x + x * cos + z * sin,
			y: root.y + y,
			z: root.z - x * sin + z * cos,
			yaw: root.yaw,
		});
	}


	/*
	 * And the anvil's own tile, which nothing may walk onto. One cell rather
	 * than a rectangle, because that is what it is: a stump with an anvil on
	 * it, occupying exactly the hexagon it stands in.
	 */
	terrain.blockCell(ANVIL_CELL.q, ANVIL_CELL.r);

	return {
		statics,
		anvil: { cell: ANVIL_CELL, x: anvilPos.x, z: anvilPos.z, faceY: anvilFaceY },
		chimneys,
	};
}
