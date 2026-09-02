/*
 * 4x4 matrices, column-major in a Float32Array of 16 — the layout both WebGL
 * and WGSL expect, so a matrix can go straight into a uniform buffer.
 *
 * The one thing worth knowing here is `DepthRange`. WebGL clips to z in
 * [-1, 1] and WebGPU clips to z in [0, 1], so a projection built for one is
 * wrong for the other: the near half of the scene vanishes. Rather than
 * guessing, every projection takes the range explicitly, and a renderer
 * publishes the range it needs (`Renderer.depthRange`).
 */

export type Mat4 = Float32Array;

export type Mat4Like = ArrayLike<number>;

/** Which clip-space depth convention a projection matrix should target. */
export type DepthRange = 'zero-to-one' | 'negative-one-to-one';

export function mat4(): Mat4 {
	return identity(new Float32Array(16));
}

export function identity(out: Mat4): Mat4 {
	out.fill(0);
	out[0] = 1;
	out[5] = 1;
	out[10] = 1;
	out[15] = 1;
	return out;
}

export function copy(out: Mat4, a: Mat4Like): Mat4 {
	for (let i = 0; i < 16; i++) out[i] = a[i]!;
	return out;
}

/** `out = a * b`, applied to a column vector as `a * (b * v)`. */
export function multiply(out: Mat4, a: Mat4Like, b: Mat4Like): Mat4 {
	for (let col = 0; col < 4; col++) {
		const b0 = b[col * 4 + 0]!;
		const b1 = b[col * 4 + 1]!;
		const b2 = b[col * 4 + 2]!;
		const b3 = b[col * 4 + 3]!;
		for (let row = 0; row < 4; row++) {
			out[col * 4 + row] =
				a[row]! * b0 + a[4 + row]! * b1 + a[8 + row]! * b2 + a[12 + row]! * b3;
		}
	}
	return out;
}

/**
 * Right-handed perspective projection looking down -Z.
 *
 * `fovY` is the vertical field of view in radians.
 */
export function perspective(
	out: Mat4,
	fovY: number,
	aspect: number,
	near: number,
	far: number,
	depthRange: DepthRange,
): Mat4 {
	const f = 1 / Math.tan(fovY / 2);
	out.fill(0);
	out[0] = f / aspect;
	out[5] = f;
	out[11] = -1;
	if (depthRange === 'zero-to-one') {
		out[10] = far / (near - far);
		out[14] = (far * near) / (near - far);
	} else {
		out[10] = (far + near) / (near - far);
		out[14] = (2 * far * near) / (near - far);
	}
	return out;
}

/** Right-handed orthographic projection — the isometric camera's other mode. */
export function ortho(
	out: Mat4,
	left: number,
	right: number,
	bottom: number,
	top: number,
	near: number,
	far: number,
	depthRange: DepthRange,
): Mat4 {
	out.fill(0);
	out[0] = 2 / (right - left);
	out[5] = 2 / (top - bottom);
	out[12] = (right + left) / (left - right);
	out[13] = (top + bottom) / (bottom - top);
	out[15] = 1;
	if (depthRange === 'zero-to-one') {
		out[10] = 1 / (near - far);
		out[14] = near / (near - far);
	} else {
		out[10] = 2 / (near - far);
		out[14] = (far + near) / (near - far);
	}
	return out;
}

/** A view matrix placing the eye at `eye`, looking at `center`. */
export function lookAt(
	out: Mat4,
	eye: ArrayLike<number>,
	center: ArrayLike<number>,
	up: ArrayLike<number>,
): Mat4 {
	const ex = eye[0]!;
	const ey = eye[1]!;
	const ez = eye[2]!;

	// Backwards along the view direction, so the basis stays right-handed.
	let zx = ex - center[0]!;
	let zy = ey - center[1]!;
	let zz = ez - center[2]!;
	const zLen = Math.hypot(zx, zy, zz);
	if (zLen === 0) return identity(out);
	zx /= zLen;
	zy /= zLen;
	zz /= zLen;

	let xx = up[1]! * zz - up[2]! * zy;
	let xy = up[2]! * zx - up[0]! * zz;
	let xz = up[0]! * zy - up[1]! * zx;
	const xLen = Math.hypot(xx, xy, xz);
	if (xLen === 0) {
		// Looking straight along `up`: any perpendicular will do.
		xx = 1;
		xy = 0;
		xz = 0;
	} else {
		xx /= xLen;
		xy /= xLen;
		xz /= xLen;
	}

	const yx = zy * xz - zz * xy;
	const yy = zz * xx - zx * xz;
	const yz = zx * xy - zy * xx;

	out[0] = xx;
	out[1] = yx;
	out[2] = zx;
	out[3] = 0;
	out[4] = xy;
	out[5] = yy;
	out[6] = zy;
	out[7] = 0;
	out[8] = xz;
	out[9] = yz;
	out[10] = zz;
	out[11] = 0;
	out[12] = -(xx * ex + xy * ey + xz * ez);
	out[13] = -(yx * ex + yy * ey + yz * ez);
	out[14] = -(zx * ex + zy * ey + zz * ez);
	out[15] = 1;
	return out;
}
