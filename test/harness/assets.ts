/*
 * The asset tree on disk, as a library — shared by the tests that need one.
 *
 * `AssetIO` is one method for reading and two for writing, which is the whole
 * point of it being that small: nothing in @hexdelve/engine imports `node:fs`,
 * a browser gets `fetchIO`, and a test that wants the real files writes the
 * dozen lines below and hands them over.
 *
 * The default library here is READ-ONLY. A test that can write to public/assets
 * is a test that can quietly rewrite the thing it is checking; anything
 * exercising the write path gets a scratch directory of its own.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { AssetLibrary, readOnly, type AssetIO } from '@hexdelve/engine';
import { loadCast, type Cast, type CastOptions } from '@hexdelve/client';

/** Where the files actually are. */
export const ASSET_ROOT = resolve(import.meta.dirname, '..', '..', 'public', 'assets');

/** A directory as an asset backend, read and write. */
export function diskIO(at: string): AssetIO {
	const full = (path: string): string => resolve(at, path);
	return {
		kind: 'memory',
		origin: at,
		read: (path) => readFile(full(path), 'utf8'),
		writer: {
			async write(path, text) {
				await mkdir(dirname(full(path)), { recursive: true });
				await writeFile(full(path), text, 'utf8');
			},
			remove: (path) => rm(full(path), { force: true }),
		},
	};
}

/**
 * A library over the real tree.
 *
 * A fresh one per call rather than a shared singleton: a library is a cache,
 * and a test that saved something should not be able to leak the result into
 * the next one through it.
 */
export function openLibrary(at: string = ASSET_ROOT): AssetLibrary {
	return new AssetLibrary(readOnly(diskIO(at)));
}

/** The yard's cast, loaded from the real files. */
export function loadYardCast(options: CastOptions = {}): Promise<Cast> {
	return loadCast(openLibrary(), options);
}
