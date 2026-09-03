/*
 * The prop bench's right-hand panel: how it is shown, what it would be, and
 * what it measures.
 *
 * Three sections, and the order is deliberate. PREVIEW is how the thing is
 * being drawn. STATS is the mock — the numbers a prop will have one day, in a
 * form, editable, saved nowhere, and saying so on screen. MEASURED is the
 * opposite of the mock: dimensions read straight off the mesh, which are the
 * only numbers on this panel that are true today.
 *
 * The form is generated from `statGroups`, not written out here. That is the
 * whole reason the mock is worth having: adding a stat is one line in a table
 * and no change to this file, so when the real item definition arrives, what
 * has to be replaced is the table and not the panel.
 */

import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { useEffect, useState, type ReactElement } from 'react';

import { WEARER, type PropBench, type PropDisplay, type PropShow } from '../bench/PropBench.js';
import type { BenchProp, PropBox } from '../bench/props.js';
import type { BenchAnimation } from '../bench/rigs.js';
import { statGroups, type PropStats, type PropStatValue } from '../bench/stats.js';

export interface PropInspectorProps {
	bench: PropBench | null;
	prop: BenchProp;
	display: PropDisplay;
	onDisplayChange(display: PropDisplay): void;
	animation: BenchAnimation;
	onAnimationChange(animation: BenchAnimation): void;
	show: PropShow;
	onShowChange(key: keyof PropShow, value: boolean): void;
	stats: PropStats;
	onStatChange(key: string, value: PropStatValue): void;
	onRevert(): void;
	edited: boolean;
}

const DISPLAYS: { value: PropDisplay; label: string; hint: string }[] = [
	{ value: 'stand', label: 'Stand', hint: 'The model as authored, centred on the pad' },
	{ value: 'ground', label: 'Ground', hint: 'Its own lift and tilt — how it lies in the grass' },
	{ value: 'worn', label: 'Worn', hint: 'Through its bone, on the wanderer' },
];

const SHOW: { key: keyof PropShow; label: string; hint: string }[] = [
	// "Pad" rather than "Stand", which is taken by the display above it.
	{ key: 'pad', label: 'Pad', hint: 'The stand, and the shadow it catches' },
	{ key: 'spin', label: 'Turntable', hint: 'Turn the subject while you look at it' },
	{ key: 'bounds', label: 'Bounds', hint: 'The measured box, drawn as twelve edges' },
	{ key: 'ghost', label: 'Ghost', hint: 'Fade the wearer, so the gear reads against him' },
];

export function PropInspector({
	bench,
	prop,
	display,
	onDisplayChange,
	animation,
	onAnimationChange,
	show,
	onShowChange,
	stats,
	onStatChange,
	onRevert,
	edited,
}: PropInspectorProps) {
	const [fps, setFps] = useState(0);
	const [instances, setInstances] = useState(0);
	const [parts, setParts] = useState(0);
	const [box, setBox] = useState<PropBox | null>(null);
	const [copied, setCopied] = useState(false);

	/*
	 * The frame loop produces these sixty times a second and a re-render at
	 * that rate would be both slower and unreadable; a readout at twelve is
	 * legible and costs nothing.
	 */
	useEffect(() => {
		if (!bench) return;
		const handle = window.setInterval(() => {
			setFps(bench.stats.fps);
			setInstances(bench.stats.instances);
			setParts(bench.stats.parts);
			setBox(bench.bounds);
		}, 80);
		return () => window.clearInterval(handle);
	}, [bench]);

	useEffect(() => {
		if (!copied) return;
		const handle = window.setTimeout(() => setCopied(false), 1400);
		return () => window.clearTimeout(handle);
	}, [copied]);

	const info = bench?.info;

	const row = (label: string, value: string): ReactElement => (
		<Box key={label} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, py: 0.15 }}>
			<Typography variant="caption" color="text.secondary">
				{label}
			</Typography>
			<Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
				{value}
			</Typography>
		</Box>
	);

	const copyStats = (): void => {
		const json = JSON.stringify({ id: prop.id, ...stats }, null, '\t');
		// Nothing here is saved, so the clipboard is the only way an edit
		// leaves the panel at all. It is also the whole export path for now.
		void navigator.clipboard?.writeText(json).then(
			() => setCopied(true),
			() => setCopied(false),
		);
	};

	return (
		<Box
			component="aside"
			sx={{
				width: 300,
				flexShrink: 0,
				borderLeft: 1,
				borderColor: 'divider',
				bgcolor: 'background.paper',
				overflowY: 'auto',
				p: 2,
			}}
		>
			<Typography variant="subtitle2" color="text.secondary">
				Renderer
			</Typography>

			<Stack direction="row" spacing={1} sx={{ mt: 1, mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
				<Chip
					size="small"
					color={info?.backend === 'webgpu' ? 'primary' : 'default'}
					label={info ? (info.backend === 'webgpu' ? 'WebGPU' : 'WebGL2') : '—'}
				/>
				<Chip size="small" variant="outlined" label={`${fps.toFixed(0)} fps`} />
				<Chip size="small" variant="outlined" label={`${instances} prisms`} />
				<Chip size="small" variant="outlined" label={`${parts} parts`} />
			</Stack>

			<Divider sx={{ my: 1.5 }} />

			<Typography variant="subtitle2" color="text.secondary" gutterBottom>
				Preview
			</Typography>

			<ToggleButtonGroup
				size="small"
				exclusive
				fullWidth
				value={display}
				disabled={!bench}
				onChange={(_, value: PropDisplay | null) => value && onDisplayChange(value)}
			>
				{DISPLAYS.map((entry) => (
					// `describeChild`, or the tooltip becomes the button's name:
					// a screen reader would read the hint and never say "Ground".
					<Tooltip key={entry.value} describeChild title={entry.hint}>
						<ToggleButton value={entry.value}>{entry.label}</ToggleButton>
					</Tooltip>
				))}
			</ToggleButtonGroup>

			{display === 'worn' && (
				<TextField
					select
					fullWidth
					size="small"
					label="Wearer"
					sx={{ mt: 1.5 }}
					value={animation.id}
					disabled={!bench}
					onChange={(event) => {
						const next = WEARER.animations.find(
							(candidate) => candidate.id === event.target.value,
						);
						if (next) onAnimationChange(next);
					}}
				>
					{WEARER.animations.map((candidate) => (
						<MenuItem key={candidate.id} value={candidate.id}>
							{candidate.label}
						</MenuItem>
					))}
				</TextField>
			)}

			<Box sx={{ mt: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 1 }}>
				{SHOW.map(({ key, label, hint }) => (
					<FormControlLabel
						key={key}
						title={hint}
						sx={{ m: 0 }}
						control={
							<Checkbox
								size="small"
								// Bounds mean nothing on a wearer, and there is
								// nobody to ghost anywhere else.
								disabled={
									!bench ||
									(key === 'bounds' && display === 'worn') ||
									(key === 'ghost' && display !== 'worn')
								}
								checked={show[key]}
								onChange={(event) => onShowChange(key, event.target.checked)}
							/>
						}
						label={<Typography variant="caption">{label}</Typography>}
					/>
				))}
			</Box>

			<Divider sx={{ my: 1.5 }} />

			<Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
				<Typography variant="subtitle2" color="text.secondary" sx={{ flexGrow: 1 }}>
					Stats
				</Typography>
				{edited && <Chip size="small" color="secondary" variant="outlined" label="edited" />}
				<Tooltip title={copied ? 'Copied' : 'Copy this block as JSON'}>
					<IconButton size="small" onClick={copyStats}>
						<ContentCopyIcon fontSize="inherit" color={copied ? 'primary' : 'inherit'} />
					</IconButton>
				</Tooltip>
				<Tooltip title="Back to the starting numbers">
					<span>
						<IconButton size="small" disabled={!edited} onClick={onRevert}>
							<RestartAltIcon fontSize="inherit" />
						</IconButton>
					</span>
				</Tooltip>
			</Stack>

			<Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
				A mock. Props are meshes today — nothing reads these and nothing saves them, so
				edit freely and copy the block out when it says something worth keeping.
			</Typography>

			{statGroups(prop).map((group) => (
				<Box key={group.id} sx={{ mb: 1.5 }}>
					<Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
						{group.label}
					</Typography>

					<Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
						{group.fields.map((field) => {
							const value = stats[field.key];

							if (field.kind === 'flag') {
								return (
									<FormControlLabel
										key={field.key}
										title={field.hint ?? ''}
										sx={{ m: 0, gridColumn: '1 / -1' }}
										control={
											<Switch
												size="small"
												checked={value === true}
												onChange={(event) => onStatChange(field.key, event.target.checked)}
											/>
										}
										label={<Typography variant="caption">{field.label}</Typography>}
									/>
								);
							}

							const shared = {
								size: 'small' as const,
								label: field.unit ? `${field.label} (${field.unit})` : field.label,
								...(field.hint !== undefined ? { helperText: field.hint } : {}),
								sx: { gridColumn: field.kind === 'text' ? '1 / -1' : undefined },
							};

							if (field.kind === 'choice') {
								return (
									<TextField
										key={field.key}
										{...shared}
										select
										value={typeof value === 'string' ? value : ''}
										onChange={(event) => onStatChange(field.key, event.target.value)}
									>
										{(field.choices ?? []).map((choice) => (
											<MenuItem key={choice} value={choice}>
												{choice}
											</MenuItem>
										))}
									</TextField>
								);
							}

							if (field.kind === 'text') {
								return (
									<TextField
										key={field.key}
										{...shared}
										value={typeof value === 'string' ? value : ''}
										onChange={(event) => onStatChange(field.key, event.target.value)}
									/>
								);
							}

							return (
								<TextField
									key={field.key}
									{...shared}
									type="number"
									value={typeof value === 'number' ? value : 0}
									slotProps={{
										htmlInput: {
											...(field.min !== undefined ? { min: field.min } : {}),
											...(field.max !== undefined ? { max: field.max } : {}),
											step: field.step ?? 1,
										},
									}}
									onChange={(event) => {
										// An emptied box is a zero rather than a NaN: a
										// half-typed number should not poison the block.
										const next = Number(event.target.value);
										onStatChange(field.key, Number.isFinite(next) ? next : 0);
									}}
								/>
							);
						})}
					</Box>
				</Box>
			))}

			<Divider sx={{ my: 1.5 }} />

			<Typography variant="subtitle2" color="text.secondary" gutterBottom>
				Measured
			</Typography>

			<Box sx={{ mb: 1 }}>
				{row('Slot', `${prop.bone} · ${prop.kind}`)}
				{row('Parts', `${parts}`)}
				{row(
					'Size',
					box
						? `${box.size[0].toFixed(3)} x ${box.size[1].toFixed(3)} x ${box.size[2].toFixed(3)} m`
						: '—',
				)}
				{row('Stands', box ? `${box.min[1].toFixed(3)} .. ${box.max[1].toFixed(3)} m` : '—')}
				{row('Ground lift', `${prop.groundLift.toFixed(3)} m`)}
				{row('Ground tilt', `${((prop.groundTilt * 180) / Math.PI).toFixed(0)}°`)}
			</Box>

			<Typography variant="caption" color="text.secondary">
				Off the mesh, in the frame it is drawn in — the only numbers on this panel that are
				true today.
			</Typography>

			<Divider sx={{ my: 1.5 }} />

			<Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
				<Tooltip title="Put the camera back where it started">
					<span>
						<IconButton size="small" disabled={!bench} onClick={() => bench?.frameSubject()}>
							<CenterFocusStrongIcon />
						</IconButton>
					</span>
				</Tooltip>
				<Typography variant="caption" color="text.secondary">
					Drag to orbit, <b>shift</b>-drag to pan, wheel to zoom.
				</Typography>
			</Stack>
		</Box>
	);
}
