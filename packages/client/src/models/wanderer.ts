/*
 * The player character: hexagonal prisms on the humanoid rig.
 *
 * Every part is the unit hex prism under a different scale and rotation, bound
 * to a bone, and nothing here is animated directly — posing the rig poses the
 * character.
 *
 * He carries nothing at all, so both hands stay free and every clip reads on
 * him unchanged. What he wears instead is close-cut layered cloth — a wrapped
 * chest, a short tunic over trousers, wound wrists and laced greaves — with
 * nothing hanging off the pelvis, so the legs are never fighting a garment and
 * there is no cloth to drive.
 */

import { Model } from '@hexdelve/engine';

const PI = Math.PI;

export const WANDERER_PALETTE = {
	skin: 0xcf9b76,
	hair: 0x8b837a,
	beard: 0x43392f,
	tunic: 0xcec5b4,
	fold: 0xbcb2a0,
	wrap: 0xb6ab98,
	belt: 0x6d4a2e,
	pouch: 0x593c25,
	buckle: 0x7c7a72,
	hem: 0xd8cfbd,
	hemShade: 0xb0a693,
	trouser: 0x3c362f,
	greave: 0x7d4f30,
	greaveDark: 0x5e3a23,
	boot: 0x6b4227,
};

export function buildWanderer(): Model {
	const model = new Model();
	const C = WANDERER_PALETTE;

	/** One band of cloth wound round the torso, tipped off horizontal so the
	 * wrap reads as a spiral rather than as a stack of hoops. */
	const band = (
		bone: string,
		y: number,
		z: number,
		scale: [number, number, number],
		roll: number,
		color: number,
	): void => {
		model.add(bone, [0, y, z], scale, color, { euler: [0, 0, roll] });
	};

	// Pelvis: trousers, belt, and the pouch slung off it.
	model.add('root', [0, -0.03, 0], [0.24, 0.24, 0.175], C.trouser);
	model.add('root', [0, 0.08, 0.01], [0.26, 0.09, 0.19], C.tunic);
	model.add('root', [0, 0.02, 0.01], [0.27, 0.07, 0.2], C.belt);
	model.add('root', [0, 0.02, 0.19], [0.045, 0.05, 0.03], C.buckle);
	model.add('root', [0.16, -0.06, 0.09], [0.07, 0.13, 0.05], C.pouch);

	// The tunic's hem, a course wider than the belt: the whole garment stops at
	// the hip, so the legs are never inside cloth and nothing has to be swung
	// out of their way as he walks.
	model.add('root', [0, -0.14, 0.005], [0.275, 0.12, 0.25], C.hem);
	model.add('root', [0, -0.215, 0.005], [0.262, 0.045, 0.238], C.hemShade);

	// Torso: tunic, a fold of cloth over the left shoulder, and the wrapping.
	model.add('spine', [0, 0.02, 0], [0.23, 0.2, 0.165], C.tunic);
	model.add('chest', [0, 0.03, 0], [0.265, 0.32, 0.185], C.tunic);
	model.add('chest', [0, 0.17, 0], [0.28, 0.1, 0.195], C.fold);
	model.add('chest', [0.13, 0.13, 0.01], [0.12, 0.11, 0.16], C.fold);
	band('chest', 0.08, 0.005, [0.272, 0.035, 0.19], 0.05, C.wrap);
	band('chest', 0.005, 0.005, [0.274, 0.04, 0.192], -0.06, C.wrap);
	band('chest', -0.075, 0.005, [0.272, 0.035, 0.19], 0.06, C.wrap);
	band('spine', -0.055, 0.005, [0.245, 0.035, 0.175], -0.05, C.wrap);

	// Neck and head: grey hair swept back, a full beard, no cap.
	model.add('neck', [0, 0.02, 0], [0.085, 0.14, 0.085], C.skin);
	model.add('head', [0, 0.02, 0], [0.18, 0.23, 0.165], C.skin);
	model.add('head', [0, -0.08, 0.08], [0.145, 0.17, 0.105], C.beard);
	model.add('head', [0, -0.155, 0.05], [0.09, 0.06, 0.07], C.beard);
	model.add('head', [0, 0.02, 0.165], [0.032, 0.05, 0.032], C.skin);
	model.add('head', [0, -0.035, 0.14], [0.055, 0.03, 0.05], C.beard);
	model.add('head', [0.062, 0.055, 0.15], [0.023, 0.028, 0.012], C.beard);
	model.add('head', [-0.062, 0.055, 0.15], [0.023, 0.028, 0.012], C.beard);
	model.add('head', [0, 0.155, -0.01], [0.185, 0.08, 0.172], C.hair);
	model.add('head', [0, 0.055, -0.105], [0.14, 0.16, 0.075], C.hair);
	model.add('head', [0, 0.128, 0.145], [0.07, 0.04, 0.07], C.hair);
	model.add('head', [0.088, 0.0, 0.05], [0.028, 0.09, 0.05], C.beard);
	model.add('head', [-0.088, 0.0, 0.05], [0.028, 0.09, 0.05], C.beard);

	// Arms: a short sleeve, bare arm below it, wound wrist, open hand. Nothing
	// is held — the right fist is as free as the left.
	for (const side of ['L', 'R'] as const) {
		model.add(`arm${side}`, [0, -0.01, 0], [0.1, 0.13, 0.1], C.tunic);
		model.add(`arm${side}`, [0, -0.12, 0], [0.088, 0.2, 0.088], C.tunic);
		model.add(`arm${side}`, [0, -0.27, 0], [0.072, 0.16, 0.072], C.skin);
		model.add(`forearm${side}`, [0, -0.12, 0], [0.066, 0.22, 0.066], C.skin);
		model.add(`forearm${side}`, [0, -0.235, 0], [0.076, 0.11, 0.076], C.wrap);
		model.add(`hand${side}`, [0, -0.05, 0.01], [0.068, 0.12, 0.055], C.skin);
	}

	// Legs: trousers into laced leather greaves and a boot.
	for (const side of ['L', 'R'] as const) {
		model.add(`hip${side}`, [0, -0.2, 0], [0.1, 0.36, 0.1], C.trouser);
		model.add(`shin${side}`, [0, -0.11, 0], [0.088, 0.22, 0.088], C.trouser);
		for (let k = 0; k < 3; k++) {
			model.add(
				`shin${side}`,
				[0, -0.18 - k * 0.07, 0],
				[0.096 + k * 0.006, 0.075, 0.096 + k * 0.006],
				k % 2 ? C.greaveDark : C.greave,
				{ euler: [0, (k % 2 ? 12 : -8) * (PI / 180), 0] },
			);
		}
		model.add(`foot${side}`, [0, -0.06, 0.01], [0.096, 0.1, 0.106], C.boot);
		model.add(`foot${side}`, [0, -0.075, 0.12], [0.082, 0.07, 0.086], C.greaveDark);
	}

	return model;
}
