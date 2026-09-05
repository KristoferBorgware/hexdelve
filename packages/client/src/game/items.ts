/*
 * A thing that can be picked up.
 *
 * Everything about where it is belongs to components beside this one. `Attach`
 * says which bone it hangs from and how it lies when it is set down;
 * `MeshRenderer` draws it from wherever the object ended up. What is left here
 * is the one thing neither of those is: whether the game may pick it up, and
 * what it is called when it does.
 *
 * Being carried is being a child of the wearer; being dropped is being a child
 * of the scene with a place written on it. Both are the object's own transform,
 * so nothing about the picture asks which of the two it is.
 */

import { worldToAxial, type Axial } from '@hexdelve/shared';
import { Attach, Component, MeshRenderer, param, type GameObject } from '@hexdelve/engine';

export class Item extends Component {
	/** What a readout calls it. The object's own name unless the file says. */
	label = param('', { label: 'Label', hint: 'What a readout calls it' });

	private readonly attachment: Attach;
	private readonly renderer: MeshRenderer;

	constructor(object: GameObject) {
		super(object);
		const attachment = object.getComponent(Attach);
		const renderer = object.getComponent(MeshRenderer);
		if (!attachment || !renderer) {
			throw new Error(`'${object.name}' needs an attach and a mesh before an item on them`);
		}
		this.attachment = attachment;
		this.renderer = renderer;
	}

	/** What it is called: what the file said, or what the object is named. */
	get name(): string {
		return this.label || this.object.name;
	}

	/** The bone it hangs from when worn. */
	get bone(): string {
		return this.attachment.bone;
	}

	/**
	 * Whether somebody is carrying it.
	 *
	 * Asked of the scene rather than kept in a flag. A flag is a second version
	 * of the truth, and the first thing it does is disagree with the first —
	 * this cannot, because being carried IS being underneath a wearer.
	 */
	get worn(): boolean {
		return this.attachment.worn;
	}

	/** Where it is, which is wherever its object is. */
	get x(): number {
		return this.object.world.position[0]!;
	}
	get z(): number {
		return this.object.world.position[2]!;
	}

	get cell(): Axial {
		return worldToAxial(this.x, this.z);
	}

	/**
	 * Put it down in the world, resting on ground level `groundY`.
	 *
	 * The caller re-parents it out of whoever was carrying it; the attachment
	 * writes where it lands. Both are needed and they are deliberately not one
	 * call: a prop placed at the start of a level was never carried by anybody.
	 */
	ground(x: number, z: number, yaw: number, groundY: number): this {
		this.attachment.ground(x, z, yaw, groundY);
		return this;
	}

	/**
	 * Hang it on the bone it belongs to, on whoever is picking it up.
	 *
	 * The whole of picking something up: one re-parent. `Attach` puts it where
	 * the bone is on the next solve, and every clip carries it from then on for
	 * free, because it is part of the body's hierarchy rather than a second
	 * thing drawn to look as though it were.
	 */
	equip(wearer: GameObject): this {
		wearer.add(this.object);
		this.attachment.follow();
		return this;
	}

	/** Draw it, wherever its object has ended up. */
	emit(out: import('@hexdelve/engine').HexInstances, alpha = 1): void {
		this.renderer.emit(out, { alpha });
	}
}
