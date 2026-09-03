/*
 * The prop bench, as a three-panel view: catalogue, subject, stats.
 *
 * The same arrangement as the character bench next door, for the same reasons.
 * The two are never mounted at once: a canvas owns its GPU context for its
 * whole life, so two live viewports would mean two devices for one thing
 * anybody is looking at. Switching tabs tears one down and builds the other,
 * which costs a device request and is the honest price.
 *
 * Everything the panels choose lives HERE rather than on the bench, and is
 * pushed down in one effect — switching renderer builds a new bench, and a
 * bench that came up with its own defaults while the panels still read the old
 * ones would leave the two disagreeing about what is even on the stand.
 *
 * The edited stats live here too, keyed by prop, which is what makes them
 * survive both a renderer switch and a walk through the whole catalogue and
 * back. They survive nothing else: there is no item system to write them to
 * yet, and a reload starts over from the defaults.
 */

import Box from '@mui/material/Box';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BackendPreference } from '@hexdelve/engine';

import {
	WEARER_DEFAULT,
	type PropBench,
	type PropDisplay,
	type PropShow,
} from '../bench/PropBench.js';
import { BENCH_PROPS, type BenchProp } from '../bench/props.js';
import type { BenchAnimation } from '../bench/rigs.js';
import { defaultStats, isEdited, type PropStats, type PropStatValue } from '../bench/stats.js';
import { PropCatalogue } from './PropCatalogue.js';
import { PropInspector } from './PropInspector.js';
import { PropViewport } from './PropViewport.js';

const DEFAULT_SHOW: PropShow = { pad: true, spin: false, bounds: false, ghost: true };

export interface PropBenchViewProps {
	backend: BackendPreference;
	running: boolean;
}

export function PropBenchView({ backend, running }: PropBenchViewProps) {
	const [bench, setBench] = useState<PropBench | null>(null);
	const [prop, setProp] = useState<BenchProp>(BENCH_PROPS[0]!);
	const [display, setDisplay] = useState<PropDisplay>('stand');
	const [animation, setAnimation] = useState<BenchAnimation>(WEARER_DEFAULT);
	const [selectedPart, setSelectedPart] = useState<number | null>(null);
	const [show, setShow] = useState<PropShow>(DEFAULT_SHOW);
	const [edits, setEdits] = useState<Record<string, PropStats>>({});

	// Stable, because PropViewport tears the bench down when this changes.
	const onBenchReady = useCallback((next: PropBench | null) => setBench(next), []);

	const stats = useMemo<PropStats>(
		() => edits[prop.id] ?? defaultStats(prop),
		[edits, prop],
	);

	/*
	 * The panels' state, made true of whatever bench is currently up — the one
	 * that has been there all along, or the one a backend switch just built.
	 */
	useEffect(() => {
		if (!bench) return;
		bench.setProp(prop);
		bench.setDisplay(display);
		bench.setAnimation(animation);
		bench.selectedPart = selectedPart;
		Object.assign(bench.show, show);
		if (!bench.running) bench.renderOnce();
	}, [bench, prop, display, animation, selectedPart, show]);

	const chooseProp = (next: BenchProp): void => {
		if (next === prop) return;
		// A different prop is a different pile of prisms; the old selection
		// indexes into a list that no longer exists.
		setProp(next);
		setSelectedPart(null);
	};

	const changeStat = (key: string, value: PropStatValue): void => {
		setEdits((current) => ({
			...current,
			[prop.id]: { ...(current[prop.id] ?? defaultStats(prop)), [key]: value },
		}));
	};

	const revertStats = (): void => {
		setEdits((current) => {
			const { [prop.id]: _dropped, ...rest } = current;
			return rest;
		});
	};

	return (
		<>
			<PropCatalogue
				prop={prop}
				onPropChange={chooseProp}
				selectedPart={selectedPart}
				onSelectPart={setSelectedPart}
			/>
			<Box sx={{ flex: 1, display: 'flex', minWidth: 0 }}>
				<PropViewport backend={backend} running={running} onBenchReady={onBenchReady} />
			</Box>
			<PropInspector
				bench={bench}
				prop={prop}
				display={display}
				onDisplayChange={setDisplay}
				animation={animation}
				onAnimationChange={setAnimation}
				show={show}
				onShowChange={(key, value) => setShow((current) => ({ ...current, [key]: value }))}
				stats={stats}
				onStatChange={changeStat}
				onRevert={revertStats}
				edited={isEdited(prop, stats)}
			/>
		</>
	);
}
