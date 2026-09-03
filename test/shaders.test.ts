/*
 * Do the shaders compile, and do the pipelines build?
 *
 * This exists because of a bug that shipped twice. WebGPU does not throw when
 * a pipeline fails validation and does not return null: it hands back an
 * object marked invalid and only complains when something tries to draw with
 * it. So a mistake in one line of WGSL turns into a wall of "invalid due to a
 * previous error" once a frame, with the actual cause — a shader compile
 * message — nowhere in the console. Reading the console and seeing no error
 * proves nothing at all, which is exactly the mistake made here.
 *
 * The renderer now builds inside an error scope and turns a validation failure
 * into a creation error. This is what makes that check run on its own: launch
 * a headless browser, ask for each backend by name, and fail if either one
 * refuses to be created.
 *
 * What it does NOT prove is that either backend draws the right picture.
 * Compiling is not rendering. On the sandboxed machines this project is built
 * on, a WebGPU device is torn down after about one frame — a twenty-line
 * clear-loop with no shaders and no pipelines dies there the same way — so
 * there is often nothing to look at even when everything compiles. A device
 * lost AFTER creation is therefore forgiven: the pipelines were already built
 * by then. See backends.test.ts, which compares the two pictures where that
 * is possible.
 */

import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..', 'packages', 'client', 'dist-app');

const TYPES: Record<string, string> = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.json': 'application/json',
	'.map': 'application/json',
	'.wasm': 'application/wasm',
};

/**
 * Why this cannot run here, or null if it can.
 *
 * Not a failure: most people running the build do not have a browser driver,
 * and a missing app build means `npm run build` has not been run yet. Neither
 * is a broken shader.
 */
async function unavailable(): Promise<string | null> {
	if (!existsSync(join(ROOT, 'index.html'))) {
		return 'no built client at packages/client/dist-app — run `npm run build`';
	}
	try {
		await import('playwright');
	} catch {
		return 'playwright is not installed';
	}
	return null;
}

const reason = await unavailable();

describe.skipIf(reason !== null)('shaders', () => {
	let server: Server;
	let browser: Awaited<ReturnType<typeof launch>> | null = null;
	let base = '';

	async function launch() {
		const { chromium } = await import('playwright');
		const args = [
			'--enable-unsafe-webgpu',
			'--use-angle=swiftshader',
			'--use-vulkan=swiftshader',
			'--ignore-gpu-blocklist',
		];
		const executablePath = process.env['CHROME_PATH'];
		try {
			return await chromium.launch(
				executablePath ? { args, executablePath } : { args, channel: 'chrome' },
			);
		} catch {
			return await chromium.launch({ args });
		}
	}

	beforeAll(async () => {
		server = createServer((request, response) => {
			const url = (request.url ?? '/').split('?')[0]!;
			const file = join(ROOT, url === '/' ? 'index.html' : url);
			if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
				response.writeHead(404);
				response.end();
				return;
			}
			response.writeHead(200, {
				'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
			});
			response.end(readFileSync(file));
		});
		await new Promise<void>((done) => server.listen(0, done));
		const address = server.address();
		base = `http://localhost:${typeof address === 'object' && address ? address.port : 0}`;
		browser = await launch();
	});

	afterAll(async () => {
		await browser?.close();
		server?.close();
	});

	for (const backend of ['webgl2', 'webgpu'] as const) {
		it(`${backend}: compiles its shaders and builds its pipelines`, async () => {
			const page = await browser!.newPage();
			const complaints: string[] = [];
			page.on('console', (message) => {
				if (message.type() === 'error') complaints.push(message.text());
			});
			page.on('pageerror', (error) => complaints.push(String(error)));

			await page.goto(`${base}/index.html?backend=${backend}`, { waitUntil: 'load' });
			// Long enough for the adapter request and every pipeline to be built.
			await page.waitForTimeout(2500);

			// Read through Playwright rather than an in-page `document`, so this
			// file never needs the DOM lib to typecheck.
			const reported = await page.getAttribute('body', 'data-backend');
			const creationFailed =
				reported === 'failed' || complaints.some((c) => c.includes('failed validation'));

			await page.close();

			expect(
				creationFailed,
				`the renderer could not be created:\n${complaints.map((c) => c.split('\n')[0]).join('\n')}`,
			).toBe(false);
		});
	}
});

if (reason) console.log(`shaders: skipped — ${reason}`);
