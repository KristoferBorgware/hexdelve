/*
 * labs/shared/blacksmith.js — the character: hexagonal prisms hung on the rig.
 *
 * Every part is the same unit hex prism under a different scale and rotation,
 * parented to a bone. Nothing here is animated directly — posing the rig poses
 * the character, which is the entire point of the exercise.
 */

var Hexdelve = Hexdelve || {};

Hexdelve.blacksmith = (function () {
'use strict';

const { hexGeometry, Q_ID, Q_AXIS_X, Q_AXIS_Z } = Hexdelve.hex;

const PALETTE = {
	skin: '#d8a57f',
	beard: '#2e2621',
	cap: '#5a555c',
	shirt: '#d9d2c6',
	apron: '#8a5b3a',
	strap: '#6f462a',
	glove: '#6b4226',
	mitt: '#54341e',
	pants: '#453c35',
	cuff: '#8c8578',
	boot: '#7a4a2c',
	haft: '#8a6234',
	iron: '#4c5057',
};

function buildBlacksmith(rig, { hammer = true } = {}) {
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

	const C = PALETTE;

	// Pelvis, waistband, apron skirt.
	part('root', [0, -0.02, 0], [0.28, 0.22, 0.19], C.pants);
	part('root', [0, 0.1, 0.02], [0.3, 0.09, 0.21], C.apron);
	const apron = part('root', [0, -0.38, 0.16], [0.24, 0.05, 0.3], C.apron, Q_AXIS_Z);

	// Torso, apron bib and strap.
	part('spine', [0, 0.02, 0], [0.26, 0.2, 0.18], C.shirt);
	part('chest', [0, 0.02, 0], [0.3, 0.34, 0.2], C.shirt);
	part('chest', [0, 0, 0.2], [0.22, 0.05, 0.24], C.apron, Q_AXIS_Z);
	strut('chest', [0.16, 0.2, 0.23], [-0.19, -0.26, 0.26], 0.035, C.strap);

	// Neck and head.
	part('neck', [0, 0.02, 0], [0.09, 0.14, 0.09], C.skin);
	part('head', [0, 0.02, 0], [0.19, 0.24, 0.17], C.skin);
	part('head', [0, -0.07, 0.09], [0.15, 0.16, 0.1], C.beard);
	part('head', [0, 0.02, 0.17], [0.035, 0.05, 0.035], C.skin);
	part('head', [0.065, 0.05, 0.155], [0.024, 0.03, 0.012], C.beard);
	part('head', [-0.065, 0.05, 0.155], [0.024, 0.03, 0.012], C.beard);
	part('head', [0, 0.155, 0.01], [0.215, 0.09, 0.195], C.cap);
	part('head', [0, 0.115, 0.17], [0.09, 0.035, 0.1], C.cap);

	// Arms: sleeve to the elbow, bare forearm, glove, mitt.
	for (const side of ['L', 'R']) {
		part(`arm${side}`, [0, -0.01, 0], [0.11, 0.12, 0.11], C.shirt);
		part(`arm${side}`, [0, -0.18, 0], [0.085, 0.28, 0.085], C.shirt);
		part(`arm${side}`, [0, -0.32, 0], [0.098, 0.08, 0.098], C.shirt);
		part(`forearm${side}`, [0, -0.12, 0], [0.07, 0.2, 0.07], C.skin);
		part(`forearm${side}`, [0, -0.24, 0], [0.082, 0.09, 0.082], C.glove);
		part(`hand${side}`, [0, -0.05, 0.01], [0.075, 0.12, 0.06], C.mitt);
	}

	// Legs: pants, cuff, boot, toe.
	for (const side of ['L', 'R']) {
		part(`hip${side}`, [0, -0.2, 0], [0.115, 0.36, 0.115], C.pants);
		part(`shin${side}`, [0, -0.15, 0], [0.095, 0.28, 0.095], C.pants);
		part(`shin${side}`, [0, -0.29, 0], [0.105, 0.08, 0.105], C.cuff);
		part(`foot${side}`, [0, -0.06, 0.01], [0.1, 0.1, 0.11], C.boot);
		part(`foot${side}`, [0, -0.075, 0.12], [0.088, 0.07, 0.09], C.mitt);
	}

	// The hammer, gripped in the right fist. The haft carries on down the line
	// of the forearm but tipped forward, so that when the elbow extends into a
	// strike the head arrives flat and level — which is what puts it on the
	// anvil face instead of stabbing past it.
	let hammerHead = null;
	if (hammer) {
		const grip = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.6, 0, 0));
		part('handR', [0, -0.2, 0.096], [0.035, 0.34, 0.035], C.haft, grip);
		hammerHead = part('handR', [0, -0.341, 0.192], [0.085, 0.19, 0.085], C.iron, Q_AXIS_X);
		part('handR', [0, -0.341, 0.192], [0.06, 0.24, 0.06], C.iron, Q_AXIS_X);
	}

	return { meshes, materials, apron, hammerHead };
}

return { PALETTE, buildBlacksmith };
})();
