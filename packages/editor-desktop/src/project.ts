/*
 * Which checkout this window is editing.
 *
 * The shell around the client has no equivalent of this file and does not need
 * one: it opens a window on a build and the build is inside the application.
 * An EDITOR is the other way round. What it edits is somebody's working copy —
 * `public/assets` and `packages/client/scripts` in a clone of this repository —
 * and that lives outside the application, is different for every person, and
 * has to be chosen rather than assumed.
 *
 * So the root is resolved in four steps, most explicit first:
 *
 *   HEXDELVE_PROJECT    said outright, for a script or a second checkout
 *   the remembered one  what was picked last time, in the app's own data
 *   the workspace       the repository this shell was built inside, which is
 *                       the right answer for anyone running `npm run
 *                       dev:editor-desktop` and never has to be picked
 *   asked for           a directory dialog, once, for a packaged application
 *
 * Every one of them is CHECKED before it is used, by looking for the two
 * directories the editor writes to. A root that does not have them is not a
 * refusal to work — the window opens read-only and says which directory it
 * was pointed at — because a wrong answer that announces itself is worth more
 * than a right one that cannot be questioned.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { app, dialog } from 'electron';

/** The two trees the editor authors, relative to the project root. */
export const ASSET_DIR = join('public', 'assets');
export const SCRIPT_DIR = join('packages', 'client', 'scripts');

/** Where the choice is remembered between runs. */
function memory(): string {
	return join(app.getPath('userData'), 'project.json');
}

/** A directory is a project when it has both of the trees the editor edits. */
export function looksLikeProject(root: string): boolean {
	return existsSync(join(root, ASSET_DIR)) && existsSync(join(root, SCRIPT_DIR));
}

/**
 * The repository this shell was built inside, if it still is.
 *
 * `dist/main.js` sits at `packages/editor-desktop/dist`, so the root is three
 * directories up. Packaged, it is somewhere in an application bundle and this
 * check fails, which is exactly what it is for.
 */
function workspace(): string | null {
	const root = resolve(__dirname, '..', '..', '..');
	return looksLikeProject(root) ? root : null;
}

async function remembered(): Promise<string | null> {
	try {
		const saved = JSON.parse(await readFile(memory(), 'utf8')) as { root?: unknown };
		return typeof saved.root === 'string' && looksLikeProject(saved.root) ? saved.root : null;
	} catch {
		return null; // Never chosen, or the file is not ours to read.
	}
}

async function remember(root: string): Promise<void> {
	await mkdir(dirname(memory()), { recursive: true });
	await writeFile(memory(), JSON.stringify({ root }, null, '\t'), 'utf8');
}

/**
 * Ask for a directory, and remember it.
 *
 * A directory that is not a project is refused with a message that says what
 * was looked for, rather than accepted and then found wanting one save later.
 */
export async function choose(): Promise<string | null> {
	const picked = await dialog.showOpenDialog({
		title: 'Open a Hexdelve project',
		properties: ['openDirectory'],
		message: 'The directory holding public/assets and packages/client/scripts.',
	});
	const root = picked.filePaths[0];
	if (picked.canceled || !root) return null;

	if (!looksLikeProject(root)) {
		await dialog.showMessageBox({
			type: 'warning',
			title: 'Not a Hexdelve project',
			message: `${root} has no ${ASSET_DIR} and no ${SCRIPT_DIR} in it.`,
			detail: 'Pick the top of a checkout of the repository.',
		});
		return null;
	}

	await remember(root);
	return root;
}

/** The root this window starts on, asking for one only if it must. */
export async function openProject(): Promise<string | null> {
	const said = process.env['HEXDELVE_PROJECT'];
	if (said && looksLikeProject(said)) return said;

	const last = await remembered();
	if (last) return last;

	const here = workspace();
	if (here) return here;

	return choose();
}
