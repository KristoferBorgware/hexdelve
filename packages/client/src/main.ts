/*
 * Entry point for the standalone client page — the build Electron wraps and
 * the one published beside the labs. It does nothing the library does not
 * already do; it finds the canvas, starts the client and reports which backend
 * it got.
 *
 * Like the labs, it reads its initial state from the query string:
 *
 *     index.html?backend=webgl2     force the fallback backend
 *     index.html?backend=webgpu     fail rather than fall back
 *
 * which is what makes it possible to check that the two backends really do
 * draw the same picture.
 */

import { createClient, type BackendPreference } from './index.js';

function requestedBackend(): BackendPreference {
	const value = new URLSearchParams(location.search).get('backend');
	return value === 'webgpu' || value === 'webgl2' ? value : 'auto';
}

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
const badge = document.querySelector<HTMLElement>('#backend');

if (!canvas) throw new Error('The page is missing its #scene canvas.');

try {
	const client = await createClient({ canvas, backend: requestedBackend() });
	const info = client.info;

	// The test harness and a curious human want the same fact, so put it
	// somewhere both can read it.
	document.body.dataset['backend'] = info.backend;

	if (badge) {
		badge.textContent = info.backend === 'webgpu' ? 'WebGPU' : 'WebGL2';
		badge.title = `${info.device} · ${info.msaaSamples}x MSAA${
			info.fellBack ? ' · WebGPU unavailable, fell back' : ''
		}`;
	}
} catch (error) {
	document.body.dataset['backend'] = 'failed';
	if (badge) badge.textContent = 'no GPU';
	console.error('[hexdelve] the client could not start', error);
}
