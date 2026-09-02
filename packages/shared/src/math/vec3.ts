/*
 * Three-component vectors, stored as Float32Array so they can be handed to a
 * GPU buffer without a copy.
 *
 * Every function that produces a vector takes the destination first and
 * returns it, so a caller can work without allocating in a frame loop.
 */

export type Vec3 = Float32Array;

/** Anything three numbers can be read out of — a Vec3, a tuple, an array. */
export type Vec3Like = ArrayLike<number>;

export function vec3(x = 0, y = 0, z = 0): Vec3 {
	const out = new Float32Array(3);
	out[0] = x;
	out[1] = y;
	out[2] = z;
	return out;
}

export function set(out: Vec3, x: number, y: number, z: number): Vec3 {
	out[0] = x;
	out[1] = y;
	out[2] = z;
	return out;
}

export function copy(out: Vec3, a: Vec3Like): Vec3 {
	out[0] = a[0]!;
	out[1] = a[1]!;
	out[2] = a[2]!;
	return out;
}

export function add(out: Vec3, a: Vec3Like, b: Vec3Like): Vec3 {
	out[0] = a[0]! + b[0]!;
	out[1] = a[1]! + b[1]!;
	out[2] = a[2]! + b[2]!;
	return out;
}

export function subtract(out: Vec3, a: Vec3Like, b: Vec3Like): Vec3 {
	out[0] = a[0]! - b[0]!;
	out[1] = a[1]! - b[1]!;
	out[2] = a[2]! - b[2]!;
	return out;
}

export function scale(out: Vec3, a: Vec3Like, s: number): Vec3 {
	out[0] = a[0]! * s;
	out[1] = a[1]! * s;
	out[2] = a[2]! * s;
	return out;
}

/** `out = a + b * s`, the one fused operation worth having. */
export function scaleAndAdd(out: Vec3, a: Vec3Like, b: Vec3Like, s: number): Vec3 {
	out[0] = a[0]! + b[0]! * s;
	out[1] = a[1]! + b[1]! * s;
	out[2] = a[2]! + b[2]! * s;
	return out;
}

export function dot(a: Vec3Like, b: Vec3Like): number {
	return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
}

export function cross(out: Vec3, a: Vec3Like, b: Vec3Like): Vec3 {
	const ax = a[0]!;
	const ay = a[1]!;
	const az = a[2]!;
	const bx = b[0]!;
	const by = b[1]!;
	const bz = b[2]!;
	out[0] = ay * bz - az * by;
	out[1] = az * bx - ax * bz;
	out[2] = ax * by - ay * bx;
	return out;
}

export function length(a: Vec3Like): number {
	return Math.hypot(a[0]!, a[1]!, a[2]!);
}

export function squaredLength(a: Vec3Like): number {
	return a[0]! * a[0]! + a[1]! * a[1]! + a[2]! * a[2]!;
}

/** Normalises in place into `out`; a zero vector is left at zero. */
export function normalize(out: Vec3, a: Vec3Like): Vec3 {
	const len = length(a);
	if (len === 0) return set(out, 0, 0, 0);
	return scale(out, a, 1 / len);
}

export function lerp(out: Vec3, a: Vec3Like, b: Vec3Like, t: number): Vec3 {
	out[0] = a[0]! + (b[0]! - a[0]!) * t;
	out[1] = a[1]! + (b[1]! - a[1]!) * t;
	out[2] = a[2]! + (b[2]! - a[2]!) * t;
	return out;
}

export function distance(a: Vec3Like, b: Vec3Like): number {
	return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}
