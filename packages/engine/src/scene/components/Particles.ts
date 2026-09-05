/*
 * An emitter, on a game object.
 *
 * The system next door in `particles/` is the simulation and knows nothing
 * about a scene. This is the other half: it puts one on an object, so an
 * effect can hang off a chimney, off a hand, or off a burst spawned where a
 * blow landed, and it moves with whatever it is under like anything else in
 * the tree.
 *
 * ## Where it thinks it is
 *
 * `object.world`, which is solved once a frame AFTER every component has
 * updated — so an emitter reads the placement the previous solve left. For a
 * chimney that is exact, and for a torch in a moving hand it is one frame of
 * lag on a puff of smoke. The alternative is a second solve for every emitter,
 * which is what `Attach` pays because a sword in the wrong place is visible
 * and a puff a frame behind is not.
 *
 * The one moment that lag would be visible is the FIRST: an emitter attached
 * to an object nothing has solved yet reads a world transform of zeroes, and a
 * burst is thrown once. So `onAttach` composes its own chain — see
 * `placeOnAttach` — rather than waiting for the scene, and the opening burst
 * lands where it was asked for even when it was asked for mid-frame.
 *
 * ## Its own randomness
 *
 * Seeded from the object's id, so two chimneys running one effect file do not
 * puff in step, and a given run of the yard produces the same two. A system
 * built directly, by a bench, seeds from the effect's id instead.
 */

import { makeRandom } from '@hexdelve/shared';

import { ParticleSystem } from '../../particles/ParticleSystem.js';
import type { ParticleEffect } from '../../particles/effect.js';
import type { GameObject } from '../GameObject.js';
import type { HexInstances } from '../HexInstances.js';
import { composeWorld } from '../Transform.js';
import { Component } from './Component.js';
import { param } from './parameters.js';

export class Particles extends Component {
	readonly system: ParticleSystem;

	/** Whether the emitter is producing. Clearing it lets the live ones fade. */
	playing = param(true, { hint: 'Whether new particles are arriving' });

	/**
	 * Take the object out of the scene once the effect is over.
	 *
	 * What a one-shot is for: a burst spawned where a blow landed has nothing
	 * to do afterwards, and an object left standing there is one more thing
	 * every walk of the tree has to step over. A looping effect never finishes,
	 * so this does nothing to one.
	 */
	autoDestroy = param(false, { hint: 'Destroy the object when the effect is done' });

	/** What `playing` was last frame, so a change of it is what acts. */
	private producing = false;

	constructor(object: GameObject, effect: ParticleEffect) {
		super(object);
		this.system = new ParticleSystem(effect, {
			random: makeRandom(Math.imul(object.id, 0x9e3779b1) >>> 0),
			// Not yet: `play` throws the opening burst, and where the object is
			// is not known until `onAttach` has composed it.
			autoPlay: false,
		});
	}

	get effect(): ParticleEffect {
		return this.system.effect;
	}

	override onAttach(): void {
		this.placeOnAttach();
		this.system.moveTo(this.object.world);
		if (this.playing) {
			this.system.play();
			this.producing = true;
		}
	}

	/** Start again from the top, wherever the object now is. */
	restart(): void {
		this.system.moveTo(this.object.world);
		this.system.play();
		this.playing = true;
		this.producing = true;
	}

	override update(dt: number): void {
		this.system.moveTo(this.object.world);

		if (this.playing !== this.producing) {
			// The flag CHANGING is what acts, so an effect that ran out of its
			// own duration is not started again every frame by a `playing` that
			// was left true.
			if (this.playing) this.system.play();
			else this.system.stop();
			this.producing = this.playing;
		}

		this.system.update(dt);

		if (this.autoDestroy && this.system.finished) this.object.destroy();
	}

	/**
	 * Compose this object's world transform, and its ancestors', from their
	 * local ones.
	 *
	 * What a scene solve does, for one chain and without descending into
	 * anything. It is here because the scene has not necessarily solved yet:
	 * a prefab builds its objects from the root down and hangs the components
	 * on each as it goes, so at this moment every ancestor holds a local
	 * transform the file gave it and a world transform of zeroes.
	 *
	 * Writing the ancestors' as well is not a side effect to apologise for —
	 * it writes exactly what the next solve would write, which is why the
	 * emitter can read the result.
	 */
	private placeOnAttach(): void {
		const chain: GameObject[] = [];
		for (let up: GameObject | null = this.object; up; up = up.parent) chain.push(up);
		for (let i = chain.length - 1; i >= 0; i--) {
			const node = chain[i]!;
			composeWorld(node.world, node.parent?.world ?? null, node.transform);
		}
	}

	/** This moment's particles, into the blended pass. */
	emit(out: HexInstances): void {
		this.system.emit(out);
	}
}
