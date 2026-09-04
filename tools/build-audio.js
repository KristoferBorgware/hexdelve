/*
 * tools/build-audio.js — render the ambience tracks.
 *
 *   npm run audio                    # every track that is not already rendered
 *   npm run audio -- --force         # every track, again
 *   npm run audio -- dungeon-crawl   # one of them
 *   npm run audio -- --list          # what there is to render
 *
 * The generators live in `public/assets/audio`, beside the `.wav` files they
 * write, because that is where the game reads audio from — the same place the
 * rigs and clips answer on. They are the source of those files the way a
 * `.blend` is the source of a mesh: not read at run time, but not a build tool
 * either, and the tree is easier to understand with the two together.
 *
 * The renders are gitignored, ~30 MB apiece and about twenty seconds apiece, so
 * this skips one that is already on disk. `--force` is how you get it back
 * after changing a generator; there is no timestamp comparison, because a
 * change to `synth.js` changes every track and a mtime rule would either miss
 * that or rerender the lot every time anything under the directory moved.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const audioDir = path.join(root, 'public', 'assets', 'audio');

/**
 * Which files render a track and which are the floor underneath them.
 *
 * `synth.js` and `voices.js` are required by the tracks and write nothing on
 * their own; every other `.js` here renders one `.wav` and exits. They are told
 * apart by whether they export anything, which is the actual difference rather
 * than a list to keep in step: a library has a `module.exports` and a track is
 * a program.
 */
function generators() {
	return fs
		.readdirSync(audioDir)
		.filter((name) => name.endsWith('.js'))
		.filter((name) => !/^\s*module\.exports\b/m.test(fs.readFileSync(path.join(audioDir, name), 'utf8')))
		.map((name) => name.slice(0, -'.js'.length))
		.sort();
}

function render(name, force) {
	const script = path.join(audioDir, `${name}.js`);
	const wav = path.join(audioDir, `${name}.wav`);

	if (!force && fs.existsSync(wav)) {
		console.log(`${name}  already rendered — pass --force to do it again`);
		return true;
	}

	const started = Date.now();
	const result = spawnSync(process.execPath, [script, wav], { cwd: root, stdio: 'inherit' });
	if (result.error) {
		console.error(`${name} could not run: ${result.error.message}`);
		return false;
	}
	if (result.status !== 0) {
		console.error(`${name} failed (exit ${result.status})`);
		return false;
	}
	console.log(`${name}  ${((Date.now() - started) / 1000).toFixed(1)}s`);
	return true;
}

function main(argv) {
	const force = argv.includes('--force');
	const wanted = argv.filter((one) => !one.startsWith('--')).map((one) => one.replace(/\.js$/, ''));
	const known = generators();

	if (argv.includes('--list')) {
		for (const name of known) {
			const rendered = fs.existsSync(path.join(audioDir, `${name}.wav`)) ? 'rendered' : '—';
			console.log(`${name.padEnd(20)} ${rendered}`);
		}
		return 0;
	}

	// Named but not there is a typo, and a typo that rendered nothing and said
	// nothing would look exactly like a track that was already up to date.
	for (const name of wanted) {
		if (known.includes(name)) continue;
		console.error(`there is no track called '${name}'. There is: ${known.join(', ')}`);
		return 1;
	}

	const todo = wanted.length > 0 ? wanted : known;
	console.log(`rendering ${todo.length} track${todo.length === 1 ? '' : 's'} into ${path.relative(root, audioDir)}`);

	let failed = 0;
	for (const name of todo) if (!render(name, force)) failed++;

	if (failed > 0) console.error(`${failed} of ${todo.length} did not render`);
	return failed > 0 ? 1 : 0;
}

// Run as a program, and read as a module by `test/audio.test.ts`, which pins
// the one rule here that is inferred rather than written down.
if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { generators, audioDir };
