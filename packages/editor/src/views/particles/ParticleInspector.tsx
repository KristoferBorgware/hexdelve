/*
 * The particle bench's right-hand panel: what is on screen, and every number
 * the effect is made of.
 *
 * Two sections, and the split is the one every bench here makes. VIEW is how
 * the thing is being shown — the pad, the ruler, how high the emitter sits,
 * how fast the clock runs — and changes nothing about the file. EFFECT is the
 * file, and every control in it writes a new effect and hands it up.
 *
 * The effect controls are generated from `EFFECT_GROUPS` and the three curves,
 * so adding a field to `ParticleEffect` is one entry in that table and no
 * change here. That is the whole reason the table exists: an effect has about
 * thirty numbers and a panel that named each one would be the same twelve
 * lines of JSX thirty times over.
 */

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import type { ParticleEffect } from '@hexdelve/engine';

import { ColorCurve, NumberCurve } from './CurveEditor.js';
import { EFFECT_GROUPS, type Field } from './fields.js';
import type { ParticleBench, ParticleShow } from './ParticleBench.js';

const SHOW: { key: keyof ParticleShow; label: string; hint: string }[] = [
	{ key: 'pad', label: 'Pad', hint: 'The stand, and the shadow it catches' },
	{ key: 'ruler', label: 'Ruler', hint: 'A post to a person’s height, banded every half metre' },
	{ key: 'spin', label: 'Turntable', hint: 'Walk the camera round while you look at it' },
];

export interface ParticleInspectorProps {
	bench: ParticleBench | null;
	effect: ParticleEffect;
	onEffectChange(effect: ParticleEffect): void;
	show: ParticleShow;
	onShowChange(key: keyof ParticleShow, value: boolean): void;
	height: number;
	onHeightChange(height: number): void;
	rate: number;
	onRateChange(rate: number): void;
}

export function ParticleInspector({
	bench,
	effect,
	onEffectChange,
	show,
	onShowChange,
	height,
	onHeightChange,
	rate,
	onRateChange,
}: ParticleInspectorProps) {
	const [fps, setFps] = useState(0);
	const [instances, setInstances] = useState(0);
	const [particles, setParticles] = useState(0);

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
			setParticles(bench.stats.particles);
		}, 80);
		return () => window.clearInterval(handle);
	}, [bench]);

	const info = bench?.info;
	const full = particles >= effect.capacity;

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
				{/* Coloured when the pool is full, which is the one reading that
				    means the picture is not the effect: particles are being
				    dropped, and the capacity is what to raise. */}
				<Tooltip
					describeChild
					title={
						full
							? 'The pool is full, so new particles are being dropped. Raise the capacity.'
							: 'Particles alive, against the pool the effect asked for'
					}
				>
					<Chip
						size="small"
						variant="outlined"
						color={full ? 'warning' : 'default'}
						label={`${particles} / ${effect.capacity}`}
					/>
				</Tooltip>
			</Stack>

			<Divider sx={{ my: 1.5 }} />

			<Typography variant="subtitle2" color="text.secondary" gutterBottom>
				View
			</Typography>

			{SHOW.map((entry) => (
				<Tooltip key={entry.key} describeChild title={entry.hint} placement="left">
					<FormControlLabel
						sx={{ display: 'flex', ml: 0 }}
						control={
							<Switch
								size="small"
								checked={show[entry.key]}
								onChange={(event) => onShowChange(entry.key, event.target.checked)}
							/>
						}
						label={<Typography variant="body2">{entry.label}</Typography>}
					/>
				</Tooltip>
			))}

			<SliderRow
				label="Emitter height"
				hint="How high above the pad the emitter sits, in metres"
				value={height}
				min={0}
				max={4}
				step={0.01}
				onChange={onHeightChange}
			/>
			<SliderRow
				label="Clock"
				hint="How fast time runs here, so a burst can be watched slowly"
				value={rate}
				min={0.05}
				max={2}
				step={0.05}
				onChange={onRateChange}
			/>

			<Divider sx={{ my: 1.5 }} />

			{EFFECT_GROUPS.map((group) => (
				<Box key={group.title} sx={{ mb: 2 }}>
					<Typography variant="subtitle2" color="text.secondary">
						{group.title}
					</Typography>
					<Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
						{group.hint}
					</Typography>

					{group.fields.map((field) => (
						<FieldControl
							key={field.key}
							field={field}
							effect={effect}
							onEffectChange={onEffectChange}
						/>
					))}

					{group.title === 'Size' && (
						<NumberCurve
							label="Radius over life"
							hint="The circumradius of the prism, in metres, from birth to death"
							curve={effect.size.curve}
							max={1}
							step={0.005}
							onChange={(curve) => onEffectChange({ ...effect, size: { ...effect.size, curve } })}
						/>
					)}
					{group.title === 'Colour' && (
						<ColorCurve
							label="Colour over life"
							hint="Where the particle starts and where it ends"
							curve={effect.color.curve}
							onChange={(curve) => onEffectChange({ ...effect, color: { ...effect.color, curve } })}
						/>
					)}
					{group.title === 'Alpha' && (
						<NumberCurve
							label="Alpha over life"
							hint="How solid it is, from birth to death"
							curve={effect.alpha.curve}
							max={1}
							step={0.01}
							onChange={(curve) => onEffectChange({ ...effect, alpha: { ...effect.alpha, curve } })}
						/>
					)}
				</Box>
			))}
		</Box>
	);
}

/** One field of the table, as whichever control its kind asks for. */
function FieldControl({
	field,
	effect,
	onEffectChange,
}: {
	field: Field;
	effect: ParticleEffect;
	onEffectChange(effect: ParticleEffect): void;
}) {
	if (field.kind === 'flag') {
		return (
			<Tooltip describeChild title={field.hint ?? ''} placement="left">
				<FormControlLabel
					sx={{ display: 'flex', ml: 0 }}
					control={
						<Switch
							size="small"
							checked={field.read(effect)}
							onChange={(event) => onEffectChange(field.write(effect, event.target.checked))}
						/>
					}
					label={<Typography variant="body2">{field.label}</Typography>}
				/>
			</Tooltip>
		);
	}

	if (field.kind === 'choice') {
		return (
			<Tooltip describeChild title={field.hint ?? ''} placement="left">
				<TextField
					select
					fullWidth
					size="small"
					label={field.label}
					sx={{ mt: 1 }}
					value={field.read(effect)}
					onChange={(event) => onEffectChange(field.write(effect, event.target.value))}
				>
					{field.options.map((option) => (
						<MenuItem key={option} value={option}>
							{option}
						</MenuItem>
					))}
				</TextField>
			</Tooltip>
		);
	}

	return (
		<SliderRow
			label={field.label}
			hint={field.hint ?? ''}
			value={field.read(effect)}
			min={field.min}
			max={field.max}
			step={field.step}
			onChange={(value) => onEffectChange(field.write(effect, value))}
		/>
	);
}

/**
 * A slider with the number beside it.
 *
 * Both, because the two answer different questions: the slider is how a value
 * is FOUND, by dragging it until the picture is right, and the readout is how
 * it is written down afterwards into a file somebody else will read.
 */
function SliderRow({
	label,
	hint,
	value,
	min,
	max,
	step,
	onChange,
}: {
	label: string;
	hint: string;
	value: number;
	min: number;
	max: number;
	step: number;
	onChange(value: number): void;
}) {
	return (
		<Box sx={{ mt: 0.5 }}>
			<Tooltip describeChild title={hint} placement="left">
				<Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
					<Typography variant="body2">{label}</Typography>
					<Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>
						{round(value)}
					</Typography>
				</Stack>
			</Tooltip>
			<Slider
				size="small"
				value={value}
				min={min}
				max={max}
				step={step}
				onChange={(_, next) => onChange(next as number)}
			/>
		</Box>
	);
}

/** Enough digits to tell two settings apart, and no more. */
function round(value: number): string {
	if (Number.isInteger(value)) return String(value);
	return value.toFixed(Math.abs(value) < 0.1 ? 4 : 3).replace(/0+$/, '').replace(/\.$/, '');
}
