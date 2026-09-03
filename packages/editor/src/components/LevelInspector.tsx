/*
 * The level bench's right-hand panel: the knobs, and what came out.
 *
 * The knobs are not hand-written. A stack declares its parameters as data —
 * range, step, whether it is a choice — and this builds a control per entry, so
 * a third algorithm with seven settings of its own arrives here without a line
 * being added. That is the same bargain the bone outline makes next door, and
 * it is the one that keeps a bench from rotting the moment it is useful.
 *
 * The readout under them is the actual product of this view. A picture tells
 * you the level looks like a dungeon; only the numbers tell you it came out in
 * eleven disconnected pieces, or that the wave function needed nine seeds to
 * find one that closed. Those two are what a tileset gets tuned against, so
 * they are given as much room as the shape is.
 */

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CasinoIcon from '@mui/icons-material/Casino';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import { useEffect, useState, type ReactElement } from 'react';
import type { Level, LevelStack } from '@hexdelve/client';

import type { LevelBench, LevelShow } from '../bench/LevelBench.js';

export interface LevelInspectorProps {
	bench: LevelBench | null;
	stack: LevelStack;
	level: Level | null;
	seed: number;
	onSeedChange(seed: number): void;
	radius: number;
	onRadiusChange(radius: number): void;
	prune: boolean;
	onPruneChange(prune: boolean): void;
	params: Readonly<Record<string, number>>;
	onParamChange(key: string, value: number): void;
	show: LevelShow;
	onShowChange(key: keyof LevelShow, value: boolean): void;
}

const SHOW: { key: keyof LevelShow; label: string; hint: string }[] = [
	{ key: 'rock', label: 'Rock', hint: 'The solid the level is cut out of' },
	{ key: 'walls', label: 'Edge walls', hint: 'Shut edges between two floor tiles' },
	{ key: 'route', label: 'Entry & exit', hint: 'The two ends, and the way between them' },
	{ key: 'regions', label: 'Regions', hint: 'Colour the floor by connected component' },
];

export function LevelInspector({
	bench,
	stack,
	level,
	seed,
	onSeedChange,
	radius,
	onRadiusChange,
	prune,
	onPruneChange,
	params,
	onParamChange,
	show,
	onShowChange,
}: LevelInspectorProps) {
	const info = bench?.info;
	const stats = level?.stats;

	/*
	 * The bench's own counters, polled.
	 *
	 * They are produced by drawing rather than by React, and a draw happens
	 * when a camera drag or a toggle asks for one — so there is no render of
	 * this panel to read them off. Four times a second is faster than anyone
	 * reads a number and cheaper than plumbing an event back up.
	 */
	const [drawn, setDrawn] = useState({ instances: 0, drawMs: 0 });
	useEffect(() => {
		if (!bench) {
			setDrawn({ instances: 0, drawMs: 0 });
			return;
		}
		const handle = window.setInterval(() => setDrawn({ ...bench.stats }), 250);
		return () => window.clearInterval(handle);
	}, [bench]);

	const row = (label: string, value: string, warn = false): ReactElement => (
		<Box key={label} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, py: 0.15 }}>
			<Typography variant="caption" color="text.secondary">
				{label}
			</Typography>
			<Typography
				variant="caption"
				color={warn ? 'warning.main' : 'text.primary'}
				sx={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}
			>
				{value}
			</Typography>
		</Box>
	);

	return (
		<Box
			component="aside"
			sx={{
				width: 310,
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
				<Chip size="small" variant="outlined" label={`${drawn.instances} prisms`} />
			</Stack>

			<Divider sx={{ my: 1.5 }} />

			<Typography variant="subtitle2" color="text.secondary" gutterBottom>
				Seed
			</Typography>

			<Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mb: 1.5 }}>
				<Tooltip title="The seed before this one">
					<IconButton size="small" onClick={() => onSeedChange(seed - 1)}>
						<NavigateBeforeIcon />
					</IconButton>
				</Tooltip>
				<Typography
					variant="body2"
					sx={{ flexGrow: 1, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}
				>
					{seed}
				</Typography>
				<Tooltip title="The next one">
					<IconButton size="small" onClick={() => onSeedChange(seed + 1)}>
						<NavigateNextIcon />
					</IconButton>
				</Tooltip>
				<Tooltip title="Somewhere else entirely">
					<IconButton
						size="small"
						onClick={() => onSeedChange(Math.floor(Math.random() * 0x7fffffff))}
					>
						<CasinoIcon />
					</IconButton>
				</Tooltip>
			</Stack>

			<Typography variant="caption" color="text.secondary">
				Radius — {radius} rings
			</Typography>
			<Slider
				size="small"
				min={4}
				max={24}
				step={1}
				marks
				value={radius}
				onChange={(_, value) => onRadiusChange(value as number)}
			/>

			<FormControlLabel
				sx={{ m: 0, mt: 0.5 }}
				title="Fill in everything but the biggest connected piece"
				control={
					<Checkbox
						size="small"
						checked={prune}
						onChange={(event) => onPruneChange(event.target.checked)}
					/>
				}
				label={<Typography variant="caption">Keep only the largest region</Typography>}
			/>

			<Divider sx={{ my: 1.5 }} />

			<Typography variant="subtitle2" color="text.secondary" gutterBottom>
				{stack.label}
			</Typography>

			{stack.params.map((param) => {
				const value = params[param.key] ?? param.value;
				if (param.choices) {
					return (
						<Box key={param.key} sx={{ mb: 1.5 }}>
							<Tooltip title={param.hint}>
								<Typography variant="caption" color="text.secondary">
									{param.label}
								</Typography>
							</Tooltip>
							<Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
								{param.choices.map((choice, index) => (
									<Chip
										key={choice}
										size="small"
										clickable
										variant={Math.round(value) === index ? 'filled' : 'outlined'}
										color={Math.round(value) === index ? 'primary' : 'default'}
										label={choice}
										onClick={() => onParamChange(param.key, index)}
									/>
								))}
							</Stack>
						</Box>
					);
				}
				return (
					<Box key={param.key} sx={{ mb: 0.5 }}>
						<Tooltip title={param.hint}>
							<Typography variant="caption" color="text.secondary">
								{param.label} — {param.integer ? value.toFixed(0) : value.toFixed(3)}
							</Typography>
						</Tooltip>
						<Slider
							size="small"
							min={param.min}
							max={param.max}
							step={param.step}
							value={value}
							onChange={(_, next) => onParamChange(param.key, next as number)}
						/>
					</Box>
				);
			})}

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
				Level
			</Typography>

			{stats ? (
				<Box sx={{ mb: 1 }}>
					{row('Cells', `${stats.cells}`)}
					{row('Floor', `${stats.floor}  (${((100 * stats.floor) / stats.cells).toFixed(0)} %)`)}
					{row('Regions', `${stats.regions}`, stats.regions > 1)}
					{row('Largest', `${stats.largest}`)}
					{row('Entry to exit', stats.route > 0 ? `${stats.route} steps` : 'no route', stats.route === 0)}
					{row('Attempts', `${stats.attempts}`, stats.attempts > 1)}
					{row('Generated in', `${stats.ms.toFixed(1)} ms`)}
					{row('Drawn in', `${drawn.drawMs.toFixed(1)} ms`)}
				</Box>
			) : (
				<Typography variant="caption" color="text.secondary">
					Nothing generated yet.
				</Typography>
			)}

			<Divider sx={{ my: 1.5 }} />

			<Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
				<Tooltip title="Put the camera back over the middle">
					<span>
						<IconButton size="small" disabled={!bench} onClick={() => bench?.frameLevel()}>
							<CenterFocusStrongIcon />
						</IconButton>
					</span>
				</Tooltip>
				<Typography variant="caption" color="text.secondary">
					Drag to orbit, <b>shift</b>-drag to pan, wheel to zoom.
				</Typography>
			</Stack>

			<Button
				fullWidth
				size="small"
				variant="outlined"
				sx={{ mt: 1.5 }}
				onClick={() => onSeedChange(Math.floor(Math.random() * 0x7fffffff))}
			>
				Generate another
			</Button>
		</Box>
	);
}
