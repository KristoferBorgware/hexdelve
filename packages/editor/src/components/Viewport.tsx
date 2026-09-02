/*
 * The editor's view of the game.
 *
 * This is the whole reason the client is a package and not an application: the
 * editor mounts a canvas, hands it to `createClient`, and from then on it is
 * looking at exactly what a player would be looking at. There is no editor
 * renderer and no editor scene — only the client, in a box.
 */

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import { useEffect, useRef, useState } from 'react';
import { createClient, type HexdelveClient } from '@hexdelve/client';
import type { BackendPreference } from '@hexdelve/engine';

export interface ViewportProps {
	backend: BackendPreference;
	running: boolean;
	onClientReady(client: HexdelveClient | null): void;
}

export function Viewport({ backend, running, onClientReady }: ViewportProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const clientRef = useRef<HexdelveClient | null>(null);
	const [status, setStatus] = useState<'starting' | 'ready' | 'failed'>('starting');
	const [error, setError] = useState<string>('');

	// Re-created when the backend changes, because a renderer owns its context
	// and a canvas will only ever give out one.
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		let disposed = false;
		setStatus('starting');

		createClient({
			canvas,
			backend,
			onDeviceLost: (reason) => {
				if (disposed) return;
				setError(reason);
				setStatus('failed');
			},
		})
			.then((client) => {
				if (disposed) {
					client.dispose();
					return;
				}
				clientRef.current = client;
				setStatus('ready');
				onClientReady(client);
			})
			.catch((cause: unknown) => {
				if (disposed) return;
				setError(cause instanceof Error ? cause.message : String(cause));
				setStatus('failed');
				onClientReady(null);
			});

		return () => {
			disposed = true;
			clientRef.current?.dispose();
			clientRef.current = null;
			onClientReady(null);
		};
	}, [backend, onClientReady]);

	// Pausing stops the loop but still draws once, so the viewport holds the
	// last frame instead of going blank.
	useEffect(() => {
		const client = clientRef.current;
		if (!client || status !== 'ready') return;
		if (running) client.start();
		else {
			client.stop();
			client.renderOnce();
		}
	}, [running, status]);

	return (
		<Box
			sx={{
				position: 'relative',
				flex: 1,
				minWidth: 0,
				bgcolor: '#11150f',
				overflow: 'hidden',
			}}
		>
			{/* A canvas is replaced wholesale when the backend changes: keying it
			    forces React to make a new element rather than reuse a canvas that
			    already has a context bound to it. */}
			<canvas
				key={backend}
				ref={canvasRef}
				style={{ display: 'block', width: '100%', height: '100%', touchAction: 'none' }}
			/>

			{status === 'starting' && (
				<Box sx={overlay}>
					<CircularProgress size={26} />
				</Box>
			)}

			{status === 'failed' && (
				<Box sx={{ ...overlay, p: 3 }}>
					<Alert severity="error" variant="outlined" sx={{ maxWidth: 460, pointerEvents: 'auto' }}>
						The renderer stopped. {error} Switching backend above will start a new one.
					</Alert>
				</Box>
			)}
		</Box>
	);
}

const overlay = {
	position: 'absolute',
	inset: 0,
	display: 'grid',
	placeItems: 'center',
	pointerEvents: 'none',
} as const;
