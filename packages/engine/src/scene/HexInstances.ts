/*
 * A pile of hex prisms, packed the way both backends read them.
 *
 * Sixteen floats per instance, in four vec4s so the layout is 16-byte aligned
 * for WebGPU and needs no padding rules on either side:
 *
 *     0..2    translation
 *     3       alpha, 0..1
 *     4..7    rotation, as a quaternion (x, y, z, w)
 *     8..10   scale (x, y, z)
 *     11      flags, see below
 *     12..14  colour, 0..1
 *     15      unused
 *
 * A full quaternion rather than the yaw this used to carry, because almost
 * nothing in a Hexdelve scene is upright. Logs lie along X or Z, roof shingles
 * tilt to the pitch of the roof, and every part of a character is parented to
 * a bone that is pointing wherever the pose put it. A yaw could express the
 * terrain and nothing else.
 *
 * Scale is three independent axes for the same reason: a sword blade is a
 * prism 0.046 wide, 0.6 long and 0.021 thick, and squashing it uniformly would
 * make it a stick.
 */

import { quat, rgbFromHex, type QuatLike, type Rgb } from '@hexdelve/shared';

export const HEX_INSTANCE_FLOATS = 16;
export const HEX_INSTANCE_BYTES = HEX_INSTANCE_FLOATS * 4;

/** Shade this prism with the sun, as everything solid is. */
export const HEX_FLAG_NONE = 0;
/** Draw it at its own colour, unlit — for readouts drawn into the world. */
export const HEX_FLAG_UNLIT = 1;

export type ColorInput = number | Rgb;

function toRgb(color: ColorInput): Rgb {
	return typeof color === 'number' ? rgbFromHex(color) : color;
}

const scratchQuat = quat.quat();

export interface PrismOptions {
	/** Rotation as a quaternion. Takes precedence over `yaw`. */
	rotation?: QuatLike;
	/** Rotation about +Y, when that is all a prism needs. */
	yaw?: number;
	alpha?: number;
	flags?: number;
}

export class HexInstances {
	private buffer: Float32Array;
	private length = 0;

	constructor(capacity = 1024) {
		this.buffer = new Float32Array(Math.max(1, capacity) * HEX_INSTANCE_FLOATS);
	}

	get count(): number {
		return this.length;
	}

	get capacity(): number {
		return this.buffer.length / HEX_INSTANCE_FLOATS;
	}

	/** The packed array, trimmed to the instances actually written. */
	get data(): Float32Array {
		return this.buffer.subarray(0, this.length * HEX_INSTANCE_FLOATS);
	}

	clear(): this {
		this.length = 0;
		return this;
	}

	/** A prism centred on (x, y, z), scaled independently on each axis. */
	push(
		x: number,
		y: number,
		z: number,
		sx: number,
		sy: number,
		sz: number,
		color: ColorInput,
		options: PrismOptions = {},
	): this {
		this.reserve(this.length + 1);
		const at = this.length * HEX_INSTANCE_FLOATS;
		const rgb = toRgb(color);
		const b = this.buffer;

		const rotation = options.rotation ?? quat.fromYaw(scratchQuat, options.yaw ?? 0);

		b[at + 0] = x;
		b[at + 1] = y;
		b[at + 2] = z;
		b[at + 3] = options.alpha ?? 1;
		b[at + 4] = rotation[0]!;
		b[at + 5] = rotation[1]!;
		b[at + 6] = rotation[2]!;
		b[at + 7] = rotation[3]!;
		b[at + 8] = sx;
		b[at + 9] = sy;
		b[at + 10] = sz;
		b[at + 11] = options.flags ?? HEX_FLAG_NONE;
		b[at + 12] = rgb.r;
		b[at + 13] = rgb.g;
		b[at + 14] = rgb.b;
		b[at + 15] = 0;

		this.length++;
		return this;
	}

	/** A prism of circular footprint — the common case, where x and z agree. */
	pushRadial(
		x: number,
		y: number,
		z: number,
		radius: number,
		height: number,
		color: ColorInput,
		options: PrismOptions = {},
	): this {
		return this.push(x, y, z, radius, height, radius, color, options);
	}

	/** A prism standing on `baseY` rather than centred on it. */
	pushUpright(
		x: number,
		baseY: number,
		z: number,
		radius: number,
		height: number,
		color: ColorInput,
		options: PrismOptions = {},
	): this {
		return this.pushRadial(x, baseY + height / 2, z, radius, height, color, options);
	}

	/**
	 * Appends every instance of another list. Used to stitch the per-frame
	 * pieces — characters, props, motes — onto the static ground.
	 */
	pushAll(other: HexInstances): this {
		if (other.length === 0) return this;
		this.reserve(this.length + other.length);
		this.buffer.set(other.data, this.length * HEX_INSTANCE_FLOATS);
		this.length += other.length;
		return this;
	}

	private reserve(needed: number): void {
		if (needed <= this.capacity) return;
		let capacity = Math.max(1, this.capacity);
		while (capacity < needed) capacity *= 2;
		const grown = new Float32Array(capacity * HEX_INSTANCE_FLOATS);
		grown.set(this.buffer);
		this.buffer = grown;
	}
}
