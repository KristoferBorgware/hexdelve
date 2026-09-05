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

import { AssetLibrary, readOnly, type AssetIO, type EntityAsset, type SceneAsset } from '@hexdelve/engine';

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

/** Where the town is, and the only scene there is. */
export const TOWN_SCENE = 'scenes/town.scene.yaml';

/**
 * The town, loaded from the real files.
 *
 * `spawnable` lays the same scene over the tree with a `spawnable:` list added,
 * for a test about a script asking for something that was not placed. Written
 * as text rather than assembled as an object, so what the test exercises is the
 * reader every other scene goes through.
 */
export function loadTownScene(spawnable: readonly string[] = []): Promise<SceneAsset> {
	if (spawnable.length === 0) return openLibrary().scene(TOWN_SCENE);

	const listed = spawnable.map((id) => `  - ../entities/${id}.entity.yaml`).join('\n');
	const disk = diskIO(ASSET_ROOT);
	const io: AssetIO = {
		...disk,
		read: async (path) =>
			path === TOWN_SCENE
				? `${await disk.read(path)}\nspawnable:\n${listed}\n`
				: disk.read(path),
	};
	return new AssetLibrary(readOnly(io)).scene(TOWN_SCENE);
}

/** The entity a scene places under a given name, for a test that needs one. */
export function placedEntity(scene: SceneAsset, name: string): EntityAsset {
	const found = scene.objects.find((one) => one.name === name)?.entity;
	if (!found) throw new Error(`the scene '${scene.id}' places no entity called '${name}'`);
	return found;
}
