/*
 * Entry point for the standalone client page — the build Electron wraps and
 * the one published beside the labs. It does nothing the library does not
 * already do; it finds the canvas, starts the client, and renders the readout
 * lab 09 carried in its panel.
 *
 * Like the labs, it reads its initial state from the query string:
 *
 *     ?backend=webgl2   force the fallback backend
 *     ?backend=webgpu   fail rather than fall back
 *     ?ik=0 &vec=0 &paths=0 &strafe=0 &skel=1 &follow=0
 *     ?gear=1           start him carrying all three, to see the guard and the
 *                       cut without walking the yard first
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

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
const badge = document.querySelector<HTMLElement>('#backend');
const readout = document.querySelector<HTMLElement>('#stats');

if (!canvas) throw new Error('The page is missing its #scene canvas.');

const BEARINGS: { to: number; name: string }[] = [
	{ to: 0.4, name: 'forward' },
	{ to: 1.2, name: 'half left' },
	{ to: 2.0, name: 'left' },
	{ to: 2.75, name: 'back left' },
	{ to: Math.PI + 0.01, name: 'backwards' },
];

function bearingName(angle: number): string {
	const a = Math.abs(angle);
	for (const band of BEARINGS) {
		if (a <= band.to) return angle < 0 ? band.name.replace('left', 'right') : band.name;
	}
	return 'backwards';
}

try {
	const client = await createClient({
		canvas,
		backend: requestedBackend(),
		toggles: {
			ik: flag('ik', true),
			vectors: flag('vec', true),
			paths: flag('paths', true),
			screenStrafe: flag('strafe', true),
			skeleton: flag('skel', false),
			follow: flag('follow', true),
		},
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
			const off = s.amp > 0.05 ? s.heading : 0;
			const rows: [string, string][] = [
				['You', s.message],
				['Speed', `${s.speed.toFixed(2)} m/s · ${s.gait > 0.5 ? 'run' : 'walk'}`],
				[
					'Going',
					s.amp > 0.05
						? `${bearingName(off)} · ${Math.round(Math.abs((off * 180) / Math.PI))}° off his face`
						: '—',
				],
				['Foot slip', `${Math.abs(s.slip * 100).toFixed(0)} cm/s`],
				['Cell', `${s.cell.q}, ${s.cell.r} · terrace ${s.terrace ?? '–'}`],
				['Carrying', s.carrying.length ? s.carrying.join(', ') : 'nothing'],
				['Bat', `${s.batMessage} · ${s.batSpeed.toFixed(2)} m/s`],
				['Range', `${s.batRange} tiles · wakes at ${s.wakeRange}`],
				['Bites / missed', `${s.bites} · ${s.batMissed}`],
			];
			if (s.cuts) rows.push(['Cuts / hits', `${s.cuts} · ${s.hits}`]);
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
