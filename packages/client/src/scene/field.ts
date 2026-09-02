/*
 * A place to put prisms while a building is being described.
 *
 * Everything in this world is the unit hex prism, and the three ways it ever
 * gets used are: standing on the ground, lying along an axis, or placed at an
 * arbitrary rotation. Those are the three methods here, and they are what let
 * the cabin and the smithy read as construction rather than as a list of
 * matrices.
 *
 * The root transform is the other half of it. A building is authored in its
 * own space — origin at the centre of its floor, front towards +Z, ground at
 * y = 0 — and then placed. With a scene graph that placement is a parent node;
 * with one flat instance buffer it has to be baked in as the prisms are
 * written, which is what `origin` and `yaw` do.
 */

import { quat, type QuatLike, SQRT3 } from '@hexdelve/shared';
import { type ColorInput, type HexInstances, type PrismOptions } from '@hexdelve/engine';

/** Lying with the prism's axis along world X, flat side down so they stack. */
export const AXIS_X = quat.fromEulerXYZ(quat.quat(), 0, 0, Math.PI / 2);

/**
 * And along Z. The extra sixth of a turn about Y is what puts a flat face
 * down: without it the prism rests on an edge and a stack of logs rolls.
 */
export const AXIS_Z = quat.multiply(
	quat.quat(),
	quat.fromEulerXYZ(quat.quat(), Math.PI / 2, 0, 0),
	quat.fromEulerXYZ(quat.quat(), 0, Math.PI / 6, 0),
);

export { SQRT3 };

const composed = quat.quat();
const rotated = new Float32Array(3);

export class PrismField {
	private readonly rootQuat = quat.quat();

	constructor(
		private readonly out: HexInstances,
		private readonly originX = 0,
		private readonly originY = 0,
		private readonly originZ = 0,
		yaw = 0,
	) {
		quat.fromYaw(this.rootQuat, yaw);
	}

	/** A prism at an arbitrary rotation, centred on `pos`. */
	compose(
		pos: readonly [number, number, number],
		rotation: QuatLike | null,
		scale: readonly [number, number, number],
		color: ColorInput,
		options: PrismOptions = {},
	): this {
		if (rotation) quat.multiply(composed, this.rootQuat, rotation);
		else quat.copy(composed, this.rootQuat);

		rotated[0] = pos[0];
		rotated[1] = pos[1];
		rotated[2] = pos[2];
		quat.rotateVec3(rotated, this.rootQuat, rotated);

		this.out.push(
			this.originX + rotated[0]!,
			this.originY + rotated[1]!,
			this.originZ + rotated[2]!,
			scale[0],
			scale[1],
			scale[2],
			color,
			{ ...options, rotation: composed },
		);
		return this;
	}

	/** A prism standing on `baseY`. */
	upright(
		x: number,
		baseY: number,
		z: number,
		radius: number,
		height: number,
		color: ColorInput,
		yawDegrees = 0,
		options: PrismOptions = {},
	): this {
		const rotation = yawDegrees
			? quat.fromYaw(quat.quat(), (yawDegrees * Math.PI) / 180)
			: null;
		return this.compose(
			[x, baseY + height / 2, z],
			rotation,
			[radius, height, radius],
			color,
			options,
		);
	}

	/** A prism lying along world X or Z — every log, sill and lintel. */
	lying(
		axis: 'x' | 'z',
		cx: number,
		cy: number,
		cz: number,
		radius: number,
		length: number,
		color: ColorInput,
		options: PrismOptions = {},
	): this {
		return this.compose(
			[cx, cy, cz],
			axis === 'x' ? AXIS_X : AXIS_Z,
			[radius, length, radius],
			color,
			options,
		);
	}
}
