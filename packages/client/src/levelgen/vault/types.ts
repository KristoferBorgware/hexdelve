/*
 * What a vault is.
 *
 * Everything else in a level is made up by an algorithm. A vault is a room
 * somebody DREW, stamped into the level as-is — the only part of a dungeon that
 * is deliberate, and the reason a player recognises a place on their fifth run
 * rather than merely walking through another plausible arrangement of rock.
 *
 * ## Not an Angband file
 *
 * Angband stores these as ASCII maps in `vault.txt`, where `8` means "a monster
 * forty levels out of depth and a great object" and `&` means "an object 75% of
 * the time, else a trap a quarter of the rest". That is a wonderfully compact
 * notation for a game whose content is finished, and a bad one for a game whose
 * content is not: every symbol is a decision about loot tables and monster
 * depths that this project has not made yet, baked into a character.
 *
 * So a vault here is DATA, not text. Terrain is a named enum and entities are a
 * list of positions with a kind — which means adding a terrain or an entity
 * kind is a change the compiler tells you about everywhere, instead of a symbol
 * that silently means nothing in half the vaults that use it.
 *
 * ## What is deliberately provisional
 *
 * The entity kinds below are a first cut and are expected to change. The game
 * has no monsters that fight, no loot tables and no traps yet, so anything more
 * specific than "something dangerous goes here, roughly this dangerous" would
 * be inventing a system to fit a file format — exactly backwards. `tier` is a
 * number relative to the level's depth and `tag` is an escape hatch for
 * whatever the game turns out to need, so a vault drawn today keeps meaning
 * what it meant once those systems exist.
 *
 * ## Coordinates
 *
 * Odd-r offset, row-major, the same space the boxes stack builds in — so a
 * vault's rectangle drops onto a room's rectangle without conversion, and a
 * rectangle of cells is a rectangle on screen rather than a leaning rhombus.
 */

/** One cell of a vault's map. */
export type VaultTerrain =
	/** Solid. Nothing may dig through it, which is what makes a vault a vault. */
	| 'wall'
	/** Walkable. */
	| 'floor'
	/**
	 * Walkable, and the only place a corridor may arrive.
	 *
	 * A vault with no door is a vault nobody can enter, so it is refused at
	 * load rather than shipped and discovered.
	 */
	| 'door'
	/**
	 * Not part of the vault at all — the level shows through here.
	 *
	 * What lets a vault be a cross or a ring rather than only a rectangle,
	 * without needing a second shape system on top of the bounding box.
	 */
	| 'outside';

/**
 * Something that stands on a cell rather than being the cell.
 *
 * Five kinds, chosen to be the smallest set that can express a designed
 * encounter: something to fight, something to take, something to avoid,
 * something that lights the room, and a named point for anything else.
 */
export type VaultEntityKind = 'monster' | 'loot' | 'trap' | 'light' | 'marker';

export interface VaultEntity {
	readonly kind: VaultEntityKind;
	readonly col: number;
	readonly row: number;
	/**
	 * How far out of depth this is, in level steps. Zero is "whatever is normal
	 * here"; a guarded hoard might be `+8` on the monster and `+5` on the loot.
	 * Relative rather than absolute so one vault reads sensibly across the whole
	 * depth range it is allowed to appear in.
	 */
	readonly tier: number;
	/** Free-form, for whatever eventually reads this. Never interpreted here. */
	readonly tag?: string;
}

export interface Vault {
	readonly id: string;
	readonly name: string;
	readonly width: number;
	readonly height: number;
	/** `width * height`, row-major. */
	readonly terrain: readonly VaultTerrain[];
	readonly entities: readonly VaultEntity[];
	/** Depths this vault may appear at, inclusive on both ends. */
	readonly minDepth: number;
	readonly maxDepth: number;
	/**
	 * How much more dangerous a level feels for containing this.
	 *
	 * Angband's own number, and worth keeping for the same reason: it is the
	 * one property of a vault that is about the LEVEL rather than about the
	 * room, so it is what a difficulty budget would eventually be spent on.
	 */
	readonly rating: number;
	/** Relative frequency among the vaults eligible at a given depth. */
	readonly weight: number;
}

/** A vault, once it has been put somewhere. */
export interface PlacedVault {
	readonly vault: Vault;
	/** Where its top-left corner landed, in the level's offset coordinates. */
	readonly col: number;
	readonly row: number;
	/** Its entities, moved into level coordinates. */
	readonly entities: readonly VaultEntity[];
}

export function terrainAt(vault: Vault, col: number, row: number): VaultTerrain {
	if (col < 0 || row < 0 || col >= vault.width || row >= vault.height) return 'outside';
	return vault.terrain[col + row * vault.width]!;
}

/** Everything wrong with a vault, as sentences. Empty means it is fine. */
export function vaultProblems(vault: Vault): string[] {
	const problems: string[] = [];

	if (vault.width < 1 || vault.height < 1) problems.push('has no size');
	if (vault.terrain.length !== vault.width * vault.height) {
		problems.push(`has ${vault.terrain.length} cells, expected ${vault.width * vault.height}`);
	}
	if (vault.minDepth > vault.maxDepth) problems.push('has a depth range that runs backwards');
	if (vault.weight <= 0) problems.push('has no weight, so it can never be chosen');

	let doors = 0;
	let floors = 0;
	for (const cell of vault.terrain) {
		if (cell === 'door') doors++;
		else if (cell === 'floor') floors++;
	}
	// The two failures that produce a vault which draws perfectly and ruins a
	// level: one nobody can get into, and one that is not a room.
	if (doors === 0) problems.push('has no door, so nothing could ever enter it');
	if (floors === 0) problems.push('has no floor, so there is nothing inside it');

	for (const entity of vault.entities) {
		const on = terrainAt(vault, entity.col, entity.row);
		if (on === 'wall' || on === 'outside') {
			problems.push(`has a ${entity.kind} at ${entity.col},${entity.row}, which is ${on}`);
		}
	}

	return problems;
}
