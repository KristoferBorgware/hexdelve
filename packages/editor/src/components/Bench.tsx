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
import {
	BENCH_RIGS,
	initialParameters,
	isTree,
	type BenchAnimation,
	type BenchRig,
} from '../bench/rigs.js';
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
	/** Repeat at the end of the cycle. On by default; see `CharacterBench.loop`. */
	const [loop, setLoop] = useState(true);
	/*
	 * A tree's parameters, and whether its synced leaves share a phase. Both
	 * live here for the same reason as everything else on this list: the tree
	 * objects outlive any one renderer, but the panel's reading of them would
	 * not if it were held next to the device.
	 */
	const [params, setParams] = useState<Record<string, number>>(() =>
		initialParameters(BENCH_RIGS[0]!.animations[0]!),
	);
	const [treeSync, setTreeSync] = useState(true);

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
		bench.loop = loop;
		Object.assign(bench.show, show);
		if (isTree(animation)) {
			// Written onto the tree rather than passed to it, because the frame
			// loop samples between renders and React is not in that path.
			Object.assign(animation.params, params);
			animation.tree.sync = treeSync;
		}
		if (!bench.running) bench.renderOnce();
	}, [bench, rig, animation, selectedBone, show, speed, loop, params, treeSync]);

	const chooseAnimation = (next: BenchAnimation): void => {
		setAnimation(next);
		// Parameters belong to a tree, so they start again with each one.
		setParams(initialParameters(next));
	};

	const chooseRig = (next: BenchRig): void => {
		if (next === rig) return;
		// A new creature brings its own bones and its own clips; neither of the
		// old selections means anything on it.
		setRig(next);
		chooseAnimation(next.animations[0]!);
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
				onAnimationChange={chooseAnimation}
				params={params}
				onParamChange={(name, value) =>
					setParams((current) => ({ ...current, [name]: value }))
				}
				treeSync={treeSync}
				onTreeSyncChange={setTreeSync}
				show={show}
				onShowChange={(key, value) => setShow((current) => ({ ...current, [key]: value }))}
				speed={speed}
				onSpeedChange={setSpeed}
				loop={loop}
				onLoopChange={setLoop}
				selectedBone={selectedBone}
			/>
		</>
	);
}
