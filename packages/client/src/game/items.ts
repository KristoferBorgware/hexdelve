/*
 * The three things lying in the grass, and what it means to pick one up.
 *
 * A prop is modelled around the origin of the bone it belongs to, so worn, its
 * transform is the identity and it goes through the rig like any other part of
 * the body — every clip carries it for free, and there is no held version of
 * the model to keep in step with the dropped one.
 *
 * Put down, the same parts are drawn through one transform of their own:
 * lifted so the thing rests on the grass rather than floating where a head
 * would have been, and tilted, because a sword lies flat and a helmet stands
 * up. Picking it up changes which of the two paths runs, and nothing else.
 *
 * It is a component for the same reason an actor is: a helmet is not a thing
 * in the world, it is what a thing in the world has. The object is where the
 * helmet lies; this is the helmet. Once prefabs arrive, being worn will be
 * exactly what it sounds like — the object moves under the hand's — and the
 * two drawing paths below collapse into one.
 */

import { quat, worldToAxial, type Axial } from '@hexdelve/shared';
import { Component, type GameObject, type HexInstances, type Model, type WorldPose } from '@hexdelve/engine';

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

	worn = false;
	x = 0;
	z = 0;
	cell: Axial = { q: 0, r: 0 };

	private groundY = 0;
	// The ground yaw and tilt live in this quaternion rather than as separate
	// fields, because that is the only form the emit path wants them in.
	private readonly groundRotation = quat.quat();

	constructor(object: GameObject, options: ItemOptions) {
		super(object);
		this.label = options.label;
		this.bone = options.bone;
		this.model = options.model;
		this.lift = options.lift;
		this.tilt = options.tilt;
	}

	/** Put it down in the world, resting on ground level `groundY`. */
	ground(x: number, z: number, yaw: number, groundY: number): this {
		this.x = x;
		this.z = z;
		this.groundY = groundY;
		this.cell = worldToAxial(x, z);
		this.worn = false;
		quat.fromEulerXYZ(this.groundRotation, this.tilt, yaw, 0);
		return this;
	}

	/** Hang it on its bone. Worn, its transform is the identity. */
	equip(): this {
		this.worn = true;
		return this;
	}

	/**
	 * Draw it, wherever it currently is.
	 *
	 * `world` and the actor's placement are only read when it is worn — the
	 * grounded path does not touch the rig at all, which is what keeps a
	 * dropped sword from following the man around.
	 */
	emit(
		out: HexInstances,
		world: WorldPose,
		actorX: number,
		actorY: number,
		actorZ: number,
		actorYaw: number,
		alpha = 1,
	): void {
		if (this.worn) {
			this.model.emit(out, world, actorX, actorY, actorZ, actorYaw, { alpha });
		} else {
			this.model.emitDetached(
				out,
				this.x,
				this.groundY + this.lift,
				this.z,
				this.groundRotation,
				{ alpha },
			);
		}
	}
}
