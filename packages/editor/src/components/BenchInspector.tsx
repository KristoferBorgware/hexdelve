/*
 * The bench's right-hand panel: the transport, the tree, and what the pose is
 * doing.
 *
 * The transport drives a playhead and nothing else — pick, play, scrub, slow
 * down — because a duration and a function from a time to a pose is all a clip,
 * a pose function and a blend tree have in common. Gaining trees did not change
 * it; it grew a section underneath.
 *
 * That section is where a tree is actually checked rather than merely watched.
 * The parameters move the pose, the tree view says which leaf is worth what,
 * and three numbers say whether the blend is honest: the cycle it settled on,
 * how far the synced leaves have drifted apart, and — for a subject that walks
 * — what the blend really carries him at against what was asked for.
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
import RepeatIcon from '@mui/icons-material/Repeat';
import SkipPreviousIcon from '@mui/icons-material/SkipPrevious';
import { useEffect, useState, type ReactElement } from 'react';
import type { ActiveLeaf } from '@hexdelve/engine';

import type { BenchShow, CharacterBench } from '../bench/CharacterBench.js';
import { isTree, type BenchAnimation, type BenchRig } from '../bench/rigs.js';
import { TreeView } from './TreeView.js';

export interface BenchInspectorProps {
	bench: CharacterBench | null;
	rig: BenchRig;
	animation: BenchAnimation;
	onAnimationChange(animation: BenchAnimation): void;
	params: Record<string, number>;
	onParamChange(name: string, value: number): void;
	treeSync: boolean;
	onTreeSyncChange(value: boolean): void;
	show: BenchShow;
	onShowChange(key: keyof BenchShow, value: boolean): void;
	speed: number;
	onSpeedChange(speed: number): void;
	loop: boolean;
	onLoopChange(loop: boolean): void;
	selectedBone: string | null;
}

const SHOW: { key: keyof BenchShow; label: string; hint: string }[] = [
	{ key: 'mesh', label: 'Mesh', hint: 'The prisms hung on the bones' },
	{ key: 'skeleton', label: 'Skeleton', hint: 'The rig, drawn from the bone list' },
	{ key: 'ground', label: 'Stand', hint: 'The pad, and the shadow it catches' },
	{ key: 'spin', label: 'Turntable', hint: 'Turn the subject while it plays' },
];

const SPEEDS = [0.1, 0.25, 0.5, 1, 2];

const KIND_LABEL: Record<BenchAnimation['kind'], string> = {
	clip: 'keyframed clip',
	procedural: 'pose function',
	tree: 'blend tree',
};

export function BenchInspector({
	bench,
	rig,
	animation,
	onAnimationChange,
	params,
	onParamChange,
	treeSync,
	onTreeSyncChange,
	show,
	onShowChange,
	speed,
	onSpeedChange,
	loop,
	onLoopChange,
	selectedBone,
}: BenchInspectorProps) {
	const [fps, setFps] = useState(0);
	const [instances, setInstances] = useState(0);
	const [bones, setBones] = useState(0);
	const [time, setTime] = useState(0);
	const [playing, setPlaying] = useState(true);
	const [bonePosition, setBonePosition] = useState<[number, number, number] | null>(null);
	const [active, setActive] = useState<readonly ActiveLeaf[]>([]);
	const [spread, setSpread] = useState(0);
	const [measured, setMeasured] = useState<number | null>(null);

	const tree = isTree(animation) ? animation : null;

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

			if (!tree) return;
			setActive(tree.tree.active);
			setSpread(tree.tree.phaseSpread());
			setMeasured(tree.measure ? tree.measure().z : null);
		}, 80);
		return () => window.clearInterval(handle);
	}, [bench, selectedBone, tree]);

	const info = bench?.info;
	// A tree's cycle moves under the playhead, so clamp rather than let the
	// scrub bar draw one past its own end.
	const duration = animation.duration;
	const playhead = Math.min(time, duration);

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
				width: 320,
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
								// Playing from a held last frame would be a no-op,
								// so the button rewinds it first.
								if (!bench.playing && !loop && bench.time >= duration) {
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

				<Tooltip
					title={
						loop
							? 'Repeating. A clip authored to hold will pop at the wrap — it was never made to close onto its first key.'
							: 'Playing once, then holding the last frame'
					}
				>
					<span>
						<IconButton
							size="small"
							disabled={!bench}
							color={loop ? 'primary' : 'default'}
							onClick={() => onLoopChange(!loop)}
						>
							<RepeatIcon />
						</IconButton>
					</span>
				</Tooltip>

				<Typography
					variant="caption"
					sx={{ fontVariantNumeric: 'tabular-nums', flexGrow: 1, textAlign: 'right' }}
				>
					{playhead.toFixed(2)} / {duration.toFixed(2)} s
				</Typography>
			</Stack>

			<Slider
				size="small"
				min={0}
				max={duration}
				step={duration / 240}
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
				{row('Source', KIND_LABEL[animation.kind])}
				{row('Authored to', animation.loop ? 'loop' : 'hold')}
				{row('Playing', loop ? 'repeating' : 'once, then holding')}
				{row('Phase', `${((playhead / duration) * 100).toFixed(0)} %`)}
			</Box>

			{tree && (
				<>
					<Divider sx={{ my: 1.5 }} />

					<Typography variant="subtitle2" color="text.secondary" gutterBottom>
						Parameters
					</Typography>

					{tree.parameters.map((parameter) => (
						<Box key={parameter.name} sx={{ mb: 0.5 }} title={parameter.hint ?? ''}>
							<Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
								<Typography variant="caption" color="text.secondary">
									{parameter.label}
								</Typography>
								<Typography
									variant="caption"
									sx={{ fontVariantNumeric: 'tabular-nums' }}
								>
									{(params[parameter.name] ?? parameter.initial).toFixed(2)}
									{parameter.unit ? ` ${parameter.unit}` : ''}
									{parameter.toTree && (
										<Box component="span" sx={{ color: 'text.secondary' }}>
											{' → '}
											{parameter.toTree(params[parameter.name] ?? parameter.initial).toFixed(2)}
										</Box>
									)}
								</Typography>
							</Box>
							<Slider
								size="small"
								min={parameter.min}
								max={parameter.max}
								step={parameter.step}
								value={params[parameter.name] ?? parameter.initial}
								disabled={!bench}
								onChange={(_, value) => onParamChange(parameter.name, value as number)}
							/>
						</Box>
					))}

					<Divider sx={{ my: 1.5 }} />

					<Typography variant="subtitle2" color="text.secondary" gutterBottom>
						Blend tree
					</Typography>

					<TreeView root={tree.tree.root} active={active} />

					<Box sx={{ mt: 1 }}>
						{row('Cycle', `${duration.toFixed(3)} s`)}
						{row('Phase spread', `${(spread * 100).toFixed(1)} % of a cycle`)}
						{measured !== null &&
							row(
								'Asks / carries',
								`${(params['speed'] ?? 0).toFixed(2)} / ${measured.toFixed(2)} m/s`,
							)}
					</Box>

					<FormControlLabel
						title="Stretch the synced leaves onto one cycle and line their footfalls up"
						sx={{ m: 0, mt: 0.5 }}
						control={
							<Checkbox
								size="small"
								disabled={!bench}
								checked={treeSync}
								onChange={(event) => onTreeSyncChange(event.target.checked)}
							/>
						}
						label={<Typography variant="caption">Phase sync</Typography>}
					/>

					<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
						{treeSync
							? 'Off it, the leaves run on their own clocks and the spread above wanders through the whole range — which is the feet disagreeing about where the ground is.'
							: 'The leaves are on their own clocks now. Watch the spread, and the feet.'}
					</Typography>
				</>
			)}

			<Divider sx={{ my: 1.5 }} />

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
