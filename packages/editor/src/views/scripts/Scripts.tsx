/*
 * The script view: the client's behaviour, written where it runs.
 *
 * Every other view in this editor either previews something the code decided
 * or edits a file of data. This one edits CODE, which is the same claim the
 * asset view makes and a larger one — a script is a TypeScript file in
 * `packages/client/scripts`, tracked in the repository, compiled by the same
 * esbuild the yard's hot reload uses, and there is no editor-only dialect of
 * it. What is on the right is the actual file.
 *
 * ## What this adds over a text editor and a terminal
 *
 * Three things, and each of them is the reason for a paragraph elsewhere.
 * The language service knows the SDK, because the declarations are the ones
 * `npm run typecheck` uses — so a misspelt field is underlined as it is typed
 * rather than found by a compiler two minutes later. Saving COMPILES, through
 * the same call the running yard compiles with, so a file that will not build
 * says so here with the error on its own line. And the host that can write is
 * named in the corner, so nobody types into a page that cannot save.
 *
 * ## The yard beside the code
 *
 * A compile that reaches nothing is a compile nobody can judge, so this view
 * has a running world of its own — the same client the yard view mounts, in a
 * pane beside the editor — and every successful compile is swapped into it
 * with `host.reload`. The world is not restarted: the host rebuilds every
 * instance behind its id, keeping the parameters somebody set, so a change to
 * a number takes effect on a creature that is mid-fight rather than on a fresh
 * one that has forgotten the fight.
 *
 * It reloads on a COMPILE rather than on a save, which is the one place this
 * view knowingly runs something that is not on disk. That is the useful order:
 * try the change, then keep it. The status line says which it is, because a
 * world running a buffer nobody saved is exactly the state somebody would
 * otherwise walk away from and lose.
 *
 * The pane has its own watcher turned off. What belongs in this host is what
 * these buffers compile to, and a watcher reading the directory would overwrite
 * it with the disk a moment later — see `watch` in Viewport.
 */

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import RestoreIcon from '@mui/icons-material/Restore';
import SaveIcon from '@mui/icons-material/Save';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HexdelveClient } from '@hexdelve/client';
import type { BackendPreference } from '@hexdelve/engine';
import type { ScriptProvider } from '@hexdelve/engine';

import { compileScripts, type ScriptDiagnostic } from '../../scripts/compiler.js';
import { scriptNameProblem, scriptStem, scriptStore } from '../../scripts/store.js';
import { loadScriptTypes, type ScriptTypesState } from '../../monaco/types.js';
import { SCRIPT_ROOT } from '../../monaco/uris.js';
import { CodeEditor, type CodeMarker } from '../../components/CodeEditor.js';
import { Viewport } from '../../components/Viewport.js';

/** What a new script starts as. Enough to be a script, and nothing more. */
function template(name: string): string {
	const stem = scriptStem(name);
	return `/*
 * ${stem}.
 */

import { Script } from '@hexdelve/engine';

export class ${stem} extends Script {
	override tick(dt: number): void {}
}
`;
}

/** The last compile, whatever it said. */
interface CompileState {
	/** The class names the bundle produced. */
	readonly names: readonly string[];
	readonly error: string | null;
	readonly diagnostics: readonly ScriptDiagnostic[];
	readonly compiling: boolean;
	/** Null before anything has been compiled in this session. */
	readonly at: number | null;
	/** How many times a compile has been swapped into the world beside it. */
	readonly swaps: number;
}

const IDLE: CompileState = {
	names: [],
	error: null,
	diagnostics: [],
	compiling: false,
	at: null,
	swaps: 0,
};

export interface ScriptsProps {
	backend: BackendPreference;
	/** Whether the world beside the code is running. The toolbar's transport. */
	running: boolean;
}

export function Scripts({ backend, running }: ScriptsProps) {
	/** What is on disk, as far as this view knows. */
	const [saved, setSaved] = useState<ReadonlyMap<string, string>>(new Map());
	/** What is in the buffers. The same text until somebody types. */
	const [buffers, setBuffers] = useState<ReadonlyMap<string, string>>(new Map());
	const [selected, setSelected] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
	const [compile, setCompile] = useState<CompileState>(IDLE);
	const [types, setTypes] = useState<ScriptTypesState | null>(null);
	const [naming, setNaming] = useState<string | null>(null);
	/**
	 * The world beside the code, once it has a renderer. Null while it starts,
	 * and null for good if it fails or the pane is hidden.
	 *
	 * Held twice on purpose. The state is what the view renders from; the ref is
	 * what a compile finishing later reads, because a compile started before the
	 * world existed must still swap into the world that exists when it lands.
	 */
	const [client, setClient] = useState<HexdelveClient | null>(null);
	const world = useRef<HexdelveClient | null>(null);
	/** The buffers, for an effect that must not run again when they change. */
	const sources = useRef<ReadonlyMap<string, string>>(new Map());
	const [showYard, setShowYard] = useState(true);
	/**
	 * What the world is running, and what the next compile falls back to.
	 *
	 * A ref rather than state: nothing renders it, and a compile that lands
	 * after a re-render must swap the provider it just built rather than one
	 * captured when the callback was made.
	 */
	const live = useRef<ScriptProvider | null>(null);

	const writable = scriptStore.writable;
	sources.current = buffers;
	const names = useMemo(() => [...buffers.keys()].sort(), [buffers]);
	const text = selected === null ? '' : (buffers.get(selected) ?? '');
	const dirty = selected !== null && buffers.get(selected) !== saved.get(selected);
	const anyDirty = useMemo(
		() => [...buffers].some(([name, value]) => saved.get(name) !== value),
		[buffers, saved],
	);

	// Stable, because Viewport tears its client down when this identity changes.
	const onClientReady = useCallback((next: HexdelveClient | null) => {
		world.current = next;
		setClient(next);
	}, []);

	// Every script, once. The compiler needs all of them to build any of them —
	// one bundle, so that a script can import its neighbour.
	useEffect(() => {
		let live = true;
		scriptStore
			.readAll()
			.then((sources) => {
				if (!live) return;
				setSaved(sources);
				setBuffers(new Map(sources));
				setSelected((current) => current ?? [...sources.keys()].sort()[0] ?? null);
				setLoading(false);
			})
			.catch((error: unknown) => {
				if (!live) return;
				setLoading(false);
				setMessage({ kind: 'error', text: why(error) });
			});
		return () => {
			live = false;
		};
	}, []);

	// The declarations, once, so the language service has something to say.
	useEffect(() => {
		let live = true;
		void loadScriptTypes().then((state) => {
			if (live) setTypes(state);
		});
		return () => {
			live = false;
		};
	}, []);

	/**
	 * Put a compiled set of classes into a running world.
	 *
	 * The one place the count moves, because there are two ways a swap happens
	 * and they are the same event: a compile finishing while a world is up, and
	 * a world starting when something has already been compiled for it.
	 */
	const swapInto = useCallback((target: HexdelveClient, provider: ScriptProvider) => {
		// Every instance is rebuilt behind its id, so the world is not
		// restarted and nothing that points at a script is disturbed.
		target.simulation.scripts.reload(provider);
		setCompile((state) => ({ ...state, swaps: state.swaps + 1 }));
	}, []);

	/**
	 * Compile the buffers, and put what comes out into the world beside them.
	 *
	 * The previous provider is handed to the compiler so that a failure leaves
	 * the world running what it was running — the same rule the yard's watcher
	 * follows, and the difference between an editor somebody can work in and
	 * one that empties itself every time a file is half-typed.
	 */
	const build = useCallback(
		async (sources: ReadonlyMap<string, string>): Promise<void> => {
			setCompile((state) => ({ ...state, compiling: true }));
			const result = await compileScripts(sources, live.current ?? undefined);

			if (!result.error) {
				live.current = result.provider;
				// Read from the ref rather than from state: this may have
				// started before there was a world, and what matters is the one
				// there is now. When there is none, the effect below hands it
				// over as soon as there is.
				if (world.current) swapInto(world.current, result.provider);
			}

			setCompile((state) => ({
				...state,
				names: result.names,
				error: result.error,
				diagnostics: result.diagnostics,
				compiling: false,
				at: Date.now(),
			}));
		},
		[swapInto],
	);

	/*
	 * Compile once, as soon as there is something to compile.
	 *
	 * Not because there is a world to put it in — there may not be, and the
	 * pane can be hidden or its renderer can fail — but because a compile is
	 * the answer to "does this build", which is worth having on screen either
	 * way. Guarded on `live`, so this is the first compile and not every one.
	 */
	useEffect(() => {
		if (loading || live.current) return;
		void build(sources.current);
	}, [loading, build]);

	/*
	 * A world that has just started has NOTHING on it: an editor-hosted client
	 * fetches no compiled bundle, so everything it runs is compiled here. So
	 * whatever was last compiled is put into it as soon as it exists — which is
	 * what makes switching backend, or showing the pane after hiding it, keep
	 * the change somebody was looking at.
	 */
	useEffect(() => {
		if (client && live.current) swapInto(client, live.current);
	}, [client, swapInto]);

	const save = useCallback(() => {
		if (selected === null || !writable) return;
		const content = buffers.get(selected) ?? '';
		setBusy(true);
		scriptStore
			.write(selected, content)
			.then(async () => {
				setSaved((previous) => new Map(previous).set(selected, content));
				setMessage({ kind: 'success', text: `Saved ${selected}` });
				// What was just written, compiled — the same call the yard's
				// hot reload makes, so a file that builds here builds there.
				await build(buffers);
			})
			.catch((error: unknown) => setMessage({ kind: 'error', text: why(error) }))
			.finally(() => setBusy(false));
	}, [selected, writable, buffers, build]);

	const revert = useCallback(() => {
		if (selected === null) return;
		setBuffers((previous) => new Map(previous).set(selected, saved.get(selected) ?? ''));
		setMessage(null);
	}, [selected, saved]);

	const create = useCallback((name: string) => {
		const content = template(name);
		setBusy(true);
		scriptStore
			.write(name, content)
			.then(() => {
				setSaved((previous) => new Map(previous).set(name, content));
				setBuffers((previous) => new Map(previous).set(name, content));
				setSelected(name);
				setNaming(null);
				setMessage({ kind: 'success', text: `Created ${name}` });
			})
			.catch((error: unknown) => setMessage({ kind: 'error', text: why(error) }))
			.finally(() => setBusy(false));
	}, []);

	const remove = useCallback(() => {
		if (selected === null || !writable) return;
		const name = selected;
		setBusy(true);
		scriptStore
			.remove(name)
			.then(() => {
				const left = new Map(buffers);
				left.delete(name);
				setBuffers(left);
				setSaved((previous) => {
					const next = new Map(previous);
					next.delete(name);
					return next;
				});
				// Somewhere to be, rather than an empty pane with a name on it.
				setSelected([...left.keys()].sort()[0] ?? null);
				setMessage({ kind: 'success', text: `Deleted ${name}` });
			})
			.catch((error: unknown) => setMessage({ kind: 'error', text: why(error) }))
			.finally(() => setBusy(false));
	}, [selected, writable, buffers]);

	/*
	 * Every script, by the URI the language service knows it as.
	 *
	 * The whole directory rather than the open file: `Combat.ts` imports
	 * `./events.js`, and a service that has not been shown `events.ts` reports
	 * that line as an error in a file that compiles perfectly.
	 */
	const documents = useMemo(() => {
		const out = new Map<string, string>();
		for (const [name, content] of buffers) out.set(`${SCRIPT_ROOT}${name}`, content);
		return out;
	}, [buffers]);

	// Only this file's errors: the pane is showing one document, and a marker
	// belongs on the line it is about.
	const markers = useMemo<CodeMarker[]>(() => {
		if (selected === null) return [];
		return compile.diagnostics
			.filter((problem) => problem.file === selected)
			.map((problem) => ({
				line: problem.line,
				column: problem.column,
				length: problem.length,
				message: problem.text,
			}));
	}, [compile.diagnostics, selected]);

	return (
		<Box sx={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', minHeight: 0 }}>
			<Box
				sx={{
					width: 260,
					flexShrink: 0,
					borderRight: 1,
					borderColor: 'divider',
					display: 'flex',
					flexDirection: 'column',
					minHeight: 0,
				}}
			>
				{/* Which host, pinned: whether this page can save is the first
				    thing to know and the last thing that should scroll away. */}
				<Box sx={{ p: 1.5, flexShrink: 0 }}>
					<Typography variant="overline" color="text.secondary">
						Host
					</Typography>
					<Stack direction="row" spacing={1} sx={{ mt: 0.5, alignItems: 'center' }}>
						<Chip
							size="small"
							label={scriptStore.kind}
							color={writable ? 'success' : 'default'}
							variant={writable ? 'filled' : 'outlined'}
						/>
						<Typography variant="caption" color="text.secondary" noWrap>
							{writable ? 'read and write' : 'read-only'}
						</Typography>
					</Stack>
					{!writable && (
						<Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
							A built page has nowhere to put a file. Run <code>npm run dev:editor</code>, or
							open the desktop editor.
						</Typography>
					)}
					{types && types.error && (
						<Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 1 }}>
							No declarations: {types.error}
						</Typography>
					)}
					{types && !types.error && types.missing.length > 0 && (
						<Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 1 }}>
							Not built: {types.missing.join(', ')}. Run <code>npm run typecheck</code>.
						</Typography>
					)}
				</Box>
				<Divider />

				<Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
					{loading && (
						<Box sx={{ p: 2, display: 'flex', justifyContent: 'center' }}>
							<CircularProgress size={22} />
						</Box>
					)}
					<List dense disablePadding>
						{names.map((name) => (
							<ListItemButton
								key={name}
								selected={name === selected}
								onClick={() => setSelected(name)}
							>
								<ListItemText
									primary={`${name}${saved.get(name) === buffers.get(name) ? '' : ' •'}`}
									slotProps={{ primary: { variant: 'body2', noWrap: true } }}
								/>
							</ListItemButton>
						))}
					</List>
				</Box>

				<Divider />
				<Stack direction="row" spacing={1} sx={{ p: 1 }}>
					<Tooltip title={writable ? 'A new script' : 'This host cannot write'}>
						<span>
							<Button
								size="small"
								startIcon={<AddIcon />}
								disabled={!writable || busy}
								onClick={() => setNaming('')}
							>
								New
							</Button>
						</span>
					</Tooltip>
					<Box sx={{ flexGrow: 1 }} />
					<Tooltip title={writable ? 'Delete this script' : 'This host cannot write'}>
						<span>
							<Button
								size="small"
								color="error"
								startIcon={<DeleteIcon />}
								disabled={!writable || busy || selected === null}
								onClick={remove}
							>
								Delete
							</Button>
						</span>
					</Tooltip>
				</Stack>
			</Box>

			<Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
				<Stack
					direction="row"
					spacing={1}
					sx={{ p: 1, borderBottom: 1, borderColor: 'divider', alignItems: 'center' }}
				>
					<Typography variant="body2" sx={{ flex: 1 }} noWrap>
						{selected ?? 'nothing selected'}
						{dirty && ' •'}
					</Typography>
					<Tooltip title={showYard ? 'Hide the world, and use the width' : 'Show the world'}>
						<ToggleButton
							size="small"
							value="yard"
							selected={showYard}
							sx={{ px: 1, py: 0.25 }}
							onChange={() => setShowYard((shown) => !shown)}
						>
							Yard
						</ToggleButton>
					</Tooltip>
					<Tooltip
						title={
							showYard
								? 'Compile these buffers and swap them into the world'
								: 'Compile these buffers'
						}
					>
						<span>
							<Button
								size="small"
								startIcon={<PlayArrowIcon />}
								disabled={busy || compile.compiling || buffers.size === 0}
								onClick={() => void build(buffers)}
							>
								Compile
							</Button>
						</span>
					</Tooltip>
					<Button
						size="small"
						startIcon={<RestoreIcon />}
						disabled={!dirty || busy}
						onClick={revert}
					>
						Revert
					</Button>
					<Tooltip title={writable ? '' : 'This host cannot write'}>
						<span>
							<Button
								size="small"
								variant="contained"
								startIcon={<SaveIcon />}
								disabled={!writable || !dirty || busy}
								onClick={save}
							>
								Save
							</Button>
						</span>
					</Tooltip>
				</Stack>

				{message && (
					<Alert severity={message.kind} sx={{ borderRadius: 0 }} onClose={() => setMessage(null)}>
						{message.text}
					</Alert>
				)}
				{compile.error && (
					<Alert severity="error" sx={{ borderRadius: 0, whiteSpace: 'pre-wrap' }}>
						{compile.error}
					</Alert>
				)}

				<Box sx={{ flex: 1, display: 'flex', minHeight: 0, minWidth: 0 }}>
					<Box
						sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}
					>
						{selected === null ? (
							<Box sx={{ flex: 1, display: 'grid', placeItems: 'center' }}>
								<Typography variant="body2" color="text.secondary">
									{loading ? '' : 'No scripts here yet.'}
								</Typography>
							</Box>
						) : (
							<CodeEditor
								uri={`${SCRIPT_ROOT}${selected}`}
								language="typescript"
								value={text}
								readOnly={!writable}
								markers={markers}
								documents={documents}
								onChange={(next) =>
									setBuffers((previous) => new Map(previous).set(selected, next))
								}
								onSave={save}
							/>
						)}
					</Box>

					{/*
					 * The world these scripts run in, so a compile can be judged
					 * rather than reported. It is the client, unchanged — the same
					 * component the yard view mounts — with its own watcher off,
					 * because what belongs in this host is what the buffers on the
					 * left compile to. See the header.
					 */}
					{showYard && (
						<Box
							sx={{
								width: 480,
								flexShrink: 0,
								borderLeft: 1,
								borderColor: 'divider',
								display: 'flex',
								minHeight: 0,
							}}
						>
							<Viewport
								backend={backend}
								running={running}
								watch={false}
								onClientReady={onClientReady}
							/>
						</Box>
					)}
				</Box>

				<Stack
					direction="row"
					spacing={2}
					sx={{ px: 2, py: 0.75, borderTop: 1, borderColor: 'divider', alignItems: 'center' }}
				>
					<Typography variant="caption" color="text.secondary">
						{names.length} scripts
					</Typography>
					<Typography variant="caption" color="text.secondary">
						{text.split('\n').length} lines
					</Typography>
					<Typography variant="caption" color="text.secondary">
						{types ? `${types.count} declarations` : 'declarations…'}
					</Typography>
					<Box sx={{ flexGrow: 1 }} />
					{compile.compiling && <CircularProgress size={14} />}
					{compile.at !== null && !compile.compiling && (
						<Typography
							variant="caption"
							color={compile.error ? 'error.main' : 'success.main'}
							noWrap
						>
							{compile.error
								? `${compile.diagnostics.length || 1} error${
										compile.diagnostics.length === 1 ? '' : 's'
									}`
								: `compiled ${compile.names.length} classes: ${compile.names.join(', ')}`}
						</Typography>
					)}
					{/*
					 * What the world is actually running, which is the question a
					 * compile raises. A count rather than a tick, because the
					 * useful thing to know is that the last swap was YOURS.
					 */}
					{compile.swaps > 0 && (
						<Typography variant="caption" color="text.secondary" noWrap>
							swapped into the yard ×{compile.swaps}
						</Typography>
					)}
					{anyDirty && (
						<Typography variant="caption" color="warning.main" noWrap>
							{compile.swaps > 0 ? 'the yard is running unsaved edits' : 'unsaved'}
						</Typography>
					)}
				</Stack>
			</Box>

			<NewScript
				name={naming}
				taken={names}
				onCancel={() => setNaming(null)}
				onChange={setNaming}
				onCreate={create}
			/>
		</Box>
	);
}

interface NewScriptProps {
	/** The name being typed, or null when the dialog is shut. */
	readonly name: string | null;
	readonly taken: readonly string[];
	onChange(name: string): void;
	onCancel(): void;
	onCreate(name: string): void;
}

/**
 * Naming a new script.
 *
 * The rule is checked here rather than after the round trip, because the dev
 * server and the desktop shell both refuse a name that does not resolve to a
 * `.ts` inside the script directory and a 400 is a poor way to learn that.
 */
function NewScript({ name, taken, onChange, onCancel, onCreate }: NewScriptProps) {
	const open = name !== null;
	const filled = name === '' ? null : (name ?? null);
	const problem =
		filled === null
			? null
			: (scriptNameProblem(filled) ?? (taken.includes(filled) ? 'there is one of those' : null));

	return (
		<Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth>
			<DialogTitle>New script</DialogTitle>
			<DialogContent>
				<TextField
					autoFocus
					fullWidth
					size="small"
					margin="dense"
					label="File name"
					placeholder="Patrol.ts"
					value={name ?? ''}
					error={problem !== null}
					helperText={problem ?? 'A class of the same name is what a prefab will ask for.'}
					onChange={(event) => onChange(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === 'Enter' && filled !== null && problem === null) onCreate(filled);
					}}
				/>
			</DialogContent>
			<DialogActions>
				<Button onClick={onCancel}>Cancel</Button>
				<Button
					variant="contained"
					disabled={filled === null || problem !== null}
					onClick={() => filled !== null && onCreate(filled)}
				>
					Create
				</Button>
			</DialogActions>
		</Dialog>
	);
}

function why(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
