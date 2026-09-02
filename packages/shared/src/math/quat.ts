/*
 * Quaternions, in the one convention this project uses everywhere.
 *
 * Poses are written as Euler XYZ triples because that is what a human can
 * author and read back — `armR: [0.25, 0, -0.42]` is a shoulder someone can
 * picture. Composing them down a bone chain in Euler space is not possible, so
 * every solve converts to quaternions, multiplies, and converts back at the
 * edges. That round trip is why both directions live here rather than in the
 * animation code.
 *
 * Storage is [x, y, z, w], matching WebGPU and WebGL vertex layouts, so a
 * quaternion can go straight into an instance buffer without being repacked.
 */

export type Quat = Float32Array & { length: 4 };
export type QuatLike = ArrayLike<number>;

export function quat(x = 0, y = 0, z = 0, w = 1): Quat {
	const out = new Float32Array(4) as Quat;
	out[0] = x;
	out[1] = y;
	out[2] = z;
	out[3] = w;
	return out;
}

export const IDENTITY: readonly number[] = [0, 0, 0, 1];

export function set(out: Quat, x: number, y: number, z: number, w: number): Quat {
	out[0] = x;
	out[1] = y;
	out[2] = z;
	out[3] = w;
	return out;
}

export function copy(out: Quat, a: QuatLike): Quat {
	out[0] = a[0]!;
	out[1] = a[1]!;
	out[2] = a[2]!;
	out[3] = a[3]!;
	return out;
}

export function identity(out: Quat): Quat {
	return set(out, 0, 0, 0, 1);
}

/** Euler XYZ (radians) to a quaternion. The order poses are authored in. */
export function fromEulerXYZ(out: Quat, x: number, y: number, z: number): Quat {
	const c1 = Math.cos(x / 2);
	const c2 = Math.cos(y / 2);
	const c3 = Math.cos(z / 2);
	const s1 = Math.sin(x / 2);
	const s2 = Math.sin(y / 2);
	const s3 = Math.sin(z / 2);
	return set(
		out,
		s1 * c2 * c3 + c1 * s2 * s3,
		c1 * s2 * c3 - s1 * c2 * s3,
		c1 * c2 * s3 + s1 * s2 * c3,
		c1 * c2 * c3 - s1 * s2 * s3,
	);
}

/**
 * And back again, in the same order.
 *
 * At the gimbal pole (|m13| ~ 1) the X and Z rotations describe the same
 * motion and cannot be told apart, so Z is pinned to zero and X takes all of
 * it. That is a real ambiguity in Euler angles rather than a shortcut: any
 * split of the total between the two axes reproduces the same orientation.
 */
export function toEulerXYZ(out: [number, number, number], q: QuatLike): [number, number, number] {
	const x = q[0]!;
	const y = q[1]!;
	const z = q[2]!;
	const w = q[3]!;

	const x2 = x + x;
	const y2 = y + y;
	const z2 = z + z;
	const xx = x * x2;
	const xy = x * y2;
	const xz = x * z2;
	const yy = y * y2;
	const yz = y * z2;
	const zz = z * z2;
	const wx = w * x2;
	const wy = w * y2;
	const wz = w * z2;

	const m11 = 1 - (yy + zz);
	const m12 = xy - wz;
	const m13 = xz + wy;
	const m22 = 1 - (xx + zz);
	const m23 = yz - wx;
	const m32 = yz + wx;
	const m33 = 1 - (xx + yy);

	out[1] = Math.asin(m13 < -1 ? -1 : m13 > 1 ? 1 : m13);
	if (Math.abs(m13) < 0.9999999) {
		out[0] = Math.atan2(-m23, m33);
		out[2] = Math.atan2(-m12, m11);
	} else {
		out[0] = Math.atan2(m32, m22);
		out[2] = 0;
	}
	return out;
}

/** `out = a * b` — b applied first, then a, as with matrices. */
export function multiply(out: Quat, a: QuatLike, b: QuatLike): Quat {
	const ax = a[0]!;
	const ay = a[1]!;
	const az = a[2]!;
	const aw = a[3]!;
	const bx = b[0]!;
	const by = b[1]!;
	const bz = b[2]!;
	const bw = b[3]!;
	return set(
		out,
		aw * bx + ax * bw + ay * bz - az * by,
		aw * by - ax * bz + ay * bw + az * bx,
		aw * bz + ax * by - ay * bx + az * bw,
		aw * bw - ax * bx - ay * by - az * bz,
	);
}

export function conjugate(out: Quat, a: QuatLike): Quat {
	return set(out, -a[0]!, -a[1]!, -a[2]!, a[3]!);
}

/** Rotates a vector. `out` may alias neither `q` nor `v`. */
export function rotateVec3(
	out: [number, number, number] | Float32Array,
	q: QuatLike,
	v: ArrayLike<number>,
): typeof out {
	const x = q[0]!;
	const y = q[1]!;
	const z = q[2]!;
	const w = q[3]!;
	const vx = v[0]!;
	const vy = v[1]!;
	const vz = v[2]!;

	// t = 2 * (q.xyz x v), out = v + w * t + q.xyz x t
	const tx = 2 * (y * vz - z * vy);
	const ty = 2 * (z * vx - x * vz);
	const tz = 2 * (x * vy - y * vx);

	out[0] = vx + w * tx + y * tz - z * ty;
	out[1] = vy + w * ty + z * tx - x * tz;
	out[2] = vz + w * tz + x * ty - y * tx;
	return out;
}

/**
 * The shortest arc taking unit vector `from` onto unit vector `to`.
 *
 * Directly opposed vectors have no shortest arc — every half turn about a
 * perpendicular axis works — so one is picked, choosing the axis the input is
 * least aligned with so the cross product stays well conditioned.
 */
export function fromUnitVectors(out: Quat, from: ArrayLike<number>, to: ArrayLike<number>): Quat {
	const fx = from[0]!;
	const fy = from[1]!;
	const fz = from[2]!;
	const tx = to[0]!;
	const ty = to[1]!;
	const tz = to[2]!;

	let r = fx * tx + fy * ty + fz * tz + 1;
	let x: number;
	let y: number;
	let z: number;

	if (r < 1e-6) {
		r = 0;
		if (Math.abs(fx) > Math.abs(fz)) {
			x = -fy;
			y = fx;
			z = 0;
		} else {
			x = 0;
			y = -fz;
			z = fy;
		}
	} else {
		x = fy * tz - fz * ty;
		y = fz * tx - fx * tz;
		z = fx * ty - fy * tx;
	}

	const len = Math.sqrt(x * x + y * y + z * z + r * r) || 1;
	return set(out, x / len, y / len, z / len, r / len);
}

/** Spherical interpolation, taking the short way round. */
export function slerp(out: Quat, a: QuatLike, b: QuatLike, t: number): Quat {
	let cos = a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!;

	let bx = b[0]!;
	let by = b[1]!;
	let bz = b[2]!;
	let bw = b[3]!;
	if (cos < 0) {
		bx = -bx;
		by = -by;
		bz = -bz;
		bw = -bw;
		cos = -cos;
	}

	// Nearly parallel: the arc is short enough that a straight line across it
	// is indistinguishable, and sin(theta) is about to divide by nothing.
	if (cos > 0.9995) {
		const x = a[0]! + (bx - a[0]!) * t;
		const y = a[1]! + (by - a[1]!) * t;
		const z = a[2]! + (bz - a[2]!) * t;
		const w = a[3]! + (bw - a[3]!) * t;
		const len = Math.hypot(x, y, z, w) || 1;
		return set(out, x / len, y / len, z / len, w / len);
	}

	const theta = Math.acos(cos);
	const sin = Math.sin(theta);
	const wa = Math.sin((1 - t) * theta) / sin;
	const wb = Math.sin(t * theta) / sin;
	return set(out, a[0]! * wa + bx * wb, a[1]! * wa + by * wb, a[2]! * wa + bz * wb, a[3]! * wa + bw * wb);
}

/** A rotation of `angle` about +Y — the common case for a prism's yaw. */
export function fromYaw(out: Quat, angle: number): Quat {
	return set(out, 0, Math.sin(angle / 2), 0, Math.cos(angle / 2));
}
