/*
 * The entity bench: a prefab's object tree, its subject, and what is on it.
 *
 * The other benches show something the code decided — a rig, a prop, a level —
 * and let you look at it from every side. This one edits: the tree on the left
 * is the `object:` block of an entity file, and the file is what a save writes.
 *
 * ## The document is the model, not the scene
 *
 * A draft is held here and the picture is drawn from it. The alternative — a
 * live scene that the tree edits and a save reads back — was the tempting one
 * and is wrong in a way that only shows up at the end: a scene carries what the
 * components made of the file, not the file, so anything a component normalised
 * or ignored would be lost on the first save. The draft goes to YAML, and the
 * picture is a reading of the draft.
 *
 * ## What the middle shows
 *
 * The entity itself, on the character bench's stand, plus a marker for every
 * object in the prefab and axes on the selected one. Most objects in a prefab
 * have no appearance at all — a `grip` on a hand is a transform and nothing
 * else — so without the markers the viewport would be a picture of a creature
 * with nothing in it to select.
 */

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BackendPreference, EntityAsset, ParameterMeta } from '@hexdelve/engine';
import { parametersOf } from '@hexdelve/engine';

import { components } from '@hexdelve/client';

import { useAssets } from '../../assets/library.js';
import type { CharacterBench } from '../../bench/CharacterBench.js';
import {
	addChild,
	addComponent,
	draftFromPrefab,
	emptyNode,
	findNode,
	moveNode,
	newComponent,
	parentOf,
	removeComponent,
	removeNode,
	renameNode,
	reorderNode,
	setField,
	setTransform,
	type DraftNode,
} from './entitydraft.js';
import { placeNodes } from './gizmos.js';
import { benchRigs } from '../../bench/rigs.js';
import { BenchViewport } from '../../components/BenchViewport.js';
import { EntityInspector } from './EntityInspector.js';
import { EntityTree } from './EntityTree.js';
import { useCompiledScripts } from '../../scripts/compiled.js';
import { saveEntityPrefab } from './saveEntity.js';

export interface EntityBenchViewProps {
	backend: BackendPreference;
	running: boolean;
}

export function EntityBenchView({ backend, running }: EntityBenchViewProps) {
	const assets = useAssets();
	const [entityId, setEntityId] = useState('');
	const [draft, setDraft] = useState<DraftNode | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [bench, setBench] = useState<CharacterBench | null>(null);
	const [saving, setSaving] = useState(false);
	const [note, setNote] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);

	const scripts = useCompiledScripts();

	/** Only characters have a rig to stand on the bench. */
	const rigs = useMemo(() => benchRigs(assets.entities), [assets.entities]);

	const entity = useMemo(
		() => assets.entities.find((one) => one.id === entityId) ?? null,
		[assets.entities, entityId],
	);

	// The first entity that can be shown, once the manifest is in.
	useEffect(() => {
		if (entityId || assets.entities.length === 0) return;
		setEntityId(assets.entities[0]!.id);
	}, [assets.entities, entityId]);

	// A new subject means a new draft, and nothing selected but its root.
	useEffect(() => {
		if (!entity) return;
		const next = draftFromPrefab(entity.prefab);
		setDraft(next);
		setSelectedId(next.id);
		setNote(null);
	}, [entity]);

	const placed = useMemo(() => (draft ? placeNodes(draft) : []), [draft]);

	// The markers follow the draft and the selection, and nothing else.
	useEffect(() => {
		bench?.setPrefab(placed, selectedId);
	}, [bench, placed, selectedId]);

	const onBenchReady = useCallback((next: CharacterBench | null) => setBench(next), []);

	const edit = useCallback((change: (root: DraftNode) => DraftNode) => {
		setDraft((current) => (current ? change(current) : current));
		setNote(null);
	}, []);

	const selected = draft && selectedId ? findNode(draft, selectedId) : null;

	/*
	 * What this build can instantiate. Read from the client's registry, which is
	 * where the game says what its components are — the engine has never heard
	 * of an `actor`, and a list written here would be a second answer able to
	 * disagree with the one that does the building.
	 */
	const componentTypes = useMemo(() => components.types, []);

	const parametersOfScript = useCallback(
		(name: string): readonly ParameterMeta[] => {
			const constructor = scripts.provider.resolve(name);
			return constructor ? parametersOf(constructor as never) : [];
		},
		[scripts.provider],
	);

	async function save(): Promise<void> {
		if (!entity || !draft) return;
		setSaving(true);
		try {
			await saveEntityPrefab(entity.id, draft);
			// `save` has already forgotten everything derived from the old file;
			// this is what puts the reloaded document back on screen.
			assets.reload();
			setNote({ kind: 'ok', text: `Wrote entities/${entity.id}.entity.yaml` });
		} catch (error) {
			setNote({ kind: 'bad', text: error instanceof Error ? error.message : String(error) });
		} finally {
			setSaving(false);
		}
	}

	if (assets.loading) return <Centre><CircularProgress size={22} /></Centre>;
	if (assets.error) return <Centre><Alert severity="error">{assets.error}</Alert></Centre>;

	const rig = rigs.find((one) => one.id === entityId) ?? rigs[0];

	return (
		<Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
			{draft && (
				<EntityTree
					root={draft}
					selectedId={selectedId}
					onSelect={setSelectedId}
					onAdd={(parentId) => {
						const child = emptyNode('object');
						edit((root) => addChild(root, parentId, child));
						setSelectedId(child.id);
					}}
					onRemove={(id) => {
						edit((root) => removeNode(root, id));
						setSelectedId(draft.id);
					}}
					onReorder={(id, by) => edit((root) => reorderNode(root, id, by))}
					onIndent={(id) =>
						edit((root) => {
							const parent = parentOf(root, id);
							if (!parent) return root;
							const at = parent.children.findIndex((one) => one.id === id);
							const above = parent.children[at - 1];
							return above ? moveNode(root, id, above.id) : root;
						})
					}
					onOutdent={(id) =>
						edit((root) => {
							const parent = parentOf(root, id);
							const grandparent = parent ? parentOf(root, parent.id) : null;
							return grandparent ? moveNode(root, id, grandparent.id) : root;
						})
					}
				/>
			)}

			<Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
				<Stack
					direction="row"
					spacing={1}
					sx={{ p: 1, borderBottom: 1, borderColor: 'divider', alignItems: 'center' }}
				>
					<TextField
						select
						size="small"
						label="Entity"
						value={entityId}
						sx={{ minWidth: 200 }}
						onChange={(event) => setEntityId(event.target.value)}
					>
						{assets.entities.map((one: EntityAsset) => (
							<MenuItem key={one.id} value={one.id}>
								{one.name}
							</MenuItem>
						))}
					</TextField>
					<Box sx={{ flex: 1 }} />
					{note && (
						<Typography variant="caption" color={note.kind === 'ok' ? 'success.main' : 'error'}>
							{note.text}
						</Typography>
					)}
					<Button size="small" variant="outlined" disabled={!draft || saving} onClick={save}>
						{saving ? 'Saving…' : 'Save'}
					</Button>
				</Stack>

				{rig ? (
					<BenchViewport
						backend={backend}
						running={running}
						rig={rig}
						onBenchReady={onBenchReady}
					/>
				) : (
					<Centre>
						<Typography variant="body2" color="text.secondary">
							Nothing here has a rig to stand on the bench.
						</Typography>
					</Centre>
				)}
			</Box>

			<EntityInspector
				node={selected}
				componentTypes={componentTypes}
				scriptNames={scripts.names}
				parametersOfScript={parametersOfScript}
				onRename={(name) => selectedId && edit((root) => renameNode(root, selectedId, name))}
				onTransform={(part, axis, value) =>
					selectedId && edit((root) => setTransform(root, selectedId, part, axis, value))
				}
				onAddComponent={(type) => {
					if (!selectedId) return;
					edit((root) => addComponent(root, selectedId, newComponent(type)));
				}}
				onRemoveComponent={(componentId) =>
					selectedId && edit((root) => removeComponent(root, selectedId, componentId))
				}
				onField={(componentId, key, value) =>
					selectedId && edit((root) => setField(root, selectedId, componentId, key, value))
				}
			/>
		</Box>
	);
}

function Centre({ children }: { children: React.ReactNode }) {
	return (
		<Box
			sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}
		>
			{children}
		</Box>
	);
}
