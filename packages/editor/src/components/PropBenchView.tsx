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
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BackendPreference } from '@hexdelve/engine';

import { useAssets } from '../assets/library.js';
import {
	wearerDefault,
	type PropBench,
	type PropDisplay,
	type PropShow,
} from '../bench/PropBench.js';
import { benchProps, type BenchProp } from '../bench/props.js';
import { benchRigs, type BenchAnimation, type BenchRig } from '../bench/rigs.js';
import { defaultStats, isEdited, type PropStats, type PropStatValue } from '../bench/stats.js';
import { PropCatalogue } from './PropCatalogue.js';
import { PropInspector } from './PropInspector.js';
import { PropViewport } from './PropViewport.js';

const DEFAULT_SHOW: PropShow = { pad: true, spin: false, bounds: false, ghost: true };

export interface PropBenchViewProps {
	backend: BackendPreference;
	running: boolean;
}

interface LoadedProps extends PropBenchViewProps {
	props: readonly BenchProp[];
	wearer: BenchRig;
}

function PropBenchOnProps({ backend, running, props, wearer }: LoadedProps) {
	const [bench, setBench] = useState<PropBench | null>(null);
	const [prop, setProp] = useState<BenchProp>(props[0]!);
	const [display, setDisplay] = useState<PropDisplay>('stand');
	const [animation, setAnimation] = useState<BenchAnimation>(() => wearerDefault(wearer));
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
				props={props}
				prop={prop}
				onPropChange={chooseProp}
				selectedPart={selectedPart}
				onSelectPart={setSelectedPart}
			/>
			<Box sx={{ flex: 1, display: 'flex', minWidth: 0 }}>
				<PropViewport
					backend={backend}
					running={running}
					prop={prop}
					wearer={wearer}
					onBenchReady={onBenchReady}
				/>
			</Box>
			<PropInspector
				bench={bench}
				prop={prop}
				display={display}
				onDisplayChange={setDisplay}
				animation={animation}
				onAnimationChange={setAnimation}
				wearerAnimations={wearer.animations}
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

/**
 * The prop bench, and the wait for the manifest.
 *
 * Two things have to arrive before there is anything to show: the props, and
 * the body they are checked against. Both are entities, so both are files, and
 * the wearer is simply the first character on the manifest — the same one the
 * character bench opens on, which is the point of them coming from one list.
 */
export function PropBenchView({ backend, running }: PropBenchViewProps) {
	const { entities, loading, error } = useAssets();
	const props = useMemo(() => benchProps(entities), [entities]);
	const wearer = useMemo(() => benchRigs(entities)[0] ?? null, [entities]);

	if (error) return <PropNotice text={error} error />;
	if (loading) return <PropNotice text="Reading the manifest…" spinner />;
	if (props.length === 0) return <PropNotice text="No entity in the manifest is a prop." />;
	if (!wearer) return <PropNotice text="No entity in the manifest has a rig to wear it." />;

	return (
		<PropBenchOnProps
			key={`${props.map((one) => one.id).join(',')}|${wearer.id}`}
			backend={backend}
			running={running}
			props={props}
			wearer={wearer}
		/>
	);
}

function PropNotice({ text, spinner, error }: { text: string; spinner?: boolean; error?: boolean }) {
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
