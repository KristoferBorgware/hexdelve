/*
 * labs/shared/helmet.js — a helmet, as a prop.
 *
 * The characters are built by hanging prisms on bones; a prop has no bones, so
 * it is built in its own local space and handed back as one group. That group
 * is deliberately centred on the head bone's origin rather than on the
 * helmet's own middle: parent it to `head` at [0, 0, 0] and it is worn, add it
 * to the scene lifted by GROUND_LIFT and it is standing on the ground. Picking
 * it up is then a re-parent and nothing else — no second model, no offsets to
 * keep in step.
 *
 * The shape is the closed Corinthian kind: a swept-back skull, a nose guard
 * down the middle and cheek plates flaring past the jaw, with the eye slits
 * left as the gaps between them.
 */

var Hexdelve = Hexdelve || {};

Hexdelve.helmet = (function () {
'use strict';

const { hexGeometry, Q_ID } = Hexdelve.hex;

const PI = Math.PI;

const PALETTE = {
	steel: '#4a5058',
	steelDark: '#3a4046',
	steelLight: '#5d646d',
	rim: '#727a84',
	liner: '#2a2e33',
};

// How far to lift the group so the helmet stands on the ground instead of
// floating where a head would have been.
const GROUND_LIFT = 0.2;

function buildHelmet() {
	const group = new THREE.Group();
	const materials = new Map();
	const meshes = [];

	function mat(color) {
		if (!materials.has(color)) {
			materials.set(
				color,
				new THREE.MeshPhongMaterial({ color, flatShading: true, shininess: 40, specular: 0x30353c }),
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
		m.receiveShadow = true;
		group.add(m);
		meshes.push(m);
		return m;
	}

	const C = PALETTE;

	/*
	 * Everything here is laid out against the head it has to fit, which in this
	 * space (the head bone's origin) is a prism of radius 0.18 by 0.165 running
	 * from y -0.095 to 0.135, with the brows at y 0.055, the nose reaching
	 * z 0.197 and the beard hanging to y -0.165. So the shell stops at y 0.08 —
	 * the brow line of that face, not of an imagined one — and the eye slits sit
	 * where the eyes actually are. Get this wrong and the helmet is a bucket
	 * with a nose sticking out of it.
	 */

	// The skull: three courses, each turned and tipped further back than the one
	// below, which is what sweeps the crown back over the neck. Fewer, larger
	// pieces read as one helmet; a tall stack of thin rings reads as a cake.
	const SKULL = [
		[0.155, 0, 0.207, 0.195, 0.155, 0, 0, C.steel],
		[0.245, -0.03, 0.15, 0.145, 0.105, 15, -0.18, C.steelLight],
		[0.293, -0.078, 0.078, 0.083, 0.1, -10, -0.45, C.steelLight],
	];
	for (const [y, z, rx, rz, h, yawDeg, tilt, color] of SKULL) {
		part([0, y, z], [rx, h, rz], color, [tilt, (yawDeg * PI) / 180, 0]);
	}

	/*
	 * Below the brow. The back and sides are one collar pulled backwards, so its
	 * front vertex stops short of the face; a post carries the brow down outside
	 * each eye; the nose guard comes down the centre line, standing proud of the
	 * nose it covers. What is left between post, nose guard and brow is the eye
	 * slit — not cut out of anything, just the space no piece fills.
	 */
	part([0, 0.068, 0.135], [0.168, 0.05, 0.062], C.steel, [0.1, 0, 0]);
	part([0, -0.01, -0.05], [0.201, 0.19, 0.14], C.steel);
	part([0, 0.0, 0.178], [0.038, 0.16, 0.052], C.steelLight, [0.05, 0, 0]);
	part([0, -0.1, 0.168], [0.045, 0.05, 0.04], C.rim, [0.2, 0, 0]);
	for (const side of [1, -1]) {
		part([side * 0.152, 0.02, 0.105], [0.055, 0.13, 0.08], C.steel, [0, (side * -12 * PI) / 180, 0]);
	}

	/*
	 * Cheek plates: prisms laid on their side so each is a flat plate, hanging
	 * from the collar past the jaw and flared out at the bottom. They stand as
	 * far forward as the shell does, because the face behind them has a beard
	 * that reaches almost that far and would otherwise come through the steel.
	 * The gap left between them is the mouth; the small plate behind each closes
	 * the side down to the neck guard.
	 */
	for (const side of [1, -1]) {
		part([side * 0.108, -0.075, 0.172], [0.085, 0.046, 0.115], C.steel, [PI / 2 + 0.05, 0, side * 0.12]);
		part([side * 0.183, -0.07, -0.005], [0.075, 0.045, 0.085], C.steelDark, [0, 0, side * (PI / 2 + 0.08)]);
	}
	part([0, -0.035, -0.185], [0.176, 0.05, 0.09], C.steel, [PI / 2 + 0.22, 0, 0]);
	part([0, -0.105, -0.205], [0.14, 0.045, 0.065], C.steelDark, [PI / 2 + 0.42, 0, 0]);

	/*
	 * Two dark blocks well inside the shell: one behind the eye slits, one down
	 * where the jaw would be. From outside they are invisible; through the slits
	 * and the mouth they are what makes the helmet read as hollow rather than as
	 * a window straight through it. Worn, the head fills the upper one and the
	 * lower one is empty air under the chin, so neither is ever in the way.
	 */
	part([0, 0.07, -0.005], [0.172, 0.22, 0.158], C.liner);
	part([0, -0.09, 0.0], [0.15, 0.16, 0.135], C.liner);

	return { group, meshes, materials };
}

return { PALETTE, GROUND_LIFT, buildHelmet };
})();
