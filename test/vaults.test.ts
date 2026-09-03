/*
 * Are the shipped vaults usable, and does the format catch the ways one breaks?
 *
 * A vault fails silently in a way nothing else in this project does: the placer
 * skips anything `vaultProblems` complains about, so a broken vault is not a
 * crash or a bad picture — it is a room that simply never appears, for months,
 * until somebody wonders where the shrine went. So the checks are asserted
 * against here rather than trusted, and the whole catalogue is asserted to pass
 * them.
 */

import { describe, expect, it } from 'vitest';
import {
	parseVault,
	terrainAt,
	vaultCatalogue,
	vaultProblems,
	VAULT_SPECS,
	type Vault,
} from '@hexdelve/client';

describe('the catalogue', () => {
	it('parses, and every vault in it is placeable', () => {
		const vaults = vaultCatalogue();
		expect(vaults.length).toBe(VAULT_SPECS.length);

		for (const vault of vaults) {
			expect(vaultProblems(vault), `${vault.id}: ${vaultProblems(vault).join('; ')}`).toEqual([]);
			expect(vault.terrain.length).toBe(vault.width * vault.height);
		}
	});

	it('gives every vault a distinct id', () => {
		// Two vaults with one id is a vault that can never be chosen, because
		// the placer's "not this one again" set is keyed by id.
		const ids = new Set(vaultCatalogue().map((vault) => vault.id));
		expect(ids.size).toBe(VAULT_SPECS.length);
	});

	it('puts every entity somewhere it can stand', () => {
		for (const vault of vaultCatalogue()) {
			for (const entity of vault.entities) {
				const on = terrainAt(vault, entity.col, entity.row);
				expect(on, `${vault.id} ${entity.kind}`).not.toBe('wall');
				expect(on, `${vault.id} ${entity.kind}`).not.toBe('outside');
			}
		}
	});

	it('covers a range of depths with something', () => {
		// A depth with no eligible vault is a depth that never gets one, which
		// is a hole in the content nobody would notice from a unit test of any
		// single vault.
		for (const depth of [1, 10, 20, 40, 60, 80]) {
			const eligible = vaultCatalogue().filter(
				(vault) => depth >= vault.minDepth && depth <= vault.maxDepth,
			);
			expect(eligible.length, `nothing is eligible at depth ${depth}`).toBeGreaterThan(0);
		}
	});
});

describe('parsing', () => {
	it('reads terrain and entities out of the art', () => {
		const vault = parseVault({
			id: 'test',
			name: 'Test',
			minDepth: 1,
			maxDepth: 9,
			rating: 1,
			weight: 1,
			tiers: { monster: 3 },
			rows: [' ##+ ', '#.M.#', ' ### '],
		});

		expect(vault.width).toBe(5);
		expect(vault.height).toBe(3);
		expect(terrainAt(vault, 0, 0)).toBe('outside');
		expect(terrainAt(vault, 1, 0)).toBe('wall');
		expect(terrainAt(vault, 3, 0)).toBe('door');
		// An entity character is floor with something standing on it.
		expect(terrainAt(vault, 2, 1)).toBe('floor');
		expect(vault.entities).toEqual([{ kind: 'monster', col: 2, row: 1, tier: 3 }]);
	});

	it('refuses a ragged row rather than padding it', () => {
		// A row a character short shifts nothing — the cells simply stop — so
		// the vault would load, draw, and be a different room from the one that
		// was drawn.
		expect(() =>
			parseVault({
				id: 'ragged',
				name: 'Ragged',
				minDepth: 1,
				maxDepth: 9,
				rating: 1,
				weight: 1,
				rows: ['####', '#.+', '####'],
			}),
		).toThrow(/row 1 is 3 wide/);
	});

	it('refuses a character it does not know', () => {
		expect(() =>
			parseVault({
				id: 'odd',
				name: 'Odd',
				minDepth: 1,
				maxDepth: 9,
				rating: 1,
				weight: 1,
				rows: ['#?#'],
			}),
		).toThrow(/'\?'/);
	});
});

describe('the checks', () => {
	const base: Vault = {
		id: 'x',
		name: 'X',
		width: 3,
		height: 3,
		terrain: ['wall', 'door', 'wall', 'wall', 'floor', 'wall', 'wall', 'wall', 'wall'],
		entities: [],
		minDepth: 1,
		maxDepth: 9,
		rating: 1,
		weight: 1,
	};

	it('passes a vault that is fine', () => {
		expect(vaultProblems(base)).toEqual([]);
	});

	it('catches a vault nobody can enter', () => {
		const sealed: Vault = { ...base, terrain: base.terrain.map((c) => (c === 'door' ? 'wall' : c)) };
		expect(vaultProblems(sealed)).toContain('has no door, so nothing could ever enter it');
	});

	it('catches a vault with nothing inside it', () => {
		const solid: Vault = { ...base, terrain: base.terrain.map((c) => (c === 'floor' ? 'wall' : c)) };
		expect(vaultProblems(solid)).toContain('has no floor, so there is nothing inside it');
	});

	it('catches a cell count that does not match the size', () => {
		expect(vaultProblems({ ...base, width: 4 })).toContain('has 9 cells, expected 12');
	});

	it('catches a weight that makes it unchoosable', () => {
		expect(vaultProblems({ ...base, weight: 0 })).toContain(
			'has no weight, so it can never be chosen',
		);
	});

	it('catches an entity standing in a wall', () => {
		const stuck: Vault = {
			...base,
			entities: [{ kind: 'loot', col: 0, row: 0, tier: 0 }],
		};
		expect(vaultProblems(stuck)).toContain('has a loot at 0,0, which is wall');
	});
});
