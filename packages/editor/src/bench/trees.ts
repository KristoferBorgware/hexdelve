/*
 * The one thing a blend tree file cannot hold: the calibration.
 *
 * This file used to build both trees by hand — the leaves, the blend1d over
 * them, the additive lean, the layered guard, and the thresholds measured off
 * the stride. All of that is now `public/assets/trees/*.tree.yaml`, which is
 * where an arrangement belongs, and the tree the bench drives is the one the
 * game drives.
 *
 * What is left is the part that is not an arrangement.
 *
 * A blend halfway between a walk and a run does not travel at the average of
 * their speeds. The stride and the cadence blend separately and speed is one
 * divided by the other, so the tree delivers about five per cent less than a
 * slider in metres per second claims, and the feet make up the difference by
 * sliding. A file can state the request — `calibrated: true` on the axis — but
 * not the answer, because the answer is a sweep of the built tree. So the file
 * asks and this obliges: `calibrateSpeed` walks the axis once at startup and
 * hands back the inverse, and the slider is then in true metres per second all
 * the way across.
 *
 * Only a subject with feet gets one. A bat's effort axis is a plain 0 to 1 and
 * there is nothing about it to correct.
 */

import { calibrateSpeed, type Skeleton } from '@hexdelve/engine';
import type { BlendTreeAsset, TreeParameter } from '@hexdelve/client';

import type { BenchParameter } from './animation.js';

/** How finely the axis is swept. Forty points across a walk-to-run range. */
const STEPS = 40;

/**
 * A tree's parameters, with any calibrated axis bent to mean what it says.
 *
 * The sweep needs the other axes held somewhere, and they are held at their
 * own initial values: the guard is masked to the upper body and the lean is a
 * roll, so neither moves the feet much, and a curve per combination would be a
 * table nobody could check.
 */
export function calibratedParameters(
	asset: BlendTreeAsset,
	skeleton: Skeleton,
): readonly BenchParameter[] {
	const declared = asset.parameters;
	const axis = declared.find((parameter) => parameter.calibrated);
	if (!axis) return declared.map(plain);

	const held: Record<string, number> = {};
	for (const parameter of declared) {
		if (parameter.name !== axis.name) held[parameter.name] = parameter.initial;
	}

	/*
	 * A tree of its own for the sweep. The one the bench is driving has a
	 * playhead somebody may already be scrubbing, and calibrating walks it.
	 */
	const calibration = calibrateSpeed(asset.tree(), skeleton, axis.name, [axis.min, axis.max], {
		steps: STEPS,
		params: held,
		contactPhase: 0,
	});

	return declared.map((parameter) =>
		parameter.name === axis.name
			? { ...plain(parameter), max: calibration.maxSpeed, toTree: calibration.parameterFor }
			: plain(parameter),
	);
}

/** A declared parameter, as the panel's slider wants it. */
function plain(parameter: TreeParameter): BenchParameter {
	return {
		name: parameter.name,
		label: parameter.label,
		min: parameter.min,
		max: parameter.max,
		step: parameter.step,
		initial: parameter.initial,
		...(parameter.unit ? { unit: parameter.unit } : {}),
		...(parameter.hint ? { hint: parameter.hint } : {}),
	};
}
