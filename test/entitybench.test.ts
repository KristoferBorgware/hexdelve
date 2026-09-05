/*
 * The entity bench, in a browser, against a real editor dev server.
 *
 * Everything under it is covered without one — the writer round-trips every
 * asset file, the draft's tree operations are pinned on their own. What none of
 * that reaches is whether the three panes come up and talk to each other, and
 * that is exactly the class of failure this repository has shipped before: a
 * dev server whose routes were each correct and which served no behaviour,
 * because of how two of them sat next to each other.
 *
 * So this boots the editor's own Vite config, opens the bench, and drives it:
 * the hierarchy lists the prefab, the inspector draws controls from what a
 * SCRIPT declared rather than from what the file happens to set, and adding an
 * object reaches the tree. It does not save — writing an asset file from a test
 * would leave the tree dirty when the test failed halfway.
 *
 * WebGL2 rather than WebGPU on purpose: the software rasteriser in a container
 * loses a WebGPU device, and this is a test of a view rather than of a backend.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';
import type { Browser, Page } from 'playwright';

const root = new URL('..', import.meta.url).pathname;

/** Long enough for a GPU context, a compile of the scripts and a first frame. */
const SETTLE = 6000;

let browser: Browser | null = null;
let server: ViteDevServer | null = null;
let page: Page | null = null;
let why = '';

/** Everything the page complained about, gathered from the first navigation. */
const errors: string[] = [];

beforeAll(async () => {
	let chromium;
	try {
		({ chromium } = await import('playwright'));
	} catch {
		why = 'playwright is not installed';
		return;
	}

	server = await createServer({
		configFile: `${root}packages/editor/vite.config.ts`,
		root: `${root}packages/editor`,
		logLevel: 'error',
		server: { port: 0, strictPort: false, host: '127.0.0.1' },
	});
	await server.listen();
	const address = server.httpServer?.address();
	if (!address || typeof address === 'string') throw new Error('the editor did not listen');

	/*
	 * The machine's own Chrome first, then Playwright's download, which is
	 * the order the render and shader tests use: a CI runner has a Chrome of
	 * its own and no Playwright browser, a container the other way round.
	 */
	const args = ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--use-vulkan=swiftshader', '--ignore-gpu-blocklist'];
	const executablePath = process.env['CHROME_PATH'];
	try {
		try {
			browser = await chromium.launch(executablePath ? { args, executablePath } : { args, channel: 'chrome' });
		} catch {
			browser = await chromium.launch({ args });
		}
	} catch (cause) {
		why = `no browser (${String(cause).split('\n')[0]})`;
		return;
	}

	page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
	page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(`console: ${message.text()}`);
	});
	await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: 'load' });
	await page.getByRole('button', { name: 'WebGL2' }).click();
	await page.getByRole('button', { name: 'Entity', exact: true }).click();
	await page.waitForTimeout(SETTLE);
}, 180_000);

afterAll(async () => {
	await browser?.close();
	await server?.close();
});

/**
 * Wait until the hierarchy shows a given number of rows.
 *
 * A click returns before React has re-rendered, and `count()` asks once rather
 * than retrying — so a query straight after an edit reads the tree as it was.
 * Polled in Node rather than through `waitForFunction`, whose callback runs in
 * the page and cannot see this file's types.
 */
async function rowsSettle(expected: number, within = 5000): Promise<void> {
	const until = Date.now() + within;
	for (;;) {
		const rows = await page!.getByRole('treeitem').count();
		if (rows === expected || Date.now() > until) return;
		await new Promise((wake) => setTimeout(wake, 50));
	}
}

describe('the entity bench', () => {
	it('has a browser to run in', () => {
		// Stated rather than skipped silently: a suite that quietly tests
		// nothing is worse than one that says it could not.
		expect(page, why).not.toBeNull();
	});

	it('lists the prefab of the entity it is showing', async () => {
		if (!page) return;
		expect(await page.locator('text=Hierarchy').count()).toBe(1);
		// The wanderer's prefab is one object named after the entity.
		expect(await page.getByText('wanderer', { exact: true }).count()).toBe(1);
	});

	it('shows the components the file puts on it', async () => {
		if (!page) return;
		expect(await page.getByText('actor', { exact: true }).count()).toBe(1);
		expect(await page.getByText('script · Character').count()).toBe(1);
	});

	/*
	 * The claim worth testing. `hp` and `power` are set by the prefab, `lift` is
	 * not — it exists here only because the Character class declares it, so a
	 * control for it is proof the inspector read the script rather than the
	 * file. The hint beside it comes from the same declaration.
	 */
	it('draws controls from what the script declares, not from what the file sets', async () => {
		if (!page) return;
		expect(await page.getByLabel('hp').inputValue()).toBe('20');
		expect(await page.getByLabel('power').inputValue()).toBe('5');

		expect(await page.getByLabel('lift').inputValue(), 'unset, so empty').toBe('');
		expect(await page.getByText('Height of the body above its feet').count()).toBe(1);
	});

	it('adds an object, and hangs the next one under it', async () => {
		if (!page) return;
		const add = page.locator('button').filter({ has: page.locator('svg[data-testid="AddIcon"]') });

		await add.first().click();
		await page.getByLabel('Name').fill('grip');
		await add.first().click();
		await page.getByLabel('Name').fill('blade');

		// Three rows, nested: the new object is added under the selection, and
		// the selection follows what was just added.
		await rowsSettle(3);
		const rows = await page.getByRole('treeitem').allInnerTexts();
		expect(rows[0], 'the root contains both').toContain('blade');
		expect(rows[1], 'the grip contains the blade').toContain('blade');
		expect(rows[2]!.trim()).toBe('blade');
	});

	/*
	 * It is a tree rather than a list of indented rows, which is the whole
	 * reason for the component: the roles are what make the depth of a row
	 * audible, and collapsing a branch is what makes a deep prefab readable. A
	 * flat outline passes every other test in this file.
	 */
	it('is a tree that collapses', async () => {
		if (!page) return;
		expect(await page.getByRole('tree').count()).toBe(1);
		expect(await page.getByRole('treeitem').count(), 'three rows to start').toBe(3);

		// The root's own collapse toggle, named rather than picked by position:
		// a treeitem contains its descendants, so "the first icon inside it" is
		// not reliably the one that belongs to it.
		const root = page.getByRole('treeitem').first();
		await root.locator('svg[data-testid="TreeViewCollapseIconIcon"]').first().click();

		// Waited for rather than read straight back: a click returns before
		// React has re-rendered, and `count()` asks once instead of retrying.
		await rowsSettle(1);
		expect(await page.getByRole('treeitem').count(), 'the branch shut').toBe(1);
	});

	/*
	 * F-022. The entity bench compiled scripts on its own, the yard's hot
	 * reload compiled them again, and nothing said whether the two agreed —
	 * two calls to esbuild a moment apart, from the same directory, that could
	 * disagree with each other. Names matching is not the proof: two
	 * independent compiles usually agree, right up until the moment they do
	 * not. The proof is that the SECOND one never happens.
	 *
	 * The entity bench has already compiled once, in `beforeAll`. Switching to
	 * the yard mounts a fresh `Viewport`, which asks the shared cache the same
	 * question. Watched over the network rather than asserted on a value:
	 * `scriptStore.list()` is the one request every compile starts with, so a
	 * second compile means a second request, and sharing means none.
	 */
	it('shares its compile with the yard rather than starting a second one', async () => {
		if (!page) return;

		let listRequests = 0;
		const onRequest = (request: { url(): string }) => {
			if (/\/scripts\/\?t=/.test(request.url())) listRequests++;
		};
		page.on('request', onRequest);

		await page.getByRole('button', { name: 'Yard', exact: true }).click();
		await page.waitForTimeout(1500);

		page.off('request', onRequest);
		expect(listRequests, 'the yard reused the entity bench\'s compile').toBe(0);
	});

	it('came up without an error on the console', async () => {
		if (!page) return;
		// Collected from the moment the page loaded, so this covers the boot as
		// well as everything the tests above did.
		expect(errors, errors.join('\n')).toEqual([]);
	});
});
