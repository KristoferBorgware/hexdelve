/*
 * The right-hand panel: what the renderer is, and the handful of knobs worth
 * having before there is anything in the world to select.
 *
 * Camera and light are mutated on the client directly rather than mirrored in
 * React state — the frame loop reads them sixty times a second, and routing
 * that through a re-render would be both slower and a lie about who owns them.
 */

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import type { HexdelveClient } from '@hexdelve/client';

export interface InspectorProps {
	client: HexdelveClient | null;
}

export function Inspector({ client }: InspectorProps) {
	const [fps, setFps] = useState(0);

	useEffect(() => {
		if (!client) return;
		const handle = window.setInterval(() => setFps(client.stats.fps), 500);
		return () => window.clearInterval(handle);
	}, [client]);

	const info = client?.info;

	return (
		<Box
			component="aside"
			sx={{
				width: 288,
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
			</Stack>

			<Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
				{info?.device ?? 'starting…'}
			</Typography>

			{info?.fellBack && (
				<Typography variant="body2" color="warning.main" sx={{ mt: 1 }}>
					WebGPU was asked for and was not available.
				</Typography>
			)}

			{client && (
				<>
					<Divider sx={{ my: 2 }} />
					<Typography variant="subtitle2" color="text.secondary">
						Camera
					</Typography>
					<Stack spacing={1.5} sx={{ mt: 1.5 }}>
						<Labelled label="Distance">
							<Slider
								size="small"
								min={4}
								max={80}
								step={0.5}
								defaultValue={client.camera.distance}
								onChange={(_, value) => {
									client.camera.distance = value as number;
									if (!client.running) client.renderOnce();
								}}
							/>
						</Labelled>
						<Labelled label="Pitch">
							<Slider
								size="small"
								min={0.08}
								max={1.5}
								step={0.01}
								defaultValue={client.camera.pitch}
								onChange={(_, value) => {
									client.camera.pitch = value as number;
									if (!client.running) client.renderOnce();
								}}
							/>
						</Labelled>
						<Labelled label="Field of view">
							<Slider
								size="small"
								min={0.2}
								max={1.2}
								step={0.01}
								defaultValue={client.camera.fovY}
								onChange={(_, value) => {
									client.camera.fovY = value as number;
									if (!client.running) client.renderOnce();
								}}
							/>
						</Labelled>
					</Stack>

					<Divider sx={{ my: 2 }} />
					<Typography variant="subtitle2" color="text.secondary">
						Light
					</Typography>
					<Stack spacing={1.5} sx={{ mt: 1.5 }}>
						<Labelled label="Intensity">
							<Slider
								size="small"
								min={0}
								max={1.5}
								step={0.01}
								defaultValue={client.light.intensity}
								onChange={(_, value) => {
									client.light.intensity = value as number;
									if (!client.running) client.renderOnce();
								}}
							/>
						</Labelled>
						<Labelled label="Ambient">
							<Slider
								size="small"
								min={0}
								max={1}
								step={0.01}
								defaultValue={client.light.ambient[0]}
								onChange={(_, value) => {
									const level = value as number;
									client.light.ambient.set([level, level * 1.06, level]);
									if (!client.running) client.renderOnce();
								}}
							/>
						</Labelled>
					</Stack>
				</>
			)}
		</Box>
	);
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<Box>
			<Typography variant="caption" color="text.secondary">
				{label}
			</Typography>
			{children}
		</Box>
	);
}
