/*
 * The bench's canvas.
 *
 * Same shape as the game viewport next door, and for the same reason: a canvas
 * hands out one kind of context and then that is what it is forever, so
 * switching backend has to mean a genuinely new element. Building it inside the
 * effect ties its life to that effect exactly — one run, one canvas, one
 * context — rather than trusting React's reconciler to keep two asynchronous
 * device requests from sharing an element.
 */

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { useEffect, useRef, useState } from 'react';
import type { BackendPreference } from '@hexdelve/engine';

import { CharacterBench } from '../bench/CharacterBench.js';
import type { BenchRig } from '../bench/rigs.js';

export interface BenchViewportProps {
	backend: BackendPreference;
	running: boolean;
	/** The subject the bench is created on. A bench without one is not a bench. */
	rig: BenchRig;
	onBenchReady(bench: CharacterBench | null): void;
}

export function BenchViewport({ backend, running, rig, onBenchReady }: BenchViewportProps) {
	const hostRef = useRef<HTMLDivElement>(null);
	const benchRef = useRef<CharacterBench | null>(null);
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

		CharacterBench.create({
			canvas,
			backend,
			rig,
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

	useEffect(() => {
		const bench = benchRef.current;
		if (!bench || status !== 'ready') return;
		if (running) bench.start();
		else {
			bench.stop();
			bench.renderOnce();
		}
	}, [running, status]);

	return (
		<Box
			sx={{
				position: 'relative',
				flex: 1,
				minWidth: 0,
				bgcolor: '#1b201c',
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
