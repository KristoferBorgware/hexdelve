/*
 * The asset view: the files themselves, and a way to change them.
 *
 * Every other view in this editor previews something the code decided. This
 * one edits the decision. What is on the right is the actual bytes of the
 * actual file — no form, no fields, no schema-driven widgets — and that is a
 * choice rather than a shortcut: these documents are written to be read, they
 * carry comments explaining why a cheek plate sits where it does, and a form
 * would throw all of that away the first time it round-tripped one.
 *
 * What the editor adds instead is the two things a text box cannot do on its
 * own. It VALIDATES before writing, so a document that could not be read back
 * is never saved — turning an unsaved change into a broken asset is strictly
 * worse than refusing. And it RELOADS the whole graph afterwards, because a
 * rig's hip height moves every mesh hung on it, and a view still holding the
 * old objects would be showing a character that no longer exists.
 *
 * When the host cannot write, it says so and leaves the text read-only. The
 * published editor is that host, and an editor offering a save that silently
 * does nothing is worse than one that admits what it is.
 */

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import SaveIcon from '@mui/icons-material/Save';
import RestoreIcon from '@mui/icons-material/Restore';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { backendLabel, library, useAssets } from '../assets/library.js';

/** `rigs/humanoid.rig.yaml` sorts and reads better grouped by its directory. */
function group(path: string): string {
	const slash = path.indexOf('/');
	return slash === -1 ? 'root' : path.slice(0, slash);
}

function leaf(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}

export function Assets() {
	const { entities, paths, loading, error, reload } = useAssets();
	const [selected, setSelected] = useState<string | null>(null);
	const [text, setText] = useState('');
	const [original, setOriginal] = useState('');
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

	const writable = library.writable;
	const dirty = text !== original;

	// The first file, once there is one, so the pane is never blank on arrival.
	useEffect(() => {
		if (selected === null && paths.length > 0) setSelected(paths[0]!);
	}, [paths, selected]);

	// Load whichever file is selected. Reading through the library rather than
	// around it means this is the same text every other view was built from.
	useEffect(() => {
		if (selected === null) return;
		let live = true;
		library
			.text(selected)
			.then((content) => {
				if (!live) return;
				setText(content);
				setOriginal(content);
				setMessage(null);
			})
			.catch((cause: unknown) => {
				if (!live) return;
				setMessage({ kind: 'error', text: cause instanceof Error ? cause.message : String(cause) });
			});
		return () => {
			live = false;
		};
	}, [selected]);

	const save = useCallback(() => {
		if (selected === null) return;
		setBusy(true);
		library
			.save(selected, text)
			.then(() => {
				setOriginal(text);
				setMessage({ kind: 'success', text: `Saved ${selected}` });
				// The library has forgotten everything derived from that file;
				// this is what brings the rest of the editor back into step.
				reload();
			})
			.catch((cause: unknown) => {
				setMessage({ kind: 'error', text: cause instanceof Error ? cause.message : String(cause) });
			})
			.finally(() => setBusy(false));
	}, [selected, text, reload]);

	const revert = useCallback(() => {
		setText(original);
		setMessage(null);
	}, [original]);

	const groups = useMemo(() => {
		const out = new Map<string, string[]>();
		for (const path of paths) {
			const key = group(path);
			const list = out.get(key);
			if (list) list.push(path);
			else out.set(key, [path]);
		}
		return [...out.entries()];
	}, [paths]);

	return (
		<Box sx={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', minHeight: 0 }}>
			<Box
				sx={{
					width: 300,
					flexShrink: 0,
					borderRight: 1,
					borderColor: 'divider',
					display: 'flex',
					flexDirection: 'column',
					minHeight: 0,
				}}
			>
				{/* Which backend, pinned: whether this host can save is the first
				    thing to know and the last thing that should scroll away. */}
				<Box sx={{ p: 1.5, flexShrink: 0 }}>
					<Typography variant="overline" color="text.secondary">
						Backend
					</Typography>
					<Stack direction="row" spacing={1} sx={{ mt: 0.5, alignItems: 'center' }}>
						<Chip
							size="small"
							label={library.source.kind}
							color={writable ? 'success' : 'default'}
							variant={writable ? 'filled' : 'outlined'}
						/>
						<Tooltip title={backendLabel()}>
							<Typography variant="caption" color="text.secondary" noWrap>
								{writable ? 'read and write' : 'read-only'}
							</Typography>
						</Tooltip>
					</Stack>
					{!writable && (
						<Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
							A built page has nowhere to put a file. Run <code>npm run dev:editor</code> to
							author.
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

				{groups.map(([name, list]) => (
					<List
						key={name}
						dense
						disablePadding
						subheader={<ListSubheader disableSticky>{name}</ListSubheader>}
					>
						{list.map((path) => (
							<ListItemButton
								key={path}
								selected={path === selected}
								onClick={() => setSelected(path)}
							>
								<ListItemText
									primary={leaf(path)}
									slotProps={{ primary: { variant: 'body2', noWrap: true } }}
								/>
							</ListItemButton>
						))}
					</List>
				))}
				</Box>
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

				{error && (
					<Alert severity="error" sx={{ borderRadius: 0 }}>
						{error}
					</Alert>
				)}
				{message && (
					<Alert severity={message.kind} sx={{ borderRadius: 0 }} onClose={() => setMessage(null)}>
						{message.text}
					</Alert>
				)}

				{/*
				 * A plain textarea rather than a code editor component. It is
				 * the file, it is monospaced, and it does not need a
				 * three-hundred-kilobyte dependency to be one.
				 */}
				<Box
					component="textarea"
					value={text}
					readOnly={!writable}
					spellCheck={false}
					onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value)}
					sx={{
						flex: 1,
						minHeight: 0,
						// A textarea has an intrinsic `cols` width and will sit at it
						// inside a flex column, however much room is going spare.
						width: '100%',
						boxSizing: 'border-box',
						border: 0,
						outline: 'none',
						resize: 'none',
						p: 2,
						fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
						fontSize: 12.5,
						lineHeight: 1.55,
						tabSize: 2,
						color: 'text.primary',
						backgroundColor: writable ? 'background.paper' : 'action.hover',
					}}
				/>

				<Stack
					direction="row"
					spacing={2}
					sx={{ px: 2, py: 0.75, borderTop: 1, borderColor: 'divider' }}
				>
					<Typography variant="caption" color="text.secondary">
						{entities.length} entities
					</Typography>
					<Typography variant="caption" color="text.secondary">
						{paths.length} files
					</Typography>
					<Typography variant="caption" color="text.secondary">
						{text.split('\n').length} lines
					</Typography>
				</Stack>
			</Box>
		</Box>
	);
}
