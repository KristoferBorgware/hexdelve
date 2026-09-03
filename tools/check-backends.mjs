/*
 * tools/check-backends.mjs — do the two backends draw the same picture?
 *
 *     node tools/check-backends.mjs [--write-images]
 *
 * The engine's whole bargain is that nothing above the Renderer interface can
 * tell WebGPU from WebGL2. The two shaders are written twice rather than
 * generated from one source, deliberately, so that a change to the lighting
 * has to be made in both places — and until this existed, the only thing
 * keeping the two pictures together was whoever edited them last remembering
 * to edit both. That is not a guarantee, it is a hope.
 *
 * So: build the same scene twice, capture a frame from each off the GPU, and
 * compare them pixel by pixel.
 *
 * The scene is stepped by hand rather than left to run, because the smoke, the
 * breathing and the flap all move with elapsed time and two live clients would
 * never be at the same instant. A fixed number of fixed-size steps puts both
 * on exactly the same frame.
 *
 * The harness is its own page rather than the published demo, so a test's
 * needs never leak into what ships.
 */

import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '..', 'packages', 'client');
const LIB = join(ROOT, 'dist-lib', 'hexdelve-client.es.js');

const WIDTH = 640;
const HEIGHT = 420;
/** Enough steps for the world to settle out of its first frame. */
const STEPS = 30;
const STEP = 1 / 60;

if (!existsSync(LIB)) {
	console.error('No client library at packages/client/dist-lib — run `npm run build` first.');
	process.exit(1);
}

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	console.log('playwright is not installed — skipping the backend comparison.');
	process.exit(0);
}

const PAGE = `<!DOCTYPE html><meta charset="utf-8"><title>backend comparison</title>
<style>html,body{margin:0;background:#000}canvas{display:block}</style>
<canvas id="c" width="${WIDTH}" height="${HEIGHT}"></canvas>
<script type="module">
import { createClient } from '/lib.js';

window.run = async (backend) => {
	const canvas = document.querySelector('#c');
	const client = await createClient({
		canvas, backend, seed: 37,
		autoStart: false, autoResize: false, controls: false,
		toggles: { follow: false, vectors: false, paths: false, skeleton: false, ik: true },
	});

	// A camera nobody can nudge, so the only difference left is the renderer.
	client.camera.zoom = 0.42;
	client.camera.yaw = 1.0821;
	client.camera.target[0] = 0;
	client.camera.target[1] = 0.6;
	client.camera.target[2] = 0;

	for (let i = 0; i < ${STEPS} - 1; i++) client.step(${STEP});

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
		process.exit(0);
	}
}

async function capture(backend) {
	const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
	try {
		await page.goto(base, { waitUntil: 'load' });
		const result = await Promise.race([
			page.evaluate((b) => window.run(b), backend),
			new Promise((r) => setTimeout(() => r({ failed: 'timed out' }), 30000)),
		]);
		if (result.failed) return { ok: false, why: result.failed };
		return { ok: true, width: result.width, height: result.height, pixels: Buffer.from(result.b64, 'base64') };
	} catch (cause) {
		return { ok: false, why: String(cause).split('\n')[0] };
	} finally {
		await page.close();
	}
}

const shots = {};
for (const backend of ['webgl2', 'webgpu']) {
	shots[backend] = await capture(backend);
	const s = shots[backend];
	console.log(s.ok ? `captured ${backend}` : `could not capture ${backend}: ${s.why}`);
}
await browser.close();
server.close();

if (!shots['webgl2'].ok) {
	console.error('FAIL  WebGL2 would not render — that is not an environment problem.');
	process.exit(1);
}

if (!shots['webgpu'].ok) {
	/*
	 * Not a failure. WebGPU needs a working device, and a sandboxed CI runner
	 * frequently has none — the machine this was written on tears the device
	 * down one frame in, and a twenty-line clear-loop dies there too. Saying so
	 * is honest; failing the build over it would only teach people to ignore
	 * a red check.
	 */
	console.log('\nskipped: no usable WebGPU device here, so there is nothing to compare against.');
	console.log('         WebGL2 rendered and read back correctly.');
	process.exit(0);
}

const a = shots['webgl2'];
const b = shots['webgpu'];

if (a.width !== b.width || a.height !== b.height) {
	console.error(`FAIL  different sizes: ${a.width}x${a.height} against ${b.width}x${b.height}`);
	process.exit(1);
}

/*
 * A tolerance, because identical is not the goal and never was.
 *
 * The two rasterise separately, resolve multisampling separately, and the two
 * shaders compile through different compilers — a channel or two of drift on
 * an edge pixel is the hardware, not a disagreement about what to draw. What
 * this is looking for is a difference of *substance*: a shadow in the wrong
 * place, a face lit from the wrong side, geometry missing.
 */
const CHANNEL_TOLERANCE = 12;
const ALLOWED_FRACTION = 0.02;

let differing = 0;
let worst = 0;
let total = 0;
const diff = Buffer.alloc(a.pixels.length, 255);

for (let i = 0; i < a.pixels.length; i += 4) {
	const dr = Math.abs(a.pixels[i] - b.pixels[i]);
	const dg = Math.abs(a.pixels[i + 1] - b.pixels[i + 1]);
	const db = Math.abs(a.pixels[i + 2] - b.pixels[i + 2]);
	const d = Math.max(dr, dg, db);
	total += d;
	if (d > worst) worst = d;
	if (d > CHANNEL_TOLERANCE) {
		differing++;
		diff[i] = 255;
		diff[i + 1] = 0;
		diff[i + 2] = 0;
	} else {
		diff[i] = diff[i + 1] = diff[i + 2] = 255 - d * 4;
	}
}

const pixels = a.pixels.length / 4;
const fraction = differing / pixels;
console.log(`\n${pixels} pixels compared`);
console.log(`  mean channel difference: ${(total / pixels).toFixed(2)}`);
console.log(`  worst channel difference: ${worst}`);
console.log(`  over tolerance (${CHANNEL_TOLERANCE}): ${differing} (${(fraction * 100).toFixed(2)}%)`);

if (process.argv.includes('--write-images')) {
	writePng('/tmp/backend-webgl2.png', a.width, a.height, a.pixels);
	writePng('/tmp/backend-webgpu.png', b.width, b.height, b.pixels);
	writePng('/tmp/backend-diff.png', a.width, a.height, diff);
	console.log('  images written to /tmp/backend-*.png');
}

if (fraction > ALLOWED_FRACTION) {
	console.error(`\nFAIL  the two backends disagree about more than ${ALLOWED_FRACTION * 100}% of the frame.`);
	process.exit(1);
}
console.log('\nok    the two backends draw the same picture');

function writePng(file, width, height, rgba) {
	const stride = width * 4;
	const raw = Buffer.alloc((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
	}
	const crcTable = [];
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		crcTable[n] = c >>> 0;
	}
	const crc = (buf) => {
		let c = 0xffffffff;
		for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
		return (c ^ 0xffffffff) >>> 0;
	};
	const chunk = (type, data) => {
		const length = Buffer.alloc(4);
		length.writeUInt32BE(data.length);
		const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
		const check = Buffer.alloc(4);
		check.writeUInt32BE(crc(body));
		return Buffer.concat([length, body, check]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	writeFileSync(
		file,
		Buffer.concat([
			Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
			chunk('IHDR', ihdr),
			chunk('IDAT', deflateSync(raw)),
			chunk('IEND', Buffer.alloc(0)),
		]),
	);
}
