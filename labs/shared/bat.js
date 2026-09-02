/*
 * labs/shared/bat.js — the bat: hexagonal prisms hung on its own rig.
 *
 * Same exercise as ../shared/blacksmith.js and ../shared/wanderer.js, on a
 * skeleton that is nothing like theirs (../shared/batrig.js). Every part is the
 * unit hex prism under a different scale and rotation, parented to a bone, and
 * nothing here is animated directly.
 *
 * The wing is the interesting part. It is built the way the animal is: a spar
 * along each of the four bones, and a membrane patch trailing behind each spar
 * — a hexagonal prism squashed flat in Y, so it is a sheet lying in the plane
 * of the wing. Because each patch belongs to one bone, folding the bones folds
 * the wing: the sheets come together with the spars and end up wrapped round
 * the body without a single line of cloth simulation.
 */

var Hexdelve = Hexdelve || {};

Hexdelve.bat = (function () {
'use strict';

const { hexGeometry, Q_ID } = Hexdelve.hex;

const PI = Math.PI;

const PALETTE = {
	fur: '#4a3a3c',
	furDark: '#372a2d',
	belly: '#5b4a49',
	membrane: '#6b4f57',
	membraneDark: '#5a4149',
	spar: '#2e2428',
	ear: '#57424a',
	snout: '#6d5257',
	eye: '#ffb648',
	claw: '#cfc4b6',
	fang: '#efe8dc',
};

function buildBat(rig) {
	const materials = new Map();
	const meshes = [];

	function mat(color) {
		if (!materials.has(color)) {
			materials.set(
				color,
				new THREE.MeshPhongMaterial({ color, flatShading: true, shininess: 12, specular: 0x241d22 }),
			);
		}
		return materials.get(color);
	}

	function part(boneName, pos, scale, color, euler) {
		const m = new THREE.Mesh(hexGeometry(), mat(color));
		m.position.set(pos[0], pos[1], pos[2]);
		if (euler) m.quaternion.setFromEuler(new THREE.Euler(euler[0], euler[1], euler[2]));
		else m.quaternion.copy(Q_ID);
		m.scale.set(scale[0], scale[1], scale[2]);
		m.castShadow = true;
		rig.bones[boneName].add(m);
		meshes.push(m);
		return m;
	}

	// A thin prism spanning two points in a bone's local space — the wing spars
	// and the limbs are all this.
	function strut(boneName, from, to, radius, color) {
		const a = new THREE.Vector3(from[0], from[1], from[2]);
		const b = new THREE.Vector3(to[0], to[1], to[2]);
		const dir = new THREE.Vector3().subVectors(b, a);
		const m = new THREE.Mesh(hexGeometry(), mat(color));
		m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
		m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
		m.scale.set(radius, dir.length(), radius);
		m.castShadow = true;
		rig.bones[boneName].add(m);
		meshes.push(m);
		return m;
	}

	const C = PALETTE;

	/*
	 * Body: a prism lying along Z, nose to tail, with the fur darker on top than
	 * underneath. It is tipped head-up so that the perch pose, which pitches the
	 * whole root forward, ends with the animal hunched rather than face down.
	 */
	part('root', [0, 0, -0.02], [0.19, 0.52, 0.2], C.fur, [PI / 2, 0, 0]);
	part('root', [0, -0.1, -0.02], [0.15, 0.34, 0.13], C.belly, [PI / 2, 0, 0]);
	part('chest', [0, 0, 0.02], [0.17, 0.24, 0.18], C.fur, [PI / 2, 0, 0]);
	part('neck', [0, 0, 0.03], [0.1, 0.14, 0.1], C.furDark, [PI / 2, 0, 0]);

	// Head, snout and jaw. The eyes are small and set wide; the ears are the
	// silhouette, so they are big, thin and raked back.
	part('head', [0, 0.01, 0.02], [0.15, 0.17, 0.15], C.fur, [PI / 2, 0, 0]);
	part('head', [0, -0.01, 0.13], [0.08, 0.1, 0.08], C.snout, [PI / 2, 0, 0]);
	part('head', [0.055, 0.05, 0.11], [0.026, 0.03, 0.026], C.eye);
	part('head', [-0.055, 0.05, 0.11], [0.026, 0.03, 0.026], C.eye);
	part('jaw', [0, -0.01, 0.05], [0.07, 0.06, 0.11], C.snout, [PI / 2, 0, 0]);
	part('jaw', [0.032, 0.01, 0.11], [0.012, 0.035, 0.012], C.fang, [0.4, 0, 0]);
	part('jaw', [-0.032, 0.01, 0.11], [0.012, 0.035, 0.012], C.fang, [0.4, 0, 0]);
	for (const side of ['L', 'R']) {
		const s = side === 'L' ? 1 : -1;
		part(`ear${side}`, [s * 0.01, 0.09, -0.03], [0.055, 0.2, 0.02], C.ear, [-0.35, 0, s * 0.12]);
		part(`ear${side}`, [s * 0.01, 0.18, -0.06], [0.03, 0.09, 0.016], C.ear, [-0.5, 0, s * 0.12]);
	}

	/*
	 * The wings. Four segments a side; for each, a spar along the bone and a
	 * membrane patch behind it, widening outboard the way a real wing does.
	 * `x` is the length of that bone, so the spar always spans it exactly —
	 * change a bone in batrig.js and the wing follows.
	 */
	const SEGMENTS = [
		{ bone: 'arm', x: 0.34, spar: 0.035, patch: [0.23, 0.016, 0.3], at: [0.17, -0.01, -0.24] },
		{ bone: 'fore', x: 0.4, spar: 0.03, patch: [0.26, 0.016, 0.32], at: [0.2, -0.005, -0.27] },
		{ bone: 'hand', x: 0.26, spar: 0.025, patch: [0.19, 0.014, 0.29], at: [0.13, 0, -0.25] },
		{ bone: 'digit', x: 0.24, spar: 0.02, patch: [0.16, 0.014, 0.24], at: [0.11, 0, -0.19] },
	];
	for (const side of ['L', 'R']) {
		const s = side === 'L' ? 1 : -1;
		for (let i = 0; i < SEGMENTS.length; i++) {
			const seg = SEGMENTS[i];
			const bone = seg.bone + side;
			strut(bone, [0, 0, 0], [s * seg.x, 0, 0], seg.spar, C.spar);
			part(
				bone,
				[s * seg.at[0], seg.at[1], seg.at[2]],
				seg.patch,
				i % 2 ? C.membraneDark : C.membrane,
				[0, s * 0.12, 0],
			);
		}
		// A thumb claw at the wrist, which is what a bat walks and hangs on.
		part(`hand${side}`, [s * 0.03, 0.05, 0.03], [0.018, 0.09, 0.018], C.claw, [0.3, 0, s * 0.5]);
	}

	// Hind legs, and the membrane stretched between them and the tail.
	for (const side of ['L', 'R']) {
		const s = side === 'L' ? 1 : -1;
		strut(`leg${side}`, [0, 0, 0], [0, -0.21, 0], 0.03, C.spar);
		part(`leg${side}`, [0, -0.1, 0], [0.045, 0.16, 0.05], C.furDark);
		part(`foot${side}`, [0, -0.02, 0.02], [0.04, 0.05, 0.06], C.furDark);
		for (let k = -1; k <= 1; k++) {
			part(`foot${side}`, [k * 0.025, -0.04, 0.055], [0.012, 0.055, 0.012], C.claw, [0.9, 0, 0]);
		}
	}
	part('tail', [0, -0.02, -0.09], [0.14, 0.014, 0.13], C.membraneDark);
	strut('tail', [0, 0, 0], [0, -0.03, -0.18], 0.018, C.spar);

	return { meshes, materials };
}

return { PALETTE, buildBat };
})();
