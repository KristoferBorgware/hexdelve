/*
 * Entry point for the standalone client page — the build Electron wraps and
 * the one published beside the labs. It does nothing the library does not
 * already do; it finds the canvas, starts the client, and renders a readout of
 * the turn clock.
 *
 * Like the labs, it reads its initial state from the query string:
 *
 *     ?backend=webgl2   force the fallback backend
 *     ?backend=webgpu   fail rather than fall back
 *     ?ik=0 &routes=0 &skel=1 &follow=0
 *     ?gear=1           start him carrying all three, to see the guard and the
 *                       cut without walking the yard first
 *     ?speed=120        his place in the energy table (110 is normal). 120 is
 *                       +10: he then has to cross a hexagon in half the time,
 *                       so `strideFor` puts him into a run and one row of the
 *                       table is visible as a gait
 *     ?batspeed=110     level the fight, so the bat gets one move to your one
 */

import { createClient, type BackendPreference, type HexdelveClient } from './index.js';

const query = new URLSearchParams(location.search);

function requestedBackend(): BackendPreference {
	const value = query.get('backend');
	return value === 'webgpu' || value === 'webgl2' ? value : 'auto';
}

function flag(name: string, fallback: boolean): boolean {
	return query.has(name) ? query.get(name) !== '0' : fallback;
}

function speed(name: string): number | undefined {
	const value = Number(query.get(name));
	return Number.isFinite(value) && value > 0 ? value : undefined;
}

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
const badge = document.querySelector<HTMLElement>('#backend');
const readout = document.querySelector<HTMLElement>('#stats');

if (!canvas) throw new Error('The page is missing its #scene canvas.');

try {
	const playerSpeed = speed('speed');
	const batSpeed = speed('batspeed');
	const client = await createClient({
		canvas,
		backend: requestedBackend(),
		toggles: {
			ik: flag('ik', true),
			routes: flag('routes', true),
			skeleton: flag('skel', false),
			follow: flag('follow', true),
		},
		...(playerSpeed !== undefined ? { playerSpeed } : {}),
		...(batSpeed !== undefined ? { batSpeed } : {}),
	});

	if (query.get('gear') === '1') for (const item of client.simulation.items) item.equip();

	const info = client.info;

	// The test harness and a curious human want the same fact, so put it
	// somewhere both can read it.
	document.body.dataset['backend'] = info.backend;

	// The same handle lab 09 hung on `window.lab`: everything the page is
	// doing, reachable from a console or a test.
	(window as unknown as { hexdelve: HexdelveClient }).hexdelve = client;

	if (badge) {
		badge.textContent = info.backend === 'webgpu' ? 'WebGPU' : 'WebGL2';
		badge.title = `${info.device} · ${info.msaaSamples}x MSAA${
			info.fellBack ? ' · WebGPU unavailable, fell back' : ''
		}`;
	}

	if (readout) {
		// Twice a dozen frames rather than every frame: the numbers are for
		// reading, and one that changes sixty times a second cannot be read.
		setInterval(() => {
			const s = client.state;
			const rating = (value: number): string =>
				`${value} (${value >= 110 ? '+' : ''}${value - 110})`;

			const rows: [string, string][] = [
				['You', s.message],
				['Clock', s.waitingForYou ? 'waiting for you' : 'running'],
				['Turn', `${s.gameTurn} game · ${s.actions} action${s.actions === 1 ? '' : 's'}`],
				['Last', s.lastAction],
				['Cell', `${s.cell.q}, ${s.cell.r} · terrace ${s.terrace ?? '–'}`],
				['Route', s.stepsLeft ? `${s.stepsLeft} hex to go` : '—'],
				['Your speed', `${rating(s.speedRating)} · ${s.energy | 0} energy`],
				[
					'Gait',
					s.amp > 0.05
						? `${s.gait > 0.5 ? 'run' : 'walk'} · ${s.speed.toFixed(2)} m/s`
						: 'standing',
				],
				['Carrying', s.carrying.length ? s.carrying.join(', ') : 'nothing'],
				['Bat', `${s.batMessage} · ${s.batState}`],
				[
					'Its speed',
					`${rating(s.batSpeedRating)} · ×${s.batSpeedFactor.toFixed(1)} · ${s.batEnergy | 0} energy`,
				],
				['Range', `${s.batRange} tiles · wakes at ${s.wakeRange}, loses you at ${s.loseRange}`],
				['Bites / missed', `${s.bites} · ${s.batMissed}`],
			];
			if (s.cuts) rows.push(['Cuts / hits', `${s.cuts} · ${s.hits}`]);
			rows.push([
				'Reach',
				`${s.reach.toFixed(2)} m + ${(s.lean * 100).toFixed(0)} cm of lean`,
			]);
			if (s.slip > 0.005) rows.push(['Foot slip', `${(s.slip * 100).toFixed(0)} cm/s`]);
			if (client.toggles.ik) rows.push(['Pelvis drop', `${(s.pelvisDrop * 100).toFixed(1)} cm`]);
			rows.push(['Draw', `${client.stats.instances} prisms · ${Math.round(client.stats.fps)} fps`]);

			readout.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
		}, 120);
	}
} catch (error) {
	document.body.dataset['backend'] = 'failed';
	if (badge) badge.textContent = 'no GPU';
	console.error('[hexdelve] the client could not start', error);
}
