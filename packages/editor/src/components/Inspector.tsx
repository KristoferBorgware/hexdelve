/*
 * The right-hand panel: what the renderer is, what the world is doing, and the
 * toggles lab 09 carried in its own panel.
 *
 * The toggles are the demonstration that matters here. They are not editor
 * features — they are fields on the running client, and flipping one from
 * React reaches the same object an embedder would reach from their own page.
 * The editor has no privileged access to the game; it is just a caller.
 *
 * The live numbers are polled rather than pushed, and deliberately: the frame
 * loop produces them sixty times a second and a re-render at that rate would
 * be both slower and unreadable.
 */

import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useState, type ReactElement } from 'react';
import type { HexdelveClient, SimulationToggles, YardStats } from '@hexdelve/client';

export interface InspectorProps {
	client: HexdelveClient | null;
}

const TOGGLES: { key: keyof SimulationToggles; label: string; hint: string }[] = [
	{ key: 'ik', label: 'Foot IK', hint: 'Plant his feet on the terraces' },
	{ key: 'vectors', label: 'Vectors', hint: 'Where he faces against where he is going' },
	{ key: 'paths', label: 'Paths', hint: "The bat's route, its hexagon and its perch" },
	{ key: 'screenStrafe', label: 'Screen strafe', hint: "A and D on the screen's axes, not his hips" },
	{ key: 'skeleton', label: 'Skeleton', hint: 'Ghost the bodies and show the rigs' },
	{ key: 'follow', label: 'Follow', hint: 'The camera tracks him' },
];

const BEARINGS: { to: number; name: string }[] = [
	{ to: 0.4, name: 'forward' },
	{ to: 1.2, name: 'half left' },
	{ to: 2.0, name: 'left' },
	{ to: 2.75, name: 'back left' },
	{ to: Math.PI + 0.01, name: 'backwards' },
];

function bearingName(angle: number): string {
	const a = Math.abs(angle);
	for (const band of BEARINGS) {
		if (a <= band.to) return angle < 0 ? band.name.replace('left', 'right') : band.name;
	}
	return 'backwards';
}

export function Inspector({ client }: InspectorProps) {
	const [fps, setFps] = useState(0);
	const [instances, setInstances] = useState(0);
	const [stats, setStats] = useState<YardStats | null>(null);
	// Mirrored only so the checkboxes re-render; the client stays the owner.
	const [toggleTick, setToggleTick] = useState(0);
	/*
	 * The camera's own numbers, polled.
	 *
	 * These sliders are the only thing that aims the camera now: the mouse aims
	 * him and cuts, the keys walk him, and neither touches it. They are still
	 * controlled and still polled rather than merely defaulted, because the
	 * client owns the camera and anything else holding a reference to it —
	 * another embedder, a later feature, a console — can move it underneath.
	 * A slider that showed only where the camera was first put would be lying
	 * about the thing it controls.
	 */
	const [zoom, setZoom] = useState(1.35);
	const [azimuth, setAzimuth] = useState(1.08);

	useEffect(() => {
		if (!client) {
			setStats(null);
			return;
		}
		const handle = window.setInterval(() => {
			setFps(client.stats.fps);
			setInstances(client.stats.instances);
			setStats(client.state);
			setZoom(client.camera.zoom);
			// Wrapped, because Q and E keep turning past a full circle.
			setAzimuth(((client.camera.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2));
		}, 250);
		return () => window.clearInterval(handle);
	}, [client]);

	const info = client?.info;

	const row = (label: string, value: string): ReactElement => (
		<Box
			key={label}
			sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, py: 0.15 }}
		>
			<Typography variant="caption" color="text.secondary">
				{label}
			</Typography>
			<Typography
				variant="caption"
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
				{info && <Chip size="small" variant="outlined" label={`${info.msaaSamples}x MSAA`} />}
				<Chip size="small" variant="outlined" label={`${fps.toFixed(0)} fps`} />
				<Chip size="small" variant="outlined" label={`${instances} prisms`} />
			</Stack>

			<Divider sx={{ my: 1.5 }} />

			<Typography variant="subtitle2" color="text.secondary" gutterBottom>
				Free movement
			</Typography>

			{stats ? (
				<Box sx={{ mb: 1 }}>
					{row('You', stats.message)}
					{row('Speed', `${stats.speed.toFixed(2)} m/s · ${stats.gait > 0.5 ? 'run' : 'walk'}`)}
					{row(
						'Going',
						stats.amp > 0.05
							? `${bearingName(stats.heading)} · ${Math.round(Math.abs((stats.heading * 180) / Math.PI))}°`
							: '—',
					)}
					{row('Foot slip', `${Math.abs(stats.slip * 100).toFixed(0)} cm/s`)}
					{row('Cell', `${stats.cell.q}, ${stats.cell.r} · terrace ${stats.terrace ?? '–'}`)}
					{row('Carrying', stats.carrying.length ? stats.carrying.join(', ') : 'nothing')}
					{row('Pelvis drop', `${(stats.pelvisDrop * 100).toFixed(1)} cm`)}
					<Divider sx={{ my: 0.75 }} />
					{row('Bat', `${stats.batMessage} · ${stats.batSpeed.toFixed(2)} m/s`)}
					{row('Range', `${stats.batRange} tiles · wakes at ${stats.wakeRange}`)}
					{row('Bites / missed', `${stats.bites} · ${stats.batMissed}`)}
					{stats.cuts > 0 && row('Cuts / hits', `${stats.cuts} · ${stats.hits}`)}
				</Box>
			) : (
				<Typography variant="caption" color="text.secondary">
					starting…
				</Typography>
			)}

			<Divider sx={{ my: 1.5 }} />

			<Typography variant="subtitle2" color="text.secondary" gutterBottom>
				Show
			</Typography>

			<Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 1 }}>
				{TOGGLES.map(({ key, label, hint }) => (
					<FormControlLabel
						key={key}
						title={hint}
						sx={{ m: 0 }}
						control={
							<Checkbox
								size="small"
								disabled={!client}
								checked={client ? client.toggles[key] : false}
								onChange={(event) => {
									if (!client) return;
									client.toggles[key] = event.target.checked;
									setToggleTick(toggleTick + 1);
									if (!client.running) client.renderOnce();
								}}
							/>
						}
						label={<Typography variant="caption">{label}</Typography>}
					/>
				))}
			</Box>

			<Divider sx={{ my: 1.5 }} />

			<Typography variant="subtitle2" color="text.secondary" gutterBottom>
				Camera
			</Typography>

			<Typography variant="caption" color="text.secondary">
				Zoom
			</Typography>
			<Slider
				size="small"
				min={0.4}
				max={3}
				step={0.05}
				value={zoom}
				disabled={!client}
				onChange={(_, value) => {
					setZoom(value as number);
					if (client) client.camera.zoom = value as number;
					if (client && !client.running) client.renderOnce();
				}}
			/>

			<Typography variant="caption" color="text.secondary">
				Azimuth
			</Typography>
			<Slider
				size="small"
				min={0}
				max={Math.PI * 2}
				step={0.01}
				value={azimuth}
				disabled={!client}
				onChange={(_, value) => {
					setAzimuth(value as number);
					if (client) client.camera.yaw = value as number;
					if (client && !client.running) client.renderOnce();
				}}
			/>

			<Divider sx={{ my: 1.5 }} />

			<Typography variant="subtitle2" color="text.secondary" gutterBottom>
				Sun
			</Typography>

			<Typography variant="caption" color="text.secondary">
				Intensity
			</Typography>
			<Slider
				size="small"
				min={0}
				max={2}
				step={0.05}
				defaultValue={client?.light.intensity ?? 0.95}
				disabled={!client}
				onChange={(_, value) => {
					if (client) client.light.intensity = value as number;
					if (client && !client.running) client.renderOnce();
				}}
			/>

			<Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
				<b>W</b>/<b>S</b> are his, <b>A</b>/<b>D</b> the screen's. <b>Shift</b> runs,
				<b> click</b> or <b>space</b> cuts. The mouse aims and nothing else — the
				camera follows him, and the sliders above are the only thing that turns it.
			</Typography>
		</Box>
	);
}
