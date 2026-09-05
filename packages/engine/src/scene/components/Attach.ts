/*
 * Being carried, expressed as what it is: an object under another object.
 *
 * A prop is modelled around the origin of the bone it belongs to, so a helmet
 * worn on a head is the helmet's parts placed at the head bone. Wearing it is
 * therefore one re-parent: the prop's object becomes a child of the wearer's,
 * this writes its local transform from the bone every frame, and the scene
 * composes that with the wearer's own placement exactly as it composes any
 * parent and child. Putting it down is the reverse re-parent and a place to put
 * it, which `ground` writes.
 *
 * Nothing about the drawing asks which of the two it is, because the object's
 * world transform already says.
 *
 * ## Why the local transform IS the bone
 *
 * A pose is solved in the rig's own space — that is what makes the IK and the
 * hit tests able to work in it — so a bone's `p` and `q` are already a local
 * transform relative to the object carrying the rig. Writing them straight onto
 * a child of that object and letting `composeWorld` do the rest is the same two
 * operations in the same order the drawing would have done by hand.
 *
 * ## When it runs
 *
 * After the wearer has solved its pose and before the scene composes world
 * transforms. That is a real ordering constraint, and it is why a caller runs
 * `follow` itself rather than this being an ordinary `update`: components
 * update BEFORE the pose is solved, so a follow that ran there would place
 * every prop one frame behind the body carrying it — which looks like a helmet
 * that lags when you turn, and is the kind of thing that gets blamed on the
 * animation.
 */

import { quat } from '@hexdelve/shared';

import { Component } from './Component.js';
import { param } from './parameters.js';
import { Rig } from './Rig.js';

export class Attach extends Component {
	/**
	 * The bone this object hangs from, by the name the rig gives it.
	 *
	 * Declared with `param` rather than taken as a constructor argument, which
	 * is how any component says a field is somebody else's to set: the entity
	 * file names the bone, `attachComponent` applies it, and an editor showing
	 * this component shows this field. A component that declares nothing shows
	 * nothing.
	 */
	bone = param('', { label: 'Bone', hint: "The bone in the wearer's rig" });

	/** How far to raise it so it rests on the grass rather than in it. */
	lift = param(0, { label: 'Lift', min: 0, max: 2 });

	/** Rotation about X on the ground: 0 stands it up, pi/2 lays it flat. */
	tilt = param(0, { label: 'Tilt', min: -Math.PI, max: Math.PI });

	/**
	 * The rig this is being carried by, or null when it is not.
	 *
	 * Found by walking up rather than remembered, so re-parenting is the whole
	 * of picking something up and putting it down: there is no second piece of
	 * state to keep in step, and nothing can be worn according to one of them
	 * and dropped according to the other.
	 */
	get wearer(): Rig | null {
		return this.object.parent?.getComponentInParent(Rig) ?? null;
	}

	/** Whether somebody is carrying it. */
	get worn(): boolean {
		return this.wearer !== null;
	}

	/**
	 * Put this object where its bone is, in the wearer's space.
	 *
	 * Does nothing at all when there is no wearer — the object is then standing
	 * somewhere in the world on its own transform, and overwriting it is exactly
	 * the bug this component exists to make impossible.
	 *
	 * Returns whether it followed, which is worth knowing: a rig without the
	 * named bone is a prop authored for a different body, and it stays where it
	 * was put rather than snapping to the origin.
	 */
	follow(): boolean {
		const pose = this.wearer?.world[this.bone];
		if (!pose) return false;

		const local = this.object.transform;
		local.position[0] = pose.p[0]!;
		local.position[1] = pose.p[1]!;
		local.position[2] = pose.p[2]!;
		quat.copy(local.rotation, pose.q);
		return true;
	}

	/**
	 * Set it down in the world, resting on ground level `groundY`.
	 *
	 * The caller re-parents it out of whoever was carrying it; this writes where
	 * it lands. Both are needed and they are deliberately not one call: a prop
	 * placed at the start of a level was never carried by anybody.
	 */
	ground(x: number, z: number, yaw: number, groundY: number): void {
		this.object.transform.setPosition(x, groundY + this.lift, z);
		quat.fromEulerXYZ(this.object.transform.rotation, this.tilt, yaw, 0);
	}
}
