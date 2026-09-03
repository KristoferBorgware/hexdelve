/*
 * The hellhound: hexagonal prisms hung on its own quadruped rig.
 *
 * Built the same way every other body in this project is — the unit hex prism
 * under a different scale and rotation, bound to a bone — but jagged rather
 * than smooth where the wanderer and the ghoul are both built out of flat
 * planes. The mane is a row of thin spikes struck straight off the spine, the
 * same primitive a claw or a sword blade already is; nothing here is a new
 * kind of shape, only a new arrangement of the one shape the whole project
 * draws.
 */

import { Model } from '@hexdelve/engine';

export const HELLHOUND_PALETTE = {
	fur: 0x18181a,
	furDark: 0x0b0b0c,
	mane: 0x08080a,
	eye: 0xff2a1c,
	mouth: 0x7a0d08,
	fang: 0xe6dccc,
	claw: 0x2a2422,
};

export function buildHellhound(): Model {
	const model = new Model();
	const C = HELLHOUND_PALETTE;

	/** Three claws fanned from a paw, the same trick the ghoul's hands use. */
	const claws = (
		bone: string,
		root: readonly [number, number, number],
		directions: readonly (readonly [number, number, number])[],
		length: number,
	): void => {
		for (const dir of directions) {
			model.strut(
				bone,
				root,
				[root[0] + dir[0] * length, root[1] + dir[1] * length, root[2] + dir[2] * length],
				0.015,
				C.claw,
			);
		}
	};

	/** One spike of the mane, struck up and back from a point on the ridge. */
	const spike = (
		bone: string,
		at: readonly [number, number, number],
		height: number,
		lean: number,
		radius = 0.014,
	): void => {
		model.strut(bone, at, [at[0], at[1] + height, at[2] - lean * height], radius, C.mane);
	};

	// Torso: hips, the bridge of ribs between them and the chest, and a deep,
	// powerful chest — a running animal is built round its lungs and haunches,
	// not round a waist the way a man is.
	model.add('root', [0, 0.05, 0.02], [0.19, 0.22, 0.24], C.fur);
	model.add('root', [0, -0.05, 0.0], [0.17, 0.1, 0.2], C.furDark);
	model.add('spineMid', [0, 0.02, 0.1], [0.155, 0.17, 0.16], C.fur);
	model.add('chest', [0, 0.02, 0.02], [0.18, 0.2, 0.19], C.fur);
	model.add('chest', [0, -0.09, 0.05], [0.16, 0.09, 0.17], C.furDark);

	// Neck and head: a heavy skull, a tapering snout, and eyes set for a
	// straight-ahead stare rather than a wide field of view.
	model.add('neck', [0, 0.0, 0.04], [0.13, 0.15, 0.14], C.fur);
	model.add('head', [0, 0.0, 0.02], [0.135, 0.135, 0.16], C.fur);
	model.add('head', [0, -0.025, 0.13], [0.075, 0.075, 0.09], C.furDark);
	model.add('head', [0.05, 0.03, 0.15], [0.024, 0.022, 0.012], C.eye);
	model.add('head', [-0.05, 0.03, 0.15], [0.024, 0.022, 0.012], C.eye);

	// Jaw: the lower half of an open mouth, glowing at the back of the throat,
	// with a fang top and bottom on each side.
	model.add('jaw', [0, -0.015, 0.055], [0.065, 0.045, 0.09], C.mouth);
	model.add('head', [0.028, -0.05, 0.16], [0.011, 0.03, 0.011], C.fang, { euler: [0.5, 0, 0] });
	model.add('head', [-0.028, -0.05, 0.16], [0.011, 0.03, 0.011], C.fang, { euler: [0.5, 0, 0] });
	model.add('jaw', [0.026, 0.02, 0.09], [0.01, 0.026, 0.01], C.fang, { euler: [-0.4, 0, 0] });
	model.add('jaw', [-0.026, 0.02, 0.09], [0.01, 0.026, 0.01], C.fang, { euler: [-0.4, 0, 0] });

	// Ears: two segments a side, raked back and drawn to a point, folded
	// forward a little rather than standing straight up.
	for (const side of ['L', 'R'] as const) {
		const s = side === 'L' ? 1 : -1;
		model.add(`ear${side}`, [s * 0.01, 0.05, -0.015], [0.04, 0.11, 0.02], C.mane, {
			euler: [-0.3, 0, s * 0.15],
		});
		model.add(`ear${side}`, [s * 0.015, 0.11, -0.03], [0.02, 0.05, 0.012], C.mane, {
			euler: [-0.45, 0, s * 0.15],
		});
	}

	/*
	 * The mane: a single row of spikes down the ridge of the spine, tallest
	 * over the shoulders where a real animal carries the most muscle and
	 * tapering off towards the skull ahead of it and the hips behind — which
	 * is what makes it read as a silhouette rather than as a fence.
	 */
	spike('head', [0, 0.07, -0.02], 0.05, 0.55);
	spike('neck', [0, 0.075, 0.03], 0.09, 0.6);
	spike('neck', [0, 0.08, -0.03], 0.11, 0.5);
	spike('chest', [0, 0.1, 0.07], 0.13, 0.45);
	spike('chest', [0, 0.095, -0.02], 0.1, 0.5);
	spike('spineMid', [0, 0.085, 0.06], 0.08, 0.55);
	spike('spineMid', [0, 0.075, -0.03], 0.06, 0.6);
	spike('root', [0, 0.14, 0.05], 0.045, 0.65);

	// Front legs: lean and built for reach rather than power.
	for (const side of ['L', 'R'] as const) {
		const s = side === 'L' ? 1 : -1;
		model.add(`frontLeg${side}`, [0, -0.1, 0], [0.062, 0.2, 0.062], C.fur);
		model.add(`frontShin${side}`, [0, -0.09, 0], [0.05, 0.17, 0.05], C.furDark);
		model.add(`frontPaw${side}`, [0, -0.03, 0.02], [0.052, 0.05, 0.075], C.fur);
		claws(
			`frontPaw${side}`,
			[0, -0.05, 0.06],
			[
				[-0.35 * s, -0.3, 1],
				[0, -0.2, 1],
				[0.35 * s, -0.3, 1],
			],
			0.075,
		);
	}

	// Back legs: the haunches, thicker than the front pair by a clear margin
	// — this is where a lunge actually comes from.
	for (const side of ['L', 'R'] as const) {
		const s = side === 'L' ? 1 : -1;
		model.add(`backLeg${side}`, [0, -0.1, 0], [0.075, 0.2, 0.075], C.fur);
		model.add(`backShin${side}`, [0, -0.09, 0], [0.05, 0.17, 0.05], C.furDark);
		model.add(`backPaw${side}`, [0, -0.03, 0.02], [0.055, 0.05, 0.078], C.fur);
		claws(
			`backPaw${side}`,
			[0, -0.05, 0.06],
			[
				[-0.35 * s, -0.3, 1],
				[0, -0.2, 1],
				[0.35 * s, -0.3, 1],
			],
			0.08,
		);
	}

	// Tail: two segments, tapering, with a small dark tuft at the tip rather
	// than a fan — the mane already carries the silhouette, the tail does not
	// need to repeat it.
	model.strut('tailA', [0, 0, 0], [0, -0.02, -0.16], 0.035, C.fur);
	model.strut('tailB', [0, 0, 0], [0, -0.02, -0.16], 0.024, C.furDark);
	model.add('tailB', [0, -0.02, -0.17], [0.028, 0.03, 0.03], C.mane);

	return model;
}
