/*
 * labs/shared/sword.js — a sword, modelled around the fist that holds it.
 *
 * Like ../shared/helmet.js, the origin is not the middle of the object: it is
 * the origin of the bone it will hang from, here the right hand. The grip
 * closes where the fist actually is, so equipping it is a re-parent and
 * nothing else, and every clip in ../shared/clips.js swings it correctly
 * without knowing it exists.
 *
 * The blade carries on down the line of the forearm, tipped a little forward
 * out of the wrist, which is what makes the swing in clips.js read as a slash
 * arriving edge-first rather than a bar being waved.
 */

var Hexdelve = Hexdelve || {};

Hexdelve.sword = (function () {
'use strict';

const { hexGeometry, Q_ID } = Hexdelve.hex;

const PI = Math.PI;

const PALETTE = {
	steel: '#b9bec7',
	edge: '#d9dee5',
	fuller: '#9aa1ab',
	guard: '#8a6a3a',
	guardDark: '#6d5129',
	grip: '#46301f',
	wrap: '#5a4029',
};

// How far to lift the group so a sword laid on the grass rests on it, and the
// tilt that lays it down: the blade runs down -Y, so a quarter turn about X
// puts it flat along the ground.
const GROUND_LIFT = 0.04;
const GROUND_TILT = PI / 2;

// The blade is built straight down its own axis and the whole thing is then
// tipped out of the wrist by LEAN, so the numbers below read as "how far down
// the blade" rather than as a pile of rotated offsets. It also means the point
// can be derived rather than guessed: TIP is where the tip actually ends up in
// the hand bone's space, and the lab measures its reach from that.
const LEAN = -0.22;
const BLADE_END = -0.92;
const TIP = [0, BLADE_END * Math.cos(LEAN), BLADE_END * Math.sin(LEAN)];

function buildSword() {
	const group = new THREE.Group();
	const materials = new Map();
	const meshes = [];

	// Everything hangs off the leaning axis, not off the group itself.
	const blade = new THREE.Group();
	blade.rotation.set(LEAN, 0, 0);
	group.add(blade);

	function mat(color) {
		if (!materials.has(color)) {
			materials.set(
				color,
				new THREE.MeshPhongMaterial({ color, flatShading: true, shininess: 60, specular: 0x444a52 }),
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
		blade.add(m);
		meshes.push(m);
		return m;
	}

	const C = PALETTE;

	// Grip in the fist, its wrapping, and the pommel above it.
	part([0, 0.04, 0], [0.032, 0.05, 0.032], C.guardDark);
	part([0, -0.03, 0], [0.026, 0.15, 0.026], C.grip);
	part([0, -0.06, 0], [0.03, 0.02, 0.03], C.wrap);
	part([0, -0.005, 0], [0.03, 0.02, 0.03], C.wrap);

	// Cross guard: a bar lying along the character's X, which is most of what
	// makes the silhouette a sword rather than a stick.
	part([0, -0.12, 0], [0.028, 0.2, 0.028], C.guard, [0, 0, PI / 2]);
	part([0, -0.12, 0], [0.045, 0.05, 0.045], C.guard);

	/*
	 * Blade: flat in Z, so the edges are at ±X, which is where the two bright
	 * strips go. The fuller is a groove down the middle of the flat and has to
	 * stay inside the blade's thickness — proud of it, it turns the whole sword
	 * into a pale plank from any angle.
	 */
	part([0, -0.44, 0], [0.046, 0.6, 0.021], C.steel);
	part([0, -0.44, 0], [0.016, 0.6, 0.023], C.fuller);
	part([0.04, -0.44, 0], [0.009, 0.6, 0.013], C.edge);
	part([-0.04, -0.44, 0], [0.009, 0.6, 0.013], C.edge);
	part([0, -0.79, 0], [0.03, 0.13, 0.017], C.steel);
	part([0, -0.87, 0], [0.013, 0.06, 0.009], C.steel);

	return { group, meshes, materials };
}

return { PALETTE, GROUND_LIFT, GROUND_TILT, TIP, buildSword };
})();
