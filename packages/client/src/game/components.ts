/*
 * The component types a prefab file may name that are not the engine's own.
 *
 * The engine can read a prefab and walk it; it cannot build an `item`, because
 * it has never heard of one. This is where the game says what its own
 * components are, and it is the only file that has to change when there is a
 * new kind of thing to attach.
 *
 *     components:
 *       - { type: item, label: Nasal helm }
 *
 * A factory reads the record with the same `Node` API every asset file is read
 * with, so a missing field fails by name and line like anything else.
 *
 * ## Only one of them is here
 *
 * `item` is hexdelve's own vocabulary — a thing lying in the grass that can be
 * picked up — and the engine has never heard of it. The five it HAS heard of
 * are its own: `rig`, `mesh`, `animator` and `attach` are facts about drawing
 * and posing, and `script` is the engine's answer to how an object gets
 * behaviour at all. This registry starts from those rather than repeating them.
 */

import { engineComponents, type ComponentContext, type EntityAsset } from '@hexdelve/engine';

import type { ScriptSpawnExtras } from '@hexdelve/engine';

import { Item } from './items.js';

/**
 * What a factory is handed beyond the record itself.
 *
 * `scripts` is the engine's own contract for a `script` component — see
 * `ScriptSpawnExtras` — inherited rather than restated, so the two cannot drift
 * apart. `entity` is this package's own addition: what is being spawned, for a
 * caller that wants to know which file an object came out of.
 */
export interface SpawnExtras extends ScriptSpawnExtras {
	/**
	 * What is being spawned.
	 *
	 * Absent for a system prefab, which is not an entity — it has no rig, no
	 * mesh and nothing to draw.
	 */
	readonly entity?: EntityAsset;
}

/**
 * A thing that can be picked up.
 *
 * The record carries the label and nothing else. Which bone it hangs from and
 * how it lies in the grass are the `attach` component's on the same object,
 * read off it rather than repeated here — there is no second place to say how a
 * helmet lies.
 */
function itemFactory(context: ComponentContext): void {
	context.fields.only('type', 'label');
	context.object.attachComponent(new Item(context.object), {
		label: context.fields.get('label').textOr(''),
	});
}

/**
 * Everything this package can build from a prefab.
 *
 * Starts from `engineComponents()`, which already knows the five the engine
 * defines, and adds the one type that is this game's own vocabulary. One
 * registry, exported rather than constructed per caller, for the reason the
 * pose functions are: two libraries disagreeing about what `item` means is not
 * a state worth being able to reach.
 */
export const components = engineComponents().register('item', itemFactory);
