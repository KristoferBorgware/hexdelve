/*
 * The bench's right-hand panel: the transport, and what the pose is doing.
 *
 * The transport is the part worth arguing about. An animation here is a
 * duration and a function from a time to a pose — that is all a keyframed clip
 * and the procedural stride have in common, and it is all a blend tree will
 * have in common with either. So the panel drives a playhead and nothing else:
 * pick, play, scrub, slow down. When a tree arrives it becomes another entry in
 * the list with parameters of its own, and none of this changes.
 *
 * What is chosen here is owned by `Bench`, so it survives a renderer switch;
 * what the CLOCK is doing is owned by the bench and polled. The frame loop
 * produces that sixty times a second and a re-render at that rate would be both
 * slower and unreadable; a playhead at twelve is legible and costs nothing.
 */

import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SkipPreviousIcon from '@mui/icons-material/SkipPrevious';
import { useEffect, useState, type ReactElement } from 'react';

import type { BenchShow, CharacterBench } from '../bench/CharacterBench.js';
import type { BenchAnimation, BenchRig } from '../bench/rigs.js';

export interface BenchInspectorProps {
	bench: CharacterBench | null;
	rig: BenchRig;
	animation: BenchAnimation;
	onAnimationChange(animation: BenchAnimation): void;
	show: BenchShow;
	onShowChange(key: keyof BenchShow, value: boolean): void;
	speed: number;
	onSpeedChange(speed: number): void;
	selectedBone: string | null;
}

const SHOW: { key: keyof BenchShow; label: string; hint: string }[] = [
	{ key: 'mesh', label: 'Mesh', hint: 'The prisms hung on the bones' },
	{ key: 'skeleton', label: 'Skeleton', hint: 'The rig, drawn from the bone list' },
	{ key: 'ground', label: 'Stand', hint: 'The pad, and the shadow it catches' },
	{ key: 'spin', label: 'Turntable', hint: 'Turn the subject while it plays' },
];

const SPEEDS = [0.1, 0.25, 0.5, 1, 2];

export function BenchInspector({
	bench,
	rig,
	animation,
	onAnimationChange,
	show,
	onShowChange,
	speed,
	onSpeedChange,
	selectedBone,
}: BenchInspectorProps) {
	const [fps, setFps] = useState(0);
	const [instances, setInstances] = useState(0);
	const [bones, setBones] = useState(0);
	const [time, setTime] = useState(0);
	const [playing, setPlaying] = useState(true);
	const [bonePosition, setBonePosition] = useState<[number, number, number] | null>(null);

	useEffect(() => {
		if (!bench) return;
		const handle = window.setInterval(() => {
			setFps(bench.stats.fps);
			setInstances(bench.stats.instances);
			setBones(bench.stats.bones);
			setTime(bench.time);
			setPlaying(bench.playing);
			const bone = selectedBone ? bench.bones[selectedBone] : undefined;
			setBonePosition(bone ? [bone.p[0], bone.p[1], bone.p[2]] : null);
		}, 80);
		return () => window.clearInterval(handle);
	}, [bench, selectedBone]);

	const info = bench?.info;
	// The bench may be a frame or two behind a fresh choice; clamp rather than
	// let the scrub bar draw a playhead past its own end.
	const playhead = Math.min(time, animation.duration);

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
				<Chip size="small" variant="outlined" label={`${bones} bones`} />
			</Stack>

			<Divider sx={{ my: 1.5 }} />

			<Typography variant="subtitle2" color="text.secondary" gutterBottom>
				Animation
			</Typography>

			<TextField
				select
				fullWidth
				size="small"
				value={animation.id}
				disabled={!bench}
				onChange={(event) => {
					const next = rig.animations.find((candidate) => candidate.id === event.target.value);
					if (!next) return;
					onAnimationChange(next);
					if (bench) bench.playing = true;
					setPlaying(true);
				}}
			>
				{rig.animations.map((candidate) => (
					<MenuItem key={candidate.id} value={candidate.id}>
						{candidate.label}
					</MenuItem>
				))}
			</TextField>

			<Stack direction="row" spacing={1} sx={{ mt: 1.5, alignItems: 'center' }}>
				<Tooltip title={playing ? 'Hold this frame' : 'Play'}>
					<span>
						<IconButton
							size="small"
							disabled={!bench}
							onClick={() => {
								if (!bench) return;
								// Playing a held one-shot from its last frame would
								// be a no-op, so the button rewinds it first.
								if (!bench.playing && !animation.loop && bench.time >= animation.duration) {
									bench.seek(0);
								}
								bench.playing = !bench.playing;
								setPlaying(bench.playing);
							}}
						>
							{playing ? <PauseIcon /> : <PlayArrowIcon />}
						</IconButton>
					</span>
				</Tooltip>

				<Tooltip title="Back to the first frame">
					<span>
						<IconButton size="small" disabled={!bench} onClick={() => bench?.seek(0)}>
							<SkipPreviousIcon />
						</IconButton>
					</span>
				</Tooltip>

				<Typography
					variant="caption"
					sx={{ fontVariantNumeric: 'tabular-nums', flexGrow: 1, textAlign: 'right' }}
				>
					{playhead.toFixed(2)} / {animation.duration.toFixed(2)} s
				</Typography>
			</Stack>

			<Slider
				size="small"
				min={0}
				max={animation.duration}
				step={animation.duration / 240}
				value={playhead}
				disabled={!bench}
				onChange={(_, value) => {
					if (!bench) return;
					// Scrubbing takes the clock: a playhead that snapped back to
					// where the loop had got to would be unusable.
					bench.playing = false;
					setPlaying(false);
					setTime(value as number);
					bench.seek(value as number);
				}}
			/>

			<Box sx={{ mt: 0.5, mb: 1 }}>
				{row('Source', animation.kind === 'clip' ? 'keyframed clip' : 'pose function')}
				{row('Ends', animation.loop ? 'loops' : 'holds')}
				{row('Phase', `${((playhead / animation.duration) * 100).toFixed(0)} %`)}
			</Box>

			<Typography variant="caption" color="text.secondary">
				Speed
			</Typography>
			<Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5, mb: 0.5 }}>
				{SPEEDS.map((value) => (
					<Chip
						key={value}
						size="small"
						clickable
						variant={speed === value ? 'filled' : 'outlined'}
						color={speed === value ? 'primary' : 'default'}
						label={`${value}x`}
						onClick={() => onSpeedChange(value)}
					/>
				))}
			</Stack>

			<Divider sx={{ my: 1.5 }} />

			<Typography variant="subtitle2" color="text.secondary" gutterBottom>
				Show
			</Typography>

			<Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 1 }}>
				{SHOW.map(({ key, label, hint }) => (
					<FormControlLabel
						key={key}
						title={hint}
						sx={{ m: 0 }}
						control={
							<Checkbox
								size="small"
								disabled={!bench}
								checked={show[key]}
								onChange={(event) => onShowChange(key, event.target.checked)}
							/>
						}
						label={<Typography variant="caption">{label}</Typography>}
					/>
				))}
			</Box>

			<Divider sx={{ my: 1.5 }} />

			<Typography variant="subtitle2" color="text.secondary" gutterBottom>
				Bone
			</Typography>

			{selectedBone ? (
				<Box sx={{ mb: 1 }}>
					{row('Name', selectedBone)}
					{row('At', bonePosition ? bonePosition.map((v) => v.toFixed(3)).join(', ') : '—')}
					<Typography variant="caption" color="text.secondary">
						In the subject's own space, through the pose above.
					</Typography>
				</Box>
			) : (
				<Typography variant="caption" color="text.secondary">
					Pick one on the left to mark it.
				</Typography>
			)}

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
