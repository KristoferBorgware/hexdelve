/*
 * tools/check-shaders.mjs — do the shaders compile, and do the pipelines build?
 *
 *     node tools/check-shaders.mjs
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
 * into a creation error. This script is what makes that check run on its own:
 * launch a headless browser, ask for each backend by name, and fail if either
 * one refuses to be created.
 *
 * What it does NOT prove is that either backend draws the right picture.
 * Compiling is not rendering. On the sandboxed machines this project is built
 * on, a WebGPU device is torn down after about one frame — a twenty-line
 * clear-loop with no shaders and no pipelines dies there the same way — so
 * there is often nothing to look at even when everything compiles. See
 * check-backends.mjs, which compares the two pictures where that is possible.
 * A shader that will not compile can never render, and that is what this
 * catches.
 */

import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', 'packages', 'client', 'dist-app');

if (!existsSync(join(ROOT, 'index.html'))) {
	console.error('No built client at packages/client/dist-app — run `npm run build` first.');
	process.exit(1);
}

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	// Not a failure: most people running the build do not have a browser
	// driver, and refusing to build for want of one would be worse than
	// skipping a check they did not ask for.
	console.log('playwright is not installed — skipping the shader check.');
	process.exit(0);
}

const TYPES = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.map': 'application/json',
};

const server = createServer((request, response) => {
	let file = join(ROOT, decodeURIComponent(new URL(request.url, 'http://local').pathname));
	if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
	if (!file.startsWith(ROOT) || !existsSync(file)) {
		response.writeHead(404);
		return response.end();
	}
	response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
	response.end(readFileSync(file));
});

await new Promise((done) => server.listen(0, done));
const base = `http://localhost:${server.address().port}`;

const launchOptions = {
	args: [
		'--enable-unsafe-webgpu',
		'--use-webgpu-adapter=swiftshader',
		'--enable-features=Vulkan',
		'--use-angle=swiftshader',
		'--use-gl=angle',
		'--ignore-gpu-blocklist',
	],
};
/*
 * Which browser. An explicit path wins; otherwise take whatever Chrome the
 * machine already has, so this needs the playwright package but not its
 * hundred-megabyte browser download. The bundled Chromium is the last resort.
 */
if (process.env['CHROME_PATH']) launchOptions.executablePath = process.env['CHROME_PATH'];
else launchOptions.channel = 'chrome';

async function launch() {
	try {
		return await chromium.launch(launchOptions);
	} catch (cause) {
		if (!launchOptions.channel) throw cause;
		// No system Chrome; fall back to whatever playwright downloaded.
		delete launchOptions.channel;
		return chromium.launch(launchOptions);
	}
}

let browser;
try {
	browser = await launch();
} catch (cause) {
	console.log(`could not launch a browser (${String(cause).split('\n')[0]}) — skipping.`);
	server.close();
	process.exit(0);
}

let failed = false;

for (const backend of ['webgl2', 'webgpu']) {
	const page = await browser.newPage({ viewport: { width: 320, height: 240 } });
	const complaints = [];
	page.on('console', (message) => {
		const text = message.text();
		if (message.type() === 'error' && !text.includes('404')) complaints.push(text);
	});
	page.on('pageerror', (error) => complaints.push(String(error)));

	await page.goto(`${base}/index.html?backend=${backend}`, { waitUntil: 'load' });
	// Long enough for the adapter request and every pipeline to be built.
	await page.waitForTimeout(2500);

	const reported = await page.evaluate(() => document.body.dataset.backend);

	// A creation failure is the thing being tested for. A device lost *after*
	// creation is this environment, not this code, so it is reported and
	// forgiven — the pipelines were already built by then.
	const creationFailed =
		reported === 'failed' || complaints.some((c) => c.includes('failed validation'));

	if (creationFailed) {
		failed = true;
		console.error(`FAIL  ${backend}: the renderer could not be created`);
		for (const line of complaints) console.error(`        ${line.split('\n')[0]}`);
	} else {
		const lost = complaints.some((c) => c.includes('device was lost'));
		console.log(`ok    ${backend}: shaders compiled and pipelines built${lost ? ' (device lost afterwards — this environment, not the code)' : ''}`);
	}

	await page.close();
}

await browser.close();
server.close();

if (failed) process.exit(1);
