/*
 * Legs solved in the plane of the body.
 *
 * A gait lives in one plane: every rotation that carries a leg through a
 * stride is about the body's x axis, so a leg is a chain of vectors in y and
 * z, and where its foot ends up is a triangle. This is the two-link solve the
 * engine's IK does in three dimensions, written for the one plane a gait
 * needs — a pose function stays a pure function of a phase, with no skeleton
 * to be handed and nothing to iterate.
 *
 * Every vector here is `[y, z]`, in metres, in the body's frame. A rotation
 * is about x, in radians, with the engine's own sign: rot.x > 0 pitches a
 * forward-pointing vector down, and swings a hanging one back.
 */

export type Planar = readonly [number, number];

/** `[y, z]` turned about x by `r`. */
export const turn = (v: Planar, r: number): Planar => {
	const c = Math.cos(r);
	const s = Math.sin(r);
	return [v[0] * c - v[1] * s, v[0] * s + v[1] * c];
};

export const plus = (a: Planar, b: Planar): Planar => [a[0] + b[0], a[1] + b[1]];

export const span = (v: Planar): number => Math.hypot(v[0], v[1]);

/** How far a vector points forward of straight down, in radians. */
export const bearing = (v: Planar): number => Math.atan2(v[1], -v[0]);

/** A vector of length `l` at that bearing. */
export const heading = (a: number, l: number): Planar => [-l * Math.cos(a), l * Math.sin(a)];

/**
 * Two links from `from` to `target`, solved for the rotation each bone needs.
 *
 * @param frame   the rotation of the frame the first link's offset is in —
 *                everything above the joint being solved, summed
 * @param first   the first link's rest offset (the second bone's offset)
 * @param second  the second link's rest offset, already folded at any joint
 *                below the one being solved
 * @param bend    +1 puts the middle joint BEHIND the line from `from` to
 *                `target` (an elbow), -1 ahead of it (a knee or a stifle)
 * @returns the rotations of the two bones, and the shortfall in metres when
 *          the target is out of reach and the leg is left straight
 */
export function twoLink(
	frame: number,
	from: Planar,
	first: Planar,
	second: Planar,
	target: Planar,
	bend: number,
): [number, number, number] {
	const l1 = span(first);
	const l2 = span(second);
	const line: Planar = [target[0] - from[0], target[1] - from[1]];
	const distance = span(line);
	const along = bearing(line);

	let a1: number;
	let a2: number;
	let short = 0;
	if (distance >= l1 + l2) {
		a1 = along;
		a2 = along;
		short = distance - (l1 + l2);
	} else {
		const cosine = (l1 * l1 + distance * distance - l2 * l2) / (2 * l1 * distance);
		const open = Math.acos(Math.max(-1, Math.min(1, cosine)));
		a1 = along - bend * open;
		const mid = plus(from, heading(a1, l1));
		a2 = bearing([target[0] - mid[0], target[1] - mid[1]]);
	}
	// A bone's bearing is its rest bearing less every rotation above it and
	// its own, so each rotation is what is left over.
	const r1 = bearing(first) - frame - a1;
	const r2 = bearing(second) - (frame + r1) - a2;
	return [r1, r2, short];
}

const PI = Math.PI;

/**
 * Where a foot is at a phase of its own cycle, in the body's frame.
 *
 * Planted from pi / 2 to 3 pi / 2, moving back along the ground in a straight
 * line at a constant rate — which is what keeps the measured ground speed
 * honest and the foot from skating — and in the air for the other half,
 * carried forward on an arc that peaks mid-swing.
 *
 * @param restZ       where the foot stands at rest, along the body
 * @param halfStride  half the ground covered in one stance, at amp 1
 * @param lift        how high the foot is carried at mid-swing, at amp 1
 * @param height      where the foot bone sits with the foot on the ground
 * @param amp         0 stands still, 1 is the full stride
 */
export function groundPath(
	phase: number,
	restZ: number,
	halfStride: number,
	lift: number,
	height: number,
	amp: number,
): Planar {
	const front = restZ + halfStride * amp;
	const back = restZ - halfStride * amp;
	let own = phase % (2 * PI);
	if (own < 0) own += 2 * PI;
	if (own >= PI / 2 && own <= 1.5 * PI) {
		const u = (own - PI / 2) / PI;
		return [height, front - (front - back) * u];
	}
	const u = ((own + PI / 2) % (2 * PI)) / PI;
	const eased = u * u * (3 - 2 * u);
	return [height + lift * amp * Math.sin(PI * u), back + (front - back) * eased];
}
