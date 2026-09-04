/*
 * tools/run-editor.js — bring the editor up to date and open it on the desktop.
 *
 *   npm run editor                 # pull, build, launch
 *   npm run editor -- --no-pull    # build and launch what is already here
 *   npm run editor -- --no-start   # everything except opening the window
 *   npm run editor -- --project D:\work\hexdelve-other
 *
 * Four steps, and the point of putting them in one file is that they have to
 * happen in this order and it is easy to do three of them and forget the
 * fourth — most often the editor's own Vite build, because
 * `npm run dev:editor-desktop` only compiles the SHELL and will happily open a
 * window on whatever `packages/editor/dist` was left from last week.
 *
 *   pull       the current branch, merged, never rebased. Others push to these
 *              branches and rewriting shared history to save a merge commit is
 *              not a trade this project makes.
 *   install    only when node_modules has fallen out of step with the
 *              lockfile, which `npm ls` answers in about a second. Asking that
 *              rather than "did the pull move the lockfile" is deliberate: the
 *              tree can be stale for reasons this script never saw, and a
 *              missing dependency shows up as a type error in a package that
 *              has nothing wrong with it.
 *   build      the editor, its libraries and the shell, through the root's own
 *              `build:editor-desktop` so there is one definition of what that
 *              means rather than two that drift.
 *   start      electron, on this checkout.
 *
 * Every step says what it is doing and how long it took, because the answer to
 * "why is this slow" should come off the screen rather than out of a guess.
 *
 * ## What it does not do
 *
 * It does not run the tests, and it does not touch `main`. Pulling somebody
 * else's work into a branch is a decision, not a convenience, and this is a
 * convenience.
 */

'use strict';

const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

const WINDOWS = process.platform === 'win32';

/** npm is a .cmd on Windows, and spawn will not find it without the suffix. */
const NPM = WINDOWS ? 'npm.cmd' : 'npm';

/**
 * How to spawn a command file at all on Windows.
 *
 * Node refuses to spawn a `.cmd` or `.bat` without a shell — it throws
 * `EINVAL` rather than running it — since the fix for CVE-2024-27980, where
 * arguments to a batch file could be read as further commands. So Windows gets
 * `shell: true`, and everything handed to it is quoted, because a shell is
 * exactly what makes an argument with a space in it into two arguments.
 *
 * Nothing else gets a shell. On Linux and macOS `npm` is an ordinary
 * executable and adding one would only be a second thing to get the quoting
 * right for.
 */
function shellSafe(argument) {
	if (!WINDOWS) return argument;
	return /[\s"^&|<>()]/.test(argument) ? `"${argument.replace(/"/g, '""')}"` : argument;
}

function usage() {
	console.log(
		[
			'Usage: npm run editor -- [options]',
			'',
			'  --no-pull            skip the git pull',
			'  --no-install         never install, even if the tree is out of step',
			'  --install            install whether or not it is',
			'  --no-start           build everything and stop before the window',
			'  --project <dir>      edit a different checkout (sets HEXDELVE_PROJECT)',
			'  --help',
		].join('\n'),
	);
}

function parse(argv) {
	const options = {
		pull: true,
		install: null, // null means "only if the installed tree is out of step"
		start: true,
		project: null,
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--help' || arg === '-h') return null;
		else if (arg === '--no-pull') options.pull = false;
		else if (arg === '--no-install') options.install = false;
		else if (arg === '--install') options.install = true;
		else if (arg === '--no-start') options.start = false;
		else if (arg === '--project') options.project = argv[++i] ?? null;
		else throw new Error(`unknown option '${arg}' — try --help`);
	}
	if (options.project && !existsSync(options.project)) {
		throw new Error(`no such directory: ${options.project}`);
	}
	return options;
}

/** Run something, showing its output, and stop the script if it fails. */
function run(what, command, args, extraEnv) {
	console.log(`\n\u001b[1m${what}\u001b[0m  ${command} ${args.join(' ')}`);
	const started = Date.now();
	const result = spawnSync(shellSafe(command), args.map(shellSafe), {
		cwd: root,
		stdio: 'inherit',
		shell: WINDOWS,
		env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
	});
	const seconds = ((Date.now() - started) / 1000).toFixed(1);

	if (result.error) throw new Error(`${what} could not run: ${result.error.message}`);
	if (result.status !== 0) {
		throw new Error(`${what} failed after ${seconds}s (exit ${result.status})`);
	}
	console.log(`\u001b[2m${what} took ${seconds}s\u001b[0m`);
	return result;
}

/** Something git can tell us, as a trimmed line. */
function git(...args) {
	const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
	if (result.status !== 0) {
		throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || '').trim()}`);
	}
	return result.stdout.trim();
}

/**
 * Whether what is installed still matches what the lockfile asks for.
 *
 * `npm ls` walks the tree and exits non-zero when anything is missing or the
 * wrong version, which is exactly the question — and it is quiet and quick,
 * unlike the install it saves. A pull that added a dependency, a branch switch,
 * a half-finished install: all of them look the same here, which is the point.
 */
function treeIsCurrent() {
	const result = spawnSync(NPM, ['ls', '--workspaces', '--depth=0'], {
		cwd: root,
		stdio: 'ignore',
		shell: WINDOWS,
	});
	return result.status === 0;
}

function main() {
	const options = parse(process.argv.slice(2));
	if (!options.project && !existsSync(path.join(root, 'packages', 'editor-desktop'))) {
		throw new Error(
			'there is no packages/editor-desktop in this checkout — ' +
				'the branch you are on predates the editor shell',
		);
	}

	if (options.pull) {
		const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
		if (branch === 'HEAD') throw new Error('detached HEAD — check a branch out first');

		/*
		 * Merged rather than rebased, and stated on the command line rather
		 * than left to configuration: whoever runs this may not have
		 * `pull.rebase false` set, and rewriting a branch other people push to
		 * is the one thing this repository is firm about.
		 */
		run(`pull ${branch}`, 'git', ['pull', '--no-rebase', 'origin', branch]);
	} else {
		console.log('\u001b[2mskipping the pull\u001b[0m');
	}

	const current = options.install === null ? treeIsCurrent() : !options.install;
	if (current) {
		console.log('\u001b[2mno install: node_modules matches the lockfile\u001b[0m');
	} else {
		if (options.install === null) {
			console.log('\u001b[2mnode_modules is out of step with the lockfile\u001b[0m');
		}
		run('install', NPM, ['ci']);
	}

	// The editor, its libraries and the shell. `dev:editor-desktop` compiles
	// only the shell, which is how a window ends up on last week's editor.
	run('build', NPM, ['run', 'build:editor-desktop']);

	if (!options.start) {
		console.log('\n\u001b[2mbuilt, and --no-start said to stop here\u001b[0m');
		return;
	}

	/*
	 * `HEXDELVE_PROJECT` is the first thing the shell looks at, ahead of what
	 * it remembered and ahead of the checkout it was built in. Only set when
	 * asked for, so the ordinary case keeps whatever was chosen last.
	 */
	const env = options.project ? { HEXDELVE_PROJECT: path.resolve(options.project) } : null;
	if (env) console.log(`\u001b[2mediting ${env.HEXDELVE_PROJECT}\u001b[0m`);

	run('start', NPM, ['start', '-w', '@hexdelve/editor-desktop'], env);
}

try {
	if (process.argv.includes('--help') || process.argv.includes('-h')) usage();
	else main();
} catch (error) {
	console.error(`\n\u001b[31m${error instanceof Error ? error.message : error}\u001b[0m`);
	process.exitCode = 1;
}
