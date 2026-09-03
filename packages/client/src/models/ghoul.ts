/*
 * The ghoul: hexagonal prisms on the humanoid rig.
 *
 * Same bones, same trick, same skeleton as the wanderer — a body is still
 * nothing but the unit hex prism under a different scale and rotation, bound
 * to a bone. What changes is what gets hung on it: where he was built up in
 * layers of cloth, the ghoul is built down to what is left once most of them
 * have rotted away — a gaunt frame, bone showing through torn skin at the
 * chest and one cheek, and a single ragged wrap at the waist held on by a
 * cord. Every clip and the locomotion tree both read on him unchanged,
 * because nothing here is animated directly and the rig underneath is the
 * wanderer's own.
 *
 * Hands and feet end in claws rather than fingers and toes — three thin
 * struts fanned from the wrist and the ankle, the same primitive the wings
 * and the sword blade already use elsewhere in this project, not a new one.
 */

import { Model } from '@hexdelve/engine';

const PI = Math.PI;

export const GHOUL_PALETTE = {
	skin: 0x8ea88a,
	skinDark: 0x71896f,
	bone: 0xe2d9bc,
	boneDark: 0xb9ad8d,
	wound: 0x38221e,
	eye: 0x120f0c,
	rag: 0xa9865a,
	ragDark: 0x836b47,
	cord: 0x4a3826,
	claw: 0xcdbd8d,
	hair: 0x413b34,
};

export function buildGhoul(): Model {
	const model = new Model();
	const C = GHOUL_PALETTE;

	/**
	 * Three claws fanned out from a joint, in that joint's own space — the
	 * same `strut` a wing spar or a sword blade is, just three of them at
	 * once and short. `directions` need not be unit length: a claw is as long
	 * as its own vector says, which is what lets the fan be uneven rather
	 * than combed.
	 */
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
				0.013,
				C.claw,
			);
		}
	};

	// Pelvis: nothing left to wear but one ragged wrap, tied on with a cord —
	// there is no belt because there is no waistband it could sit on anymore.
	model.add('root', [0, -0.02, 0], [0.185, 0.2, 0.15], C.rag);
	model.add('root', [0, 0.055, 0.01], [0.2, 0.05, 0.155], C.ragDark);
	model.add('root', [0, 0.015, 0.16], [0.05, 0.055, 0.018], C.cord);

	// Torn strips at angles round the hem, the greave trick turned loose: a
	// stack of plates reads as armour, a fan of scraps at uneven lengths and
	// tilts reads as cloth that is falling apart rather than made that way.
	for (let k = 0; k < 5; k++) {
		const angle = (k / 5) * PI * 2 + 0.3;
		model.add(
			'root',
			[Math.sin(angle) * 0.14, -0.135 - (k % 2) * 0.03, Math.cos(angle) * 0.11],
			[0.038, 0.1 + (k % 2) * 0.045, 0.016],
			k % 2 ? C.ragDark : C.rag,
			{ euler: [0.15, angle, 0.1 * (k % 2 ? 1 : -1)] },
		);
	}

	// Torso: a gaunt cage rather than a chest. The sternum has torn open and
	// stayed that way, which is the wound the whole silhouette reads from —
	// a dark cavity set back of the skin, with a course of exposed ribs
	// crossing it.
	model.add('spine', [0, 0.0, 0], [0.155, 0.22, 0.12], C.skin);
	model.add('chest', [0, 0.02, 0], [0.175, 0.32, 0.13], C.skin);
	model.add('chest', [-0.1, 0.15, 0.015], [0.09, 0.13, 0.11], C.skinDark);
	model.add('chest', [0.01, 0.03, 0.05], [0.09, 0.22, 0.028], C.wound);
	for (let k = 0; k < 4; k++) {
		model.add(
			'chest',
			[0.01, 0.16 - k * 0.09, 0.075],
			[0.075 - k * 0.006, 0.026, 0.018],
			k % 2 ? C.boneDark : C.bone,
		);
	}
	// The one scrap of what was once a shirt, hanging off a shoulder that
	// still has skin on it.
	model.add('chest', [-0.13, 0.1, 0.02], [0.058, 0.14, 0.09], C.ragDark, { euler: [0.1, 0, 0.35] });

	// Neck and head: sunken eyes, a lipless jaw, bone showing through one
	// torn cheek, and a few tufts of hair left over the rest of a bald skull.
	model.add('neck', [0, 0.0, 0], [0.058, 0.13, 0.058], C.skin);
	model.add('head', [0, 0.01, 0], [0.135, 0.19, 0.125], C.skin);
	model.add('head', [0.045, 0.03, 0.115], [0.032, 0.028, 0.02], C.eye);
	model.add('head', [-0.045, 0.03, 0.115], [0.032, 0.028, 0.02], C.eye);
	model.add('head', [0, -0.09, 0.09], [0.075, 0.045, 0.075], C.bone);
	model.add('head', [0, -0.075, 0.125], [0.07, 0.016, 0.02], C.boneDark);
	model.add('head', [0.075, -0.02, 0.06], [0.045, 0.055, 0.02], C.bone, { euler: [0, 0.3, 0] });
	model.add('head', [0.02, 0.12, -0.06], [0.05, 0.03, 0.05], C.hair);
	model.add('head', [-0.06, 0.1, -0.03], [0.03, 0.025, 0.03], C.hair);

	// Arms: thin to the bone, bare, an elbow worn through — and hands that
	// end in claws rather than fingers.
	for (const side of ['L', 'R'] as const) {
		const s = side === 'L' ? 1 : -1;
		model.add(`arm${side}`, [0, -0.14, 0], [0.052, 0.3, 0.052], C.skin);
		model.add(`arm${side}`, [0, -0.3, 0], [0.038, 0.09, 0.038], C.bone);
		model.add(`forearm${side}`, [0, -0.13, 0], [0.045, 0.24, 0.045], C.skin);
		model.add(`forearm${side}`, [0, -0.26, 0], [0.05, 0.05, 0.05], C.skinDark);
		model.add(`hand${side}`, [0, -0.02, 0], [0.045, 0.06, 0.04], C.skin);
		claws(
			`hand${side}`,
			[0, -0.05, 0.01],
			[
				[-0.4 * s, -1, 0.3],
				[0, -1, 0.5],
				[0.4 * s, -1, 0.3],
			],
			0.09,
		);
	}

	// Legs: bare and skeletal — one shin worn through to bone the same way
	// the elbow is — and feet that end in claws the same way the hands do.
	for (const side of ['L', 'R'] as const) {
		model.add(`hip${side}`, [0, -0.2, 0], [0.07, 0.36, 0.07], C.skin);
		model.add(`shin${side}`, [0, -0.16, 0], [0.055, 0.3, 0.055], C.skin);
		model.add(`shin${side}`, [0, -0.05, 0.045], [0.03, 0.07, 0.014], C.bone, { euler: [0.15, 0, 0] });
		model.add(`foot${side}`, [0, -0.05, 0.03], [0.055, 0.06, 0.09], C.skinDark);
		claws(
			`foot${side}`,
			[0, -0.075, 0.12],
			[
				[-0.5, -0.3, 1],
				[0, -0.2, 1],
				[0.5, -0.3, 1],
			],
			0.1,
		);
	}

	return model;
}
