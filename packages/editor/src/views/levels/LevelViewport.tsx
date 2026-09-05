/*
 * The level bench's canvas.
 *
 * The same shape as the two viewports either side of it, for the same reason:
 * a canvas hands out one kind of context and then that is what it is forever,
 * so switching backend means a genuinely new element. Building it inside the
 * effect ties its life to that effect exactly — one run, one canvas, one device.
 *
 * Unlike those two it has no frame loop to start or stop. A level does not
 * move; the bench draws when something changes and is otherwise idle, which is
 * why the toolbar's transport is disabled while this view is up rather than
 * quietly doing nothing.
 */

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { useEffect, useRef, useState } from 'react';
import type { BackendPreference } from '@hexdelve/engine';

import { LevelBench } from './LevelBench.js';

export interface LevelViewportProps {
	backend: BackendPreference;
	onBenchReady(bench: LevelBench | null): void;
}

export function LevelViewport({ backend, onBenchReady }: LevelViewportProps) {
	const hostRef = useRef<HTMLDivElement>(null);
	const benchRef = useRef<LevelBench | null>(null);
	const [status, setStatus] = useState<'starting' | 'ready' | 'failed'>('starting');
	const [error, setError] = useState('');

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;

		const canvas = document.createElement('canvas');
		canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
		host.replaceChildren(canvas);

		let disposed = false;
		setStatus('starting');
		setError('');

		LevelBench.create({
			canvas,
			backend,
			onDeviceLost: (reason) => {
				if (disposed) return;
				setError(reason);
				setStatus('failed');
			},
		})
			.then((bench) => {
				// The backend may have been switched again while the device
				// request was in flight; this bench is already obsolete.
				if (disposed) {
					bench.dispose();
					return;
				}
				benchRef.current = bench;
				setStatus('ready');
				onBenchReady(bench);
			})
			.catch((cause: unknown) => {
				if (disposed) return;
				setError(cause instanceof Error ? cause.message : String(cause));
				setStatus('failed');
				onBenchReady(null);
			});

		return () => {
			disposed = true;
			benchRef.current?.dispose();
			benchRef.current = null;
			canvas.remove();
			onBenchReady(null);
		};
	}, [backend, onBenchReady]);

	return (
		<Box
			sx={{
				position: 'relative',
				flex: 1,
				minWidth: 0,
				bgcolor: '#0e0f12',
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
