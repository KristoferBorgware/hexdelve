/*
 * The Electron main process for the editor.
 *
 * There are two shells in this repository and they are not the same program.
 * `packages/desktop` wraps the CLIENT: a window on the game's own build, which
 * authors nothing and needs nothing from Electron but a window. This one wraps
 * the EDITOR, and it exists for exactly one reason — the editor writes files,
 * and until now the only host that could was a Vite dev server. A browser tab
 * cannot, and the built page published to Pages says so on its own status
 * line. So this is the editor with a disk under it.
 *
 * ## Two roots, not one
 *
 * The window serves out of two places and the split is the whole design.
 *
 *   the APPLICATION   the editor's build — the page, its bundle, its workers.
 *                     Inside the app, the same for everybody, never written.
 *   the PROJECT       somebody's checkout: `public/assets` for the asset files
 *                     and `packages/client/scripts` for the scripts. Outside
 *                     the app, different for everybody, and the thing being
 *                     edited. See project.ts.
 *
 * `app://hexdelve/assets/rigs/humanoid.rig.yaml` therefore comes off the disk
 * the user is editing, while `app://hexdelve/index.html` comes out of the
 * application — and the page cannot tell, which is the point. The editor was
 * written against a dev server that serves both from one origin, and it runs
 * here unchanged.
 *
 * ## Why there is a protocol here at all
 *
 * The same reason the client's shell has one. Loaded with `loadFile` the page
 * would be a `file://` document with an opaque origin, and a relative fetch
 * from one is refused by Chromium. A standard, secure `app://` scheme gives
 * the window a real origin, so every URL under it resolves as it does over
 * http and no part of the editor needs to know which host it is on.
 *
 * ## Why nothing here compiles a script
 *
 * The window carries no compiled scripts and does not need to. An
 * editor-hosted client is created with `scripts: false`, so it starts with no
 * behaviour and gets all of it from the editor compiling `scripts/` — read
 * from the PROJECT over this scheme — in the page. A bundle built into the
 * application would be behaviour frozen when the editor was built, from
 * whatever checkout built it, and compiling one here instead would put a
 * second compiler in a third place to say what the page is about to say
 * anyway.
 */

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { BrowserWindow, Menu, app, dialog, net, protocol, shell } from 'electron';

import { serveFiles, type Project } from './files.js';
import { ASSET_DIR, SCRIPT_DIR, choose, openProject } from './project.js';

/** Point the window at a running `npm run dev:editor` instead of the build. */
const DEV_SERVER = process.env['HEXDELVE_EDITOR_DEV_SERVER'];

const SCHEME = 'app';
const HOST = 'hexdelve';
const ORIGIN = `${SCHEME}://${HOST}`;

/** What the window is editing. A box, because a menu item can change it. */
const project: Project = { root: null };

/**
 * The editor's web build, wherever it is.
 *
 * Packaged, electron-builder puts it beside the app under `resources/app`;
 * in the workspace it is where `npm run build:editor` left it.
 */
function editorRoot(): string {
	const packaged = join(process.resourcesPath, 'app', 'editor');
	if (app.isPackaged || existsSync(packaged)) return packaged;
	return join(__dirname, '..', '..', 'editor', 'dist');
}

/*
 * Privileges have to be declared before the app is ready, and all four matter:
 * `standard` gives the scheme an origin and relative URL resolution, `secure`
 * puts it in a secure context, `supportFetchAPI` is what lets the editor's
 * loaders reach it, and `stream` is what lets a response be sent as one.
 */
protocol.registerSchemesAsPrivileged([
	{
		scheme: SCHEME,
		privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
	},
]);

/** One request, routed to whichever of the two roots owns it. */
async function serve(request: Request): Promise<Response> {
	const { pathname } = new URL(request.url);
	const path = decodeURIComponent(pathname);

	const root = project.root;
	if (root !== null) {
		if (path === '/scripts' || path === '/scripts/') return listScripts(root);
		if (path.startsWith('/scripts/')) return readScript(root, path.slice('/scripts/'.length));
		if (path.startsWith('/assets/')) {
			return fromDisk(resolve(root, ASSET_DIR), path.slice('/assets/'.length));
		}
	}

	return fromDisk(editorRoot(), path === '/' ? 'index.html' : path.slice(1));
}

/** A file under a root, or a refusal. The root is checked, not the spelling. */
function fromDisk(root: string, relative: string): Promise<Response> {
	const target = normalize(join(root, relative));
	if (target !== root && !target.startsWith(root + sep)) {
		return Promise.resolve(new Response('outside the tree', { status: 403 }));
	}
	return net.fetch(pathToFileURL(target).toString());
}

/**
 * The script directory, as the editor's store expects to read it.
 *
 * The same two answers the dev server's plugin gives — a JSON array of names,
 * and then each file as text — because the editor asks the same questions
 * here. `.d.ts` is left out for the same reason it is there: a declaration is
 * not a script.
 */
async function listScripts(root: string): Promise<Response> {
	try {
		const names = await readdir(resolve(root, SCRIPT_DIR));
		const scripts = names.filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts'));
		return Response.json(scripts.sort());
	} catch {
		return new Response('cannot read the script directory', { status: 500 });
	}
}

/**
 * One script's source.
 *
 * Read here rather than handed to `net.fetch`, because a `.ts` file off a disk
 * is served as an MPEG transport stream by anything that guesses a type from
 * an extension, and a page that asked for source should be given source.
 */
async function readScript(project: string, name: string): Promise<Response> {
	const root = resolve(project, SCRIPT_DIR);
	const target = resolve(root, name);
	if (!target.startsWith(root + sep) || extname(target) !== '.ts') {
		return new Response('that is not a script', { status: 400 });
	}
	try {
		return new Response(await readFile(target, 'utf8'), {
			headers: { 'content-type': 'text/plain; charset=utf-8' },
		});
	} catch {
		return notFound();
	}
}

function notFound(): Response {
	return new Response('no such file', { status: 404 });
}

function createWindow(): BrowserWindow {
	const window = new BrowserWindow({
		width: 1600,
		height: 1000,
		minWidth: 900,
		minHeight: 560,
		backgroundColor: '#1b201c',
		title: 'Hexdelve Editor',
		webPreferences: {
			preload: join(__dirname, 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});

	/*
	 * The window's title is the project, not the page's.
	 *
	 * The editor's own <title> says "Hexdelve — editor", which is right for a
	 * browser tab and useless here: what a person needs to know from a window
	 * that writes to a disk is WHICH disk. Electron adopts the document title
	 * by default, so the event is stopped and the title set back.
	 */
	window.on('page-title-updated', (event) => {
		event.preventDefault();
		showProject(window);
	});

	// A link to somewhere else belongs in the user's browser, not in a window
	// that has no address bar to leave.
	window.webContents.setWindowOpenHandler(({ url }) => {
		void shell.openExternal(url);
		return { action: 'deny' };
	});

	if (DEV_SERVER) void window.loadURL(DEV_SERVER);
	else void window.loadURL(`${ORIGIN}/index.html`);

	showProject(window);
	return window;
}

/** The project in the title bar, because it is the thing being changed. */
function showProject(window: BrowserWindow): void {
	window.setTitle(project.root ? `Hexdelve Editor — ${project.root}` : 'Hexdelve Editor');
}

/**
 * Open a different project, and reload.
 *
 * A reload rather than a message to the page: every view holds files read from
 * the old root, and the editor already knows how to start from nothing.
 */
async function openAnother(window: BrowserWindow): Promise<void> {
	const root = await choose();
	if (!root) return;
	project.root = root;
	showProject(window);
	window.webContents.reload();
}

function buildMenu(window: BrowserWindow): void {
	Menu.setApplicationMenu(
		Menu.buildFromTemplate([
			{
				label: 'File',
				submenu: [
					{
						label: 'Open Project…',
						accelerator: 'CmdOrCtrl+O',
						click: () => void openAnother(window),
					},
					{ type: 'separator' },
					{ role: 'quit' },
				],
			},
			{ role: 'editMenu' },
			{
				label: 'View',
				submenu: [
					{ role: 'reload' },
					{ role: 'toggleDevTools' },
					{ type: 'separator' },
					{ role: 'resetZoom' },
					{ role: 'zoomIn' },
					{ role: 'zoomOut' },
					{ type: 'separator' },
					{ role: 'togglefullscreen' },
				],
			},
		]),
	);
}

void app.whenReady().then(async () => {
	project.root = await openProject();
	protocol.handle(SCHEME, (request) => serve(request));
	serveFiles(project);

	const window = createWindow();
	buildMenu(window);

	if (project.root === null) {
		// Opened on nothing rather than refusing to open: the editor reports a
		// host it cannot write to on its own, and this says which case it is.
		void dialog.showMessageBox(window, {
			type: 'info',
			title: 'No project open',
			message: 'This window is not editing anything yet.',
			detail: 'Use File → Open Project to pick a checkout of the repository.',
		});
	}

	app.on('activate', () => {
		// macOS keeps the process alive with no windows; the dock icon reopens one.
		if (BrowserWindow.getAllWindows().length === 0) buildMenu(createWindow());
	});
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});
