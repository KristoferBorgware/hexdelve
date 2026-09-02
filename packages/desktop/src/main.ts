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
 */

import { join } from 'node:path';

import { app, BrowserWindow, shell } from 'electron';

const DEV_SERVER = process.env['HEXDELVE_DEV_SERVER'];

// The client's Vite app build. Resolved from this file rather than the working
// directory so it holds inside a packaged asar as well as in the workspace.
const CLIENT_PAGE = join(__dirname, '..', '..', 'client', 'dist-app', 'index.html');

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
	else void window.loadFile(CLIENT_PAGE);
}

void app.whenReady().then(() => {
	createWindow();

	app.on('activate', () => {
		// macOS keeps the process alive with no windows; the dock icon reopens one.
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});
