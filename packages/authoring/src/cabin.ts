/*
 * A log cabin, as hexagonal prisms.
 *
 * Authored in the cabin's own space: origin at the centre of the floor, front
 * wall towards +Z, ground at y = 0. The field it draws into carries the
 * placement, so the same description puts a cabin anywhere.
 *
 * The construction is the real thing rather than a box with a lid. Logs lie
 * flat-side down so courses stack; the side walls sit half a course higher
 * than the front and back so the ends interlock at the corners; the front wall
 * splits around the doorway until the courses clear the lintel; the gables are
 * closed with ever-shorter logs; and the roof is hexagons tiled across two
 * slope planes.
 *
 * Returns the measurements a caller needs to dress it further — where the
 * chimney ends up, so smoke can come out of it.
 */

import { jitter, quat, rgbFromHex, type Random, type Rgb } from '@hexdelve/shared';

import { AXIS_Z, PrismField, SQRT3 } from './prismfield.js';

const PI = Math.PI;

export const CABIN_PALETTE = {
	wood: [0x8a5a34, 0x7d5230, 0x956441, 0x734b2b],
	stone: [0x8d8d86, 0x94948c, 0x858680],
	roof: [0x5c7a3c, 0x54763a, 0x647f41],
	trim: 0x4a2f18,
	door: 0x5a3a20,
	knob: 0xd8b25a,
	pane: 0x9dc0d4,
	ridge: 0x4f3620,
	rafter: 0x5c3f24,
};

export interface CabinOptions {
	random: Random;
	halfX?: number;
	halfZ?: number;
	logR?: number;
	courses?: number;
	/** Top of any foundation the cabin stands on. */
	base?: number;
	/** How far log ends run past the corner. */
	over?: number;
	pitch?: number;
	eaveOver?: number;
	shingleR?: number;
	shingleT?: number;
	rise?: number;
	roofPalette?: number[];
	woodpile?: boolean;
}

export interface CabinResult {
	readonly wallTop: number;
	readonly ridgeY: number;
	readonly chimney: { x: number; y: number; z: number };
}

export function buildCabin(field: PrismField, options: CabinOptions): CabinResult {
	const random = options.random;
	const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
	const shade = (color: number, spread = 0.04): Rgb => jitter(rgbFromHex(color), random, spread);

	const halfX = options.halfX ?? 2.2;
	const halfZ = options.halfZ ?? 1.6;
	const logR = options.logR ?? 0.24;
	const courses = options.courses ?? 5;
	const base = options.base ?? 0;
	const over = options.over ?? 0.5;
	const pitch = options.pitch ?? 0.62;
	const eaveOver = options.eaveOver ?? 0.55;
	const shingleR = options.shingleR ?? 0.4;
	const shingleT = options.shingleT ?? 0.08;
	const roofPalette = options.roofPalette ?? CABIN_PALETTE.roof;

	const step = SQRT3 * logR; // flat-to-flat, so courses sit on each other
	const wallTop = base + courses * step;
	const eaveZ = halfZ + eaveOver;
	// The roof plane meets the top of the wall at the wall line, so the eave
	// overhangs below it — which is what an overhang is for.
	const ridgeY = wallTop + (options.rise ?? 0.28) + pitch * halfZ;

	const door = { x: -0.55, half: 0.46, height: 1.85 };
	const doorTop = base + door.height;

	/* -------------------------------------------------------------- footing -- */

	{
		const r = logR * 1.08;
		field.lying('x', 0, base - r * 0.5, -halfZ, r, 2 * halfX + 0.7, shade(pick(CABIN_PALETTE.stone)));
		field.lying('x', 0, base - r * 0.5, halfZ, r, 2 * halfX + 0.7, shade(pick(CABIN_PALETTE.stone)));
		field.lying('z', -halfX, base - r * 0.5, 0, r, 2 * halfZ + 0.7, shade(pick(CABIN_PALETTE.stone)));
		field.lying('z', halfX, base - r * 0.5, 0, r, 2 * halfZ + 0.7, shade(pick(CABIN_PALETTE.stone)));
	}

	/* ---------------------------------------------------------------- walls -- */

	const xLen = 2 * halfX + 2 * over;
	const zLen = 2 * halfZ + 2 * over;

	for (let k = 0; k < courses; k++) {
		const y = base + (k + 0.5) * step;
		const colour = (): Rgb => shade(CABIN_PALETTE.wood[k % CABIN_PALETTE.wood.length]!);

		field.lying('x', 0, y, -halfZ, logR, xLen, colour());

		if (y - logR < doorTop) {
			// This course crosses the doorway, so it arrives as two logs.
			const leftEnd = -halfX - over;
			const rightEnd = halfX + over;
			const gapL = door.x - door.half - 0.12;
			const gapR = door.x + door.half + 0.12;
			field.lying('x', (leftEnd + gapL) / 2, y, halfZ, logR, gapL - leftEnd, colour());
			field.lying('x', (gapR + rightEnd) / 2, y, halfZ, logR, rightEnd - gapR, colour());
		} else {
			field.lying('x', 0, y, halfZ, logR, xLen, colour());
		}

		// Half a course up: this offset is what makes the corners interlock.
		const ys = base + (k + 1) * step;
		const sideColour = shade(CABIN_PALETTE.wood[(k + 2) % CABIN_PALETTE.wood.length]!);
		field.lying('z', -halfX, ys, 0, logR, zLen, sideColour);
		field.lying('z', halfX, ys, 0, logR, zLen, sideColour);
	}

	/* ----------------------------------------------------------------- door -- */

	{
		const postR = logR * 0.55;
		for (const px of [door.x - door.half - postR, door.x + door.half + postR]) {
			field.upright(px, base, halfZ - 0.05, postR, door.height + 0.16, shade(CABIN_PALETTE.trim, 0.02));
		}
		field.lying(
			'x',
			door.x,
			doorTop + postR * 1.6,
			halfZ - 0.05,
			postR * 1.15,
			2 * door.half + 4 * postR,
			shade(CABIN_PALETTE.trim, 0.02),
		);
		// The door itself: one hexagon with a flat edge down, stretched taller
		// than wide. An affine hexagon is still a hexagon.
		field.compose(
			[door.x, base + door.height / 2, halfZ + logR * 0.25],
			AXIS_Z,
			[door.half, logR * 1.25, door.height / SQRT3],
			shade(CABIN_PALETTE.door, 0.03),
		);
		field.compose(
			[door.x + door.half * 0.55, base + door.height * 0.48, halfZ + logR * 0.8],
			AXIS_Z,
			[door.half * 0.13, logR * 0.4, door.half * 0.13],
			CABIN_PALETTE.knob,
		);
	}

	/* -------------------------------------------------------------- windows -- */

	for (const spec of [
		{ x: halfX * 0.52, y: base + 1.35, z: halfZ, axis: 'z' as const },
		{ x: halfX, y: base + 1.35, z: halfZ * 0.22, axis: 'x' as const },
	]) {
		const r = 0.42;
		const rotation = spec.axis === 'z' ? AXIS_Z : quat.fromEulerXYZ(quat.quat(), 0, 0, PI / 2);
		const proud = logR * 0.3;
		const px = spec.axis === 'x' ? spec.x + proud : spec.x;
		const pz = spec.axis === 'z' ? spec.z + proud : spec.z;
		field.compose([px, spec.y, pz], rotation, [r, logR * 1.1, r], shade(CABIN_PALETTE.trim, 0.02));
		field.compose(
			[spec.axis === 'x' ? px + proud : px, spec.y, spec.axis === 'z' ? pz + proud : pz],
			rotation,
			[r * 0.72, logR * 0.6, r * 0.72],
			CABIN_PALETTE.pane,
		);
	}

	/* --------------------------------------------------------------- gables -- */

	for (let j = 0; ; j++) {
		const cy = base + (courses + j + 1) * step;
		if (cy + logR > ridgeY + 0.1) break;
		const half = Math.max((ridgeY - (cy + logR * 0.8)) / pitch + 0.3, 0.6);
		for (const gx of [-halfX, halfX]) {
			field.lying('z', gx, cy, 0, logR, half * 2, shade(CABIN_PALETTE.wood[(j + 1) % CABIN_PALETTE.wood.length]!));
		}
	}

	/* ----------------------------------------------------------------- roof -- */

	// The ridge runs along X, so each slope is a single rotation about X and
	// the shingles tile in the slope plane exactly as they would on flat ground.
	const cosT = 1 / Math.hypot(1, pitch);
	const spanX = halfX + eaveOver * 0.9;
	for (const sign of [1, -1]) {
		const tilt = quat.fromEulerXYZ(quat.quat(), sign * Math.atan(pitch), 0, 0);
		let row = 0;
		for (let z = shingleR * 0.65; z < eaveZ + 0.2; z += 1.5 * shingleR * cosT, row++) {
			const offset = row % 2 ? (SQRT3 / 2) * shingleR : 0;
			for (let x = -spanX + offset; x <= spanX + 0.01; x += SQRT3 * shingleR) {
				field.compose(
					[x, ridgeY - pitch * z, sign * z],
					tilt,
					[shingleR, shingleT, shingleR],
					shade(pick(roofPalette), 0.05),
				);
			}
		}
		// Barge rafters down each gable edge, covering the step between the
		// gable logs and the roof plane.
		const angle = sign * Math.atan(pitch);
		const rq = quat.fromEulerXYZ(quat.quat(), angle + PI / 2, 0, 0);
		const slope = eaveZ / cosT;
		for (const ax of [-spanX + shingleR * 0.4, spanX - shingleR * 0.4]) {
			field.compose(
				[ax, ridgeY - pitch * eaveZ * 0.5, (sign * eaveZ) / 2],
				rq,
				[logR * 0.95, slope, logR * 0.95],
				shade(CABIN_PALETTE.rafter, 0.03),
			);
		}
	}
	field.lying('x', 0, ridgeY + logR * 0.5, 0, logR * 1.35, 2 * halfX + 2 * eaveOver, shade(CABIN_PALETTE.ridge, 0.02));

	/* -------------------------------------------------------------- chimney -- */

	const c = { side: 1, z: -halfZ * 0.4, r: 0.34, h: 0.48, clear: 0.55 };
	const cx = c.side * (halfX + c.r * 1.25);
	const top = ridgeY + c.clear;
	const count = Math.max(1, Math.ceil((top - base) / c.h));
	for (let k = 0; k < count; k++) {
		field.upright(cx, base + k * c.h, c.z, c.r, c.h, shade(pick(CABIN_PALETTE.stone), 0.06), k % 2 ? 12 : 0);
	}
	const capY = base + count * c.h;
	field.upright(cx, capY, c.z, c.r * 1.22, c.h * 0.45, shade(0x5c5c58, 0.03));

	/* ------------------------------------------------------------- woodpile -- */

	if (options.woodpile) {
		const r = logR * 0.8;
		const y = base + (SQRT3 / 2) * r;
		const wx = -halfX * 0.75;
		const wz = halfZ + 0.85;
		field.lying('x', wx, y, wz, r, 1.5, shade(pick(CABIN_PALETTE.wood), 0.05));
		field.lying('x', wx + 0.08, y, wz + 0.35, r, 1.35, shade(pick(CABIN_PALETTE.wood), 0.05));
		field.lying('x', wx + 0.04, y + SQRT3 * r, wz + 0.16, r, 1.3, shade(pick(CABIN_PALETTE.wood), 0.05));
	}

	return { wallTop, ridgeY, chimney: { x: cx, y: capY + c.h * 0.45, z: c.z } };
}
