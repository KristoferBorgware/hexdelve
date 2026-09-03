/*
 * Value noise, ported from chamfer's `generation/noise`.
 *
 * This is deliberately a port rather than a fresh implementation. The point of
 * the cave stack next door is to answer "does the algorithm chamfer carves its
 * planet with make a dungeon worth walking through?", and that question is only
 * answered if the field really is the same field: the same hash, the same
 * quintic fade, the same octave order, the same normalising division. A noise
 * function that merely looks similar would make the comparison meaningless.
 *
 * What is NOT ported is chamfer's `NoiseCorners` memo and the early exit in
 * `caveDensity`. Both exist because that world reads the field once per block
 * down a column a thousand blocks deep; a hex level reads it once per tile over
 * a few hundred tiles, and the whole generation is under a millisecond without
 * them. Carrying the cache here would be carrying the shape of a problem this
 * code does not have.
 */

/** `2^32`, the divisor that turns a `uint32` into a fraction of one. */
const U32 = 4294967296;

/**
 * Three integer coordinates and a seed, mixed into a value in `[0, 1)`.
 *
 * Every step is `uint32`: a wrapping multiply, an xor, a logical shift. There
 * are no signed intermediates and no product runs past `2^53`, so this is the
 * same number in any language that has `Math.imul` — which is what lets a level
 * be reproduced from its seed rather than shipped as data.
 */
export function hash3(x: number, y: number, z: number, seed: number): number {
	let h =
		(Math.imul(x | 0, 374761393) +
			Math.imul(y | 0, 668265263) +
			Math.imul(z | 0, 1274126177) +
			Math.imul(seed | 0, 1013904223)) >>>
		0;
	h = (h ^ (h >>> 13)) >>> 0;
	h = Math.imul(h, 1274126177) >>> 0;
	h = (h ^ (h >>> 16)) >>> 0;
	return h / U32;
}

/**
 * The quintic interpolation curve, `6t^5 - 15t^4 + 10t^3`.
 *
 * Zero in the first and second derivative at both ends of `[0, 1]`, so there is
 * no crease where one lattice cell meets the next. The cheaper smoothstep is
 * flat in the first derivative only, and on a tile grid that shows up as
 * corridors preferring to turn on lattice lines.
 */
export function fade(t: number): number {
	return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Trilinear value noise at a point in space, in `[-1, 1]`.
 *
 * The eight corners of the lattice cell containing the point are hashed, and
 * the point's position within the cell is faded before it is used to weight
 * them. Fading the weight rather than the value is what makes the result smooth
 * across a cell boundary instead of merely continuous.
 */
export function valueNoise3(px: number, py: number, pz: number, seed: number): number {
	const xi = Math.floor(px);
	const yi = Math.floor(py);
	const zi = Math.floor(pz);
	const u = fade(px - xi);
	const v = fade(py - yi);
	const w = fade(pz - zi);

	const nu = 1 - u;
	const nv = 1 - v;
	const nw = 1 - w;

	// The eight products written out in the order chamfer sums them, so the
	// floating-point result is the same bits rather than the same value in
	// exact arithmetic.
	let s = nu * nv * nw * hash3(xi, yi, zi, seed);
	s += u * nv * nw * hash3(xi + 1, yi, zi, seed);
	s += nu * v * nw * hash3(xi, yi + 1, zi, seed);
	s += u * v * nw * hash3(xi + 1, yi + 1, zi, seed);
	s += nu * nv * w * hash3(xi, yi, zi + 1, seed);
	s += u * nv * w * hash3(xi + 1, yi, zi + 1, seed);
	s += nu * v * w * hash3(xi, yi + 1, zi + 1, seed);
	s += u * v * w * hash3(xi + 1, yi + 1, zi + 1, seed);
	return s * 2 - 1;
}

/**
 * Fractional Brownian motion: octaves of {@link valueNoise3} at lacunarity 2
 * and gain 0.5, in `[-1, 1]`.
 *
 * Octaves accumulate low frequency first, because floating-point addition is
 * not associative and summing them the other way round moves the result at some
 * octave counts and not others — the kind of error testing never finds.
 *
 * The sum is divided by the total amplitude, which makes the octave count a
 * control over shape rather than over gain: adding an octave adds detail
 * without widening every passage in the level.
 */
export function fbm(
	x: number,
	y: number,
	z: number,
	frequency: number,
	octaves: number,
	seed: number,
): number {
	let sum = 0;
	let amplitude = 1;
	let total = 0;
	let f = frequency;
	for (let o = 0; o < octaves; o++) {
		sum += amplitude * valueNoise3(x * f, y * f, z * f, seed);
		total += amplitude;
		amplitude *= 0.5;
		f *= 2;
	}
	return sum / total;
}
