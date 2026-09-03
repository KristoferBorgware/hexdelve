/*
 * The vaults that ship with the game.
 *
 * Written as art rather than as arrays, because a vault is a drawing and
 * nobody can read a drawing out of a list of enum members. The characters here
 * are a LOCAL convenience of this file — `parseVault` turns them into the typed
 * terrain the rest of the code sees, and the vault bench in the editor never
 * touches them at all. That is the difference between this and an Angband
 * `vault.txt`: there, the characters are the format, and every symbol is a
 * decision about loot tables baked into a byte. Here they are shorthand for
 * four terrain values and five entity kinds, and adding a fifth terrain is a
 * change the compiler finds.
 *
 *   #  wall        .  floor       +  door        (space) outside
 *   M  monster     L  loot        T  trap        *  light      X  marker
 *
 * An entity character is floor with something standing on it. Tiers are set per
 * vault below rather than per character, since "how far out of depth" is a
 * property of the room's difficulty and not of the glyph.
 */

import type { Vault, VaultEntity, VaultEntityKind, VaultTerrain } from './types.js';

const TERRAIN: Record<string, VaultTerrain> = {
	'#': 'wall',
	'.': 'floor',
	'+': 'door',
	' ': 'outside',
};

const ENTITY: Record<string, VaultEntityKind> = {
	M: 'monster',
	L: 'loot',
	T: 'trap',
	'*': 'light',
	X: 'marker',
};

export interface VaultSpec {
	readonly id: string;
	readonly name: string;
	readonly rows: readonly string[];
	readonly minDepth: number;
	readonly maxDepth: number;
	readonly rating: number;
	readonly weight: number;
	/** Out-of-depth steps applied to every entity of that kind in this vault. */
	readonly tiers?: Partial<Record<VaultEntityKind, number>>;
}

/**
 * Turn the art above into a vault.
 *
 * Ragged rows are refused rather than padded. A row one character short shifts
 * nothing — the cells simply stop — so the vault would load, draw, and be a
 * different room from the one that was drawn, which is the worst of the three
 * possible outcomes.
 */
export function parseVault(spec: VaultSpec): Vault {
	const height = spec.rows.length;
	if (height === 0) throw new Error(`vault ${spec.id} has no rows`);
	const width = spec.rows[0]!.length;

	const terrain: VaultTerrain[] = [];
	const entities: VaultEntity[] = [];

	for (let row = 0; row < height; row++) {
		const line = spec.rows[row]!;
		if (line.length !== width) {
			throw new Error(`vault ${spec.id} row ${row} is ${line.length} wide, expected ${width}`);
		}
		for (let col = 0; col < width; col++) {
			const character = line[col]!;
			const cell = TERRAIN[character];
			if (cell !== undefined) {
				terrain.push(cell);
				continue;
			}
			const kind = ENTITY[character];
			if (kind === undefined) throw new Error(`vault ${spec.id} has '${character}'`);
			terrain.push('floor');
			entities.push({ kind, col, row, tier: spec.tiers?.[kind] ?? 0 });
		}
	}

	return {
		id: spec.id,
		name: spec.name,
		width,
		height,
		terrain,
		entities,
		minDepth: spec.minDepth,
		maxDepth: spec.maxDepth,
		rating: spec.rating,
		weight: spec.weight,
	};
}

/**
 * Six to start with, across the depth range.
 *
 * Chosen to exercise the format rather than to be a content library: one that
 * is not rectangular, one that is a room inside a room, one with two doors and
 * one with one, one that is mostly trap and one that is mostly nothing. What
 * they have in common is that each is a shape with a reason — a treasury has
 * its hoard behind an inner wall, a guardroom has its monsters facing the door.
 */
export const VAULT_SPECS: readonly VaultSpec[] = [
	{
		id: 'cell-block',
		name: 'Cell block',
		minDepth: 1,
		maxDepth: 40,
		rating: 4,
		weight: 3,
		tiers: { monster: 1, loot: 1 },
		rows: [
			'#########',
			'#.#.#.#.#',
			'#M#L#M#.#',
			'#.#.#.#.#',
			'#.......#',
			'####+####',
		],
	},
	{
		id: 'guardroom',
		name: 'Guardroom',
		minDepth: 1,
		maxDepth: 30,
		rating: 3,
		weight: 4,
		tiers: { monster: 2, loot: 2 },
		rows: [
			'###+###',
			'#.....#',
			'#.M.M.#',
			'#..L..#',
			'#.M.M.#',
			'#.....#',
			'###+###',
		],
	},
	{
		id: 'treasury',
		name: 'Treasury',
		minDepth: 5,
		maxDepth: 60,
		rating: 8,
		weight: 2,
		tiers: { monster: 5, loot: 6, trap: 3 },
		rows: [
			'###########',
			'#.........#',
			'#.#######.#',
			'#.#T.L.T#.#',
			'#.#.###.#.#',
			'#.#.#M#.#.#',
			'#.#.#+#.#.#',
			'#.#...#.#.#',
			'#.#####.#.#',
			'#.........#',
			'#####+#####',
		],
	},
	{
		id: 'crossing',
		name: 'The crossing',
		minDepth: 1,
		maxDepth: 50,
		rating: 2,
		weight: 3,
		tiers: { monster: 0, light: 0 },
		rows: [
			'  #+#  ',
			'  #.#  ',
			'###.###',
			'+..*..+',
			'###.###',
			'  #M#  ',
			'  ###  ',
		],
	},
	{
		id: 'gauntlet',
		name: 'Gauntlet',
		minDepth: 10,
		maxDepth: 80,
		rating: 6,
		weight: 2,
		tiers: { trap: 4, loot: 5 },
		rows: [
			'#############',
			'+.T.T.T.T.T.#',
			'#.#########.#',
			'#.T.T.T.T.#L#',
			'#########.###',
			'        #+#  ',
		],
	},
	{
		id: 'shrine',
		name: 'Shrine',
		minDepth: 15,
		maxDepth: 99,
		rating: 12,
		weight: 1,
		tiers: { monster: 12, loot: 10, light: 0 },
		rows: [
			'   #####   ',
			'  ##...##  ',
			' ##..*..## ',
			'##..M.M..##',
			'#....L....#',
			'##..M.M..##',
			' ##..*..## ',
			'  ##...##  ',
			'   ##+##   ',
		],
	},
];

let cached: Vault[] | null = null;

/** The parsed catalogue. Parsed once, because the art never changes at runtime. */
export function vaultCatalogue(): readonly Vault[] {
	if (!cached) cached = VAULT_SPECS.map(parseVault);
	return cached;
}
