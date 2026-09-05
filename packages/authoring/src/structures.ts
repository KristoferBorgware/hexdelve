/*
 * The buildings in the yard, as prisms in their own space.
 *
 * Each is authored where it stands: origin at the centre of its floor, front
 * towards +Z, ground at y = 0. What comes out is a list of prisms and, for the
 * two that have one, where the chimney vents — and a tool writes that to a mesh
 * file. See `tools/bake-buildings.mjs`.
 *
 * ## Why it is baked rather than run
 *
 * The construction is worth keeping: the cabin's logs interlock at the corners
 * because the side walls sit half a course higher, the front wall splits round
 * the doorway until the courses clear the lintel, and the roof is hexagons
 * tiled across two slope planes. None of that is expressible as a list, and
 * writing the list by hand would lose the reason each number is what it is.
 *
 * But a building that is only ever a function is a building nobody can open
 * and nudge, and it is a building the editor cannot show. So the function stays
 * as the thing that DERIVES the shape, and the file is what ships — the same
 * bargain the clips struck with the pose functions.
 *
 * The jitter is part of that bargain. A colour per log comes out of a seeded
 * random here and is frozen into real numbers by the bake, which is a gain
 * rather than a loss: after baking, one plank can be repainted without
 * re-deriving the wall it is in.
 */

import { hexFromRgb, jitter, quat, rgbFromHex, SQRT3, type Random, type Rgb } from '@hexdelve/shared';

import { buildCabin } from './cabin.js';
import { AXIS_X, PrismField, type PrismSink } from './prismfield.js';

/** One prism, as a mesh file writes it. */
export interface BakedPrism {
	readonly at: readonly [number, number, number];
	readonly size: readonly [number, number, number];
	readonly euler: readonly [number, number, number];
	/** `#rrggbb`, since a baked colour has no name to be known by. */
	readonly color: string;
	readonly unlit: boolean;
}

/** A structure, ready to be written down. */
export interface BakedStructure {
	readonly id: string;
	readonly name: string;
	readonly prisms: readonly BakedPrism[];
	/** Where it vents, in its own space. Absent where it does not. */
	readonly chimney?: readonly [number, number, number];
	/** Half the ground it takes up, and the clearance beyond it. */
	readonly footing: { readonly halfX: number; readonly halfZ: number; readonly margin: number };
}

/** A sink that keeps prisms instead of packing them into a frame. */
class Recorder implements PrismSink {
	readonly prisms: BakedPrism[] = [];

	push(
		x: number,
		y: number,
		z: number,
		scaleX: number,
		scaleY: number,
		scaleZ: number,
		color: unknown,
		options: { rotation?: ArrayLike<number>; flags?: number } = {},
	): void {
		const euler: [number, number, number] = [0, 0, 0];
		if (options.rotation) quat.toEulerXYZ(euler, options.rotation as never);
		this.prisms.push({
			at: [round(x), round(y), round(z)],
			size: [round(scaleX), round(scaleY), round(scaleZ)],
			euler: [round(euler[0]), round(euler[1]), round(euler[2])],
			color: hexOf(color),
			unlit: (options.flags ?? 0) !== 0,
		});
	}
}

/** Six decimals: past what a prism a centimetre wide can show. */
function round(value: number): number {
	return Math.abs(value) < 1e-9 ? 0 : Number(value.toFixed(6));
}

function hexOf(color: unknown): string {
	if (typeof color === 'number') return `#${color.toString(16).padStart(6, '0')}`;
	return `#${hexFromRgb(color as Rgb).toString(16).padStart(6, '0')}`;
}

/** The anvil on its stump, with the face at 0.86 above the ground. */
export function bakeAnvil(): BakedStructure {
	const out = new Recorder();
	const field = new PrismField(out);
	const face = 0.86;

	field.upright(0, 0, 0, 0.48, face - 0.22, rgbFromHex(0x5c4127), 14);
	field.compose([0, face - 0.16, 0], null, [0.3, 0.12, 0.3], rgbFromHex(0x3d4045));
	field.compose([0.02, face - 0.208, 0], AXIS_X, [0.24, 0.72, 0.24], rgbFromHex(0x54585e));
	field.compose([0.5, face - 0.17, 0], AXIS_X, [0.085, 0.28, 0.085], rgbFromHex(0x484c52));

	// One hexagon of ground, which is exactly what it stands on.
	return {
		id: 'anvil',
		name: 'Anvil',
		prisms: out.prisms,
		footing: { halfX: 0.4, halfZ: 0.4, margin: 0 },
	};
}

/** The smithy: three walls of logs, a shingled gable, and a forge at the back. */
export function bakeSmithy(random: Random): BakedStructure {
	const out = new Recorder();
	const field = new PrismField(out);
	const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
	const shade = (color: number, spread = 0.05): Rgb => jitter(rgbFromHex(color), random, spread);

	const HALF_X = 1.95;
	const HALF_Z = 1.5;
	const logR = 0.26;
	const step = SQRT3 * logR;
	const courses = 5;
	const sill = 0.22;
	const wallTop = sill + courses * step;
	const pitch = 0.5;
	const eaveZ = HALF_Z + 0.5;
	const ridgeY = wallTop + 0.3 + pitch * eaveZ;
	const wood = [0x7d5230, 0x8a5a34, 0x734b2b, 0x956441];
	const stone = [0x8d8d86, 0x94948c, 0x858680];

	// Stone sill under the timber, so the logs are not sitting in the mud.
	for (const [cx, cz, len, axis] of [
		[0, -HALF_Z, 2 * HALF_X + 0.6, 'x'],
		[-HALF_X, 0, 2 * HALF_Z + 0.6, 'z'],
		[HALF_X, 0, 2 * HALF_Z + 0.6, 'z'],
	] as [number, number, number, 'x' | 'z'][]) {
		field.lying(axis, cx, sill / 2, cz, 0.3, len, shade(pick(stone), 0.04));
	}

	// Three walls of stacked logs; the front stays open onto the anvil.
	for (let k = 0; k < courses; k++) {
		const y = sill + (k + 0.5) * step;
		const colour = (): Rgb => shade(wood[k % wood.length]!, 0.04);
		field.lying('x', 0, y, -HALF_Z, logR, 2 * HALF_X + 0.7, colour());
		const ys = sill + (k + 1) * step;
		field.lying('z', -HALF_X, ys, 0, logR, 2 * HALF_Z + 0.7, colour());
		field.lying('z', HALF_X, ys, 0, logR, 2 * HALF_Z + 0.7, colour());
	}

	// Front posts and the lintel they carry.
	for (const px of [-HALF_X, HALF_X]) {
		field.upright(px, sill, HALF_Z, 0.28, wallTop - sill, shade(0x5c3f24, 0.03), 10);
	}
	field.lying('x', 0, wallTop + 0.1, HALF_Z, 0.3, 2 * HALF_X + 0.7, shade(0x5c3f24, 0.03));

	// Gable roof: hexagon shingles tiled across each slope.
	const shingleR = 0.42;
	const cosT = 1 / Math.hypot(1, pitch);
	for (const sign of [1, -1]) {
		const tilt = quat.fromEulerXYZ(quat.quat(), sign * Math.atan(pitch), 0, 0);
		let row = 0;
		for (let z = 0.28; z < eaveZ + 0.2; z += 1.5 * shingleR * cosT, row++) {
			const offset = row % 2 ? (SQRT3 / 2) * shingleR : 0;
			for (let x = -HALF_X - 0.35 + offset; x <= HALF_X + 0.36; x += SQRT3 * shingleR) {
				field.compose(
					[x, ridgeY - pitch * z, sign * z],
					tilt,
					[shingleR, 0.09, shingleR],
					shade(pick([0x5c5148, 0x665a4f, 0x544a42]), 0.05),
				);
			}
		}
	}
	field.lying('x', 0, ridgeY + 0.1, 0, 0.34, 2 * HALF_X + 1.0, shade(0x4f3620, 0.02));

	// The forge itself, at the back wall, and its chimney past the roof.
	const forgeZ = -HALF_Z + 0.55;
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
	field.compose([-0.75, 0.83, forgeZ], null, [0.44, 0.06, 0.44], rgbFromHex(0xff8a3c), { flags: 1 });

	return {
		id: 'smithy',
		name: 'Smithy',
		prisms: out.prisms,
		chimney: [-0.75, 0.8 + 9 * 0.5 + 0.22, forgeZ],
		footing: { halfX: HALF_X, halfZ: HALF_Z, margin: 0.5 },
	};
}

/** The log house, as `cabin.ts` builds one. */
export function bakeCabin(random: Random): BakedStructure {
	const out = new Recorder();
	const field = new PrismField(out);
	const HALF_X = 2.2;
	const HALF_Z = 1.6;

	const built = buildCabin(field, {
		random,
		halfX: HALF_X,
		halfZ: HALF_Z,
		logR: 0.24,
		courses: 5,
		base: 0.2,
		roofPalette: [0x7a5a3a, 0x6d5134, 0x84643f],
		woodpile: true,
	});

	return {
		id: 'cabin',
		name: 'Log house',
		prisms: out.prisms,
		chimney: [built.chimney.x, built.chimney.y, built.chimney.z],
		footing: { halfX: HALF_X, halfZ: HALF_Z, margin: 0.55 },
	};
}

/** Every structure the yard has, in the order the bake writes them. */
export function bakeStructures(random: Random): BakedStructure[] {
	// One stream, in this order, so a re-bake reproduces the same jitter.
	return [bakeAnvil(), bakeSmithy(random), bakeCabin(random)];
}
