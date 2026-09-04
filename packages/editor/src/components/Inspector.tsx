/*
 * The right-hand panel: what the renderer is, what the world is doing, and the
 * toggles the client's own page carries beside it.
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
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useState, type ReactElement } from 'react';
import type { HexdelveClient, SimulationToggles, YardStats } from '@hexdelve/client';

import type { ScriptWatchState } from '../scripts/reload.js';

export interface InspectorProps {
	client: HexdelveClient | null;
	/** What the scripts are doing, or null before the first compile. */
	scripts: ScriptWatchState | null;
}

const TOGGLES: { key: keyof SimulationToggles; label: string; hint: string }[] = [
	{ key: 'ik', label: 'Foot IK', hint: 'Plant his feet on the terraces' },
	{ key: 'routes', label: 'Routes', hint: "His route, the bat's path, its hexagon and its perch" },
	{ key: 'skeleton', label: 'Skeleton', hint: 'Ghost the bodies and show the rigs' },
	{ key: 'follow', label: 'Follow', hint: 'The camera tracks him' },
];

/** Angband writes a speed as its distance from 110, and so does the readout. */
function rating(value: number): string {
	return `${value} (${value >= 110 ? '+' : ''}${value - 110})`;
}

export function Inspector({ client, scripts }: InspectorProps) {
	const [fps, setFps] = useState(0);
	const [instances, setInstances] = useState(0);
	const [stats, setStats] = useState<YardStats | null>(null);
	// Mirrored only so the checkboxes re-render; the client stays the owner.
	const [toggleTick, setToggleTick] = useState(0);
	/*
	 * The camera's own numbers, polled.
	 *
	 * These sliders are one of two ways to aim the camera now — the other is a
	 * drag on the canvas, which the mouse got back when it stopped aiming him.
	 * They are still
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
				Turn clock
			</Typography>

			{stats ? (
				<Box sx={{ mb: 1 }}>
					{row('You', stats.message)}
					{row('Clock', stats.waitingForYou ? 'waiting for you' : 'running')}
					{row('Turn', `${stats.gameTurn} game · ${stats.actions} actions`)}
					{row('Last', stats.lastAction)}
					{row('Cell', `${stats.cell.q}, ${stats.cell.r} · terrace ${stats.terrace ?? '–'}`)}
					{row('Route', stats.stepsLeft ? `${stats.stepsLeft} hex to go` : '—')}
					{row('Your speed', `${rating(stats.speedRating)} · ${stats.energy | 0} energy`)}
					{row(
						'Gait',
						stats.amp > 0.05
							? `${stats.gait > 0.5 ? 'run' : 'walk'} · ${stats.speed.toFixed(2)} m/s`
							: 'standing',
					)}
					{row('Carrying', stats.carrying.length ? stats.carrying.join(', ') : 'nothing')}
					{row('Pelvis drop', `${(stats.pelvisDrop * 100).toFixed(1)} cm`)}
					<Divider sx={{ my: 0.75 }} />
					{row('Bat', `${stats.batMessage} · ${stats.batState}`)}
					{row(
						'Its speed',
						`${rating(stats.batSpeedRating)} · ×${stats.batSpeedFactor.toFixed(1)} · ${stats.batEnergy | 0} energy`,
					)}
					{row(
						'Range',
						`${stats.batRange} tiles · wakes at ${stats.wakeRange}, loses you at ${stats.loseRange}`,
					)}
					{row('Bites / missed', `${stats.bites} · ${stats.batMissed}`)}
					{stats.cuts > 0 && row('Cuts / hits', `${stats.cuts} · ${stats.hits}`)}
					{row('Reach', `${stats.reach.toFixed(2)} m + ${(stats.lean * 100).toFixed(0)} cm lean`)}
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

			{/*
			  * What the scripts are doing.
			  *
			  * Worth a permanent line rather than only an error: a compile
			  * failure leaves the PREVIOUS scripts running, so without
			  * something on screen the yard carries on behaving correctly
			  * while the file being edited is not the one running it — which
			  * is the most confusing state this whole mechanism can be in.
			  */}
			<Divider sx={{ my: 1.5 }} />
			<Typography variant="overline" color="text.secondary">
				Scripts
			</Typography>
			{scripts === null ? (
				<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
					Not compiled yet.
				</Typography>
			) : (
				<>
					<Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5, mb: 0.5 }}>
						{scripts.names.length === 0 ? (
							<Typography variant="caption" color="text.secondary">
								None running.
							</Typography>
						) : (
							scripts.names.map((name) => <Chip key={name} size="small" label={name} />)
						)}
						{scripts.compiling && <Chip size="small" label="compiling" variant="outlined" />}
					</Stack>
					{scripts.error ? (
						<Alert severity="warning" sx={{ py: 0, mb: 1 }}>
							<Typography variant="caption" component="span">
								{scripts.error}
							</Typography>
							<Typography variant="caption" component="div" color="text.secondary">
								The scripts from before this error are still running.
							</Typography>
						</Alert>
					) : (
						<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
							Reloaded {scripts.generation}x. Saving a file in
							<code> packages/client/scripts</code> swaps them here.
						</Typography>
					)}
				</>
			)}

			<Divider sx={{ my: 1.5 }} />
			<Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
				<b>W</b>/<b>S</b> are his, <b>A</b>/<b>D</b> the screen's. <b>Shift</b> runs,
				<b> click</b> or <b>space</b> cuts. The mouse aims and nothing else — the
				camera follows him, and the sliders above are the only thing that turns it.
			</Typography>
		</Box>
	);
}
