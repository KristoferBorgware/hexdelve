/*
 * Making a blend parameter mean something.
 *
 * Put a walk at 1.56 m/s and a run at 2.94 on a Blend1D and the two ends are
 * honest: ask for either and you get exactly it. Everything in between is not,
 * and the reason is worth stating, because it looks like it ought to be.
 *
 * Halfway between the two, the tree blends the STRIDE and the CYCLE LENGTH
 * separately — the legs land somewhere between the two shapes, and the cadence
 * lands between the two periods. Speed is one divided by the other, and the
 * quotient of two averages is not the average of the quotients. So a slider
 * that says 2.25 delivers something else, and the difference comes out of the
 * one place it can: the feet, sliding.
 *
 * There is no formula for the error, because it depends on what the poses do.
 * So measure it. Sweep the axis once, ask `measureGroundSpeed` what each value
 * really produces, and keep the curve; asking it for a speed then gives the
 * parameter that actually produces that speed. The sweep is done once at
 * startup — it costs a few dozen tree evaluations — and after it the slider is
 * in true metres per second all the way across.
 *
 * The curve is forced non-decreasing before it is inverted. A blend that dips
 * would otherwise have two parameter values for one speed, and no honest
 * answer to "which".
 */

import { type BlendTree, type Parameters } from './blendtree.js';
import { measureGroundSpeed, type GroundSpeedOptions } from './measure.js';
import type { Skeleton } from './skeleton.js';

export interface SpeedSample {
	/** The value the tree was given. */
	readonly value: number;
	/** What it actually carried the body at, metres per second. */
	readonly speed: number;
}

export interface SpeedCalibration {
	readonly samples: readonly SpeedSample[];
	/** The fastest this axis goes — the top of a slider in real units. */
	readonly maxSpeed: number;
	/** A speed in m/s, to the parameter value that produces it. */
	parameterFor(speed: number): number;
	/** And back, for a readout. */
	speedFor(value: number): number;
}

export interface CalibrateSpeedOptions extends GroundSpeedOptions {
	/** Samples across the range. More is a smoother inverse and a slower start. */
	steps?: number;
	/** The other parameters, held fixed for the sweep. */
	params?: Parameters;
}

/**
 * Sweep one axis of a tree and record what it really delivers.
 *
 * The tree's playhead is put back where it was found, so this can be run on a
 * tree that is already being drawn without the picture flinching.
 */
export function calibrateSpeed(
	tree: BlendTree,
	skeleton: Skeleton,
	param: string,
	range: readonly [number, number],
	options: CalibrateSpeedOptions = {},
): SpeedCalibration {
	const steps = Math.max(1, options.steps ?? 32);
	const params: Record<string, number> = { ...(options.params ?? {}) };

	const phase = tree.phase;
	const elapsed = tree.elapsed;
	const sync = tree.sync;
	// Always calibrated synced, because that is what the game will run. The
	// unsynced curve is not a curve — it depends on the wall clock.
	tree.sync = true;

	const samples: SpeedSample[] = [];
	for (let i = 0; i <= steps; i++) {
		const value = range[0]! + ((range[1]! - range[0]!) * i) / steps;
		params[param] = value;
		tree.resolve(params);
		const cycle = tree.cycle;
		const velocity = measureGroundSpeed(
			skeleton,
			(p, out) => {
				tree.phase = p;
				tree.elapsed = p * cycle;
				tree.evaluate();
				return tree.toSparse(out);
			},
			cycle,
			options,
		);
		samples.push({ value, speed: Math.max(0, velocity.z) });
	}

	tree.phase = phase;
	tree.elapsed = elapsed;
	tree.sync = sync;

	for (let i = 1; i < samples.length; i++) {
		const previous = samples[i - 1]!;
		const current = samples[i]!;
		if (current.speed < previous.speed) samples[i] = { value: current.value, speed: previous.speed };
	}

	return {
		samples,
		maxSpeed: samples[samples.length - 1]!.speed,
		parameterFor: (speed) => invert(samples, speed),
		speedFor: (value) => forward(samples, value),
	};
}

/** Speed to parameter: the inverse of the measured curve, piecewise-linear. */
function invert(samples: readonly SpeedSample[], speed: number): number {
	const first = samples[0]!;
	const last = samples[samples.length - 1]!;
	if (speed <= first.speed) return first.value;
	if (speed >= last.speed) return last.value;
	for (let i = 0; i < samples.length - 1; i++) {
		const a = samples[i]!;
		const b = samples[i + 1]!;
		if (speed < a.speed || speed > b.speed) continue;
		const span = b.speed - a.speed;
		return span > 1e-9 ? a.value + ((b.value - a.value) * (speed - a.speed)) / span : a.value;
	}
	return last.value;
}

/** And parameter to speed, the direction the sweep measured. */
function forward(samples: readonly SpeedSample[], value: number): number {
	const first = samples[0]!;
	const last = samples[samples.length - 1]!;
	if (value <= first.value) return first.speed;
	if (value >= last.value) return last.speed;
	for (let i = 0; i < samples.length - 1; i++) {
		const a = samples[i]!;
		const b = samples[i + 1]!;
		if (value < a.value || value > b.value) continue;
		const span = b.value - a.value;
		return span > 1e-9 ? a.speed + ((b.speed - a.speed) * (value - a.value)) / span : a.speed;
	}
	return last.speed;
}
