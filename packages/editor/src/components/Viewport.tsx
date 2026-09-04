/*
 * The editor's view of the game.
 *
 * This is the whole reason the client is a package and not an application: the
 * editor makes a canvas, hands it to `createClient`, and from then on it is
 * looking at exactly what a player would be looking at. There is no editor
 * renderer and no editor scene — only the client, in a box.
 *
 * The canvas is created here rather than rendered as JSX, which is worth a
 * word. A canvas hands out one kind of context and then that is what it is
 * forever: ask a canvas that has given out `webgpu` for `webgl2` and it
 * answers null. So switching backend means a genuinely new element, and
 * leaving that to React's reconciler is too subtle to rely on — under a fast
 * switch, while the first (asynchronous) `createClient` is still in flight,
 * two effect runs could end up sharing one element and the second would find
 * the context type already spoken for. Building the element inside the effect
 * ties its life to that effect exactly: one run, one canvas, one context.
 */

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import { useEffect, useRef, useState } from 'react';
import { createClient, type HexdelveClient } from '@hexdelve/client';

import { watchScripts, type ScriptWatchState } from '../scripts/reload.js';
import type { BackendPreference } from '@hexdelve/engine';

export interface ViewportProps {
	backend: BackendPreference;
	running: boolean;
	onClientReady(client: HexdelveClient | null): void;
	/** What the scripts are doing: which are running, and what last failed. */
	onScripts(state: ScriptWatchState): void;
}

export function Viewport({ backend, running, onClientReady, onScripts }: ViewportProps) {
	const hostRef = useRef<HTMLDivElement>(null);
	const clientRef = useRef<HexdelveClient | null>(null);
	const [status, setStatus] = useState<'starting' | 'ready' | 'failed'>('starting');
	const [error, setError] = useState<string>('');

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;

		const canvas = document.createElement('canvas');
		canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
		host.replaceChildren(canvas);

		let disposed = false;
		let stopWatching: (() => void) | null = null;
		setStatus('starting');
		setError('');

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
				// The backend may have been switched again while the device
				// request was in flight; this client is already obsolete.
				if (disposed) {
					client.dispose();
					return;
				}
				clientRef.current = client;
				/*
				 * Hand this client's script host to the watcher, so a saved
				 * script file reaches the yard without a rebuild. The client
				 * came up on the table compiled into it; from here on it runs
				 * whatever is on disk.
				 */
				stopWatching = watchScripts(client.simulation.scripts, onScripts);
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
			stopWatching?.();
			clientRef.current?.dispose();
			clientRef.current = null;
			canvas.remove();
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
			<Box ref={hostRef} sx={{ width: '100%', height: '100%' }} />

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
