/*
 * Who is in the yard, and where they come from.
 *
 * The simulation used to name its cast by importing them: `buildWanderer()`
 * for the man, `BAT_SKELETON` for the thing hunting him, three `build*`
 * functions for the gear. That is the last place the old arrangement survived,
 * and it is the one this file replaces — the cast is now three lists of ids
 * looked up in the manifest, so putting the ghoul in the yard instead of the
 * wanderer is a string rather than an import.
 *
 * Ids rather than paths on purpose. A path is where a file happens to sit; an
 * id is what the thing is, the manifest already maps one to the other, and the
 * entity file is free to move without every caller following it.
 *
 * This is deliberately not a scene format. A yard with a man, a bat and three
 * props in known places is a demo, and inventing a file to describe one would
 * be inventing a system to fit a format — the same mistake the vault types
 * warn about. When there are levels to populate, what goes in them will be a
 * question for the level, and this will be the function it calls.
 */

import { entityAnimations, findComponent, type AssetLibrary, type EntityAsset } from '@hexdelve/engine';

/** The default yard: a wanderer, a bat, and the three things lying in the grass. */
export const YARD_PLAYER = 'wanderer2';
export const YARD_ENEMY = 'bat';
export const YARD_PROPS: readonly string[] = ['helmet', 'sword', 'shield'];

export interface CastOptions {
	/** The entity the player drives. Must be a character with a rig. */
	readonly player?: string;
	/** The one hunting him. */
	readonly enemy?: string;
	/** What is lying about, in the order they are placed. Props, so no rigs. */
	readonly props?: readonly string[];
	/**
	 * Loaded, and not placed.
	 *
	 * What a script spawns during play — an arrow, a mote, a dropped torch.
	 * Reading an entity takes a fetch and a tick cannot wait for one, so
	 * anything a script may ask for is loaded with the cast and waits.
	 */
	readonly spawnable?: readonly string[];
}

export interface Cast {
	readonly player: EntityAsset;
	readonly enemy: EntityAsset;
	readonly props: readonly EntityAsset[];
	/** Loaded for a script to spawn, and not placed in the yard. */
	readonly spawnable: readonly EntityAsset[];
}

/**
 * Load the cast out of the manifest.
 *
 * One `index()` and then lookups, rather than a read per entity, because the
 * manifest is the thing that knows what exists — and because a missing id
 * should say what there *was*, which needs the whole list in hand anyway.
 */
export async function loadCast(library: AssetLibrary, options: CastOptions = {}): Promise<Cast> {
	const all = await library.index();
	const byId = new Map(all.map((entity) => [entity.id, entity]));

	/*
	 * What a part needs is a component, not a label. The yard wants two things
	 * it can pose and three it can pick up, and an entity that can be posed is
	 * one carrying an `animator` — which is the same sentence, asked of the file
	 * rather than of a field somebody had to remember to set.
	 */
	const need = (id: string, wanted: 'animator' | 'attach', part: string): EntityAsset => {
		const entity = byId.get(id);
		if (!entity) {
			throw new Error(
				`no entity '${id}' in the manifest; it has ${all.map((one) => one.id).join(', ')}`,
			);
		}
		if (!findComponent(entity.prefab, wanted)) {
			throw new Error(`entity '${id}' has no '${wanted}' component, and the yard wants ${part}`);
		}
		return entity;
	};

	return {
		player: need(options.player ?? YARD_PLAYER, 'animator', 'a body it can pose here'),
		enemy: need(options.enemy ?? YARD_ENEMY, 'animator', 'a body it can pose here'),
		props: (options.props ?? YARD_PROPS).map((id) =>
			need(id, 'attach', 'something that can be carried here'),
		),
		spawnable: (options.spawnable ?? []).map((id) => {
			const entity = byId.get(id);
			if (!entity) {
				throw new Error(
					`no entity '${id}' in the manifest; it has ${all.map((one) => one.id).join(', ')}`,
				);
			}
			return entity;
		}),
	};
}

/**
 * One clip an entity was declared to have, by the name its file gave it.
 *
 * A missing one is an error here rather than a mystery later: a man with no
 * `slash` cannot be built, and finding that out when he swings would be worse
 * than finding it out when he is made.
 */
export function clipOf(entity: EntityAsset, name: string): import('@hexdelve/engine').Clip {
	const animations = entityAnimations(entity);
	const animation = animations.get(name);
	if (!animation) {
		throw new Error(
			`'${entity.id}' has no animation '${name}'; it has ${[...animations.keys()].join(', ')}`,
		);
	}
	if (!animation.clip) {
		throw new Error(`'${entity.id}' animation '${name}' is procedural, and a clip is wanted here`);
	}
	return animation.clip;
}
