/*
 * What a particle effect IS, as against what a running one is doing.
 *
 * An effect is the authored side and nothing else: how many particles, thrown
 * how fast in what direction, living how long, and what their size, colour and
 * turn do across that life. It holds no positions and no clock, so one effect
 * drives every fire in a level the way one mesh draws every wanderer.
 *
 * ## Mean and variance, everywhere
 *
 * Every number a particle is born with is a `Range`: a mean, and how far
 * either side of it a particle may land. That pairing is the whole of what
 * makes a system read as an organic thing rather than a machine — a stream of
 * particles agreeing exactly on their speed is a stream that looks extruded.
 * `variance: 0` is the machine, and is what a field carries when it wants to
 * be exact.
 *
 * ## Life is normalised
 *
 * Size, colour and alpha are curves over `u`, a particle's age divided by its
 * own life. So a particle that happened to be born with a long life fades over
 * that longer span rather than fading on somebody else's schedule, and an
 * author sets the shape of the fade once instead of once per lifetime.
 *
 * ## What a particle is drawn as
 *
 * A hex prism, like everything else this project draws. The size curve is its
 * circumradius and `aspect` is its height as a fraction of that, so a smoke
 * puff is a squat disc at 0.7 and a spark is a splinter at 4. There is no
 * billboard here and no texture: the particle is the same primitive the
 * terrain and the characters are made of, and it lands in the same instance
 * buffer.
 */

import { rgbFromHex, type Rgb } from '@hexdelve/shared';

import type { Vec3 } from '../assets/document.js';

/** A number drawn per particle: the middle of it, and the spread either side. */
export interface Range {
	readonly mean: number;
	/** Added as `variance * r`, where r is uniform in -1..1. Zero is exact. */
	readonly variance: number;
}

/** One stop of a curve: how far through a life, and the value there. */
export interface Stop {
	/** 0 at birth, 1 at death. */
	readonly at: number;
	readonly value: number;
}

/** The same, for a colour. */
export interface ColorStop {
	readonly at: number;
	readonly color: Rgb;
}

/** Where in the emitter a particle is born. */
export type EmitShapeKind = 'point' | 'sphere' | 'shell' | 'disc' | 'box';

/**
 * The volume particles appear in, in the emitter's own space.
 *
 * `point` is the origin, `sphere` is anywhere inside one, `shell` is its
 * surface, `disc` is a flat circle in XZ, and `box` is a rectangular volume.
 * Reeves describes the same five in the 1983 paper, and they are the five
 * because each one gives a silhouette the others cannot: a shell reads as a
 * blast front, a disc as a fire on the ground, a box as a fog bank.
 */
export interface EmitShape {
	readonly kind: EmitShapeKind;
	/** Metres. Read by `sphere`, `shell` and `disc`. */
	readonly radius: number;
	/** Metres, the full extent on each axis. Read by `box`. */
	readonly size: Vec3;
	/**
	 * How much of the launch direction comes from where the particle was born.
	 *
	 * 0 throws every particle along the cone below, whatever corner of the
	 * shape it appeared in; 1 throws it straight out from the emitter's origin,
	 * which is what makes a shell expand as a front rather than drift as one.
	 * Meaningless on a `point`, whose particles are all born on the origin and
	 * have no outward to speak of.
	 */
	readonly outward: number;
}

/** How many particles arrive, and where from. */
export interface EmitSpec {
	/** Particles a second, while the emitter is running. */
	readonly rate: Range;
	/** Particles the moment it starts, and again on each loop. */
	readonly burst: Range;
	readonly shape: EmitShape;
}

/**
 * What a particle is born with.
 *
 * `pitch` and `yaw` are the two angles the 1998 Game Developer article uses,
 * and they are enough because a particle is a point being thrown: pitch is the
 * inclination, pi/2 being straight up, and yaw turns that about +Y. A `yaw`
 * variance of pi is every direction round the compass, which is what a burst
 * wants; a small one is a jet.
 */
export interface ParticleSpec {
	/** Seconds. */
	readonly life: Range;
	/** Metres a second along the launch direction. */
	readonly speed: Range;
	/** Radians of inclination. pi/2 is straight up, 0 is level, -pi/2 is down. */
	readonly pitch: Range;
	/** Radians about +Y. */
	readonly yaw: Range;
}

/** What happens to a particle after it is thrown. */
export interface MotionSpec {
	/**
	 * A constant acceleration, metres a second squared.
	 *
	 * Named for the common use and not limited to it — wind is a constant
	 * acceleration too, and a wind and a gravity would add to one vector, so
	 * there is one vector. Smoke rises on a positive Y here.
	 */
	readonly gravity: Vec3;
	/** The fraction of its speed a particle sheds each second. 0 coasts. */
	readonly drag: number;
	/**
	 * Whether particles are left behind or carried.
	 *
	 * `world` fixes a particle where it was born, so an emitter moving through
	 * the world draws a trail. `local` keeps every particle in the emitter's
	 * space, so the whole plume turns and travels with whatever carries it.
	 */
	readonly space: 'world' | 'local';
}

/** A curve over life, plus the spread between one particle and the next. */
export interface SizeSpec {
	/** Circumradius in metres, over normalised life. */
	readonly curve: readonly Stop[];
	/** Scales the whole curve per particle, as `1 + variance * r`. */
	readonly variance: number;
	/** Height as a fraction of the radius. 1 is as tall as it is wide. */
	readonly aspect: number;
}

export interface ColorSpec {
	readonly curve: readonly ColorStop[];
	/** Lightness spread per particle, the same shift on all three channels. */
	readonly variance: number;
}

export interface AlphaSpec {
	readonly curve: readonly Stop[];
	/** Scales the whole curve per particle, as `1 + variance * r`. */
	readonly variance: number;
}

/**
 * How a particle is turned, and how that turn changes.
 *
 * A hex prism has an orientation whether or not anybody chose one, so the
 * choice is here. Every particle gets a random roll about the axis at birth,
 * because six-sided prisms all agreeing on their facing read as a lattice.
 */
export interface SpinSpec {
	/** Radians a second. Negative turns the other way. */
	readonly rate: Range;
	/** What it turns about, in the emitter's space. */
	readonly axis: Vec3;
	/**
	 * Give each particle an axis and a birth rotation of its own.
	 *
	 * False keeps every prism upright about `axis`, which is what smoke and
	 * embers want. True tumbles them, which is what a fleck of something solid
	 * thrown off a blow does.
	 */
	readonly tumble: boolean;
}

/** One authored effect, whole. */
export interface ParticleEffect {
	readonly id: string;
	readonly name: string;
	/**
	 * The pool size, and so the hard ceiling on particles alive at once.
	 *
	 * A ceiling rather than a target: the arrays are allocated once and a
	 * request to emit past the end of them is dropped. That is what keeps the
	 * number of prisms in a frame from depending on how long the effect has
	 * been running or how the fight has been going.
	 */
	readonly capacity: number;
	/** Seconds the emitter runs for. Zero runs until something stops it. */
	readonly duration: number;
	/** Start again when the duration is up, re-issuing the burst. */
	readonly loop: boolean;
	/**
	 * Run it forward before its first frame, so it starts established.
	 *
	 * A chimney at three puffs a second over a three-second life is a bare
	 * chimney for the first second and a thin one for the next two, and a scene
	 * that has just been built shows exactly that. Prewarming steps the
	 * simulation through one full lifetime before anybody sees a frame, so the
	 * column is already there.
	 *
	 * Only for an effect that runs on: a one-shot prewarmed is a one-shot that
	 * has already finished, so this does nothing to one. See `ParticleSystem.play`.
	 */
	readonly prewarm: boolean;
	readonly emit: EmitSpec;
	readonly particle: ParticleSpec;
	readonly motion: MotionSpec;
	readonly size: SizeSpec;
	readonly color: ColorSpec;
	readonly alpha: AlphaSpec;
	readonly spin: SpinSpec;
	/** Draw at the authored colour rather than shading it — fire, sparks, spells. */
	readonly unlit: boolean;
}

/** A range that is exactly one number. */
export function exactly(mean: number): Range {
	return { mean, variance: 0 };
}

/**
 * An effect that draws a plain white puff.
 *
 * What a reader falls back to field by field, and what the bench starts a new
 * file from. It is a working effect rather than a set of zeroes on purpose:
 * an author who sets one field should see the change, not a blank viewport.
 */
export function defaultEffect(id = 'effect'): ParticleEffect {
	return {
		id,
		name: id,
		capacity: 128,
		duration: 0,
		loop: true,
		prewarm: false,
		emit: {
			rate: { mean: 20, variance: 0 },
			burst: exactly(0),
			shape: { kind: 'point', radius: 0.1, size: [0.5, 0.5, 0.5], outward: 0 },
		},
		particle: {
			life: { mean: 1, variance: 0.2 },
			speed: { mean: 1, variance: 0.3 },
			pitch: { mean: Math.PI / 2, variance: 0.3 },
			yaw: { mean: 0, variance: Math.PI },
		},
		motion: { gravity: [0, 0, 0], drag: 0, space: 'world' },
		size: { curve: [{ at: 0, value: 0.08 }], variance: 0.2, aspect: 1 },
		color: { curve: [{ at: 0, color: rgbFromHex(0xffffff) }], variance: 0.05 },
		alpha: { curve: [{ at: 0, value: 1 }, { at: 1, value: 0 }], variance: 0 },
		spin: { rate: { mean: 0, variance: 1 }, axis: [0, 1, 0], tumble: false },
		unlit: false,
	};
}

/**
 * Read a curve at `u`, between the two stops that surround it.
 *
 * A curve with one stop is that value everywhere, which is how a size that
 * does not change is written — one stop rather than two that agree. Before the
 * first stop and after the last, the curve holds; it does not extrapolate,
 * because a size extrapolated past the end of a life goes negative and a
 * negative prism is inside out.
 */
export function sampleCurve(curve: readonly Stop[], u: number): number {
	const count = curve.length;
	if (count === 0) return 0;
	const first = curve[0]!;
	if (count === 1 || u <= first.at) return first.value;

	for (let i = 1; i < count; i++) {
		const stop = curve[i]!;
		if (u > stop.at) continue;
		const previous = curve[i - 1]!;
		const span = stop.at - previous.at;
		if (span <= 0) return stop.value;
		const t = (u - previous.at) / span;
		return previous.value + (stop.value - previous.value) * t;
	}
	return curve[count - 1]!.value;
}

/**
 * The same, for a colour, written into `out`.
 *
 * Into a caller's object rather than returning a new one: this runs once per
 * live particle per frame, and a fresh `{ r, g, b }` per particle is an
 * allocation per particle.
 */
export function sampleGradient(curve: readonly ColorStop[], u: number, out: Rgb): Rgb {
	const count = curve.length;
	if (count === 0) {
		out.r = 1;
		out.g = 1;
		out.b = 1;
		return out;
	}

	const first = curve[0]!;
	if (count === 1 || u <= first.at) {
		out.r = first.color.r;
		out.g = first.color.g;
		out.b = first.color.b;
		return out;
	}

	for (let i = 1; i < count; i++) {
		const stop = curve[i]!;
		if (u > stop.at) continue;
		const previous = curve[i - 1]!;
		const span = stop.at - previous.at;
		const t = span <= 0 ? 1 : (u - previous.at) / span;
		out.r = previous.color.r + (stop.color.r - previous.color.r) * t;
		out.g = previous.color.g + (stop.color.g - previous.color.g) * t;
		out.b = previous.color.b + (stop.color.b - previous.color.b) * t;
		return out;
	}

	const last = curve[count - 1]!.color;
	out.r = last.r;
	out.g = last.g;
	out.b = last.b;
	return out;
}
