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
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BackendPreference } from '@hexdelve/engine';

import { useAssets } from '../assets/library.js';
import type { BenchShow, CharacterBench } from '../bench/CharacterBench.js';
import {
	benchRigs,
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

/**
 * The bench, once there is something to put on it.
 *
 * Split from the loading in two, rather than threading nulls through
 * everything below: a bench with no subject is not a bench with a blank
 * subject, it is a bench that does not exist yet, and the state underneath —
 * which bone is selected, which clip is playing, where its playhead is — has
 * no meaning without one. The wrapper waits; this is what happens after.
 */
function BenchOnRigs({ backend, running, rigs }: BenchProps & { rigs: readonly BenchRig[] }) {
	const [bench, setBench] = useState<CharacterBench | null>(null);
	const [rig, setRig] = useState<BenchRig>(rigs[0]!);
	const [animation, setAnimation] = useState<BenchAnimation>(rigs[0]!.animations[0]!);
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
		initialParameters(rigs[0]!.animations[0]!),
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
				rigs={rigs}
				rig={rig}
				onRigChange={chooseRig}
				selected={selectedBone}
				onSelect={setSelectedBone}
			/>
			<Box sx={{ flex: 1, display: 'flex', minWidth: 0 }}>
				<BenchViewport
					backend={backend}
					running={running}
					rig={rig}
					onBenchReady={onBenchReady}
				/>
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

/**
 * The bench, and the wait for the manifest.
 *
 * Everything on the stand comes out of `public/assets` now — the rigs, the
 * bodies, the clips and the trees — so there is a moment before there is
 * anything to show. It is short and it is honest, and a spinner is better than
 * a subject invented to fill it.
 */
export function Bench({ backend, running }: BenchProps) {
	const { entities, loading, error } = useAssets();

	/*
	 * The subjects, built once per manifest read. A bench rig carries a model
	 * and a set of blend trees, and a tree owns a playhead — so rebuilding
	 * these on every render would hand the viewport a new subject every frame.
	 */
	const rigs = useMemo(() => benchRigs(entities), [entities]);

	if (error) return <BenchNotice text={error} error />;
	if (loading) return <BenchNotice text="Reading the manifest…" spinner />;
	if (rigs.length === 0) return <BenchNotice text="No entity in the manifest has a rig." />;

	/*
	 * Keyed by the subjects, so a manifest that changed under a save — the
	 * assets view can do that — rebuilds the bench rather than leaving it
	 * holding a model nothing points at any more.
	 */
	return (
		<BenchOnRigs
			key={rigs.map((rig) => rig.id).join(',')}
			backend={backend}
			running={running}
			rigs={rigs}
		/>
	);
}

function BenchNotice({ text, spinner, error }: { text: string; spinner?: boolean; error?: boolean }) {
	return (
		<Box
			sx={{
				flex: 1,
				display: 'flex',
				gap: 1.5,
				alignItems: 'center',
				justifyContent: 'center',
				p: 3,
			}}
		>
			{spinner && <CircularProgress size={20} />}
			<Typography variant="body2" color={error ? 'error' : 'text.secondary'}>
				{text}
			</Typography>
		</Box>
	);
}
