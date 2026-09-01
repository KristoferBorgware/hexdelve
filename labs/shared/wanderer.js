/*
 * labs/shared/wanderer.js — the player character: hexagonal prisms on the rig.
 *
 * The same exercise as ../shared/blacksmith.js, on the same 17-bone skeleton:
 * every part is the unit hex prism under a different scale and rotation,
 * parented to a bone, and nothing here is animated directly — posing the rig
 * poses the character.
 *
 * He is deliberately the blacksmith's opposite number. The smith is built
 * around his tool: apron, gloves, a hammer welded to the right fist. This one
 * carries nothing at all, so both hands stay free and every clip in
 * ../shared/clips.js reads on him unchanged. What he wears instead is close-cut
 * layered cloth — a wrapped chest, a short tunic over trousers, wound wrists
 * and laced greaves — with nothing hanging off the pelvis, so the legs are
 * never fighting a garment and the lab has no cloth to drive.
 */

var Hexdelve = Hexdelve || {};

Hexdelve.wanderer = (function () {
'use strict';

const { hexGeometry, Q_ID, Q_AXIS_Z } = Hexdelve.hex;

const PI = Math.PI;

const PALETTE = {
	skin: '#cf9b76',
	hair: '#8b837a',
	beard: '#43392f',
	tunic: '#cec5b4',
	fold: '#bcb2a0',
	wrap: '#b6ab98',
	belt: '#6d4a2e',
	pouch: '#593c25',
	buckle: '#7c7a72',
	hem: '#d8cfbd',
	hemShade: '#b0a693',
	trouser: '#3c362f',
	greave: '#7d4f30',
	greaveDark: '#5e3a23',
	boot: '#6b4227',
};

function buildWanderer(rig) {
	const materials = new Map();
	const meshes = [];

	function mat(color) {
		if (!materials.has(color)) {
			materials.set(
				color,
				new THREE.MeshPhongMaterial({ color, flatShading: true, shininess: 8, specular: 0x1a1a1a }),
			);
		}
		return materials.get(color);
	}

	function part(boneName, pos, scale, color, quat) {
		const m = new THREE.Mesh(hexGeometry(), mat(color));
		m.position.set(pos[0], pos[1], pos[2]);
		m.quaternion.copy(quat || Q_ID);
		m.scale.set(scale[0], scale[1], scale[2]);
		m.castShadow = true;
		rig.bones[boneName].add(m);
		meshes.push(m);
		return m;
	}

	// A thin prism spanning two points in a bone's local space.
	function strut(boneName, from, to, radius, color) {
		const a = new THREE.Vector3(from[0], from[1], from[2]);
		const b = new THREE.Vector3(to[0], to[1], to[2]);
		const dir = new THREE.Vector3().subVectors(b, a);
		return part(
			boneName,
			[(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2],
			[radius, dir.length(), radius],
			color,
			new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()),
		);
	}

	// One band of cloth wound round the torso, tipped a little off horizontal so
	// the wrap reads as a spiral rather than as a stack of hoops.
	function band(boneName, y, z, scale, roll, color) {
		return part(boneName, [0, y, z], scale, color, new THREE.Quaternion().setFromEuler(
			new THREE.Euler(0, 0, roll),
		));
	}

	const C = PALETTE;

	// Pelvis: trousers, belt, and the pouch slung off it.
	part('root', [0, -0.03, 0], [0.24, 0.24, 0.175], C.trouser);
	part('root', [0, 0.08, 0.01], [0.26, 0.09, 0.19], C.tunic);
	part('root', [0, 0.02, 0.01], [0.27, 0.07, 0.2], C.belt);
	part('root', [0, 0.02, 0.19], [0.045, 0.05, 0.03], C.buckle);
	part('root', [0.16, -0.06, 0.09], [0.07, 0.13, 0.05], C.pouch);

	// The tunic's hem, a course wider than the belt: the whole garment stops at
	// the hip, so the legs are never inside cloth and nothing has to be swung out
	// of their way as he walks.
	part('root', [0, -0.14, 0.005], [0.275, 0.12, 0.25], C.hem);
	part('root', [0, -0.215, 0.005], [0.262, 0.045, 0.238], C.hemShade);

	// Torso: tunic, a fold of cloth over the left shoulder, and the wrapping
	// wound round the chest — thin bands, tipped off horizontal so they read as
	// one spiral rather than as a stack of hoops.
	part('spine', [0, 0.02, 0], [0.23, 0.2, 0.165], C.tunic);
	part('chest', [0, 0.03, 0], [0.265, 0.32, 0.185], C.tunic);
	part('chest', [0, 0.17, 0], [0.28, 0.1, 0.195], C.fold);
	part('chest', [0.13, 0.13, 0.01], [0.12, 0.11, 0.16], C.fold);
	band('chest', 0.08, 0.005, [0.272, 0.035, 0.19], 0.05, C.wrap);
	band('chest', 0.005, 0.005, [0.274, 0.04, 0.192], -0.06, C.wrap);
	band('chest', -0.075, 0.005, [0.272, 0.035, 0.19], 0.06, C.wrap);
	band('spine', -0.055, 0.005, [0.245, 0.035, 0.175], -0.05, C.wrap);

	// Neck and head: grey hair swept back, a full beard, no cap.
	part('neck', [0, 0.02, 0], [0.085, 0.14, 0.085], C.skin);
	part('head', [0, 0.02, 0], [0.18, 0.23, 0.165], C.skin);
	part('head', [0, -0.08, 0.08], [0.145, 0.17, 0.105], C.beard);
	part('head', [0, -0.155, 0.05], [0.09, 0.06, 0.07], C.beard);
	part('head', [0, 0.02, 0.165], [0.032, 0.05, 0.032], C.skin);
	part('head', [0, -0.035, 0.14], [0.055, 0.03, 0.05], C.beard);
	part('head', [0.062, 0.055, 0.15], [0.023, 0.028, 0.012], C.beard);
	part('head', [-0.062, 0.055, 0.15], [0.023, 0.028, 0.012], C.beard);
	part('head', [0, 0.155, -0.01], [0.185, 0.08, 0.172], C.hair);
	part('head', [0, 0.055, -0.105], [0.14, 0.16, 0.075], C.hair);
	part('head', [0, 0.128, 0.145], [0.07, 0.04, 0.07], C.hair);
	part('head', [0.088, 0.0, 0.05], [0.028, 0.09, 0.05], C.beard);
	part('head', [-0.088, 0.0, 0.05], [0.028, 0.09, 0.05], C.beard);

	// Arms: a short sleeve, bare arm below it, wound wrist, open hand. Nothing
	// is held — the right fist is as free as the left.
	for (const side of ['L', 'R']) {
		part(`arm${side}`, [0, -0.01, 0], [0.1, 0.13, 0.1], C.tunic);
		part(`arm${side}`, [0, -0.12, 0], [0.088, 0.2, 0.088], C.tunic);
		part(`arm${side}`, [0, -0.27, 0], [0.072, 0.16, 0.072], C.skin);
		part(`forearm${side}`, [0, -0.12, 0], [0.066, 0.22, 0.066], C.skin);
		part(`forearm${side}`, [0, -0.235, 0], [0.076, 0.11, 0.076], C.wrap);
		part(`hand${side}`, [0, -0.05, 0.01], [0.068, 0.12, 0.055], C.skin);
	}

	// Legs: trousers into laced leather greaves and a boot.
	for (const side of ['L', 'R']) {
		part(`hip${side}`, [0, -0.2, 0], [0.1, 0.36, 0.1], C.trouser);
		part(`shin${side}`, [0, -0.11, 0], [0.088, 0.22, 0.088], C.trouser);
		for (let k = 0; k < 3; k++) {
			part(
				`shin${side}`,
				[0, -0.18 - k * 0.07, 0],
				[0.096 + k * 0.006, 0.075, 0.096 + k * 0.006],
				k % 2 ? C.greaveDark : C.greave,
				new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (k % 2 ? 12 : -8) * (PI / 180), 0)),
			);
		}
		part(`foot${side}`, [0, -0.06, 0.01], [0.096, 0.1, 0.106], C.boot);
		part(`foot${side}`, [0, -0.075, 0.12], [0.082, 0.07, 0.086], C.greaveDark);
	}

	return { meshes, materials };
}

return { PALETTE, buildWanderer };
})();
