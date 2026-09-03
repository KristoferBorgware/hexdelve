/*
 * The level bench, as a three-panel view: stack, level, knobs.
 *
 * Everything the panels choose lives HERE rather than on the bench, and is
 * pushed down in one effect — the same arrangement the character bench uses,
 * for the same reason: switching renderer builds a new bench, and a bench that
 * came up with its own defaults while the panels still read the old ones would
 * leave the two disagreeing about which level is even on screen.
 *
 * Parameters are kept per stack rather than in one bag. The two stacks share no
 * knob names today and might tomorrow, and either way the useful behaviour is
 * that flipping to WFC and back leaves the noise band exactly where it was
 * being tuned. A comparison you have to re-dial each time is not a comparison.
 *
 * Generation is debounced by a few frames. Dragging a slider fires a change per
 * pointer move, a wave function over a 24-ring disc is tens of milliseconds,
 * and the difference between running that on every event and on the last one is
 * the difference between a slider that tracks and a slider that lurches.
 */

import Box from '@mui/material/Box';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
	defaultParams,
	LEVEL_STACKS,
	type ExitPlacement,
	type Level,
	type LevelStack,
} from '@hexdelve/client';
import type { BackendPreference } from '@hexdelve/engine';

import type { LevelBench, LevelShow } from '../bench/LevelBench.js';
import { LevelInspector } from './LevelInspector.js';
import { LevelViewport } from './LevelViewport.js';
import { StackOutline } from './StackOutline.js';

const DEFAULT_SHOW: LevelShow = {
	rock: true,
	route: true,
	entities: true,
	regions: false,
	stitching: false,
};

/** Long enough to swallow a slider drag, short enough not to feel like lag. */
const SETTLE_MS = 40;

export interface LevelsProps {
	backend: BackendPreference;
}

export function Levels({ backend }: LevelsProps) {
	const [bench, setBench] = useState<LevelBench | null>(null);
	const [stack, setStack] = useState<LevelStack>(LEVEL_STACKS[0]!);
	const [seed, setSeed] = useState(1);
	const [radius, setRadius] = useState(14);
	const [depth, setDepth] = useState(20);
	const [vaults, setVaults] = useState(2);
	const [exitIn, setExitIn] = useState<ExitPlacement>('anywhere');
	const [stitch, setStitch] = useState(true);
	const [prune, setPrune] = useState(true);
	const [show, setShow] = useState<LevelShow>(DEFAULT_SHOW);
	const [level, setLevel] = useState<Level | null>(null);

	// One bag of settings per stack, defaulted from the stack's own declaration.
	const [params, setParams] = useState<Record<string, Record<string, number>>>(() => {
		const all: Record<string, Record<string, number>> = {};
		for (const candidate of LEVEL_STACKS) all[candidate.id] = defaultParams(candidate);
		return all;
	});

	const current = useMemo(
		() => params[stack.id] ?? defaultParams(stack),
		[params, stack],
	);

	// Stable, because LevelViewport tears the bench down when this changes.
	const onBenchReady = useCallback((next: LevelBench | null) => setBench(next), []);

	/* Generate, off the event that asked for it. */
	useEffect(() => {
		const handle = window.setTimeout(() => {
			setLevel(stack.generate({ seed, radius, depth, vaults, exitIn, params: current, stitch, prune }));
		}, SETTLE_MS);
		return () => window.clearTimeout(handle);
	}, [stack, seed, radius, depth, vaults, exitIn, stitch, prune, current]);

	/* Whatever bench is up — the old one, or the one a backend switch built. */
	useEffect(() => {
		if (!bench) return;
		Object.assign(bench.show, show);
		if (level) bench.setLevel(level);
		else bench.refresh();
	}, [bench, level, show]);

	return (
		<>
			<StackOutline stack={stack} onStackChange={setStack} />
			<Box sx={{ flex: 1, display: 'flex', minWidth: 0 }}>
				<LevelViewport backend={backend} onBenchReady={onBenchReady} />
			</Box>
			<LevelInspector
				bench={bench}
				stack={stack}
				level={level}
				seed={seed}
				onSeedChange={setSeed}
				radius={radius}
				onRadiusChange={setRadius}
				depth={depth}
				onDepthChange={setDepth}
				vaults={vaults}
				onVaultsChange={setVaults}
				exitIn={exitIn}
				onExitInChange={setExitIn}
				stitch={stitch}
				onStitchChange={setStitch}
				prune={prune}
				onPruneChange={setPrune}
				params={current}
				onParamChange={(key, value) =>
					setParams((all) => ({ ...all, [stack.id]: { ...current, [key]: value } }))
				}
				show={show}
				onShowChange={(key, value) => setShow((now) => ({ ...now, [key]: value }))}
			/>
		</>
	);
}
