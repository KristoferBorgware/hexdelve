/*
 * The particle effects the yard uses, and how one is put down in it.
 *
 * Two of them: the smoke over both chimneys, and the blood off a blow. Each is
 * a file under `public/assets/particles`, listed in the manifest and open on
 * the particle bench, which is what an effect being a file rather than a lump
 * of code is for — the numbers are tuned by looking at them.
 *
 * They are looked up by id rather than by path, for the reason the cast is:
 * a path is where a file happens to sit, an id is what the thing is, and the
 * manifest already maps one to the other.
 *
 * A missing effect is not an error here. The client can be pointed at a
 * manifest with no `particles` section at all — an embedder's own tree, a test
 * fixture — and a yard with no smoke coming out of the chimney is a yard,
 * where a yard that refused to start over it would not be.
 */

import {
	GameObject,
	Particles,
	type AssetLibrary,
	type ParticleEffect,
	type Scene,
} from '@hexdelve/engine';

/** The chimneys of both buildings. */
export const SMOKE_EFFECT = 'smoke';
/** Thrown where a blow lands. */
export const BLOOD_EFFECT = 'blood';

/** Every effect the manifest lists, by id. */
export async function loadEffects(
	library: AssetLibrary,
): Promise<ReadonlyMap<string, ParticleEffect>> {
	const listed = await library.effectIndex();
	return new Map(listed.map((effect) => [effect.id, effect]));
}

export interface EmitterPlacement {
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly yaw?: number;
	/** What to call the object. Defaults to the effect's id. */
	readonly name?: string;
	/** Where it hangs. Defaults to the scene root. */
	readonly parent?: GameObject;
	/**
	 * Take the object out of the scene once the effect is over.
	 *
	 * What a one-shot wants and a chimney must not have: a looping effect never
	 * finishes, so this would never fire on one, but saying so at the call is
	 * how a reader tells the two apart.
	 */
	readonly autoDestroy?: boolean;
}

/**
 * Put an emitter in the scene.
 *
 * An object with one component on it, which is all an emitter is — the same
 * object a prefab would produce from `{ type: particles, effect: ... }`, made
 * by hand here because what these two hang off is not an entity. The chimney
 * belongs to a building baked into the static instance list, and a burst
 * belongs to the point in the air where a blow landed.
 */
export function spawnEmitter(
	scene: Scene,
	effect: ParticleEffect,
	at: EmitterPlacement,
): GameObject {
	const object = (at.parent ?? scene.root).add(new GameObject(at.name ?? effect.id));
	object.transform.setPosition(at.x, at.y, at.z);
	if (at.yaw !== undefined) object.transform.yaw = at.yaw;
	object.attachComponent(new Particles(object, effect), {
		autoDestroy: at.autoDestroy ?? false,
	});
	return object;
}
