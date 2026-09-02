/*
 * The bat: hexagonal prisms hung on its own rig.
 *
 * The wing is the interesting part. It is built the way the animal is: a spar
 * along each of the four bones, and a membrane patch trailing behind each spar
 * — a hexagonal prism squashed flat in Y, so it is a sheet lying in the plane
 * of the wing. Because each patch belongs to one bone, folding the bones folds
 * the wing: the sheets come together with the spars and end up wrapped round
 * the body without a single line of cloth simulation.
 */

import { Model } from '@hexdelve/engine';

const PI = Math.PI;

export const BAT_PALETTE = {
	fur: 0x4a3a3c,
	furDark: 0x372a2d,
	belly: 0x5b4a49,
	membrane: 0x6b4f57,
	membraneDark: 0x5a4149,
	spar: 0x2e2428,
	ear: 0x57424a,
	snout: 0x6d5257,
	eye: 0xffb648,
	claw: 0xcfc4b6,
	fang: 0xefe8dc,
};

export function buildBat(): Model {
	const model = new Model();
	const C = BAT_PALETTE;

	/*
	 * Body: a prism lying along Z, nose to tail, with the fur darker on top
	 * than underneath. It is tipped head-up so that the perch pose, which
	 * pitches the whole root forward, ends with the animal hunched rather than
	 * face down.
	 */
	model.add('root', [0, 0, -0.02], [0.19, 0.52, 0.2], C.fur, { euler: [PI / 2, 0, 0] });
	model.add('root', [0, -0.1, -0.02], [0.15, 0.34, 0.13], C.belly, { euler: [PI / 2, 0, 0] });
	model.add('chest', [0, 0, 0.02], [0.17, 0.24, 0.18], C.fur, { euler: [PI / 2, 0, 0] });
	model.add('neck', [0, 0, 0.03], [0.1, 0.14, 0.1], C.furDark, { euler: [PI / 2, 0, 0] });

	// Head, snout and jaw. The eyes are small and set wide; the ears are the
	// silhouette, so they are big, thin and raked back.
	model.add('head', [0, 0.01, 0.02], [0.15, 0.17, 0.15], C.fur, { euler: [PI / 2, 0, 0] });
	model.add('head', [0, -0.01, 0.13], [0.08, 0.1, 0.08], C.snout, { euler: [PI / 2, 0, 0] });
	model.add('head', [0.055, 0.05, 0.11], [0.026, 0.03, 0.026], C.eye);
	model.add('head', [-0.055, 0.05, 0.11], [0.026, 0.03, 0.026], C.eye);
	model.add('jaw', [0, -0.01, 0.05], [0.07, 0.06, 0.11], C.snout, { euler: [PI / 2, 0, 0] });
	model.add('jaw', [0.032, 0.01, 0.11], [0.012, 0.035, 0.012], C.fang, { euler: [0.4, 0, 0] });
	model.add('jaw', [-0.032, 0.01, 0.11], [0.012, 0.035, 0.012], C.fang, { euler: [0.4, 0, 0] });

	for (const side of ['L', 'R'] as const) {
		const s = side === 'L' ? 1 : -1;
		model.add(`ear${side}`, [s * 0.01, 0.09, -0.03], [0.055, 0.2, 0.02], C.ear, {
			euler: [-0.35, 0, s * 0.12],
		});
		model.add(`ear${side}`, [s * 0.01, 0.18, -0.06], [0.03, 0.09, 0.016], C.ear, {
			euler: [-0.5, 0, s * 0.12],
		});
	}

	/*
	 * The wings. Four segments a side; for each, a spar along the bone and a
	 * membrane patch behind it, widening outboard the way a real wing does.
	 * `x` is the length of that bone, so the spar always spans it exactly —
	 * change a bone in batrig.ts and the wing follows.
	 */
	const SEGMENTS = [
		{ bone: 'arm', x: 0.34, spar: 0.035, patch: [0.23, 0.016, 0.3], at: [0.17, -0.01, -0.24] },
		{ bone: 'fore', x: 0.4, spar: 0.03, patch: [0.26, 0.016, 0.32], at: [0.2, -0.005, -0.27] },
		{ bone: 'hand', x: 0.26, spar: 0.025, patch: [0.19, 0.014, 0.29], at: [0.13, 0, -0.25] },
		{ bone: 'digit', x: 0.24, spar: 0.02, patch: [0.16, 0.014, 0.24], at: [0.11, 0, -0.19] },
	] as const;

	for (const side of ['L', 'R'] as const) {
		const s = side === 'L' ? 1 : -1;
		for (let i = 0; i < SEGMENTS.length; i++) {
			const seg = SEGMENTS[i]!;
			const bone = seg.bone + side;
			model.strut(bone, [0, 0, 0], [s * seg.x, 0, 0], seg.spar, C.spar);
			model.add(
				bone,
				[s * seg.at[0]!, seg.at[1]!, seg.at[2]!],
				[seg.patch[0]!, seg.patch[1]!, seg.patch[2]!],
				i % 2 ? C.membraneDark : C.membrane,
				{ euler: [0, s * 0.12, 0] },
			);
		}
		// A thumb claw at the wrist, which is what a bat walks and hangs on.
		model.add(`hand${side}`, [s * 0.03, 0.05, 0.03], [0.018, 0.09, 0.018], C.claw, {
			euler: [0.3, 0, s * 0.5],
		});
	}

	// Hind legs, and the membrane stretched between them and the tail.
	for (const side of ['L', 'R'] as const) {
		model.strut(`leg${side}`, [0, 0, 0], [0, -0.21, 0], 0.03, C.spar);
		model.add(`leg${side}`, [0, -0.1, 0], [0.045, 0.16, 0.05], C.furDark);
		model.add(`foot${side}`, [0, -0.02, 0.02], [0.04, 0.05, 0.06], C.furDark);
		for (let k = -1; k <= 1; k++) {
			model.add(`foot${side}`, [k * 0.025, -0.04, 0.055], [0.012, 0.055, 0.012], C.claw, {
				euler: [0.9, 0, 0],
			});
		}
	}
	model.add('tail', [0, -0.02, -0.09], [0.14, 0.014, 0.13], C.membraneDark);
	model.strut('tail', [0, 0, 0], [0, -0.03, -0.18], 0.018, C.spar);

	return model;
}
