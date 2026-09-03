/*
 * Putting vaults into a level, before anything carves it.
 *
 * This runs FIRST, on the solid draft, and every stack then carves around what
 * it finds. That ordering is the whole design, and the alternative — let each
 * stack place its own vaults, in its own way, after it has decided where the
 * rooms are — was tried on paper and is wrong three times over. It would be
 * three implementations of the same idea; two of the three stacks have no
 * rectangle to offer a vault by the time they are finished; and a vault stamped
 * over a carve is a vault that has just deleted whatever was there, which is
 * how you get a treasury with a cave running through the middle of it.
 *
 * Placed first, a vault is simply part of the terrain the carve has to respect.
 * The cave stack finds a built structure sitting in its rock and flows around
 * it; the boxes stack finds a region it cannot put a room in and puts its rooms
 * elsewhere. Neither needed to know what a vault is.
 *
 * What makes that work is one flag. `DraftCell.fixed` means "this cell is
 * finished, and nothing downstream may change it" — checked by every stack
 * before it writes, and by the stitcher before it digs. A vault's walls are
 * fixed rock, so no tunnel can be cut through them, and its doors are fixed
 * floor, so the way in is exactly the way that was drawn.
 */

import { axialKey, type Random } from '@hexdelve/shared';

import type { DraftCell } from '../build.js';
import { vaultCatalogue } from './catalogue.js';
import { terrainAt, vaultProblems, type PlacedVault, type Vault } from './types.js';

/** Where a vault's own cells go. Doors are floor with a colour of their own. */
export const VAULT_WALL_COLOR = 0x4a4034;
export const VAULT_FLOOR_COLOR = 0x9a8a63;
export const VAULT_DOOR_COLOR = 0xd0a850;

export const VAULT_WALL_TILE = 'vault-wall';
export const VAULT_FLOOR_TILE = 'vault';
export const VAULT_DOOR_TILE = 'vault-door';

export interface VaultPlacement {
	readonly cells: Map<string, DraftCell>;
	readonly radius: number;
	/** How deep this level is. Only vaults whose range covers it are eligible. */
	readonly depth: number;
	/** How many to try to place. */
	readonly wanted: number;
	readonly random: Random;
	/** Overrides the shipped catalogue, for the bench and for tests. */
	readonly catalogue?: readonly Vault[];
}

function offsetOf(cell: { q: number; r: number }): { col: number; row: number } {
	return { col: cell.q + ((cell.r - (cell.r & 1)) >> 1), row: cell.r };
}

function axialOf(col: number, row: number): { q: number; r: number } {
	return { q: col - ((row - (row & 1)) >> 1), r: row };
}

/**
 * Place up to `wanted` vaults, and say where they went.
 *
 * Vaults are tried biggest first. The order matters for the same reason it does
 * when packing rooms: a shrine that needs eleven by nine will not find anywhere
 * to go once four small vaults have been scattered across the middle of the
 * disc, and the shrine is the one worth having.
 */
export function placeVaults(options: VaultPlacement): PlacedVault[] {
	const { cells, depth, wanted, random } = options;
	if (wanted <= 0) return [];

	const eligible = (options.catalogue ?? vaultCatalogue()).filter(
		(vault) =>
			depth >= vault.minDepth && depth <= vault.maxDepth && vaultProblems(vault).length === 0,
	);
	if (eligible.length === 0) return [];

	const placed: PlacedVault[] = [];
	// Room for a corridor to reach a door, and for the vault to read as a thing
	// standing in the level rather than as part of its wall.
	const margin = 2;

	for (let i = 0; i < wanted; i++) {
		const vault = pick(eligible, placed, random);
		if (!vault) break;

		const spot = findSpot(cells, vault, placed, margin, random);
		if (!spot) continue;

		stamp(cells, vault, spot.col, spot.row);
		placed.push({
			vault,
			col: spot.col,
			row: spot.row,
			entities: vault.entities.map((entity) => ({
				...entity,
				col: entity.col + spot.col,
				row: entity.row + spot.row,
			})),
		});
	}

	return placed;
}

/**
 * Choose a vault, weighted, preferring the large and the not-yet-used.
 *
 * A level with two copies of the same shrine in it has told the player that the
 * shrine is furniture, which is the one thing a vault must never be. So a vault
 * already placed is only picked again when nothing else is available at all.
 */
function pick(
	eligible: readonly Vault[],
	placed: readonly PlacedVault[],
	random: Random,
): Vault | null {
	const used = new Set(placed.map((entry) => entry.vault.id));
	const fresh = eligible.filter((vault) => !used.has(vault.id));
	const from = fresh.length > 0 ? fresh : eligible;

	let total = 0;
	for (const vault of from) total += vault.weight * vault.width * vault.height;
	if (total <= 0) return null;

	let threshold = random() * total;
	for (const vault of from) {
		threshold -= vault.weight * vault.width * vault.height;
		if (threshold <= 0) return vault;
	}
	return from[from.length - 1] ?? null;
}

/**
 * Somewhere the vault fits: inside the disc, clear of the rim, clear of the
 * others.
 *
 * Dart throwing rather than a scan of every position, for the usual reason — a
 * handful of vaults on a disc of a hundred thousand cells will find a home in a
 * few dozen tries, and a scan costs the whole disc every time whether it needs
 * to or not. A vault that cannot find a spot is simply not placed, and the
 * readout says how many went in.
 */
function findSpot(
	cells: Map<string, DraftCell>,
	vault: Vault,
	placed: readonly PlacedVault[],
	margin: number,
	random: Random,
): { col: number; row: number } | null {
	let minCol = Infinity;
	let maxCol = -Infinity;
	let minRow = Infinity;
	let maxRow = -Infinity;
	for (const cell of cells.values()) {
		const { col, row } = offsetOf(cell);
		if (col < minCol) minCol = col;
		if (col > maxCol) maxCol = col;
		if (row < minRow) minRow = row;
		if (row > maxRow) maxRow = row;
	}

	for (let attempt = 0; attempt < 200; attempt++) {
		const col = minCol + Math.floor(random() * (maxCol - minCol + 1));
		const row = minRow + Math.floor(random() * (maxRow - minRow + 1));

		if (overlapsPlaced(vault, col, row, placed, margin)) continue;
		if (!fitsInDisc(cells, vault, col, row, margin)) continue;
		return { col, row };
	}

	return null;
}

function overlapsPlaced(
	vault: Vault,
	col: number,
	row: number,
	placed: readonly PlacedVault[],
	margin: number,
): boolean {
	for (const other of placed) {
		const gap = margin * 2;
		if (
			col - gap < other.col + other.vault.width &&
			other.col < col + vault.width + gap &&
			row - gap < other.row + other.vault.height &&
			other.row < row + vault.height + gap
		) {
			return true;
		}
	}
	return false;
}

/**
 * Every cell the vault would occupy, plus its margin, has to exist and be free.
 *
 * The margin is checked as well as the footprint, because a vault flush against
 * the rim has a door opening onto the edge of the world.
 */
function fitsInDisc(
	cells: Map<string, DraftCell>,
	vault: Vault,
	col: number,
	row: number,
	margin: number,
): boolean {
	for (let y = -margin; y < vault.height + margin; y++) {
		for (let x = -margin; x < vault.width + margin; x++) {
			const inside =
				x >= 0 && y >= 0 && x < vault.width && y < vault.height
					? terrainAt(vault, x, y) !== 'outside'
					: false;
			// A cell the vault does not use still has to be ON the disc if it is
			// within the margin, but it may be anything.
			const { q, r } = axialOf(col + x, row + y);
			const cell = cells.get(axialKey(q, r));
			if (!cell || cell.sealed) return false;
			if (inside && cell.fixed) return false;
		}
	}
	return true;
}

/** Write the vault into the draft, and mark every cell of it finished. */
function stamp(cells: Map<string, DraftCell>, vault: Vault, col: number, row: number): void {
	for (let y = 0; y < vault.height; y++) {
		for (let x = 0; x < vault.width; x++) {
			const terrain = terrainAt(vault, x, y);
			if (terrain === 'outside') continue;

			const { q, r } = axialOf(col + x, row + y);
			const cell = cells.get(axialKey(q, r));
			if (!cell) continue;

			cell.fixed = true;
			if (terrain === 'wall') {
				cell.kind = 'rock';
				cell.tile = VAULT_WALL_TILE;
				cell.color = VAULT_WALL_COLOR;
				continue;
			}
			cell.kind = 'floor';
			cell.tile = terrain === 'door' ? VAULT_DOOR_TILE : VAULT_FLOOR_TILE;
			cell.color = terrain === 'door' ? VAULT_DOOR_COLOR : VAULT_FLOOR_COLOR;
		}
	}
}

/** The offset coordinates of a placed vault's doors, for a stack that connects them. */
export function doorsOf(placed: PlacedVault): { col: number; row: number }[] {
	const doors: { col: number; row: number }[] = [];
	for (let y = 0; y < placed.vault.height; y++) {
		for (let x = 0; x < placed.vault.width; x++) {
			if (terrainAt(placed.vault, x, y) === 'door') {
				doors.push({ col: placed.col + x, row: placed.row + y });
			}
		}
	}
	return doors;
}
