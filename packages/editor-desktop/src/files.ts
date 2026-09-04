/*
 * The write half of the bridge: the only thing this shell can do that a
 * browser tab cannot.
 *
 * Everything the editor READS it reads with `fetch` over the `app://` scheme,
 * exactly as it does on the web — see main.ts, and the header of `desktop.ts`
 * in @hexdelve/client. What is here is the part that genuinely differs, and
 * the guards on it are the reason it is a small module rather than a line in
 * the window setup.
 *
 * ## What the page may ask for
 *
 * A scope and a path inside it, never a path of its own. The renderer cannot
 * name `/etc`, cannot name `..`, and cannot name a file in the project outside
 * the two trees the editor authors — because it does not say where those trees
 * are. The main process does, and then checks that what it resolved is still
 * inside the one it meant.
 *
 * Resolved and then CHECKED rather than scanned for `..`, which is the same
 * rule the dev server's plugin follows and for the same reason: a check on the
 * text of a path is a check on one spelling of it, and where it actually leads
 * is the only thing worth asking.
 *
 * ## Why the extension matters
 *
 * `assets` takes YAML and `scripts` takes TypeScript. Not because anything
 * would break otherwise, but because a write endpoint that accepts any name is
 * a way to put an executable somewhere it will later be run, and the editor
 * has no reason to write anything else. The dev server refuses the same set.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

import { ipcMain } from 'electron';

import { ASSET_DIR, SCRIPT_DIR, choose } from './project.js';

/** Room for a large hand-authored mesh or a long script, and nothing else. */
const MAX_BYTES = 1 << 20;

const SCOPES = {
	assets: { dir: ASSET_DIR, allowed: /\.ya?ml$/ },
	scripts: { dir: SCRIPT_DIR, allowed: /(?<!\.d)\.ts$/ },
} as const;

type Scope = keyof typeof SCOPES;

/** What the window is pointed at, and what it may write there. */
export interface Project {
	root: string | null;
}

/**
 * Answer the page's file calls, for as long as this process is up.
 *
 * The project is passed as a box rather than a string because the window can
 * be pointed somewhere else while it is open, and a handler that had captured
 * the old root would go on writing into it.
 */
export function serveFiles(project: Project): void {
	ipcMain.handle('hexdelve:root', () => project.root);

	ipcMain.handle('hexdelve:choose', async () => {
		const root = await choose();
		if (root) project.root = root;
		return project.root;
	});

	ipcMain.handle('hexdelve:write', async (_event, scope: unknown, path: unknown, text: unknown) => {
		if (typeof text !== 'string') throw new Error('a file is written as text');
		if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) {
			throw new Error(`a file may not exceed ${MAX_BYTES} bytes`);
		}
		const target = where(project, scope, path);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, text, 'utf8');
	});

	ipcMain.handle('hexdelve:remove', async (_event, scope: unknown, path: unknown) => {
		await rm(where(project, scope, path), { force: true });
	});
}

/**
 * Where a scope and a path lead, or a refusal saying which rule stopped it.
 *
 * The messages are the ones the editor puts on screen, so they say what was
 * wrong rather than that something was.
 */
function where(project: Project, scope: unknown, path: unknown): string {
	if (project.root === null) {
		throw new Error('this window is not open on a project; use File → Open Project');
	}
	if (typeof scope !== 'string' || !(scope in SCOPES)) {
		throw new Error(`there is no '${String(scope)}' to write to`);
	}
	if (typeof path !== 'string' || path === '' || path.endsWith('/')) {
		throw new Error('that is not a file name');
	}

	const { dir, allowed } = SCOPES[scope as Scope];
	if (!allowed.test(path)) throw new Error(`'${path}' is not a name anything under ${scope} may have`);

	const root = resolve(project.root, dir);
	const target = resolve(root, path);
	if (target !== root && !target.startsWith(root + sep)) {
		throw new Error(`'${path}' is outside ${dir}`);
	}
	return target;
}
