/*
 * labs/shared/props.js — things lying about that a character can pick up.
 *
 * A prop has no bones. It is one group, and the whole of "equipping" it is
 * which node that group hangs from: the scene, or a bone. So each of these is
 * modelled around the origin of the bone it belongs to — the helmet around the
 * head, the sword around the fist, the shield around the forearm — and worn,
 * its transform is the identity. There is no second model for the held version
 * and no offsets to keep in step, and once it is on, every clip carries it for
 * free.
 *
 * On the ground it is the same group under a different transform: lifted so it
 * rests on the grass rather than floating where a head would have been, and
 * tilted, because a sword lies flat and a helmet stands up.
 */

var Hexdelve = Hexdelve || {};

Hexdelve.props = (function () {
'use strict';

const { worldToAxial } = Hexdelve.hexgrid;

/**
 * @param {THREE.Scene} scene
 * @param {object} spec
 *   build   () => { group, meshes }  the model, in its bone's space
 *   bone    the bone it hangs from when worn
 *   lift    how far to raise it so it sits on the ground
 *   tilt    rotation about X on the ground: 0 stands it up, π/2 lays it flat
 *   label   what to call it in a readout
 */
function makeItem(scene, spec) {
	const built = spec.build();

	const item = {
		label: spec.label,
		bone: spec.bone,
		group: built.group,
		meshes: new Set(built.meshes),
		materials: built.materials,
		worn: false,
		x: 0,
		z: 0,
		cell: null,

		/** Put it down in the world, resting on ground level `groundY`. */
		ground: function (x, z, yaw, groundY) {
			scene.add(item.group); // re-parents it out of whatever bone held it
			item.group.position.set(x, groundY + (spec.lift || 0), z);
			item.group.rotation.set(spec.tilt || 0, yaw, 0);
			item.x = x;
			item.z = z;
			item.cell = worldToAxial(x, z);
			item.worn = false;
			return item;
		},

		/** Hang it on its bone. Worn, its transform is the identity. */
		equip: function (rig) {
			rig.bones[spec.bone].add(item.group);
			item.group.position.set(0, 0, 0);
			item.group.rotation.set(0, 0, 0);
			item.worn = true;
			return item;
		},
	};

	return item;
}

return { makeItem: makeItem };
})();
