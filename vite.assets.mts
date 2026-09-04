/*
 * The asset files, served to both apps, and writable by the editor.
 *
 * `public/assets/**` is one tree read by two Vite apps that live in different
 * directories, so neither can hold it: a copy in each would be the same YAML
 * twice, drifting, which is exactly what moving the assets out of TypeScript
 * was meant to stop. Vite's `publicDir` takes an absolute path, so both apps
 * point at the same one and it is copied into each build.
 *
 * The other half is writing, and it exists because the editor authors these
 * files. A browser cannot write to disk, so the dev server does it: a PUT to
 * the same URL a GET came from lands in `public/assets`, and the editor's
 * save button is that request and nothing more. Deliberately the same URL
 * rather than a second endpoint — a file has one address, and an editor that
 * read from one place and wrote to another would have two ways to be pointed
 * at the wrong tree.
 *
 * `apply: 'serve'` matters. This is a development tool and it must not exist
 * in a build: the published editor is read-only, says so, and has no endpoint
 * that could be otherwise.
 *
 * The guards below are not ceremony. A dev server is usually bound to
 * localhost but need not be — `--host` is one flag away, and the day somebody
 * demos the editor off a laptop on a conference network is not the day to
 * find out that a PUT can write anywhere the process can reach.
 */

import { access, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import type { Connect, Plugin } from 'vite';

const root = import.meta.dirname;

/** The one tree both apps serve, and the editor writes back to. */
export const publicDir = resolve(root, 'public');

/**
 * The client's scripts, which no application imports.
 *
 * They are compiled apart from both apps — by `tools/build-scripts.mjs` for a
 * shipped client, in the browser for the editor's hot reload — and they answer
 * on two routes here, one for each of those readers.
 *
 *   GET /scripts/          the file names, and then each file's SOURCE, which
 *                          is what the editor compiles and watches
 *   GET /scripts.js        the whole directory COMPILED, which is what the
 *                          client fetches and runs
 *
 * Serving them from where they live rather than copying them into `public/` is
 * the point: a copy would be the same script twice, and the one the editor was
 * hot-reloading would not be the one the client ran.
 */
const scriptRoot = resolve(root, 'packages', 'client', 'scripts');
const SCRIPTS = 'scripts';

/** The compiled bundle's address, and the name it is emitted under in a build. */
const SCRIPT_BUNDLE = 'scripts.js';

/** Where the asset files live inside it, and the URL prefix they answer on. */
const ASSETS = 'assets';
const assetRoot = join(publicDir, ASSETS);

/**
 * Vite emits its own chunks into `outDir/assetsDir`, which defaults to
 * `assets` — the same name the game's asset tree wants. Both apps move the
 * bundle aside rather than the data, because `/assets/rigs/humanoid.rig.yaml`
 * is an address that appears in the asset files themselves and in the docs,
 * where `/bundle/index-a1b2c3.js` is an address nobody ever types.
 */
export const bundleDir = 'bundle';

/** Only these get written. A dev endpoint that can write a .js is a shell. */
const WRITABLE = /\.ya?ml$/;

/** Room for a large hand-authored mesh, and not for anything else. */
const MAX_BYTES = 1 << 20;

export function assetIO(): Plugin {
	return {
		name: 'hexdelve:asset-io',
		apply: 'serve',
		configureServer(server) {
			server.middlewares.use(`/${ASSETS}`, handle);
			server.middlewares.use(`/${SCRIPTS}`, scripts);
		},
	};
}

/**
 * The compiled scripts, served in development and emitted into a build.
 *
 * Unlike `assetIO` this is NOT development-only, and the difference is the
 * whole point of it. Nothing imports the scripts, so without this a built page
 * would have no behaviour on it at all: the build hook compiles the directory
 * once and emits `scripts.js` beside the page, and the client fetches it the
 * way it fetches an asset.
 *
 * In development it compiles on request instead. That keeps `npm run dev`
 * honest — the running page has whatever is on disk now, with no build step to
 * forget — and it means a broken script answers with its own error on its own
 * route rather than stopping the page that asked for it.
 */
export function scriptBundle(): Plugin {
	return {
		name: 'hexdelve:script-bundle',
		configureServer(server) {
			server.middlewares.use(`/${SCRIPT_BUNDLE}`, (request, response, next) => {
				const method = request.method ?? 'GET';
				if (method !== 'GET' && method !== 'HEAD') {
					next();
					return;
				}
				void compileScripts().then(
					(code) => {
						response.setHeader('content-type', 'text/javascript; charset=utf-8');
						// Compiled fresh on every request, so it must not be kept.
						response.setHeader('cache-control', 'no-store');
						response.end(code);
					},
					(error: unknown) => fail(response, 500, why(error)),
				);
			});
		},
		async generateBundle() {
			this.emitFile({ type: 'asset', fileName: SCRIPT_BUNDLE, source: await compileScripts() });
		},
	};
}

/** `tools/build-scripts.mjs`, which is ESM and has no types of its own. */
async function compileScripts(): Promise<string> {
	const tool = (await import('./tools/build-scripts.mjs')) as {
		bundleScripts: () => Promise<{ code: string }>;
	};
	const { code } = await tool.bundleScripts();
	return code;
}

const handle: Connect.NextHandleFunction = (request, response, next) => {
	const method = request.method ?? 'GET';

	/*
	 * A missing asset has to answer 404, and by default it does not.
	 *
	 * Vite treats both apps as single-page apps, so a path it cannot serve
	 * falls back to index.html — with a 200 on it. A mistyped rig path would
	 * therefore arrive at the YAML reader as a page of HTML, and the error
	 * would be about an unexpected `<` on line one rather than about a file
	 * that is not there. Answering here, before the fallback, is what makes
	 * the dev server behave like the static host the built app runs on.
	 */
	if (method === 'GET' || method === 'HEAD') {
		void missing(request.url ?? '').then((gone) => {
			if (gone) fail(response, 404, 'no such asset');
			else next();
		}, next);
		return;
	}

	if (method !== 'PUT' && method !== 'DELETE') {
		next();
		return;
	}

	void act(method, request, response).catch((error: unknown) => {
		fail(response, 500, error instanceof Error ? error.message : String(error));
	});
};

/**
 * The scripts, listed and read.
 *
 *   GET /scripts/          the file names, as JSON
 *   GET /scripts/Spin.ts   one file's source
 *
 * Read-only. Editing a script is editing the client's source, which is what a
 * text editor and a rebuild are for; what this exists to do is let the editor
 * SEE the current text so it can compile it, and watch for it changing.
 */
const scripts: Connect.NextHandleFunction = (request, response, next) => {
	const method = request.method ?? 'GET';
	if (method !== 'GET' && method !== 'HEAD') {
		next();
		return;
	}

	const path = (request.url ?? '/').split('?')[0] ?? '/';
	if (path === '/' || path === '') {
		void readdir(scriptRoot)
			.then((names) => {
				const list = names.filter((name) => name.endsWith('.ts'));
				response.setHeader('content-type', 'application/json; charset=utf-8');
				response.end(JSON.stringify(list.sort()));
			})
			.catch(() => fail(response, 500, 'cannot read the script directory'));
		return;
	}

	const target = inside(scriptRoot, path, /\.ts$/);
	if (!target) {
		fail(response, 400, 'that is not a script');
		return;
	}
	void readFile(target, 'utf8').then(
		(text) => {
			response.setHeader('content-type', 'text/plain; charset=utf-8');
			response.end(text);
		},
		() => fail(response, 404, 'no such script'),
	);
};

/** True when the URL names a place inside the tree that has nothing in it. */
async function missing(url: string): Promise<boolean> {
	const target = safePath(url, { anyExtension: true });
	if (!target) return false; // Not ours to answer for.
	try {
		await access(target);
		return false;
	} catch {
		return true;
	}
}

async function act(
	method: 'PUT' | 'DELETE',
	request: Connect.IncomingMessage,
	response: import('node:http').ServerResponse,
): Promise<void> {
	const target = safePath(request.url ?? '');
	if (!target) {
		fail(response, 400, 'that is not a path inside the asset tree');
		return;
	}

	if (method === 'DELETE') {
		await rm(target, { force: true });
		done(response);
		return;
	}

	const body = await read(request);
	if (body === null) {
		fail(response, 413, `an asset file may not exceed ${MAX_BYTES} bytes`);
		return;
	}

	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, body, 'utf8');
	done(response);
}

/**
 * The requested path, resolved inside the asset tree, or null.
 *
 * Resolved and then CHECKED rather than merely scanned for `..`: a check on
 * the text of a path is a check on one spelling of it, and `%2e%2e` is
 * another. Comparing the resolved absolute path against the root is a check
 * on where it actually leads.
 */
function safePath(url: string, options: { anyExtension?: boolean } = {}): string | null {
	return inside(assetRoot, url, options.anyExtension ? /.*/ : WRITABLE);
}

/**
 * A URL resolved inside a directory, or null.
 *
 * Resolved and then CHECKED against the root, rather than scanned for `..`: a
 * check on the text of a path is a check on one spelling of it, and `%2e%2e` is
 * another. Where it actually leads is the only thing worth asking.
 */
function inside(root: string, url: string, allowed: RegExp): string | null {
	let path: string;
	try {
		path = decodeURIComponent(url.split('?')[0] ?? '').replace(/^\/+/, '');
	} catch {
		return null; // A malformed escape is not a path.
	}
	if (path === '' || path.endsWith('/') || !allowed.test(path)) return null;

	const target = resolve(root, path);
	if (target !== root && !target.startsWith(root + sep)) return null;
	return target;
}

function read(request: Connect.IncomingMessage): Promise<string | null> {
	return new Promise((settle, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		request.on('data', (chunk: Buffer) => {
			size += chunk.length;
			if (size > MAX_BYTES) {
				settle(null);
				request.destroy();
				return;
			}
			chunks.push(chunk);
		});
		request.on('end', () => settle(Buffer.concat(chunks).toString('utf8')));
		request.on('error', reject);
	});
}

function done(response: import('node:http').ServerResponse): void {
	response.statusCode = 204;
	response.end();
}

function fail(response: import('node:http').ServerResponse, code: number, reason: string): void {
	response.statusCode = code;
	response.setHeader('content-type', 'text/plain; charset=utf-8');
	response.end(reason);
}

function why(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
