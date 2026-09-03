/*
 * The character bench, as a three-panel view: bones, subject, transport.
 *
 * It sits beside the game viewport rather than inside it. The viewport is
 * `createClient` in a box and has no scene of its own, which is the point of
 * it; a bench cannot be that, because what it exists to show — one rig, alone,
 * held at a frame you choose — is exactly what a running world will not do.
 *
 * The two views are never mounted at once, on purpose. A canvas owns its GPU
 * context for its whole life, so two live viewports would mean two devices for
 * one thing anybody is looking at. Switching tabs therefore tears one down and
 * builds the other, which costs a device request and is the honest price.
 *
 * Everything the panels choose lives HERE rather than on the bench, and is
 * pushed down in one effect. That is not tidiness: switching renderer builds a
 * new bench, and a bench that came up with its own defaults while the panels
 * still read the old ones would leave the two disagreeing about which clip is
 * even playing. State the user set outlives the device it was set on.
 */

import Box from '@mui/material/Box';
import { useCallback, useEffect, useState } from 'react';
import type { BackendPreference } from '@hexdelve/engine';

import type { BenchShow, CharacterBench } from '../bench/CharacterBench.js';
import { BENCH_RIGS, type BenchAnimation, type BenchRig } from '../bench/rigs.js';
import { BenchInspector } from './BenchInspector.js';
import { BenchViewport } from './BenchViewport.js';
import { BoneOutline } from './BoneOutline.js';

const DEFAULT_SHOW: BenchShow = { mesh: true, skeleton: false, ground: true, spin: false };

export interface BenchProps {
	backend: BackendPreference;
	running: boolean;
}

export function Bench({ backend, running }: BenchProps) {
	const [bench, setBench] = useState<CharacterBench | null>(null);
	const [rig, setRig] = useState<BenchRig>(BENCH_RIGS[0]!);
	const [animation, setAnimation] = useState<BenchAnimation>(BENCH_RIGS[0]!.animations[0]!);
	const [selectedBone, setSelectedBone] = useState<string | null>(null);
	const [show, setShow] = useState<BenchShow>(DEFAULT_SHOW);
	const [speed, setSpeed] = useState(1);

	// Stable, because BenchViewport tears the bench down when this changes.
	const onBenchReady = useCallback((next: CharacterBench | null) => setBench(next), []);

	/*
	 * The panels' state, made true of whatever bench is currently up — the one
	 * that has been there all along, or the one a backend switch just built.
	 */
	useEffect(() => {
		if (!bench) return;
		bench.setRig(rig);
		if (bench.clip !== animation) bench.setAnimation(animation);
		bench.selectedBone = selectedBone;
		bench.speed = speed;
		Object.assign(bench.show, show);
		if (!bench.running) bench.renderOnce();
	}, [bench, rig, animation, selectedBone, show, speed]);

	const chooseRig = (next: BenchRig): void => {
		if (next === rig) return;
		// A new creature brings its own bones and its own clips; neither of the
		// old selections means anything on it.
		setRig(next);
		setAnimation(next.animations[0]!);
		setSelectedBone(null);
	};

	return (
		<>
			<BoneOutline
				rig={rig}
				onRigChange={chooseRig}
				selected={selectedBone}
				onSelect={setSelectedBone}
			/>
			<Box sx={{ flex: 1, display: 'flex', minWidth: 0 }}>
				<BenchViewport backend={backend} running={running} onBenchReady={onBenchReady} />
			</Box>
			<BenchInspector
				bench={bench}
				rig={rig}
				animation={animation}
				onAnimationChange={setAnimation}
				show={show}
				onShowChange={(key, value) => setShow((current) => ({ ...current, [key]: value }))}
				speed={speed}
				onSpeedChange={setSpeed}
				selectedBone={selectedBone}
			/>
		</>
	);
}
