/*
 * The Electron main process.
 *
 * The desktop build is a shell and nothing more: it opens a window on the
 * client's own standalone build. There is no desktop-only rendering path and
 * no desktop-only game code, so whatever ships on the web ships here.
 *
 * In development it points at the client's Vite dev server instead, so a
 * change reloads without a rebuild:
 *
 *     npm run dev:client            # terminal one
 *     HEXDELVE_DEV_SERVER=http://localhost:5180 npm run dev:desktop
 *
 * ## Why there is a protocol here
 *
 * The client reads its rigs, bodies, clips and trees out of `assets/` with
 * `fetch`. Loaded with `loadFile`, this window's page would be a `file://`
 * document, and a `file://` document has an opaque origin: a relative fetch
 * from one is refused by Chromium, and no flag worth setting changes that.
 *
 * The usual answer is to give Electron its own read path over IPC. That would
 * work and it would cost the sentence at the top of this file, because the
 * client would then contain a branch that only the desktop build ever takes,
 * and "whatever ships on the web ships here" would be a thing we used to say.
 *
 * So the window gets a real origin instead. `app://hexdelve/` is a standard,
 * secure scheme served straight out of the client's build directory, and
 * every URL underneath it — the bundle, the page, the asset files — resolves
 * exactly as it does over http. The client needs to know nothing about any of
 * this, which is the point.
 *
 * Reads only. Nothing here writes: the shell wraps the client, not the editor,
 * and the client authors nothing. The asset library will report itself
 * read-only in this window, correctly and without being told.
 */

import { existsSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { app, BrowserWindow, net, protocol, shell } from 'electron';

const DEV_SERVER = process.env['HEXDELVE_DEV_SERVER'];

const SCHEME = 'app';
const HOST = 'hexdelve';
const ORIGIN = `${SCHEME}://${HOST}`;

/**
 * The client's web build, wherever it is.
 *
 * Packaged, electron-builder puts it beside the app under `resources/app`;
 * in the workspace it is where the client left it. Resolved rather than
 * assumed, because the two are not the same shape and the packaged one used
 * to be wrong.
 */
function clientRoot(): string {
	const packaged = join(process.resourcesPath, 'app', 'client');
	if (app.isPackaged || existsSync(packaged)) return packaged;
	return join(__dirname, '..', '..', 'client', 'dist-app');
}

/*
 * Privileges have to be declared before the app is ready, and all three matter:
 * `standard` gives the scheme an origin and relative URL resolution, `secure`
 * puts it in a secure context so it is not treated as untrusted, and
 * `supportFetchAPI` is what lets the client's own loader reach it at all.
 */
protocol.registerSchemesAsPrivileged([
	{
		scheme: SCHEME,
		privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
	},
]);

/**
 * Serve one file out of the client's build.
 *
 * The path is resolved and then CHECKED against the root, rather than scanned
 * for `..`: a check on the text of a path is a check on one spelling of it,
 * and the resolved location is the only thing that says where a request
 * actually leads.
 */
function serve(root: string, request: Request): Promise<Response> {
	const { pathname } = new URL(request.url);
	const decoded = decodeURIComponent(pathname);
	const target = normalize(join(root, decoded === '/' ? '/index.html' : decoded));

	if (target !== root && !target.startsWith(root + sep)) {
		return Promise.resolve(new Response('outside the app', { status: 403 }));
	}
	return net.fetch(pathToFileURL(target).toString());
}

function createWindow(): void {
	const window = new BrowserWindow({
		width: 1440,
		height: 900,
		minWidth: 640,
		minHeight: 420,
		backgroundColor: '#1b201c',
		title: 'Hexdelve',
		webPreferences: {
			preload: join(__dirname, 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});

	// A link to somewhere else belongs in the user's browser, not in a window
	// that has no address bar to leave.
	window.webContents.setWindowOpenHandler(({ url }) => {
		void shell.openExternal(url);
		return { action: 'deny' };
	});

	if (DEV_SERVER) void window.loadURL(DEV_SERVER);
	else void window.loadURL(`${ORIGIN}/index.html`);
}

void app.whenReady().then(() => {
	const root = clientRoot();
	protocol.handle(SCHEME, (request) => serve(root, request));

	createWindow();

	app.on('activate', () => {
		// macOS keeps the process alive with no windows; the dock icon reopens one.
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});
