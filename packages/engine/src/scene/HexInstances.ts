/*
 * A pile of hex prisms, packed the way both backends read them.
 *
 * Twelve floats per instance, in three vec4s so the layout is 16-byte aligned
 * for WebGPU and needs no padding rules on either side:
 *
 *     0..2   translation
 *     3      yaw, radians about +Y
 *     4..6   scale (radius, height, radius)
 *     7      unused
 *     8..10  colour, 0..1
 *     11     unused
 *
 * This is the engine's answer to `HexField` in the labs: collect prisms, then
 * hand the whole array to the GPU in one call.
 */

import { rgbFromHex, type Rgb } from '@hexdelve/shared';

export const HEX_INSTANCE_FLOATS = 12;
export const HEX_INSTANCE_BYTES = HEX_INSTANCE_FLOATS * 4;

export type ColorInput = number | Rgb;

function toRgb(color: ColorInput): Rgb {
	return typeof color === 'number' ? rgbFromHex(color) : color;
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

	/** A prism centred on (x, y, z). */
	push(
		x: number,
		y: number,
		z: number,
		radius: number,
		height: number,
		color: ColorInput,
		yaw = 0,
	): this {
		this.reserve(this.length + 1);
		const at = this.length * HEX_INSTANCE_FLOATS;
		const rgb = toRgb(color);
		const b = this.buffer;
		b[at + 0] = x;
		b[at + 1] = y;
		b[at + 2] = z;
		b[at + 3] = yaw;
		b[at + 4] = radius;
		b[at + 5] = height;
		b[at + 6] = radius;
		b[at + 7] = 0;
		b[at + 8] = rgb.r;
		b[at + 9] = rgb.g;
		b[at + 10] = rgb.b;
		b[at + 11] = 0;
		this.length++;
		return this;
	}

	/** A prism standing on `baseY` rather than centred on it — the common case. */
	pushUpright(
		x: number,
		baseY: number,
		z: number,
		radius: number,
		height: number,
		color: ColorInput,
		yaw = 0,
	): this {
		return this.push(x, baseY + height / 2, z, radius, height, color, yaw);
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
