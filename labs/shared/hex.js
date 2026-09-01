/*
 * labs/shared/hex.js — hexagonal prism helpers (presentation).
 *
 * One geometry for the whole project: a unit hex prism, radius 1, height 1,
 * axis +Y, with a vertex pointing along +Z. Everything in these labs is that
 * shape under a different matrix.
 */

var Hexdelve = Hexdelve || {};

Hexdelve.hex = (function () {
'use strict';

const SQRT3 = Math.sqrt(3);

let sharedGeo = null;

function hexGeometry() {
	if (!sharedGeo) sharedGeo = new THREE.CylinderGeometry(1, 1, 1, 6);
	return sharedGeo;
}

// Lying down with the axis along world X or Z, flat side down so prisms stack.
const Q_ID = new THREE.Quaternion();
const Q_AXIS_X = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
const Q_AXIS_Z = new THREE.Quaternion()
	.setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0))
	.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 6, 0)));

function makeRandom(seed) {
	let a = seed >>> 0;
	return function random() {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function tintColor(random, hex, spread = 0.05) {
	const c = new THREE.Color(hex);
	c.offsetHSL((random() - 0.5) * 0.015, (random() - 0.5) * 0.05, (random() - 0.5) * spread);
	return c;
}

// Collects static prisms and bakes them into one InstancedMesh.
class HexField {
	constructor() {
		this.blocks = [];
	}

	// `meta` rides along with the instance so a raycast hit can be turned back
	// into whatever the caller cared about — usually the grid cell it belongs to.
	push(matrix, color, meta) {
		this.blocks.push({
			matrix,
			color: color instanceof THREE.Color ? color : new THREE.Color(color),
			meta: meta === undefined ? null : meta,
		});
	}

	compose(pos, quat, scale, color, meta) {
		this.push(
			new THREE.Matrix4().compose(
				new THREE.Vector3(pos[0], pos[1], pos[2]),
				quat || Q_ID,
				new THREE.Vector3(scale[0], scale[1], scale[2]),
			),
			color,
			meta,
		);
	}

	// A prism standing on baseY.
	upright(x, baseY, z, radius, height, color, yawDeg = 0, meta) {
		const q = yawDeg
			? new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (yawDeg * Math.PI) / 180, 0))
			: Q_ID;
		this.compose([x, baseY + height / 2, z], q, [radius, height, radius], color, meta);
	}

	// A prism lying along world X or Z.
	lying(axis, cx, cy, cz, radius, length, color) {
		this.compose([cx, cy, cz], axis === 'x' ? Q_AXIS_X : Q_AXIS_Z, [radius, length, radius], color);
	}

	build(material) {
		const mesh = new THREE.InstancedMesh(hexGeometry(), material, this.blocks.length);
		for (let i = 0; i < this.blocks.length; i++) {
			mesh.setMatrixAt(i, this.blocks[i].matrix);
			mesh.setColorAt(i, this.blocks[i].color);
		}
		mesh.instanceMatrix.needsUpdate = true;
		mesh.instanceColor.needsUpdate = true;
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		// Raycasting an InstancedMesh reports an instanceId; this turns that
		// back into the caller's data.
		mesh.userData.meta = this.blocks.map((b) => b.meta);
		return mesh;
	}

	get count() {
		return this.blocks.length;
	}
}

function groundMaterial() {
	return new THREE.MeshPhongMaterial({
		color: 0xffffff,
		flatShading: true,
		shininess: 6,
		specular: 0x1a1a1a,
	});
}

return { SQRT3, hexGeometry, Q_ID, Q_AXIS_X, Q_AXIS_Z, makeRandom, tintColor, HexField, groundMaterial };
})();
