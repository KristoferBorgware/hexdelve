/*
 * The yard: terrain, anvil, smithy, log house, smoke.
 *
 * What comes back is everything the game needs to reason about the ground:
 *
 *   tileAt / groundAt   the hex grid and its height, for pathing and footfall
 *   passable            walkable, with the climb limit as the caller's
 *                       business — a bat clears a step a man cannot
 *   anvil               the one prop whose position other code cares about
 *   smoke               the chimneys, which are the only thing here that moves
 *
 * Nothing in it knows what a character is.
 *
 * The static half is baked into one instance list at build time and copied
 * into the frame with a single array set. Only the smoke is rebuilt per frame,
 * because only the smoke moves.
 */

import {
	axialKey,
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

const PI = Math.PI;
const TAU = PI * 2;

export interface Tile {
	readonly q: number;
	readonly r: number;
	readonly level: number;
	/** World Y of the top of this terrace. */
	readonly top: number;
	readonly x: number;
	readonly z: number;
}

export interface WorldOptions {
	random: Random;
	groundRadius?: number;
	/** Top of the lowest terrace. */
	baseY?: number;
	/** Height of one terrace. */
	stepH?: number;
}

interface SmokePuff {
	readonly originX: number;
	readonly originY: number;
	readonly originZ: number;
	readonly phase: number;
	readonly wobble: number;
	readonly rise: number;
	/** Which building it belongs to, so it moves with that building's placement. */
	readonly root: { x: number; y: number; z: number; yaw: number };
}

export interface World {
	readonly groundRadius: number;
	readonly baseY: number;
	readonly stepH: number;
	readonly tiles: ReadonlyMap<string, Tile>;
	readonly statics: HexInstances;
	tileAt(q: number, r: number): Tile | null;
	groundAt(x: number, z: number): number;
	passable(cell: Axial, from: Axial | null, maxClimb: number): boolean;
	isAnvil(cell: Axial): boolean;
	readonly anvil: { cell: Axial; x: number; z: number; faceY: number };
	/** Writes the chimney puffs for this moment into `out`. Blended, not opaque. */
	emitSmoke(out: HexInstances, time: number): void;
}

export function buildWorld(options: WorldOptions): World {
	const random = options.random;
	const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
	const shade = (color: number, spread = 0.05): Rgb => jitter(rgbFromHex(color), random, spread);

	const groundRadius = options.groundRadius ?? 8;
	const baseY = options.baseY ?? 0.16;
	const stepH = options.stepH ?? 0.19;

	const statics = new HexInstances(6000);
	const tiles = new Map<string, Tile>();
	const blocked = new Set<string>();
	const smoke: SmokePuff[] = [];

	const ANVIL_CELL: Axial = { q: 0, r: 0 };

	/**
	 * The shape of the ground.
	 *
	 * A cone you can walk up, because neighbouring tiles never differ by more
	 * than one terrace, and a mesa with sheer sides, because they differ by
	 * three — so one is a hill and the other is a wall, and the same climb rule
	 * decides both without either being special-cased anywhere else.
	 */
	function levelAt(x: number, z: number): number {
		if (Math.hypot(x, z) < 2.4) return 1; // the flat working area round the anvil
		const cone = Math.hypot(x - 7.5, z + 5.0);
		let level = Math.max(0, Math.min(3, Math.round((7.0 - cone) / 1.75)));
		if (Math.hypot(x + 6.5, z - 4.5) < 3.2) level = Math.max(level, 3);
		return level;
	}

	/* --------------------------------------------------------------- terrain -- */

	{
		const field = new PrismField(statics);
		// The plinth the whole yard stands on, so the world has an edge rather
		// than floating tiles.
		field.upright(0, -1.4, 0, SQRT3 * groundRadius + 1.6, 1.4, rgbFromHex(0x4a3b2c), 90);

		const shades = [0x79a256, 0x84ab61, 0x90b46f, 0x9dbd7e];
		for (let q = -groundRadius; q <= groundRadius; q++) {
			for (let r = -groundRadius; r <= groundRadius; r++) {
				if ((Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2 > groundRadius) continue;
				const { x, z } = axialToWorld(q, r);
				const level = levelAt(x, z);
				const top = baseY + level * stepH;
				tiles.set(axialKey(q, r), { q, r, level, top, x, z });

				field.upright(x, 0, z, 0.985, top, shade(shades[level]!, 0.05));
				if (random() < 0.06) {
					field.upright(
						x + (random() - 0.5) * 0.8,
						top,
						z + (random() - 0.5) * 0.8,
						0.085,
						0.2,
						shade(0x5c8040, 0.06),
						random() * 60,
					);
				}
			}
		}
	}

	const tileAt = (q: number, r: number): Tile | null => tiles.get(axialKey(q, r)) ?? null;

	function groundAt(x: number, z: number): number {
		const cell = worldToAxial(x, z);
		return tileAt(cell.q, cell.r)?.top ?? baseY;
	}

	const isAnvil = (cell: Axial): boolean => cell.q === ANVIL_CELL.q && cell.r === ANVIL_CELL.r;

	/**
	 * A tile is walkable if it exists, is not the anvil's or a building's, and
	 * the step from where you came is climbable.
	 *
	 * How big a step counts as climbable is the caller's business, not the
	 * ground's: it is the difference between a man, who must walk up a terrace,
	 * and a bat, which beats its wings and clears two. So `maxClimb` comes in
	 * with the question and the same terrain answers both.
	 */
	function passable(cell: Axial, from: Axial | null, maxClimb = 1): boolean {
		const tile = tileAt(cell.q, cell.r);
		if (!tile || isAnvil(cell)) return false;
		if (blocked.has(axialKey(cell.q, cell.r))) return false;
		if (!from) return true;
		const previous = tileAt(from.q, from.r);
		return !previous || Math.abs(tile.level - previous.level) <= maxClimb;
	}

	/** Mark every tile under a placed building solid, so paths go round it. */
	function blockFootprint(
		cx: number,
		cz: number,
		yaw: number,
		halfX: number,
		halfZ: number,
		margin: number,
	): void {
		const sin = Math.sin(yaw);
		const cos = Math.cos(yaw);
		for (const tile of tiles.values()) {
			const dx = tile.x - cx;
			const dz = tile.z - cz;
			const lx = dx * cos - dz * sin;
			const lz = dx * sin + dz * cos;
			if (Math.abs(lx) < halfX + margin && Math.abs(lz) < halfZ + margin) {
				blocked.add(axialKey(tile.q, tile.r));
			}
		}
	}

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

		addSmoke(root, -0.75, 0.8 + 9 * 0.5 + 0.22, forgeZ, 8, 3.6);
		blockFootprint(SMITHY.x, SMITHY.z, SMITHY.yaw, SMITHY_HALF_X, SMITHY_HALF_Z, 0.5);
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

		addSmoke(root, built.chimney.x, built.chimney.y, built.chimney.z, 7, 3.2);
		blockFootprint(CABIN.x, CABIN.z, CABIN.yaw, CABIN_HALF_X, CABIN_HALF_Z, 0.55);
	}

	/* ----------------------------------------------------------------- smoke -- */

	function addSmoke(
		root: { x: number; y: number; z: number; yaw: number },
		x: number,
		y: number,
		z: number,
		count: number,
		rise: number,
	): void {
		for (let i = 0; i < count; i++) {
			smoke.push({
				originX: x,
				originY: y,
				originZ: z,
				phase: i / count,
				wobble: random() * TAU,
				rise,
				root,
			});
		}
	}

	const smokeColor = rgbFromHex(0xd8d4cc);

	function emitSmoke(out: HexInstances, time: number): void {
		const period = 8;
		for (const puff of smoke) {
			const u = (((time / period + puff.phase) % 1) + 1) % 1;

			// Authored in the building's own space, then carried out into the
			// world by that building's placement — the same trip the chimney it
			// comes out of made.
			const lx = puff.originX + 0.5 * u * Math.sin(puff.wobble + u * 4);
			const ly = puff.originY + 0.2 + u * puff.rise;
			const lz = puff.originZ + 0.35 * u * Math.cos(puff.wobble + u * 3);

			const sin = Math.sin(puff.root.yaw);
			const cos = Math.cos(puff.root.yaw);
			const s = 0.18 + u * 0.55;

			out.pushRadial(
				puff.root.x + lx * cos + lz * sin,
				puff.root.y + ly,
				puff.root.z - lx * sin + lz * cos,
				s,
				s * 0.7,
				smokeColor,
				{
					yaw: puff.root.yaw + puff.wobble + u * 2,
					// Fades in and back out across its rise, so a puff appears at
					// the chimney rather than switching on in mid-air.
					alpha: 0.4 * Math.sin(PI * Math.min(u * 1.7, 1)),
				},
			);
		}
	}

	return {
		groundRadius,
		baseY,
		stepH,
		tiles,
		statics,
		tileAt,
		groundAt,
		passable,
		isAnvil,
		anvil: { cell: ANVIL_CELL, x: anvilPos.x, z: anvilPos.z, faceY: anvilFaceY },
		emitSmoke,
	};
}
