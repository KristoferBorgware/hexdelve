/*
 * labs/shared/rigview.js — drawing a skeleton, and getting a pose onto it.
 *
 * This is the seam between the engine-free half of the project (skeleton data,
 * clips, the animation player) and the renderer. Everything above this file
 * deals in numbers; everything below it deals in meshes.
 */

var Hexdelve = Hexdelve || {};

Hexdelve.rigview = (function () {
'use strict';

const { hexGeometry } = Hexdelve.hex;

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Build a THREE object per bone, wired into the same hierarchy the data
 * describes. Returns { bones, order, group }.
 */
function buildRig(skeleton, parent) {
	const bones = {};
	const group = new THREE.Group();
	parent.add(group);
	for (const spec of skeleton) {
		const node = new THREE.Object3D();
		node.name = spec.name;
		node.position.set(spec.offset[0], spec.offset[1], spec.offset[2]);
		(spec.parent ? bones[spec.parent] : group).add(node);
		bones[spec.name] = node;
	}
	return { bones, order: skeleton.map((b) => b.name), group, skeleton };
}

// Dense pose (flat arrays, from the animation player) → bone transforms.
function applyPose(rig, boneNames, pose) {
	for (let i = 0; i < boneNames.length; i++) {
		const node = rig.bones[boneNames[i]];
		if (!node) continue;
		const o = i * 3;
		node.rotation.set(pose.rot[o], pose.rot[o + 1], pose.rot[o + 2]);
		const spec = rig.skeleton[i];
		node.position.set(
			spec.offset[0] + pose.pos[o],
			spec.offset[1] + pose.pos[o + 1],
			spec.offset[2] + pose.pos[o + 2],
		);
	}
}

// Sparse pose ({ bone: { rot, pos } }) → bone transforms. Bones the pose does
// not mention snap back to rest.
function applySparsePose(rig, pose) {
	for (const spec of rig.skeleton) {
		const node = rig.bones[spec.name];
		const entry = pose[spec.name];
		const rot = entry && entry.rot;
		const pos = entry && entry.pos;
		node.rotation.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0);
		node.position.set(
			spec.offset[0] + (pos ? pos[0] : 0),
			spec.offset[1] + (pos ? pos[1] : 0),
			spec.offset[2] + (pos ? pos[2] : 0),
		);
	}
}

/**
 * The visible skeleton: a joint at every bone and a shaft towards every child,
 * generated from the hierarchy rather than modelled. Add a bone to the data
 * and it shows up here for free.
 */
function buildSkeletonView(rig, skeleton, tips = []) {
	const meshes = [];
	const boneMat = new THREE.MeshPhongMaterial({
		color: 0xf2eddd,
		emissive: 0x35301f,
		flatShading: true,
		shininess: 30,
	});
	const jointMat = new THREE.MeshPhongMaterial({
		color: 0xd8cfae,
		emissive: 0x2e2818,
		flatShading: true,
		shininess: 30,
	});

	function hex(parentName, pos, scale, quat, mat) {
		const m = new THREE.Mesh(hexGeometry(), mat);
		m.position.set(pos[0], pos[1], pos[2]);
		if (quat) m.quaternion.copy(quat);
		m.scale.set(scale[0], scale[1], scale[2]);
		rig.bones[parentName].add(m);
		meshes.push(m);
		return m;
	}

	function shaft(parentName, to) {
		const v = new THREE.Vector3(to[0], to[1], to[2]);
		const len = v.length();
		if (len < 1e-4) return;
		const q = new THREE.Quaternion().setFromUnitVectors(UP, v.clone().normalize());
		hex(parentName, [v.x / 2, v.y / 2, v.z / 2], [0.028, len, 0.028], q, boneMat);
	}

	for (const spec of skeleton) {
		hex(spec.name, [0, 0, 0], [0.055, 0.075, 0.055], null, jointMat);
	}
	for (const spec of skeleton) {
		if (spec.parent) shaft(spec.parent, spec.offset);
	}
	for (const tip of tips) shaft(tip.bone, tip.to);

	return { meshes, materials: [boneMat, jointMat] };
}

return { buildRig, applyPose, applySparsePose, buildSkeletonView };
})();
