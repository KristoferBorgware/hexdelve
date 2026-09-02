/*
 * The one shape this project draws.
 *
 * A unit hexagonal prism: radius 1, height 1, centred on the origin, axis +Y,
 * with a vertex pointing along +Z. That last detail matters — it is what makes
 * the prism a pointy-top hex, which is the orientation `axialToWorld` lays the
 * grid out in. Everything in a Hexdelve scene is this shape under a different
 * translation, yaw and scale.
 *
 * Vertices are not shared between faces, so each face carries its own normal
 * and the prism shades flat. That is 36 vertices instead of 12, which is a
 * rounding error next to the instance count.
 */

export interface HexPrismGeometry {
	/** Interleaved position (3) + normal (3), 6 floats per vertex. */
	readonly vertices: Float32Array;
	readonly indices: Uint16Array;
	readonly vertexCount: number;
	readonly indexCount: number;
	/** Bytes between vertices — 24. */
	readonly stride: number;
}

export const HEX_VERTEX_STRIDE_FLOATS = 6;
export const HEX_VERTEX_STRIDE_BYTES = HEX_VERTEX_STRIDE_FLOATS * 4;

/** Corner `k` of a unit hex, anticlockwise from the vertex on +Z. */
export function hexCorner(k: number): { x: number; z: number } {
	const angle = (Math.PI / 3) * k;
	return { x: Math.sin(angle), z: Math.cos(angle) };
}

let cached: HexPrismGeometry | null = null;

/** The shared unit prism. Built once; the buffers are read-only in practice. */
export function hexPrismGeometry(): HexPrismGeometry {
	if (!cached) cached = buildHexPrism();
	return cached;
}

function buildHexPrism(): HexPrismGeometry {
	const corners = Array.from({ length: 6 }, (_, k) => hexCorner(k));

	const vertices: number[] = [];
	const indices: number[] = [];

	const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number): number => {
		const index = vertices.length / HEX_VERTEX_STRIDE_FLOATS;
		vertices.push(x, y, z, nx, ny, nz);
		return index;
	};

	// Top cap. Corner order is anticlockwise seen from +Y, so a fan from
	// corner 0 is already front-facing under counter-clockwise winding.
	const top = corners.map((c) => push(c.x, 0.5, c.z, 0, 1, 0));
	for (let k = 1; k < 5; k++) indices.push(top[0]!, top[k]!, top[k + 1]!);

	// Bottom cap, wound the other way so its front face points at -Y.
	const bottom = corners.map((c) => push(c.x, -0.5, c.z, 0, -1, 0));
	for (let k = 1; k < 5; k++) indices.push(bottom[0]!, bottom[k + 1]!, bottom[k]!);

	// Six side quads, each with its own outward normal.
	for (let k = 0; k < 6; k++) {
		const a = corners[k]!;
		const b = corners[(k + 1) % 6]!;
		const mx = (a.x + b.x) / 2;
		const mz = (a.z + b.z) / 2;
		const len = Math.hypot(mx, mz);
		const nx = mx / len;
		const nz = mz / len;

		const aBottom = push(a.x, -0.5, a.z, nx, 0, nz);
		const bBottom = push(b.x, -0.5, b.z, nx, 0, nz);
		const bTop = push(b.x, 0.5, b.z, nx, 0, nz);
		const aTop = push(a.x, 0.5, a.z, nx, 0, nz);

		indices.push(aBottom, bBottom, bTop);
		indices.push(aBottom, bTop, aTop);
	}

	return {
		vertices: new Float32Array(vertices),
		indices: new Uint16Array(indices),
		vertexCount: vertices.length / HEX_VERTEX_STRIDE_FLOATS,
		indexCount: indices.length,
		stride: HEX_VERTEX_STRIDE_BYTES,
	};
}
