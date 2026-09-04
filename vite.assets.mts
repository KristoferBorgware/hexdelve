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
 * The client's scripts, served as TEXT so the editor can compile them.
 *
 * They are ordinary TypeScript inside the client's source, compiled into both
 * of its builds like anything else. What this route adds is the other way of
 * reading them: the editor fetches the source and compiles it in the browser,
 * which is what makes a saved file reach a running game without a rebuild.
 *
 * Serving them from where they already live rather than copying them into
 * `public/` is the whole point — a copy would be the same script twice, and the
 * one the editor was hot-reloading would not be the one the client shipped.
 */
const scriptRoot = resolve(root, 'packages', 'client', 'src', 'scripts');
const SCRIPTS = 'scripts';

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
				const list = names.filter((name) => name.endsWith('.ts') && name !== 'index.ts');
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

function fail(response: import('node:http').ServerResponse, code: number, why: string): void {
	response.statusCode = code;
	response.setHeader('content-type', 'text/plain; charset=utf-8');
	response.end(why);
}
