/*
 * Poses, in the two shapes the rest of the animation code needs them in.
 *
 * Every value is a DELTA from the skeleton's rest transform, which is what
 * makes the rest pose the empty object and makes fading a clip out relax back
 * to rest rather than collapse to the origin.
 *
 *   sparse   { bone: { rot: [x,y,z], pos: [x,y,z] } }
 *            What a pose *function* produces and what the solvers read. Only
 *            mentions the bones that are doing something.
 *
 *   dense    flat Float32Arrays, three floats a bone, indexed by bone order.
 *            What blending works in, because a mask is one multiply per bone
 *            and a per-bone object lookup is not.
 *
 * Both exist because both are the right answer somewhere: the stride is a
 * function of an angle and writes sparse, the guard is a clip sampled into
 * dense, and layering one over the other means pouring the first into the
 * second's shape.
 */

export interface SparseBone {
	rot?: number[];
	pos?: number[];
}

export type SparsePose = Record<string, SparseBone>;

export interface DensePose {
	readonly rot: Float32Array;
	readonly pos: Float32Array;
}

export function createPose(boneCount: number): DensePose {
	return { rot: new Float32Array(boneCount * 3), pos: new Float32Array(boneCount * 3) };
}

export function copyPose(dst: DensePose, src: DensePose): void {
	dst.rot.set(src.rot);
	dst.pos.set(src.pos);
}

export function clearPose(pose: DensePose): void {
	pose.rot.fill(0);
	pose.pos.fill(0);
}

export function lerpPose(dst: DensePose, a: DensePose, b: DensePose, w: number): void {
	for (let i = 0; i < dst.rot.length; i++) {
		dst.rot[i] = a.rot[i]! + (b.rot[i]! - a.rot[i]!) * w;
		dst.pos[i] = a.pos[i]! + (b.pos[i]! - a.pos[i]!) * w;
	}
}

/**
 * Add one pose onto another, scaled.
 *
 * This is the whole of additive blending here, and it needs no reference pose
 * to subtract because every value in this system is ALREADY a delta from rest.
 * A lean is a lean whatever the legs are doing, so laying one over a stride is
 * a sum — where blending it in would have to take something away from the
 * stride to make room, and a character cannot bank by walking less.
 */
export function addPose(dst: DensePose, src: DensePose, weight = 1): void {
	for (let i = 0; i < dst.rot.length; i++) {
		dst.rot[i]! += src.rot[i]! * weight;
		dst.pos[i]! += src.pos[i]! * weight;
	}
}

/**
 * The same, but each bone's weight is scaled by a mask.
 *
 * This is what lets the guard hold a shield up through the arms while the legs
 * go on walking, and what lets the cut give the legs back once he is moving.
 */
export function lerpPoseMasked(
	dst: DensePose,
	a: DensePose,
	b: DensePose,
	w: number,
	mask: Float32Array,
): void {
	for (let bone = 0; bone < mask.length; bone++) {
		const bw = w * mask[bone]!;
		const o = bone * 3;
		for (let c = 0; c < 3; c++) {
			dst.rot[o + c] = a.rot[o + c]! + (b.rot[o + c]! - a.rot[o + c]!) * bw;
			dst.pos[o + c] = a.pos[o + c]! + (b.pos[o + c]! - a.pos[o + c]!) * bw;
		}
	}
}

/** Dense to sparse. Reuse `out` to keep the per-frame path allocation-free. */
export function denseToSparse(
	boneNames: readonly string[],
	dense: DensePose,
	out: SparsePose = {},
): SparsePose {
	for (let i = 0; i < boneNames.length; i++) {
		const name = boneNames[i]!;
		let entry = out[name];
		if (!entry) {
			entry = { rot: [0, 0, 0], pos: [0, 0, 0] };
			out[name] = entry;
		}
		if (!entry.rot) entry.rot = [0, 0, 0];
		if (!entry.pos) entry.pos = [0, 0, 0];
		const o = i * 3;
		entry.rot[0] = dense.rot[o]!;
		entry.rot[1] = dense.rot[o + 1]!;
		entry.rot[2] = dense.rot[o + 2]!;
		entry.pos[0] = dense.pos[o]!;
		entry.pos[1] = dense.pos[o + 1]!;
		entry.pos[2] = dense.pos[o + 2]!;
	}
	return out;
}

/**
 * And back, for a pose produced as a function rather than sampled from a clip.
 *
 * Bones the function did not touch are left at rest, which is the whole point
 * of the fill: the stride writes legs, hips and arms and says nothing about
 * the jaw, and a stale value there would be a jaw stuck wherever it last was.
 */
export function sparseToDense(
	boneNames: readonly string[],
	sparse: SparsePose,
	out: DensePose,
): DensePose {
	out.rot.fill(0);
	out.pos.fill(0);
	for (let i = 0; i < boneNames.length; i++) {
		const entry = sparse[boneNames[i]!];
		if (!entry) continue;
		const o = i * 3;
		if (entry.rot) {
			out.rot[o] = entry.rot[0]!;
			out.rot[o + 1] = entry.rot[1]!;
			out.rot[o + 2] = entry.rot[2]!;
		}
		if (entry.pos) {
			out.pos[o] = entry.pos[0]!;
			out.pos[o + 1] = entry.pos[1]!;
			out.pos[o + 2] = entry.pos[2]!;
		}
	}
	return out;
}

/** A per-bone blend weight array, from a sparse table of named weights. */
export function makeMask(
	boneNames: readonly string[],
	weights: Record<string, number>,
	fallback = 0,
): Float32Array {
	const mask = new Float32Array(boneNames.length);
	for (let i = 0; i < boneNames.length; i++) {
		const w = weights[boneNames[i]!];
		mask[i] = w === undefined ? fallback : w;
	}
	return mask;
}

/** Writes one bone of a sparse pose, reusing the arrays already there. */
export function setSparse(
	out: SparsePose,
	bone: string,
	rot: readonly number[],
	pos?: readonly number[],
): SparseBone {
	let entry = out[bone];
	if (!entry) {
		entry = { rot: [0, 0, 0], pos: [0, 0, 0] };
		out[bone] = entry;
	}
	if (!entry.rot) entry.rot = [0, 0, 0];
	entry.rot[0] = rot[0]!;
	entry.rot[1] = rot[1]!;
	entry.rot[2] = rot[2]!;
	if (pos) {
		if (!entry.pos) entry.pos = [0, 0, 0];
		entry.pos[0] = pos[0]!;
		entry.pos[1] = pos[1]!;
		entry.pos[2] = pos[2]!;
	}
	return entry;
}

const ZERO: Required<SparseBone> = { rot: [0, 0, 0], pos: [0, 0, 0] };

/**
 * Blend two sparse poses.
 *
 * A bone missing from either side is at rest there, not absent, so a pose only
 * has to mention what it actually holds — which is what lets the bat's three
 * poses each write a different subset and still mix cleanly.
 */
export function mixSparse(out: SparsePose, a: SparsePose, b: SparsePose, t: number): SparsePose {
	const u = t < 0 ? 0 : t > 1 ? 1 : t;
	for (const bone in a) if (!(bone in b)) blendBone(out, bone, a[bone]!, null, u);
	for (const bone in b) blendBone(out, bone, a[bone] ?? null, b[bone]!, u);
	return out;
}

function blendBone(
	out: SparsePose,
	bone: string,
	a: SparseBone | null,
	b: SparseBone | null,
	u: number,
): void {
	const ar = a?.rot ?? ZERO.rot;
	const ap = a?.pos ?? ZERO.pos;
	const br = b?.rot ?? ZERO.rot;
	const bp = b?.pos ?? ZERO.pos;
	setSparse(
		out,
		bone,
		[
			ar[0]! + (br[0]! - ar[0]!) * u,
			ar[1]! + (br[1]! - ar[1]!) * u,
			ar[2]! + (br[2]! - ar[2]!) * u,
		],
		[
			ap[0]! + (bp[0]! - ap[0]!) * u,
			ap[1]! + (bp[1]! - ap[1]!) * u,
			ap[2]! + (bp[2]! - ap[2]!) * u,
		],
	);
}
