/*
 * A curve over a particle's life, as a strip and a list of stops.
 *
 * The strip is the part worth having. Three numbers in a table say nothing
 * about whether an alpha fades too late, and the whole question an author is
 * asking of a curve is what SHAPE it is — so the stops are drawn, over the
 * same 0-to-1 span the simulation reads them across, above the fields that set
 * them.
 *
 * Colour curves and number curves are the same list with a different control
 * on the value, so they are one component: the alternative is two files that
 * are each other's copy, and a stop added to one of them and not the other.
 */

import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import type { ColorStop, Stop } from '@hexdelve/engine';
import { hexFromRgb, rgbFromHex } from '@hexdelve/shared';

/** How tall the strip is, in the units its viewBox is written in. */
const STRIP_HEIGHT = 34;
const STRIP_WIDTH = 240;

export interface NumberCurveProps {
	label: string;
	hint: string;
	curve: readonly Stop[];
	/** The span the strip is drawn over, so a size and an alpha read alike. */
	max: number;
	step: number;
	onChange(curve: readonly Stop[]): void;
}

export function NumberCurve({ label, hint, curve, max, step, onChange }: NumberCurveProps) {
	const ceiling = Math.max(max, ...curve.map((stop) => stop.value), 1e-6);

	const set = (index: number, next: Stop): void => {
		onChange(sortStops(curve.map((stop, i) => (i === index ? next : stop))));
	};

	return (
		<Box sx={{ mt: 1.5 }}>
			<Heading label={label} hint={hint} />

			<Box component="svg" viewBox={`0 0 ${STRIP_WIDTH} ${STRIP_HEIGHT}`} sx={STRIP}>
				<polyline
					points={curve
						.map((stop) => `${stop.at * STRIP_WIDTH},${STRIP_HEIGHT * (1 - stop.value / ceiling)}`)
						.join(' ')}
					fill="none"
					stroke="currentColor"
					strokeWidth={1.5}
				/>
				{curve.map((stop, index) => (
					<circle
						key={index}
						cx={stop.at * STRIP_WIDTH}
						cy={STRIP_HEIGHT * (1 - stop.value / ceiling)}
						r={2.5}
						fill="currentColor"
					/>
				))}
			</Box>

			{curve.map((stop, index) => (
				<Stack key={index} direction="row" spacing={1} sx={{ mt: 0.75, alignItems: 'center' }}>
					<TextField
						size="small"
						type="number"
						label="At"
						value={stop.at}
						slotProps={{ htmlInput: { min: 0, max: 1, step: 0.01 } }}
						onChange={(event) => set(index, { ...stop, at: clamp01(Number(event.target.value)) })}
						sx={{ width: 92 }}
					/>
					<TextField
						size="small"
						type="number"
						label="Value"
						value={stop.value}
						slotProps={{ htmlInput: { step } }}
						onChange={(event) => set(index, { ...stop, value: Number(event.target.value) })}
						sx={{ flex: 1 }}
					/>
					<RemoveStop
						disabled={curve.length <= 1}
						onClick={() => onChange(curve.filter((_, i) => i !== index))}
					/>
				</Stack>
			))}

			<AddStop
				onClick={() => {
					const last = curve[curve.length - 1];
					onChange(
						sortStops([...curve, { at: nextAt(curve), value: last ? last.value : 0 }]),
					);
				}}
			/>
		</Box>
	);
}

export interface ColorCurveProps {
	label: string;
	hint: string;
	curve: readonly ColorStop[];
	onChange(curve: readonly ColorStop[]): void;
}

export function ColorCurve({ label, hint, curve, onChange }: ColorCurveProps) {
	const set = (index: number, next: ColorStop): void => {
		onChange(sortStops(curve.map((stop, i) => (i === index ? next : stop))));
	};

	// The same interpolation the simulation does, handed to the browser: a
	// gradient with the stops at the same offsets is the curve, drawn.
	const bar = curve.map((stop) => `${cssHex(stop)} ${(stop.at * 100).toFixed(1)}%`).join(', ');

	return (
		<Box sx={{ mt: 1.5 }}>
			<Heading label={label} hint={hint} />

			<Box
				sx={{
					...STRIP,
					height: 22,
					borderRadius: 0.5,
					background:
						curve.length > 1 ? `linear-gradient(to right, ${bar})` : cssHex(curve[0] ?? null),
				}}
			/>

			{curve.map((stop, index) => (
				<Stack key={index} direction="row" spacing={1} sx={{ mt: 0.75, alignItems: 'center' }}>
					<TextField
						size="small"
						type="number"
						label="At"
						value={stop.at}
						slotProps={{ htmlInput: { min: 0, max: 1, step: 0.01 } }}
						onChange={(event) => set(index, { ...stop, at: clamp01(Number(event.target.value)) })}
						sx={{ width: 92 }}
					/>
					<Box
						component="input"
						type="color"
						value={cssHex(stop)}
						onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
							set(index, { ...stop, color: rgbFromHex(Number(`0x${event.target.value.slice(1)}`)) })
						}
						sx={{
							flex: 1,
							height: 38,
							padding: 0,
							border: 1,
							borderColor: 'divider',
							borderRadius: 1,
							background: 'none',
						}}
					/>
					<RemoveStop
						disabled={curve.length <= 1}
						onClick={() => onChange(curve.filter((_, i) => i !== index))}
					/>
				</Stack>
			))}

			<AddStop
				onClick={() => {
					const last = curve[curve.length - 1];
					onChange(
						sortStops([
							...curve,
							{ at: nextAt(curve), color: last ? last.color : rgbFromHex(0xffffff) },
						]),
					);
				}}
			/>
		</Box>
	);
}

/* ------------------------------------------------------------------- pieces -- */

const STRIP = {
	display: 'block',
	width: '100%',
	height: 44,
	mt: 0.5,
	color: 'primary.main',
	bgcolor: 'action.hover',
	borderRadius: 0.5,
} as const;

function Heading({ label, hint }: { label: string; hint: string }) {
	return (
		<Tooltip describeChild title={hint} placement="left">
			<Typography variant="body2">{label}</Typography>
		</Tooltip>
	);
}

function RemoveStop({ disabled, onClick }: { disabled: boolean; onClick(): void }) {
	return (
		// A curve with no stops has no value anywhere, so the last one stays.
		<Tooltip describeChild title={disabled ? 'A curve keeps at least one stop' : 'Remove this stop'}>
			<span>
				<IconButton size="small" disabled={disabled} onClick={onClick}>
					<DeleteOutlineIcon fontSize="small" />
				</IconButton>
			</span>
		</Tooltip>
	);
}

function AddStop({ onClick }: { onClick(): void }) {
	return (
		<IconButton size="small" sx={{ mt: 0.5 }} onClick={onClick}>
			<AddIcon fontSize="small" />
		</IconButton>
	);
}

/** Halfway between the last stop and the end, or the end if it is there. */
function nextAt(curve: readonly { at: number }[]): number {
	const last = curve[curve.length - 1];
	if (!last) return 0;
	return last.at >= 1 ? 1 : Math.min(1, (last.at + 1) / 2);
}

/**
 * Stops in the order the reader will put them in.
 *
 * Sorted here as well as there, so the strip above the list is drawn in the
 * order it will be read at rather than in the order somebody typed.
 */
function sortStops<T extends { at: number }>(stops: readonly T[]): T[] {
	return [...stops].sort((a, b) => a.at - b.at);
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return value < 0 ? 0 : value > 1 ? 1 : value;
}

function cssHex(stop: ColorStop | null): string {
	if (!stop) return '#ffffff';
	return `#${hexFromRgb(stop.color).toString(16).padStart(6, '0')}`;
}
