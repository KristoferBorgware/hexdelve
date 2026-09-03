/*
 * test/harness/render-harness.mjs — draw the yard in a browser and get the
 * pixels back.
 *
 * Shared by the two tests that need a picture: render.test.ts, which compares
 * one against a reference kept in the repository, and backends.test.ts, which
 * compares WebGL2's against WebGPU's.
 *
 * Three things here exist to make the same scene come out the same way twice,
 * which is the whole basis of comparing anything:
 *
 *   the world is seeded, so the scenery is the scenery
 *   the frames are stepped by hand at a fixed size, because the smoke, the
 *     breathing and the flap all move with elapsed time and two clients left
 *     to run free would never be at the same instant
 *   multisampling is off, since resolving it is where two rasterisers most
 *     visibly disagree, and an edge that is one pixel softer is not the kind
 *     of difference either check is looking for
 *
 * The page is the harness's own rather than the published demo, so a test's
 * needs never leak into what ships.
 */

import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const WIDTH = 640;
export const HEIGHT = 420;

/** Enough frames for the world to settle out of its first one. */
const STEPS = 30;
const STEP = 1 / 60;

const LIB = resolve(
	import.meta.dirname,
	'..',
	'..',
	'packages',
	'client',
	'dist-lib',
	'hexdelve-client.es.js',
);

const PAGE = `<!DOCTYPE html><meta charset="utf-8"><title>render harness</title>
<style>html,body{margin:0;background:#000}canvas{display:block}</style>
<canvas id="c" width="${WIDTH}" height="${HEIGHT}"></canvas>
<script type="module">
import { createClient } from '/lib.js';

window.run = async (backend) => {
	const client = await createClient({
		canvas: document.querySelector('#c'),
		backend, seed: 37, msaa: false,
		autoStart: false, autoResize: false, controls: false,
		toggles: { follow: false, vectors: false, paths: false, skeleton: false, ik: true },
	});

	// A camera nobody can nudge, so the only thing left to differ is the drawing.
	client.camera.zoom = 0.42;
	client.camera.yaw = 1.0821;
	client.camera.target[0] = 0;
	client.camera.target[1] = 0.6;
	client.camera.target[2] = 0;

	for (let i = 0; i < ${STEPS} - 1; i++) client.step(${STEP});

	// Asked for before the step that fulfils it: the capture is serviced by a
	// render, and there is no render unless one is asked for.
	const shot = client.captureFrame();
	client.step(${STEP});
	const frame = await shot;

	let binary = '';
	const chunk = 0x8000;
	for (let i = 0; i < frame.pixels.length; i += chunk) {
		binary += String.fromCharCode.apply(null, frame.pixels.subarray(i, i + chunk));
	}
	return { width: frame.width, height: frame.height, b64: btoa(binary), backend: client.info.backend };
};
</script>`;

/** Whether there is anything here to draw with. Tests skip rather than fail. */
export async function harnessAvailable() {
	if (!existsSync(LIB)) return 'no client library at packages/client/dist-lib — run `npm run build`';
	try {
		await import('playwright');
	} catch {
		return 'playwright is not installed';
	}
	return null;
}

/**
 * One frame, or the reason there is not one.
 *
 * @typedef {{ ok: true, width: number, height: number, pixels: Buffer }} Frame
 * @typedef {{ ok: false, why: string }} NoFrame
 * @typedef {Frame | NoFrame} Shot
 */

/**
 * Run `body` with a `capture(backend)` function, then tear everything down.
 *
 * Returns null from the body's point of view if there is no browser to be had,
 * which callers treat as a reason to skip rather than to fail: not everyone
 * running a build has a browser driver, and refusing to build for want of one
 * would be worse than skipping a check nobody asked for.
 */
/**
 * @template T
 * @param {(capture: (backend: 'webgl2' | 'webgpu') => Promise<Shot>) => Promise<T>} body
 * @returns {Promise<T | null>}
 */
export async function withHarness(body) {
	let chromium;
	try {
		({ chromium } = await import('playwright'));
	} catch {
		return null;
	}

	const server = createServer((request, response) => {
		if (request.url === '/lib.js') {
			response.writeHead(200, { 'content-type': 'text/javascript' });
			response.end(readFileSync(LIB));
			return;
		}
		response.writeHead(200, { 'content-type': 'text/html' });
		response.end(PAGE);
	});
	await new Promise((done) => server.listen(0, done));
	const base = `http://localhost:${server.address().port}`;

	const launchOptions = {
		args: [
			'--enable-unsafe-webgpu',
			'--use-angle=swiftshader',
			'--use-vulkan=swiftshader',
			'--ignore-gpu-blocklist',
		],
	};
	if (process.env['CHROME_PATH']) launchOptions.executablePath = process.env['CHROME_PATH'];
	else launchOptions.channel = 'chrome';

	let browser;
	try {
		browser = await chromium.launch(launchOptions);
	} catch {
		try {
			delete launchOptions.channel;
			browser = await chromium.launch(launchOptions);
		} catch (cause) {
			console.log(`could not launch a browser (${String(cause).split('\n')[0]}) — skipping.`);
			server.close();
			return null;
		}
	}

	async function capture(backend) {
		// A fixed device scale, so the picture does not depend on the screen
		// the browser thinks it is on.
		const page = await browser.newPage({
			viewport: { width: WIDTH, height: HEIGHT },
			deviceScaleFactor: 1,
		});
		try {
			await page.goto(base, { waitUntil: 'load' });
			const result = await Promise.race([
				page.evaluate((b) => window.run(b), backend),
				new Promise((r) => setTimeout(() => r({ failed: 'timed out' }), 30000)),
			]);
			if (result.failed) return { ok: false, why: result.failed };
			return {
				ok: true,
				width: result.width,
				height: result.height,
				pixels: Buffer.from(result.b64, 'base64'),
			};
		} catch (cause) {
			return { ok: false, why: String(cause).split('\n')[0] };
		} finally {
			await page.close();
		}
	}

	try {
		return await body(capture);
	} finally {
		await browser.close();
		server.close();
	}
}
