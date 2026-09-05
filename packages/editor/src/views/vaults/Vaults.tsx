/*
 * The vault bench: draw a room, and say where in the dungeon it belongs.
 *
 * The other three benches PREVIEW — a rig, a prop, a generated level — and
 * change nothing. This one authors, and that difference is the whole reason it
 * looks unlike them. There is no GPU viewport, because a vault is a grid of
 * cells and the truthful picture of a grid is a grid; what the room will look
 * like standing in a dungeon is the level bench's job, one tab across.
 *
 * A vault drawn here goes into the game by being copied out as source. That is
 * not a limitation being worked around, it is what a static page can honestly
 * offer: there is no server to save to, the catalogue is checked-in game data,
 * and a bench that pretended otherwise would be a bench whose work quietly
 * disappeared. The browser keeps the working copy so nothing is lost between
 * sessions; the repository keeps the vaults.
 */

import Box from '@mui/material/Box';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { vaultProblems, type VaultEntityKind, type VaultTerrain } from '@hexdelve/client';

import {
	blankVault,
	loadVaults,
	saveLocal,
	toVault,
	type VaultDraft,
} from './store.js';
import { VaultCanvas } from './VaultCanvas.js';
import { VaultInspector } from './VaultInspector.js';
import { VaultList } from './VaultList.js';

/** What a click does. Terrain paints; an entity kind places one; `erase` clears. */
export type Brush = { paint: 'terrain'; terrain: VaultTerrain } | { paint: 'entity'; kind: VaultEntityKind } | { paint: 'erase' };

export function Vaults() {
	const [drafts, setDrafts] = useState<VaultDraft[]>(() => loadVaults());
	const [selected, setSelected] = useState(0);
	const [brush, setBrush] = useState<Brush>({ paint: 'terrain', terrain: 'wall' });
	const [tier, setTier] = useState(0);

	const draft = drafts[Math.min(selected, drafts.length - 1)];

	// Persisted on every change rather than behind a save button: there is
	// nothing here worth losing to a closed tab, and a save button on a working
	// copy is a button that eventually does not get pressed.
	useEffect(() => saveLocal(drafts), [drafts]);

	const update = useCallback(
		(next: VaultDraft): void => {
			setDrafts((all) => all.map((entry, i) => (i === selected ? { ...next, local: true } : entry)));
		},
		[selected],
	);

	const paint = useCallback(
		(col: number, row: number): void => {
			if (!draft) return;
			const at = col + row * draft.width;

			if (brush.paint === 'terrain') {
				if (draft.terrain[at] === brush.terrain) return;
				const terrain = [...draft.terrain];
				terrain[at] = brush.terrain;
				// Nothing stands on a wall or on a cell that is not part of the
				// vault, so painting one takes whatever was there with it.
				const keep =
					brush.terrain === 'wall' || brush.terrain === 'outside'
						? draft.entities.filter((entity) => entity.col !== col || entity.row !== row)
						: draft.entities;
				update({ ...draft, terrain, entities: keep });
				return;
			}

			if (brush.paint === 'erase') {
				const entities = draft.entities.filter(
					(entity) => entity.col !== col || entity.row !== row,
				);
				if (entities.length !== draft.entities.length) update({ ...draft, entities });
				return;
			}

			const held = draft.entities.find((entity) => entity.col === col && entity.row === row);
			if (held && held.kind === brush.kind && held.tier === tier) return;

			// An entity needs somewhere to stand, so dropping one on a wall
			// opens the wall rather than refusing — which is what the hand
			// doing it meant, and saves a two-step dance every time.
			const terrain = [...draft.terrain];
			if (terrain[at] === 'wall' || terrain[at] === 'outside') terrain[at] = 'floor';

			update({
				...draft,
				terrain,
				entities: [
					...draft.entities.filter((entity) => entity.col !== col || entity.row !== row),
					{ kind: brush.kind, col, row, tier },
				],
			});
		},
		[draft, brush, tier, update],
	);

	const problems = useMemo(() => (draft ? vaultProblems(toVault(draft)) : []), [draft]);

	const add = (): void => {
		const fresh = blankVault(`vault-${Date.now().toString(36)}`);
		setDrafts((all) => [...all, fresh]);
		setSelected(drafts.length);
	};

	const duplicate = (): void => {
		if (!draft) return;
		const copy: VaultDraft = {
			...draft,
			id: `${draft.id}-copy`,
			name: `${draft.name} copy`,
			terrain: [...draft.terrain],
			entities: draft.entities.map((entity) => ({ ...entity })),
			local: true,
		};
		setDrafts((all) => [...all, copy]);
		setSelected(drafts.length);
	};

	const remove = (): void => {
		if (!draft) return;
		setDrafts((all) => all.filter((_, i) => i !== selected));
		setSelected((at) => Math.max(0, at - 1));
	};

	const revert = (): void => {
		// Only ever an override is dropped; the shipped art underneath it is
		// what `loadVaults` finds again.
		if (!draft) return;
		const shipped = loadVaults().find((entry) => entry.id === draft.id && !entry.local);
		if (!shipped) return;
		setDrafts((all) => all.map((entry, i) => (i === selected ? shipped : entry)));
	};

	return (
		<>
			<VaultList
				drafts={drafts}
				selected={selected}
				onSelect={setSelected}
				onAdd={add}
				onDuplicate={duplicate}
				onRemove={remove}
			/>

			<Box
				sx={{
					flex: 1,
					minWidth: 0,
					bgcolor: '#0e0f12',
					overflow: 'auto',
					display: 'grid',
					placeItems: 'center',
					p: 3,
				}}
			>
				{draft && <VaultCanvas draft={draft} onPaint={paint} />}
			</Box>

			<VaultInspector
				draft={draft ?? null}
				problems={problems}
				brush={brush}
				onBrushChange={setBrush}
				tier={tier}
				onTierChange={setTier}
				onChange={update}
				onRevert={revert}
			/>
		</>
	);
}
