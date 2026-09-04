/*
 * The dev server's own routes, against a dev server that is actually running.
 *
 * These exist because of a bug that cost a working `npm run dev` and that no
 * unit test could have caught. `/scripts.js` — the compiled bundle, and the one
 * request the client makes for its behaviour — was answered with
 * `400 that is not a script`, because Connect mounts middleware on a prefix and
 * treats a `.` as a boundary as well as a `/`: the route mounted at `/scripts`
 * was handed `/scripts.js` too, and refused it.
 *
 * Nothing about the handlers in isolation was wrong. What was wrong was how two
 * of them sat next to each other inside Vite's middleware stack, so the test has
 * to be a real server with the real plugins in the real order. A harness that
 * called the handlers directly would have passed while the dev server was
 * broken, which is the failure it is meant to prevent.
 *
 * It boots on port 0 and asks the operating system for a free one, so several
 * of these can run at once and none of them fights the port a developer is
 * already using.
 */

import { access, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';

import { assetIO, publicDir, scriptBundle, scriptTypes } from '../vite.assets.mts';

const root = resolve(import.meta.dirname, '..');

/**
 * A file the write tests create and remove.
 *
 * In the real tree rather than a scratch directory, because the plugin resolves
 * its own asset root and cannot be pointed elsewhere — which is itself worth
 * knowing. It is named so that a leak is obvious, and removed in `afterAll`
 * whether or not the tests got that far.
 */
const SCRATCH = 'scratch-devserver-test.yaml';

/**
 * The same, for the script directory, which the editor's code editor writes to.
 *
 * A `.ts` in `packages/client/scripts` is compiled by the build tool and by the
 * editor, so one left behind would turn up in a bundle. Named to be obvious and
 * removed in `afterAll` whether or not the tests got that far.
 */
const SCRATCH_SCRIPT = 'ScratchDevserverTest.ts';
const scriptRoot = resolve(root, 'packages', 'client', 'scripts');

describe('the dev server', () => {
	let server: ViteDevServer;
	let origin: string;

	beforeAll(async () => {
		server = await createServer({
			configFile: false,
			root,
			publicDir,
			logLevel: 'error',
			// The plugins in the order both apps list them. The order is the
			// thing under test as much as the handlers are.
			plugins: [assetIO(), scriptBundle(), scriptTypes()],
			server: { port: 0, strictPort: false, host: '127.0.0.1' },
		});
		await server.listen();
		const address = server.httpServer?.address();
		if (!address || typeof address === 'string') throw new Error('the server did not listen');
		origin = `http://127.0.0.1:${address.port}`;
	}, 120_000);

	afterAll(async () => {
		await rm(resolve(publicDir, 'assets', SCRATCH), { force: true });
		await rm(resolve(scriptRoot, SCRATCH_SCRIPT), { force: true });
		await server?.close();
	});

	const get = (path: string) => fetch(`${origin}${path}`);

	describe('the scripts', () => {
		/*
		 * The regression. A 400 here is the exact failure that shipped: the
		 * source route answering for a path that is not a source.
		 */
		it('serves the compiled bundle at /scripts.js', async () => {
			const response = await get('/scripts.js');
			expect(response.status, await response.clone().text()).toBe(200);

			const code = await response.text();
			expect(code.length).toBeGreaterThan(1000);
			// It is the real bundle, with the real classes in it.
			for (const name of ['Character', 'CharacterRegistry', 'Combat']) {
				expect(code, name).toContain(name);
			}
		});

		it('does not let the browser keep it, since it is compiled per request', async () => {
			const response = await get('/scripts.js');
			expect(response.headers.get('cache-control')).toBe('no-store');
			expect(response.headers.get('content-type')).toMatch(/javascript/);
		});

		it('lists the sources for the editor to compile', async () => {
			const response = await get('/scripts/');
			expect(response.status).toBe(200);
			const names = (await response.json()) as string[];
			expect(names).toContain('Spin.ts');
			expect(names).toContain('Character.ts');
			// A declaration is not a script. See `scriptFiles` in the build tool.
			expect(names.filter((name) => name.endsWith('.d.ts'))).toEqual([]);
		});

		it('serves one source as text', async () => {
			const response = await get('/scripts/Spin.ts');
			expect(response.status).toBe(200);
			expect(response.headers.get('content-type')).toMatch(/text\/plain/);
			expect(await response.text()).toContain('class Spin extends Script');
		});

		it('answers 404 for a script that is not there', async () => {
			expect((await get('/scripts/Nonexistent.ts')).status).toBe(404);
		});

		/*
		 * The guard is checked on what a path RESOLVES to rather than on how it
		 * is spelt, which is why both escapes below are covered by one line of
		 * code. Neither returns a file: the route declines them and Vite's own
		 * fallback answers with a page, so the assertion is about the body
		 * rather than the status.
		 *
		 * The unencoded spelling — `/scripts/../../package.json` — is not tested,
		 * and the reason is worth writing down: `fetch` resolves it before the
		 * request leaves, so the server is asked for `/package.json` and this
		 * route never sees it. A test of it would be a test of the client's URL
		 * parser.
		 */
		it('will not read its way out of the script directory', async () => {
			for (const path of [
				'/scripts/..%2f..%2fpackage.json',
				'/scripts/%2e%2e%2f%2e%2e%2fpackage.json',
			]) {
				const body = await (await get(path)).text();
				expect(body, path).not.toContain('"name": "hexdelve"');
			}
		});
	});

	describe('the declarations the code editor is given', () => {
		/*
		 * These are what makes the editor's script view a language service
		 * rather than a syntax highlighter, and they are read from `dist/` —
		 * so this passes only when the packages have been built, which every
		 * `npm run typecheck`, `npm test` and `npm run build` does first.
		 */
		it('hands over the SDK, named as though it were installed', async () => {
			const response = await get('/script-types.json');
			expect(response.status).toBe(200);

			const types = (await response.json()) as {
				files: Record<string, string>;
				missing: string[];
			};
			expect(types.missing).toEqual([]);

			// The manifest matters as much as the declarations: it is what
			// makes `@hexdelve/scripting` resolve by ordinary node resolution.
			const manifest = types.files['node_modules/@hexdelve/scripting/package.json'];
			expect(manifest).toContain('"types"');

			const entry = types.files['node_modules/@hexdelve/scripting/dist/index.d.ts'];
			expect(entry).toContain('Script');
		});
	});

	describe('the assets', () => {
		it('serves a real one', async () => {
			const response = await get('/assets/rigs/humanoid.rig.yaml');
			expect(response.status).toBe(200);
			expect(await response.text()).toContain('hipHeight');
		});

		/*
		 * The other bug this plugin exists to prevent. Vite treats both apps as
		 * single-page apps, so a path it cannot serve falls back to index.html
		 * WITH A 200 on it — and a mistyped rig path then reaches the YAML
		 * reader as a page of HTML, complaining about a `<` on line one rather
		 * than about a file that is not there.
		 */
		it('answers 404 for one that is not, rather than falling back to a page', async () => {
			const response = await get('/assets/rigs/no-such-rig.yaml');
			expect(response.status).toBe(404);
			expect(await response.text()).not.toContain('<!doctype');
		});
	});

	describe('writing, which is what the editor saves through', () => {
		const url = () => `${origin}/assets/${SCRATCH}`;
		const onDisk = resolve(publicDir, 'assets', SCRATCH);

		it('puts a file, and takes it away again', async () => {
			const body = 'id: scratch\nname: Written by a test\n';
			const put = await fetch(url(), { method: 'PUT', body });
			expect(put.status).toBe(204);
			expect(await readFile(onDisk, 'utf8')).toBe(body);

			// And back out through the same address it was written to, which is
			// the whole argument for it being one address rather than two.
			expect(await (await get(`/assets/${SCRATCH}`)).text()).toBe(body);

			const gone = await fetch(url(), { method: 'DELETE' });
			expect(gone.status).toBe(204);
			await expect(access(onDisk)).rejects.toThrow();
		});

		it('refuses to write anything that is not an asset file', async () => {
			// A dev endpoint that can write a .js is a shell.
			const put = await fetch(`${origin}/assets/evil.js`, { method: 'PUT', body: 'boom' });
			expect(put.status).toBe(400);
		});

		it('refuses to write its way out of the asset tree', async () => {
			for (const path of ['/assets/../escaped.yaml', '/assets/..%2fescaped.yaml']) {
				const put = await fetch(`${origin}${path}`, { method: 'PUT', body: 'no' });
				expect(put.status, path).not.toBe(204);
			}
			await expect(access(resolve(root, 'escaped.yaml'))).rejects.toThrow();
			await expect(access(resolve(publicDir, 'escaped.yaml'))).rejects.toThrow();
		});

		/*
		 * The scripts are written on the same terms, and they are the client's
		 * own source rather than data — which is the point of the view that
		 * writes them, and the reason the guards are checked here too.
		 */
		it('puts a script, serves it back, and takes it away again', async () => {
			const url = `${origin}/scripts/${SCRATCH_SCRIPT}`;
			const body = "import { Script } from '@hexdelve/scripting';\n";

			const put = await fetch(url, { method: 'PUT', body });
			expect(put.status).toBe(204);
			expect(await readFile(resolve(scriptRoot, SCRATCH_SCRIPT), 'utf8')).toBe(body);
			expect(await (await get(`/scripts/${SCRATCH_SCRIPT}`)).text()).toBe(body);

			// And it is a script as far as the listing is concerned, which is
			// what the editor rereads after a save.
			expect((await (await get('/scripts/')).json()) as string[]).toContain(SCRATCH_SCRIPT);

			const gone = await fetch(url, { method: 'DELETE' });
			expect(gone.status).toBe(204);
			await expect(access(resolve(scriptRoot, SCRATCH_SCRIPT))).rejects.toThrow();
		});

		it('refuses to write anything that is not a script', async () => {
			for (const name of ['evil.js', 'Evil.d.ts']) {
				const put = await fetch(`${origin}/scripts/${name}`, { method: 'PUT', body: 'boom' });
				expect(put.status, name).toBe(400);
				await expect(access(resolve(scriptRoot, name))).rejects.toThrow();
			}
		});

		it('refuses to write its way out of the script directory', async () => {
			for (const path of ['/scripts/../escaped.ts', '/scripts/..%2fescaped.ts']) {
				const put = await fetch(`${origin}${path}`, { method: 'PUT', body: 'no' });
				expect(put.status, path).not.toBe(204);
			}
			await expect(access(resolve(scriptRoot, '..', 'escaped.ts'))).rejects.toThrow();
		});
	});
});
