/*
 * The audio directory, and the one thing about it that is not obvious.
 *
 * `public/assets/audio` is the only place in the asset tree that holds its own
 * source: seven Node programs that synthesise an ambience loop each, sitting
 * beside the `.wav` files they write. That is on purpose — a render is only
 * reproducible if you can find what rendered it — and it has a consequence,
 * because `publicDir` copies a directory wholesale and neither app has any use
 * for a hundred kilobytes of DSP source on a static host.
 *
 * `audioSources` takes them back out of a build. This checks that it does, on a
 * directory laid out the way a build's is, rather than by running a build:
 * `npm run build` renders nothing, so on a clean checkout the only file the
 * real thing would find is the source it removes, and the test would pass with
 * the plugin deleted.
 */

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { audioSources } from '../vite.assets.mts';

const root = resolve(import.meta.dirname, '..');
const audioDir = resolve(root, 'public', 'assets', 'audio');

/** A build's output directory, invented for this and removed afterwards. */
const outDir = resolve(root, 'test', 'scratch-audio-out');

afterAll(async () => {
	await rm(outDir, { recursive: true, force: true });
});

/**
 * Run the plugin's two hooks the way Vite does, over a directory we made.
 *
 * Typed loosely on purpose: `Plugin`'s hooks may each be a function or an
 * object with a `handler`, and asserting the shape here would be asserting
 * something about Vite rather than about this plugin.
 */
async function sweep(): Promise<void> {
	const plugin = audioSources() as unknown as {
		configResolved: (config: { root: string; build: { outDir: string } }) => void;
		closeBundle: () => Promise<void>;
	};
	plugin.configResolved({ root, build: { outDir } });
	await plugin.closeBundle.call(null as never);
}

describe('what a build publishes out of the audio directory', () => {
	it('keeps the loops and drops everything else', async () => {
		const dir = join(outDir, 'assets', 'audio');
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, 'town.wav'), 'not really a wave');
		await writeFile(join(dir, 'town.js'), '// the program that renders it');
		await writeFile(join(dir, 'synth.js'), '// the floor underneath it');
		// The working file a generator caches its mix gain in. It is gitignored,
		// so it only ever exists on the machine that rendered — which is exactly
		// the machine that then runs a build.
		await writeFile(join(dir, '.mixgain-town'), '2.28');

		await sweep();

		expect((await readdir(dir)).sort()).toEqual(['town.wav']);
	});

	it('says nothing about a build with no audio in it', async () => {
		await rm(outDir, { recursive: true, force: true });
		// Which is every build on a clean checkout: the renders are gitignored,
		// so CI has none of them and the directory it copies holds only source.
		await expect(sweep()).resolves.toBeUndefined();
	});
});

/*
 * `npm run audio` renders every track and no library, and it works that out
 * rather than being told: a `.js` in there that exports something is the floor
 * the tracks stand on, and one that exports nothing is a program that writes a
 * wave and exits.
 *
 * That rule is the whole reason there is no list to keep in step, so it is the
 * thing worth pinning. A library that got mistaken for a track would render
 * nothing and say it had; a track mistaken for a library would silently stop
 * being rendered, which is worse, because the only sign of it is a loop that
 * quietly stays as it was.
 */
describe('which files `npm run audio` renders', () => {
	it('takes the tracks and leaves the libraries alone', async () => {
		const tool = (await import('../tools/build-audio.js')) as unknown as {
			default: { generators: () => string[] };
		};
		const tracks = tool.default.generators();
		const all = (await readdir(audioDir))
			.filter((name) => name.endsWith('.js'))
			.map((name) => name.slice(0, -'.js'.length))
			.sort();

		expect(tracks).not.toContain('synth');
		expect(tracks).not.toContain('voices');
		expect(tracks.sort()).toEqual(all.filter((name) => name !== 'synth' && name !== 'voices'));
		expect(tracks.length).toBeGreaterThan(0);
	});
});
