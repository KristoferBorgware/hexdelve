/*
 * The three things lying in the grass, and what it means to pick one up.
 *
 * A prop is modelled around the origin of the bone it belongs to. Worn, that
 * bone is where it goes; put down, it needs a place of its own — lifted so the
 * thing rests on the grass rather than floating where a head would have been,
 * and tilted, because a sword lies flat and a helmet stands up.
 *
 * Both of those are now the same sentence: the object's transform says where
 * the prop is. Being carried is being a child of the wearer, with `BoneFollow`
 * writing the bone onto the local transform; being dropped is being a child of
 * the scene, with the lift and the tilt written onto it once. There is one way
 * of drawing a prop and it reads the object's world transform, so nothing about
 * the picture asks which of the two it is.
 *
 * That is worth the change on its own, but the reason it was made is narrower.
 * The old worn path took a pose and a bone name, so a prop could only be
 * carried by the one rig it was authored against, and nothing checked: a helmet
 * on a hellhound would have looked for a `head` bone and drawn itself at the
 * origin without complaint. `BoneFollow` answers that question honestly — it
 * reports whether the bone was there — and a prop whose bone is missing stays
 * where it was put.
 *
 * It is a component for the same reason an actor is: a helmet is not a thing
 * in the world, it is what a thing in the world has. The object is where the
 * helmet is; this is the helmet.
 */

import { quat, worldToAxial, type Axial } from '@hexdelve/shared';
import { Component, type GameObject, type HexInstances, type Model } from '@hexdelve/engine';

import { Actor } from './actor.js';
import { BoneFollow } from './bonefollow.js';

export interface ItemOptions {
	label: string;
	/** The bone it hangs from when worn. */
	bone: string;
	model: Model;
	/** How far to raise it so it sits on the ground. */
	lift: number;
	/** Rotation about X on the ground: 0 stands it up, pi/2 lays it flat. */
	tilt: number;
}

export class Item extends Component {
	readonly label: string;
	readonly bone: string;
	readonly model: Model;
	private readonly lift: number;
	private readonly tilt: number;

	constructor(object: GameObject, options: ItemOptions) {
		super(object);
		this.label = options.label;
		this.bone = options.bone;
		this.model = options.model;
		this.lift = options.lift;
		this.tilt = options.tilt;
	}

	/**
	 * Whether somebody is carrying it.
	 *
	 * Asked of the scene rather than kept in a flag. A flag is a second version
	 * of the truth, and the first thing it does is disagree with the first —
	 * this cannot, because being carried IS being underneath a wearer.
	 */
	get worn(): boolean {
		return this.object.parent?.getComponentInParent(Actor) !== null;
	}

	/** Where it is, which is wherever its object is. */
	get x(): number {
		return this.object.world.position[0];
	}
	get z(): number {
		return this.object.world.position[2];
	}

	get cell(): Axial {
		return worldToAxial(this.x, this.z);
	}

	/**
	 * Put it down in the world, resting on ground level `groundY`.
	 *
	 * The caller re-parents it out of whoever was carrying it; this writes where
	 * it lands. Both are needed and they are deliberately not one call: a prop
	 * being placed at the start of a level was never carried by anybody.
	 */
	ground(x: number, z: number, yaw: number, groundY: number): this {
		this.object.transform.setPosition(x, groundY + this.lift, z);
		quat.fromEulerXYZ(this.object.transform.rotation, this.tilt, yaw, 0);
		return this;
	}

	/**
	 * Hang it on the bone it belongs to, on whoever is picking it up.
	 *
	 * The whole of picking something up: one re-parent. `BoneFollow` puts it
	 * where the bone is on the next solve, and every clip carries it from then
	 * on for free, because it is part of the body's hierarchy rather than a
	 * second thing drawn to look as though it were.
	 */
	equip(wearer: GameObject): this {
		wearer.add(this.object);
		this.object.getComponent(BoneFollow)?.follow();
		return this;
	}

	/** Draw it, wherever its object has ended up. */
	emit(out: HexInstances, alpha = 1): void {
		const where = this.object.world;
		this.model.emitDetached(
			out,
			where.position[0],
			where.position[1],
			where.position[2],
			where.rotation,
			{ alpha },
		);
	}
}
