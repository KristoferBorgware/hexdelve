/*
 * Where a vault lives while it is being drawn.
 *
 * The catalogue in `@hexdelve/client` is the game's, checked in, and the only
 * one the generator ever reads. This is a working copy in front of it: the
 * shipped vaults, plus whatever has been drawn or edited in the bench, kept in
 * the browser.
 *
 * That split is the honest one for a static editor. There is no server to save
 * to and no filesystem to write, so a vault drawn here becomes part of the game
 * by being COPIED OUT as source and pasted into `vault/catalogue.ts` — which is
 * what the bench's copy button is for. Anything short of that would be pretending
 * a page can commit to a repository.
 *
 * A shipped vault is never overwritten in place: editing one stores an override
 * beside it, and reverting deletes the override. So the checked-in art is
 * always recoverable from a browser that has been drawn in for a month.
 */

import { vaultCatalogue, type Vault, type VaultEntity, type VaultTerrain } from '@hexdelve/client';

const STORAGE_KEY = 'hexdelve.vaults.v1';

/** The same shape as a `Vault`, with the arrays open for editing. */
export interface VaultDraft {
	id: string;
	name: string;
	width: number;
	height: number;
	terrain: VaultTerrain[];
	entities: VaultEntity[];
	minDepth: number;
	maxDepth: number;
	rating: number;
	weight: number;
	/** True when this is an edit of, or an addition to, the shipped catalogue. */
	local: boolean;
}

export function toDraft(vault: Vault, local = false): VaultDraft {
	return {
		id: vault.id,
		name: vault.name,
		width: vault.width,
		height: vault.height,
		terrain: [...vault.terrain],
		entities: vault.entities.map((entity) => ({ ...entity })),
		minDepth: vault.minDepth,
		maxDepth: vault.maxDepth,
		rating: vault.rating,
		weight: vault.weight,
		local,
	};
}

export function toVault(draft: VaultDraft): Vault {
	return {
		id: draft.id,
		name: draft.name,
		width: draft.width,
		height: draft.height,
		terrain: draft.terrain,
		entities: draft.entities,
		minDepth: draft.minDepth,
		maxDepth: draft.maxDepth,
		rating: draft.rating,
		weight: draft.weight,
	};
}

/**
 * The shipped vaults with the local ones laid over them.
 *
 * Storage is read defensively rather than trusted: a browser that has been
 * through three versions of this format has a key in it that is no longer the
 * shape this expects, and a bench that throws on load is a bench that cannot be
 * used to fix the vault that broke it.
 */
export function loadVaults(): VaultDraft[] {
	const shipped = vaultCatalogue().map((vault) => toDraft(vault, false));
	const local = readLocal();

	const merged = new Map<string, VaultDraft>();
	for (const draft of shipped) merged.set(draft.id, draft);
	for (const draft of local) merged.set(draft.id, draft);
	return [...merged.values()];
}

export function saveLocal(drafts: readonly VaultDraft[]): void {
	const local = drafts.filter((draft) => draft.local);
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
	} catch {
		// A private window, or storage that is full. Losing the working copy is
		// bad; taking the editor down with it is worse.
	}
}

function readLocal(): VaultDraft[] {
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(isDraft).map((draft) => ({ ...draft, local: true }));
	} catch {
		return [];
	}
}

function isDraft(value: unknown): value is VaultDraft {
	if (typeof value !== 'object' || value === null) return false;
	const draft = value as Partial<VaultDraft>;
	return (
		typeof draft.id === 'string' &&
		typeof draft.width === 'number' &&
		typeof draft.height === 'number' &&
		Array.isArray(draft.terrain) &&
		draft.terrain.length === draft.width * draft.height &&
		Array.isArray(draft.entities)
	);
}

/** A blank vault: a walled box with one door and a floor inside it. */
export function blankVault(id: string): VaultDraft {
	const width = 9;
	const height = 7;
	const terrain: VaultTerrain[] = [];
	for (let row = 0; row < height; row++) {
		for (let col = 0; col < width; col++) {
			const edge = col === 0 || row === 0 || col === width - 1 || row === height - 1;
			terrain.push(edge ? 'wall' : 'floor');
		}
	}
	terrain[Math.floor(width / 2) + (height - 1) * width] = 'door';

	return {
		id,
		name: 'New vault',
		width,
		height,
		terrain,
		entities: [],
		minDepth: 1,
		maxDepth: 99,
		rating: 2,
		weight: 1,
		local: true,
	};
}

/**
 * Change a vault's size, keeping what fits.
 *
 * Growing pads with wall rather than with floor: a vault is a sealed thing, and
 * a row of floor appearing along its edge would silently open it. Shrinking
 * drops whatever falls outside, entities included — there is nowhere else for
 * them to be, and quietly moving them would be worse than losing them.
 */
export function resize(draft: VaultDraft, width: number, height: number): VaultDraft {
	const terrain: VaultTerrain[] = [];
	for (let row = 0; row < height; row++) {
		for (let col = 0; col < width; col++) {
			terrain.push(
				col < draft.width && row < draft.height
					? draft.terrain[col + row * draft.width]!
					: 'wall',
			);
		}
	}

	return {
		...draft,
		width,
		height,
		terrain,
		entities: draft.entities.filter((entity) => entity.col < width && entity.row < height),
	};
}

/**
 * The vault as source, ready to paste into `vault/catalogue.ts`.
 *
 * Emitted in the catalogue's own character art rather than as the typed arrays,
 * because that file is meant to be read: a `VaultSpec` you can see the shape of
 * is worth more in a source file than one that is technically the same data.
 */
export function toSource(draft: VaultDraft): string {
	const glyph: Record<VaultTerrain, string> = {
		wall: '#',
		floor: '.',
		door: '+',
		outside: ' ',
	};
	const entityGlyph: Record<string, string> = {
		monster: 'M',
		loot: 'L',
		trap: 'T',
		light: '*',
		marker: 'X',
	};

	const at = new Map<string, string>();
	for (const entity of draft.entities) {
		at.set(`${entity.col},${entity.row}`, entityGlyph[entity.kind] ?? 'X');
	}

	const rows: string[] = [];
	for (let row = 0; row < draft.height; row++) {
		let line = '';
		for (let col = 0; col < draft.width; col++) {
			line += at.get(`${col},${row}`) ?? glyph[draft.terrain[col + row * draft.width]!];
		}
		rows.push(`\t\t\t'${line}',`);
	}

	const tiers = new Map<string, number>();
	for (const entity of draft.entities) tiers.set(entity.kind, entity.tier);
	const tierLine =
		tiers.size > 0
			? `\n\t\ttiers: { ${[...tiers].map(([kind, tier]) => `${kind}: ${tier}`).join(', ')} },`
			: '';

	return [
		'\t{',
		`\t\tid: '${draft.id}',`,
		`\t\tname: '${draft.name.replace(/'/g, "\\'")}',`,
		`\t\tminDepth: ${draft.minDepth},`,
		`\t\tmaxDepth: ${draft.maxDepth},`,
		`\t\trating: ${draft.rating},`,
		`\t\tweight: ${draft.weight},${tierLine}`,
		'\t\trows: [',
		...rows,
		'\t\t],',
		'\t},',
	].join('\n');
}
