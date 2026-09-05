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

	it('adds an object to the tree', async () => {
		if (!page) return;
		const add = page.locator('button').filter({ has: page.locator('svg[data-testid="AddIcon"]') });
		await add.first().click();

		await page.getByLabel('Name').fill('grip');
		// The row in the hierarchy is the tree, redrawn from the draft.
		expect(await page.getByText('grip', { exact: true }).count()).toBe(1);
	});

	it('came up without an error on the console', async () => {
		if (!page) return;
		// Collected from the moment the page loaded, so this covers the boot as
		// well as everything the tests above did.
		expect(errors, errors.join('\n')).toEqual([]);
	});
});
