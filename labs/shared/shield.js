/*
 * labs/shared/shield.js — a hexagonal shield, strapped to the left forearm.
 *
 * The obvious shape for this project: the shield *is* the unit prism, squashed
 * flat and stood on edge. Like the other props it is modelled around the origin
 * of the bone it hangs from — here the left forearm, since a shield is strapped
 * to the arm rather than gripped in the fingers — so equipping it is a
 * re-parent and every clip carries it afterwards.
 */

var Hexdelve = Hexdelve || {};

Hexdelve.shield = (function () {
'use strict';

const { hexGeometry, Q_ID } = Hexdelve.hex;

const PI = Math.PI;

const PALETTE = {
	face: '#7d5a34',
	facePale: '#8f6a3f',
	rim: '#6b6f78',
	rimDark: '#54585f',
	boss: '#9aa0a9',
	strap: '#43301f',
	stud: '#8a8f98',
};

// Flat on the grass, face up: the disc already lies in the XY plane, so laying
// it down is the same quarter turn the sword takes.
const GROUND_LIFT = 0.05;
const GROUND_TILT = PI / 2;

const RADIUS = 0.26;

function buildShield() {
	const group = new THREE.Group();
	const materials = new Map();
	const meshes = [];

	/*
	 * The shield sits square on the forearm and faces the way the character
	 * does: the only rotation is the quarter turn that stands the prism on its
	 * edge, and it is the turn that puts the *face* outward once the elbow is
	 * bent into a guard, which is the only way this is ever seen. It is offset
	 * forward rather than outward, because the arm goes *through* the straps on
	 * its back — and canting it about Z put the face at an angle nobody has ever
	 * held a shield at.
	 */
	const plate = new THREE.Group();
	plate.position.set(0.02, -0.14, 0.08);
	plate.rotation.set(-PI / 2, 0, 0);
	group.add(plate);

	function mat(color) {
		if (!materials.has(color)) {
			materials.set(
				color,
				new THREE.MeshPhongMaterial({ color, flatShading: true, shininess: 18, specular: 0x2a2c30 }),
			);
		}
		return materials.get(color);
	}

	function part(pos, scale, color, euler) {
		const m = new THREE.Mesh(hexGeometry(), mat(color));
		m.position.set(pos[0], pos[1], pos[2]);
		if (euler) m.quaternion.setFromEuler(new THREE.Euler(euler[0], euler[1], euler[2]));
		else m.quaternion.copy(Q_ID);
		m.scale.set(scale[0], scale[1], scale[2]);
		m.castShadow = true;
		plate.add(m);
		meshes.push(m);
		return m;
	}

	const C = PALETTE;

	/*
	 * Boards, banded rim, boss. Everything that is meant to read as a border sits
	 * *behind* the face and wider than it — a plate in front of the face at
	 * nearly the same radius simply hides it, which is how this shield spent its
	 * first render as a grey dinner plate.
	 */
	part([0, -0.014, 0], [RADIUS * 1.07, 0.032, RADIUS * 1.07], C.rimDark, [0, PI / 6, 0]);
	part([0, 0, 0], [RADIUS, 0.045, RADIUS], C.face);
	part([0, 0.026, 0], [RADIUS * 0.66, 0.012, RADIUS * 0.66], C.facePale);
	part([0, 0.042, 0], [0.075, 0.045, 0.075], C.boss);
	part([0, 0.066, 0], [0.035, 0.03, 0.035], C.boss);

	// Studs round the rim, one to each face of the hexagon.
	for (let i = 0; i < 6; i++) {
		const a = (i * PI) / 3 + PI / 6;
		part([Math.cos(a) * RADIUS * 0.86, 0.03, Math.sin(a) * RADIUS * 0.86], [0.022, 0.02, 0.022], C.stud);
	}

	// The straps the arm goes through, on the back.
	part([0, -0.04, -0.1], [0.03, 0.03, 0.11], C.strap, [PI / 2, 0, 0]);
	part([0, -0.04, 0.1], [0.03, 0.03, 0.11], C.strap, [PI / 2, 0, 0]);

	return { group, meshes, materials };
}

return { PALETTE, GROUND_LIFT, GROUND_TILT, RADIUS, buildShield };
})();
