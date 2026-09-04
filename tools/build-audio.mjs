/*
 * tools/build-audio.mjs — render the ambience tracks and encode them for a browser.
 *
 *   npm run audio                    # bring every track up to date
 *   npm run audio -- --force         # render and encode all of them again
 *   npm run audio -- dungeon-crawl   # one track
 *   npm run audio -- --list          # every track, and what is on disk
 *
 * A track is three files in `public/assets/audio`. `<name>.js` synthesises it,
 * `<name>.wav` is the render at full rate, and `<name>.mp3` is what the game
 * loads: a fifteenth of the bytes over the network, in a format every browser
 * decodes.
 *
 * Both products are gitignored, so a fresh clone holds the generators and
 * neither output. A render takes about twenty seconds and writes 20-30 MB; an
 * encode takes a second or two and writes about 2 MB.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const audioDir = join(root, 'public', 'assets', 'audio');

/**
 * Constant bitrate in kbps, for both encoders.
 *
 * 128 holds the drones and the reverb tails without audible swirl, at about
 * 2 MB for a three-minute loop against 30 MB of PCM.
 */
const BITRATE = 128;

/**
 * Which files render a track and which are the floor underneath them.
 *
 * `synth.js` and `voices.js` are read by the tracks and write nothing on their
 * own; every other `.js` here renders one `.wav` and exits. They are told apart
 * by whether the file exports anything, which is the difference itself rather
 * than a list to keep in step.
 */
export function generators() {
	return readdirSync(audioDir)
		.filter((name) => name.endsWith('.js'))
		.filter((name) => !/^\s*module\.exports\b/m.test(readFileSync(join(audioDir, name), 'utf8')))
		.map((name) => name.slice(0, -'.js'.length))
		.sort();
}

/*
 * When each product is out of date.
 *
 * A render is skipped whenever the `.wav` is there, without comparing
 * timestamps. Every track reads `synth.js` and most read `voices.js`, so an
 * older modification time says nothing on its own, and editing either library
 * changes all seven renders at once. `--force` asks for them again.
 *
 * An encode has exactly one input, so a timestamp does answer: an `.mp3` older
 * than the `.wav` beside it is stale.
 */
function wavIsCurrent(wav) {
	return existsSync(wav);
}

function mp3IsCurrent(mp3, wav) {
	return existsSync(mp3) && statSync(mp3).mtimeMs >= statSync(wav).mtimeMs;
}

function render(name) {
	const script = join(audioDir, `${name}.js`);
	const wav = join(audioDir, `${name}.wav`);
	const result = spawnSync(process.execPath, [script, wav], { cwd: root, stdio: 'inherit' });
	if (result.error) throw new Error(`${name} could not run: ${result.error.message}`);
	if (result.status !== 0) throw new Error(`${name} exited ${result.status}`);
}

/*
 * ffmpeg where it is installed, and a JavaScript encoder where it is not.
 *
 * Both write constant-bitrate MP3 at `BITRATE` from the same 16-bit stereo PCM,
 * and lamejs is a port of LAME, which is the encoder ffmpeg reaches for as
 * libmp3lame — so the two paths differ in how long they take rather than in
 * what comes out. ffmpeg is a few hundred milliseconds a track and lamejs is a
 * few seconds.
 */
let ffmpegChecked = null;

export function haveFfmpeg() {
	if (ffmpegChecked === null) {
		const probe = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
		ffmpegChecked = !probe.error && probe.status === 0;
	}
	return ffmpegChecked;
}

export async function encode(wav, mp3) {
	if (haveFfmpeg()) {
		const result = spawnSync(
			'ffmpeg',
			['-v', 'error', '-y', '-i', wav, '-c:a', 'libmp3lame', '-b:a', `${BITRATE}k`, mp3],
			{ stdio: 'inherit' },
		);
		if (result.error || result.status !== 0) {
			throw new Error(`ffmpeg could not encode ${relative(root, wav)}`);
		}
		return 'ffmpeg';
	}
	await encodeWithLame(wav, mp3);
	return 'lamejs';
}

export async function encodeWithLame(wav, mp3) {
	const { Mp3Encoder } = await import('@breezystack/lamejs');
	const { left, right, rate, frames } = readWav(wav);
	const encoder = new Mp3Encoder(2, rate, BITRATE);

	// A whole number of MP3 frames a call, so no frame straddles two blocks.
	const BLOCK = SAMPLES_PER_FRAME * 50;
	const parts = [];
	for (let at = 0; at < left.length; at += BLOCK) {
		const block = encoder.encodeBuffer(left.subarray(at, at + BLOCK), right.subarray(at, at + BLOCK));
		if (block.length > 0) parts.push(Buffer.from(block));
	}
	const end = encoder.flush();
	if (end.length > 0) parts.push(Buffer.from(end));

	const audio = Buffer.concat(parts);
	writeFileSync(mp3, Buffer.concat([gaplessHeader(audio, frames), audio]));
}

/**
 * How many samples LAME holds back before the first one comes out.
 *
 * A decoder skips this plus its own 529, and both numbers are fixed by the
 * format rather than by the track, so the padding at the end is whatever is
 * left over once they are accounted for.
 */
const ENCODER_DELAY = 576;

const SAMPLES_PER_FRAME = 1152;

/**
 * A Xing/LAME header frame describing how much of the stream is not the track.
 *
 * An MP3 holds a whole number of 1152-sample frames and starts with the
 * encoder's own delay, so a stream decodes longer than the audio that went into
 * it. This frame states the delay and the trailing padding, and a decoder that
 * reads it hands back exactly the samples that were encoded — which is what
 * makes the loop join where the generator tuned it to.
 *
 * The layout is the one every decoder expects and is addressed from the start
 * of the frame: side information, then `Info` and the Xing fields, then the
 * LAME extension at 0x9C with the delay and the padding packed twelve bits
 * each. All four Xing fields are written, present or not, because their sizes
 * are what put the LAME extension at that address.
 */
function gaplessHeader(audio, frames) {
	// The stream's own first header carries its rate, channels and bitrate, so
	// the tag frame is built from it rather than from assumptions about them.
	const header = audio.subarray(0, 4);
	const mono = ((header[3] >> 6) & 0x03) === 3;
	const sideInfo = mono ? 17 : 32;
	const length = frameBytes(header);

	const frame = Buffer.alloc(length, 0);
	header.copy(frame, 0);

	const xing = 4 + sideInfo;
	frame.write('Info', xing, 'latin1'); // `Info` is the constant-bitrate spelling.
	frame.writeUInt32BE(0x000f, xing + 4); // Frame count, byte count, table, quality.
	const count = countFrames(audio);
	frame.writeUInt32BE(count, xing + 8);
	frame.writeUInt32BE(audio.length + length, xing + 12);
	// A seek table, linear because the bitrate is constant.
	for (let i = 0; i < 100; i++) frame[xing + 16 + i] = Math.floor((i * 255) / 100);
	frame.writeUInt32BE(0, xing + 116);

	const padding = count * SAMPLES_PER_FRAME - frames - ENCODER_DELAY;
	if (padding < 0 || padding > 0xfff) {
		throw new Error(`the padding to declare is ${padding}, which will not fit the header`);
	}

	const lame = xing + 120;
	frame.write('LAME3.100', lame, 'latin1');
	frame[lame + 20] = Math.min(BITRATE, 255);
	frame[lame + 21] = ENCODER_DELAY >> 4;
	frame[lame + 22] = ((ENCODER_DELAY & 0x0f) << 4) | ((padding >> 8) & 0x0f);
	frame[lame + 23] = padding & 0xff;
	frame.writeUInt32BE(audio.length + length, lame + 28);

	return frame;
}

/**
 * How many frames a stream holds, by walking it.
 *
 * Constant-bitrate frames are not all one length: 128 kbps at 44.1 kHz works
 * out to 417.9 bytes, so the encoder sets the padding bit on some frames to
 * make 418 and the average come out right. Dividing the stream by a frame
 * length therefore overcounts, and the count is what the declared padding is
 * derived from.
 */
function countFrames(audio) {
	let at = 0;
	let count = 0;
	while (at + 4 <= audio.length) {
		if (audio[at] !== 0xff || (audio[at + 1] & 0xe0) !== 0xe0) break; // Not a frame.
		at += frameBytes(audio.subarray(at, at + 4));
		count++;
	}
	return count;
}

/** The byte length of one frame, off its header. MPEG-1 Layer III only. */
function frameBytes(header) {
	const RATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
	const SAMPLE_RATES = [44100, 48000, 32000];
	const kbps = RATES[(header[2] >> 4) & 0x0f];
	const rate = SAMPLE_RATES[(header[2] >> 2) & 0x03];
	const pad = (header[2] >> 1) & 0x01;
	if (!kbps || !rate) throw new Error('the encoder produced a frame this cannot describe');
	return Math.floor((144 * kbps * 1000) / rate) + pad;
}

/**
 * The samples out of a WAV, as one Int16Array a channel.
 *
 * Narrow on purpose: it reads 16-bit stereo PCM, which is what `synth.js`
 * writes, and names anything else rather than decoding it into noise. Chunks
 * are walked rather than assumed at fixed offsets, so a file that carries a
 * `LIST` before its `data` still reads.
 */
export function readWav(path) {
	const file = readFileSync(path);
	if (file.length < 12 || file.toString('latin1', 0, 4) !== 'RIFF') {
		throw new Error(`${relative(root, path)} is not a RIFF file`);
	}
	if (file.toString('latin1', 8, 12) !== 'WAVE') {
		throw new Error(`${relative(root, path)} is RIFF but not WAVE`);
	}

	let format = null;
	let data = null;
	for (let at = 12; at + 8 <= file.length; ) {
		const id = file.toString('latin1', at, at + 4);
		const size = file.readUInt32LE(at + 4);
		const body = at + 8;
		if (id === 'fmt ') {
			format = {
				encoding: file.readUInt16LE(body),
				channels: file.readUInt16LE(body + 2),
				rate: file.readUInt32LE(body + 4),
				bits: file.readUInt16LE(body + 14),
			};
		} else if (id === 'data') {
			data = file.subarray(body, Math.min(body + size, file.length));
		}
		at = body + size + (size % 2); // Chunks are padded to an even length.
	}

	if (!format || !data) throw new Error(`${relative(root, path)} has no fmt or no data chunk`);
	if (format.encoding !== 1 || format.channels !== 2 || format.bits !== 16) {
		throw new Error(
			`${relative(root, path)} is ${format.channels}ch ${format.bits}-bit encoding ` +
				`${format.encoding}; this reads 16-bit stereo PCM`,
		);
	}

	const frames = Math.floor(data.length / 4);
	const left = new Int16Array(frames);
	const right = new Int16Array(frames);
	for (let n = 0; n < frames; n++) {
		left[n] = data.readInt16LE(n * 4);
		right[n] = data.readInt16LE(n * 4 + 2);
	}
	return { left, right, rate: format.rate, frames };
}

/** What a player reads to find the tracks and loop them exactly. */
const MANIFEST = 'index.json';

/**
 * The catalogue of encoded tracks, for whatever loads them.
 *
 * A player reads this rather than the directory, so the names of the tracks are
 * data instead of a list written twice. `frames` is the length of the render
 * that produced each file, in samples, which is also what a decode of it should
 * come back as — an MP3 that decodes longer has picked up the encoder's delay
 * and its frame padding, and its loop carries about 41 ms of silence.
 *
 * Tracks that have been encoded but not this run keep their entries, so asking
 * for one track does not empty the catalogue of the other six.
 */
function writeManifest() {
	const path = join(audioDir, MANIFEST);
	const before = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).tracks ?? [] : [];
	const tracks = new Map(before.map((one) => [one.name, one]));

	for (const name of generators()) {
		const mp3 = join(audioDir, `${name}.mp3`);
		const wav = join(audioDir, `${name}.wav`);
		if (!existsSync(mp3)) {
			tracks.delete(name);
			continue;
		}
		if (!existsSync(wav)) continue; // Keep what is known; the length is not.
		const { rate, frames } = readWav(wav);
		tracks.set(name, {
			name,
			file: `${name}.mp3`,
			rate,
			frames,
			seconds: Number((frames / rate).toFixed(3)),
			bytes: statSync(mp3).size,
		});
	}

	const list = [...tracks.values()].sort((a, b) => a.name.localeCompare(b.name));
	writeFileSync(path, `${JSON.stringify({ tracks: list }, null, '\t')}\n`);
	return list.length;
}

const megabytes = (path) => (statSync(path).size / 1048576).toFixed(1);

async function bring(name, force) {
	const wav = join(audioDir, `${name}.wav`);
	const mp3 = join(audioDir, `${name}.mp3`);
	let did = false;

	if (force || !wavIsCurrent(wav)) {
		const started = Date.now();
		render(name);
		console.log(`${name}  rendered  ${megabytes(wav)} MB  ${sinceSeconds(started)}s`);
		did = true;
	}

	if (force || !mp3IsCurrent(mp3, wav)) {
		const started = Date.now();
		const by = await encode(wav, mp3);
		console.log(`${name}  encoded   ${megabytes(mp3)} MB  ${sinceSeconds(started)}s  (${by})`);
		did = true;
	}

	if (!did) console.log(`${name}  up to date`);
}

const sinceSeconds = (from) => ((Date.now() - from) / 1000).toFixed(1);

async function main(argv) {
	const force = argv.includes('--force');
	const wanted = argv.filter((one) => !one.startsWith('--')).map((one) => one.replace(/\.\w+$/, ''));
	const known = generators();

	if (argv.includes('--list')) {
		for (const name of known) {
			const has = (extension) => (existsSync(join(audioDir, `${name}.${extension}`)) ? extension : '—');
			console.log(`${name.padEnd(20)} ${has('wav').padEnd(5)} ${has('mp3')}`);
		}
		return 0;
	}

	// A name that is not a track is a typo, and one that rendered nothing and
	// said nothing would read as a track that was already up to date.
	for (const name of wanted) {
		if (known.includes(name)) continue;
		console.error(`there is no track called '${name}'. There is: ${known.join(', ')}`);
		return 1;
	}

	const todo = wanted.length > 0 ? wanted : known;
	if (!haveFfmpeg()) {
		console.log('ffmpeg is not on PATH, so encoding runs in JavaScript and takes longer');
	}

	let failed = 0;
	for (const name of todo) {
		try {
			await bring(name, force);
		} catch (error) {
			console.error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
			failed++;
		}
	}

	const listed = writeManifest();
	console.log(`${MANIFEST} lists ${listed} track${listed === 1 ? '' : 's'}`);

	if (failed > 0) console.error(`${failed} of ${todo.length} did not finish`);
	return failed > 0 ? 1 : 0;
}

// Run as a program; the exports above are read by the tests.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exitCode = await main(process.argv.slice(2));
}
