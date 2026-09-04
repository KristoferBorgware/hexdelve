/*
 * Being carried, expressed as what it is: an object under another object.
 *
 * A prop is modelled around the origin of the bone it belongs to, so a helmet
 * worn on a head is the helmet's parts placed at the head bone. There were two
 * ways of saying that, and only one of them was true.
 *
 * The old way passed the wearer's pose to the prop's own draw call, which then
 * reached into it for a bone by name. Nothing about the prop's position said
 * where it was. Its transform stayed at the origin whether it was on a head or
 * lying in the grass, and the only thing that knew the difference was a flag
 * and a branch in the drawing.
 *
 * This is the other way. The prop's object becomes a CHILD of the wearer's, and
 * this component writes its local transform from the bone every frame. The
 * scene composes that with the wearer's own placement exactly as it composes
 * any parent and child, and the prop is then drawn from its own world transform
 * like anything else. Picking something up is `wearer.add(object)`; putting it
 * down is `root.add(object)` and a place to put it.
 *
 * ## Why the local transform IS the bone
 *
 * A pose is solved in the actor's own space — that is what makes the IK and the
 * hit tests able to work in it — so a bone's `p` and `q` are already a local
 * transform relative to the actor. Writing them straight onto a child of the
 * actor's object and letting `composeWorld` do the rest is not an approximation
 * of what the drawing used to do by hand; it is the same two operations in the
 * same order.
 *
 * ## When it runs
 *
 * After the actor has solved its pose and before the scene composes world
 * transforms. That is a real ordering constraint and it is why the simulation
 * calls `follow` itself rather than this being an ordinary `update`: components
 * update BEFORE the pose is solved, so a follow that ran there would place
 * every prop one frame behind the body carrying it — which looks like a helmet
 * that lags when you turn, and is the kind of thing that gets blamed on the
 * animation.
 */

import { quat } from '@hexdelve/shared';
import { Component, type GameObject } from '@hexdelve/engine';

import { Actor } from './actor.js';

export interface BoneFollowOptions {
	/** The bone this object hangs from, by the name the rig gives it. */
	bone: string;
}

export class BoneFollow extends Component {
	readonly bone: string;

	constructor(object: GameObject, options: BoneFollowOptions) {
		super(object);
		this.bone = options.bone;
	}

	/**
	 * The actor this is being carried by, or null when it is not.
	 *
	 * Found by walking up rather than remembered, so re-parenting is the whole
	 * of picking something up and putting it down: there is no second piece of
	 * state to keep in step, and nothing can be worn according to one of them
	 * and dropped according to the other.
	 */
	get wearer(): Actor | null {
		return this.object.parent?.getComponentInParent(Actor) ?? null;
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
		local.position[0] = pose.p[0];
		local.position[1] = pose.p[1];
		local.position[2] = pose.p[2];
		quat.copy(local.rotation, pose.q);
		return true;
	}
}
