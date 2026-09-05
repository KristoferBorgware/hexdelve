/*
 * The prisms an object is drawn as.
 *
 * A mesh is a list of hex prisms in bone space, built once and drawn from many
 * transforms — which is the whole reason a mesh and an object are different
 * things, and why two wanderers cost one mesh.
 *
 * ## The two ways it is drawn
 *
 * Through a pose, or not. A body's parts are hung on bones that move, so it is
 * drawn through the `Rig` on its object or above it: bone transform first, then
 * where the object is standing. A prop's parts are modelled around the origin
 * of the one bone it belongs to, so there is no pose to look anything up in —
 * it is drawn from the object's own world transform, and the object is put in
 * the right place by `Attach` or by whoever set it down in the grass.
 *
 * `Attach` is what says which of the two this is. That is not a guess about the
 * pose being empty: a thing that hangs off somebody else's bone is exactly a
 * thing whose parts are in that bone's space, and it is the same sentence.
 */

import type { MeshAsset } from '../../assets/mesh.js';
import type { EmitOptions, Model } from '../Model.js';
import type { HexInstances } from '../HexInstances.js';
import type { GameObject } from '../GameObject.js';
import { Attach } from './Attach.js';
import { Component } from './Component.js';
import { Rig } from './Rig.js';

export class MeshRenderer extends Component {
	readonly asset: MeshAsset;
	private built: Model | null = null;

	constructor(object: GameObject, asset: MeshAsset) {
		super(object);
		this.asset = asset;
	}

	/** The prisms. Built on first use — they never change afterwards. */
	get model(): Model {
		return (this.built ??= this.asset.model());
	}

	/** The rig this is posed by, or null when it is drawn in its own space. */
	get rig(): Rig | null {
		if (this.object.getComponent(Attach)) return null;
		return this.object.getComponentInParent(Rig);
	}

	/** Draw it, wherever its object and its pose have put it. */
	emit(out: HexInstances, options: EmitOptions = {}): void {
		const rig = this.rig;
		if (rig) {
			const { transform } = this.object;
			this.model.emit(
				out,
				rig.world,
				transform.position[0]!,
				transform.position[1]!,
				transform.position[2]!,
				transform.yaw,
				options,
			);
			return;
		}

		const where = this.object.world;
		this.model.emitDetached(
			out,
			where.position[0]!,
			where.position[1]!,
			where.position[2]!,
			where.rotation,
			options,
		);
	}
}
