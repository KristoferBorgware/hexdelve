/*
 * The particle bench's left-hand panel: the effects, and the file being edited.
 *
 * The list is the manifest's `particles` section, in its order, so a new effect
 * appears here the moment it is added to the tree and with no code anywhere.
 *
 * Under it is the document — what a save would put on disk, formatted by the
 * same writer that would write it. Read-only on purpose. An effect is thirty
 * numbers and a text box is a poor way to set any of them, but it is the only
 * honest answer to "what am I actually about to write", and it is what makes
 * the panel above trustworthy: every slider dragged shows up here as the line
 * it changes.
 *
 * The save button says which host it is talking to. On `npm run dev:editor`
 * the bytes land in public/assets; on the built editor published to Pages
 * there is nowhere to put a file, and the button says so rather than failing
 * when it is pressed.
 */

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import ReplayIcon from '@mui/icons-material/Replay';
import SaveIcon from '@mui/icons-material/Save';
import type { ParticleEffect } from '@hexdelve/engine';

export interface ParticleCatalogueProps {
	/** Every effect the manifest lists, in its order. */
	effects: readonly ParticleEffect[];
	effect: ParticleEffect;
	onEffectChange(effect: ParticleEffect): void;
	/** The document a save would write. */
	document: string;
	/** Whether the panel differs from the file it was read from. */
	edited: boolean;
	writable: boolean;
	saving: boolean;
	error: string | null;
	onSave(): void;
	onRevert(): void;
	onReplay(): void;
	onFrame(): void;
}

export function ParticleCatalogue({
	effects,
	effect,
	onEffectChange,
	document,
	edited,
	writable,
	saving,
	error,
	onSave,
	onRevert,
	onReplay,
	onFrame,
}: ParticleCatalogueProps) {
	return (
		<Box
			component="aside"
			sx={{
				width: 300,
				flexShrink: 0,
				borderRight: 1,
				borderColor: 'divider',
				bgcolor: 'background.paper',
				display: 'flex',
				flexDirection: 'column',
				minHeight: 0,
			}}
		>
			<List
				dense
				disablePadding
				subheader={<ListSubheader disableSticky>Effects</ListSubheader>}
				sx={{ flexShrink: 0 }}
			>
				{effects.map((one) => (
					<ListItemButton
						key={one.id}
						selected={one.id === effect.id}
						onClick={() => onEffectChange(one)}
					>
						<ListItemText
							primary={one.name}
							secondary={one.id}
							slotProps={{ primary: { variant: 'body2' } }}
						/>
					</ListItemButton>
				))}
			</List>

			<Stack direction="row" spacing={1} sx={{ p: 1, flexWrap: 'wrap', gap: 1 }}>
				<Tooltip describeChild title="Run it again from the top">
					<Button size="small" variant="outlined" startIcon={<ReplayIcon />} onClick={onReplay}>
						Replay
					</Button>
				</Tooltip>
				<Tooltip describeChild title="Put the camera back where it started">
					<Button
						size="small"
						variant="outlined"
						startIcon={<CenterFocusStrongIcon />}
						onClick={onFrame}
					>
						View
					</Button>
				</Tooltip>
				<Tooltip
					describeChild
					title={writable ? 'Write it back to its file' : 'This host has nowhere to put a file'}
				>
					<span>
						<Button
							size="small"
							variant="contained"
							disabled={!writable || !edited || saving}
							startIcon={<SaveIcon />}
							onClick={onSave}
						>
							Save
						</Button>
					</span>
				</Tooltip>
				<Tooltip describeChild title="Throw the changes away and read the file again">
					<span>
						<Button
							size="small"
							variant="outlined"
							disabled={!edited}
							startIcon={<RestartAltIcon />}
							onClick={onRevert}
						>
							Revert
						</Button>
					</span>
				</Tooltip>
			</Stack>

			{error && (
				<Alert severity="error" variant="outlined" sx={{ mx: 1, mb: 1 }}>
					{error}
				</Alert>
			)}

			<Typography variant="subtitle2" color="text.secondary" sx={{ px: 2, pt: 0.5 }}>
				{`particles/${effect.id}.particles.yaml`}
				{edited ? ' · edited' : ''}
			</Typography>

			<Box
				component="pre"
				sx={{
					flex: 1,
					minHeight: 0,
					overflow: 'auto',
					m: 0,
					px: 2,
					pb: 2,
					fontSize: 11,
					lineHeight: 1.5,
					color: 'text.secondary',
					whiteSpace: 'pre',
				}}
			>
				{document}
			</Box>
		</Box>
	);
}
