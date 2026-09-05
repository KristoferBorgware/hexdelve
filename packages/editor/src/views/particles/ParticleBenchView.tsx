/*
 * The particle bench, as a three-panel view: effects, subject, controls.
 *
 * The same arrangement as the prop bench next door, and the same rule about
 * where state lives: everything the panels choose lives HERE and is pushed
 * down in one effect, because switching renderer builds a new bench and a
 * bench that came up with its own defaults while the panels still read the old
 * ones would leave the two disagreeing about what is on the stand.
 *
 * ## What an edit is
 *
 * A new `ParticleEffect`. Nothing is mutated: the inspector's controls each
 * return a copy with one field changed, and the bench builds a fresh
 * `ParticleSystem` from whatever it is handed. That is not fastidiousness — a
 * particle draws every number it holds at its birth, so particles already out
 * were built to the OLD effect and would go on being wrong for as long as they
 * lived. Starting over is also what somebody who just moved a slider wants to
 * see.
 *
 * ## What is saved, and what is not
 *
 * Edits live here until they are saved, and a save writes the file the effect
 * came from — see `saveEffect.ts` for what it keeps. Switching to another
 * effect throws away unsaved changes to the one being left, and the panel says
 * `edited` while there are any.
 */

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { writeParticleEffect, type BackendPreference, type ParticleEffect } from '@hexdelve/engine';

import { library, useAssets } from '../../assets/library.js';
import { ParticleCatalogue } from './ParticleCatalogue.js';
import { ParticleInspector } from './ParticleInspector.js';
import { ParticleViewport } from './ParticleViewport.js';
import { effectDocument, readHeader, saveEffect } from './saveEffect.js';
import type { ParticleBench, ParticleShow } from './ParticleBench.js';

const DEFAULT_SHOW: ParticleShow = { pad: true, ruler: true, spin: false };

export interface ParticleBenchViewProps {
	backend: BackendPreference;
	running: boolean;
}

interface LoadedProps extends ParticleBenchViewProps {
	effects: readonly ParticleEffect[];
	reload(): void;
}

function ParticleBenchOnEffects({ backend, running, effects, reload }: LoadedProps) {
	const [bench, setBench] = useState<ParticleBench | null>(null);
	/** The file, as read. What `edited` compares against and revert goes back to. */
	const [saved, setSaved] = useState<ParticleEffect>(effects[0]!);
	/** The effect as the panels have it, which is what the bench runs. */
	const [effect, setEffect] = useState<ParticleEffect>(effects[0]!);
	/** The comment block its file opens with, carried across a save. */
	const [header, setHeader] = useState('');

	const [show, setShow] = useState<ParticleShow>(DEFAULT_SHOW);
	const [height, setHeight] = useState(0.9);
	const [rate, setRate] = useState(1);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Stable, because ParticleViewport tears the bench down when this changes.
	const onBenchReady = useCallback((next: ParticleBench | null) => setBench(next), []);

	/*
	 * The header of whichever file is open. Read here rather than at save time
	 * so the document under the list is the whole file rather than the half of
	 * it this bench knows how to write.
	 */
	useEffect(() => {
		let live = true;
		void readHeader(saved.id).then((text) => {
			if (live) setHeader(text);
		});
		return () => {
			live = false;
		};
	}, [saved]);

	/*
	 * The panels' state, made true of whatever bench is currently up — the one
	 * that was already there, or the one a backend switch just built.
	 */
	useEffect(() => {
		if (!bench) return;
		bench.setEffect(effect);
		bench.height = height;
		bench.rate = rate;
		Object.assign(bench.show, show);
		if (!bench.running) bench.renderOnce();
	}, [bench, effect, height, rate, show]);

	const document = useMemo(() => effectDocument(effect, header), [effect, header]);
	const edited = useMemo(
		// Compared as documents rather than field by field, because that is the
		// question being asked: would a save change the file on disk.
		() => writeParticleEffect(effect) !== writeParticleEffect(saved),
		[effect, saved],
	);

	const chooseEffect = (next: ParticleEffect): void => {
		if (next.id === saved.id) return;
		setSaved(next);
		setEffect(next);
		setError(null);
	};

	const save = (): void => {
		setSaving(true);
		setError(null);
		saveEffect(effect, header)
			.then(() => {
				setSaved(effect);
				// The library forgot everything derived from the file it just
				// wrote, so the manifest is read again and every other view
				// showing this effect catches up.
				reload();
			})
			.catch((cause: unknown) => {
				setError(cause instanceof Error ? cause.message : String(cause));
			})
			.finally(() => setSaving(false));
	};

	return (
		<>
			<ParticleCatalogue
				effects={effects}
				effect={effect}
				onEffectChange={chooseEffect}
				document={document}
				edited={edited}
				writable={library.writable}
				saving={saving}
				error={error}
				onSave={save}
				onRevert={() => {
					setEffect(saved);
					setError(null);
				}}
				onReplay={() => bench?.restart()}
				onFrame={() => bench?.frameSubject()}
			/>
			<Box sx={{ flex: 1, display: 'flex', minWidth: 0 }}>
				<ParticleViewport
					backend={backend}
					running={running}
					effect={effect}
					onBenchReady={onBenchReady}
				/>
			</Box>
			<ParticleInspector
				bench={bench}
				effect={effect}
				onEffectChange={setEffect}
				show={show}
				onShowChange={(key, value) => setShow((current) => ({ ...current, [key]: value }))}
				height={height}
				onHeightChange={setHeight}
				rate={rate}
				onRateChange={setRate}
			/>
		</>
	);
}

/**
 * The particle bench, and the wait for the manifest.
 *
 * One thing has to arrive before there is anything to show, and unlike the
 * other benches it is not an entity: an effect is its own file, listed in the
 * manifest's own `particles` section, and a tree that has authored none has
 * nothing for this view to open.
 */
export function ParticleBenchView({ backend, running }: ParticleBenchViewProps) {
	const { effects, loading, error, reload } = useAssets();

	if (error) return <Notice text={error} error />;
	if (loading) return <Notice text="Reading the manifest…" spinner />;
	if (effects.length === 0) {
		return <Notice text="The manifest lists no particle effects." />;
	}

	return (
		<ParticleBenchOnEffects
			key={effects.map((one) => one.id).join(',')}
			backend={backend}
			running={running}
			effects={effects}
			reload={reload}
		/>
	);
}

function Notice({ text, spinner, error }: { text: string; spinner?: boolean; error?: boolean }) {
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
