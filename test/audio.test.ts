/*
 * The audio directory, and the two things about it that are not obvious.
 *
 * `public/assets/audio` holds a track at three stages: the Node program that
 * synthesises it, the `.wav` rendered from that program at full rate, and the
 * `.mp3` encoded from the render. A build publishes the last of those and the
 * catalogue naming it, because `publicDir` copies a directory wholesale and a
 * static host has no use for 30 MB masters or a DSP source file.
 *
 * The encode has to give back exactly the samples that went in. An MP3 holds a
 * whole number of 1152-sample frames and begins with the encoder's own delay,
 * so a stream decodes longer than its input unless a Xing/LAME header states
 * the delay and the trailing padding. Both are about 41 ms of silence at the
 * loop join, in tracks whose oscillators are tuned to a whole number of cycles
 * per loop so that the join is silent.
 */

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { audioSources } from '../vite.assets.mts';
import { encode, encodeWithLame, generators, haveFfmpeg, readWav } from '../tools/build-audio.mjs';

const root = resolve(import.meta.dirname, '..');
const audioDir = resolve(root, 'public', 'assets', 'audio');

/** A build's output directory, and a place to encode into. Both removed after. */
const outDir = resolve(root, 'test', 'scratch-audio-out');

afterAll(async () => {
	await rm(outDir, { recursive: true, force: true });
});

/**
 * Run the plugin's two hooks the way Vite does, over a directory we made.
 *
 * Typed loosely on purpose: `Plugin`'s hooks may each be a function or an
 * object with a `handler`, and asserting the shape here would be asserting
 * something about Vite rather than about this plugin.
 */
async function sweep(): Promise<void> {
	const plugin = audioSources() as unknown as {
		configResolved: (config: { root: string; build: { outDir: string } }) => void;
		closeBundle: () => Promise<void>;
	};
	plugin.configResolved({ root, build: { outDir } });
	await plugin.closeBundle.call(null as never);
}

describe('what a build publishes out of the audio directory', () => {
	it('keeps the encodes and the catalogue, and drops everything else', async () => {
		const dir = join(outDir, 'assets', 'audio');
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, 'town.mp3'), 'not really an encode');
		await writeFile(join(dir, 'index.json'), '{"tracks":[]}');
		// The 30 MB master, which the encode is made from and which nothing loads.
		await writeFile(join(dir, 'town.wav'), 'not really a wave');
		await writeFile(join(dir, 'town.js'), '// the program that renders it');
		await writeFile(join(dir, 'synth.js'), '// the floor underneath it');
		// The working file a generator caches its mix gain in. It is gitignored,
		// so it exists only on the machine that rendered — which is the machine
		// that then runs a build.
		await writeFile(join(dir, '.mixgain-town'), '2.28');

		await sweep();

		expect((await readdir(dir)).sort()).toEqual(['index.json', 'town.mp3']);
	});

	it('says nothing about a build with no audio in it', async () => {
		await rm(outDir, { recursive: true, force: true });
		// Which is every build on a clean checkout: the renders and the encodes
		// are gitignored, so the directory copied there holds only source.
		await expect(sweep()).resolves.toBeUndefined();
	});
});

/*
 * `npm run audio` renders every track and no library, and works that out rather
 * than being told: a `.js` in there that exports something is the floor the
 * tracks stand on, and one that exports nothing is a program that writes a wave
 * and exits.
 *
 * A library mistaken for a track would render nothing and report that it had; a
 * track mistaken for a library would stop being rendered, and the only sign of
 * that is a loop that stays as it was.
 */
describe('which files `npm run audio` renders', () => {
	it('takes the tracks and leaves the libraries alone', async () => {
		const tracks = generators();
		const all = (await readdir(audioDir))
			.filter((name) => name.endsWith('.js'))
			.map((name) => name.slice(0, -'.js'.length))
			.sort();

		expect(tracks).not.toContain('synth');
		expect(tracks).not.toContain('voices');
		expect(tracks.sort()).toEqual(all.filter((name) => name !== 'synth' && name !== 'voices'));
		expect(tracks.length).toBeGreaterThan(0);
	});
});

/*
 * The encode, on a wave short enough to make in memory.
 *
 * Two seconds of a tone, at a length deliberately not a multiple of 1152, so
 * the encoder has to pad the last frame and the header has something to
 * declare. The assertion is on the samples the file says it carries rather than
 * on its bytes, because that is what a decoder gives back and what the loop
 * depends on.
 */
describe('the encoded track', () => {
	/*
	 * Fifteen seconds, at a length deliberately not a multiple of 1152 so the
	 * last frame has to be padded.
	 *
	 * The duration is not arbitrary. Constant-bitrate frames at 128 kbps and
	 * 44.1 kHz work out to 417.9 bytes, so the encoder makes some of them 418
	 * and the stream is about a byte a frame longer than a frame length times
	 * the count. Dividing the two therefore overcounts by one somewhere past
	 * 460 frames, and a shorter tone comes out to the same number either way.
	 */
	const SAMPLES = 44100 * 15 + 137;

	async function toneAt(name: string): Promise<string> {
		await mkdir(outDir, { recursive: true });
		const wav = join(outDir, `${name}.wav`);
		await writeFile(wav, tone(SAMPLES));
		return wav;
	}

	/*
	 * Both encoders, every run.
	 *
	 * The JavaScript one is a dependency of this repository, so it is always
	 * there to be asked; ffmpeg is whatever the machine has. Testing only the
	 * one that happens to be installed would leave whichever path a developer
	 * is not on unexercised, and they have to agree for the fallback to mean
	 * anything.
	 */
	const paths: [string, (wav: string, mp3: string) => Promise<unknown>][] = [
		['lamejs', encodeWithLame],
		...(haveFfmpeg() ? ([['ffmpeg', encode]] as [string, typeof encode][]) : []),
	];

	for (const [who, run] of paths) {
		describe(who, () => {
			it('gives back exactly the samples that went into it', async () => {
				const wav = await toneAt(who);
				const mp3 = join(outDir, `${who}.mp3`);
				await run(wav, mp3);
				const declared = await declaredLength(mp3);

				// The count first. The delay and the padding are derived from it, so
				// they stay consistent with each other while being wrong together,
				// and the arithmetic below balances either way.
				expect(declared.frames, 'the header counts the frames that are there').toBe(
					declared.actualFrames,
				);

				// Frames times 1152 is everything the stream decodes to; taking off
				// the delay at the front and the padding at the back leaves the
				// render, and a decoder that reads the header hands back that.
				expect(declared.frames * 1152 - declared.delay - declared.padding).toBe(SAMPLES);
			});

			it('declares the delay rather than leaving it in the audio', async () => {
				const wav = await toneAt(who);
				const mp3 = join(outDir, `${who}.mp3`);
				await run(wav, mp3);
				const declared = await declaredLength(mp3);

				// Undeclared silence at the head is silence at the loop join.
				expect(declared.delay).toBeGreaterThan(0);
				expect(declared.padding).toBeGreaterThanOrEqual(0);
				expect(declared.padding).toBeLessThanOrEqual(0xfff);
			});
		});
	}

	it('reads back the wave it was given', async () => {
		const read = readWav(await toneAt('read'));
		expect(read.frames).toBe(SAMPLES);
		expect(read.rate).toBe(44100);
		expect(read.left.length).toBe(SAMPLES);
	});
});

interface Declared {
	/** What the header says the stream holds. */
	frames: number;
	delay: number;
	padding: number;
	/** What walking the stream finds, which is the thing it should agree with. */
	actualFrames: number;
}

/**
 * What a stream's Xing header says it holds.
 *
 * The header lives in a frame of its own at the front of the audio, and the
 * extension inside it carries the delay and the padding packed twelve bits
 * each. Read at fixed addresses, which is how a decoder finds them.
 *
 * Two things vary between encoders and neither is asserted. ffmpeg puts an
 * ID3v2 tag before the first frame, so the frame is found rather than assumed
 * at zero. And the nine bytes naming the encoder read `LAME3.100` from lamejs
 * and `Lavc60.31` from ffmpeg, which says who wrote the stream rather than
 * anything about its length.
 */
async function declaredLength(path: string): Promise<Declared> {
	const { readFile } = await import('node:fs/promises');
	const file = await readFile(path);

	let at = 0;
	if (file.toString('latin1', 0, 3) === 'ID3') {
		// A syncsafe length: seven bits of each byte, high bit always clear.
		at = 10 + ((file[6]! << 21) | (file[7]! << 14) | (file[8]! << 7) | file[9]!);
	}
	expect(file[at], 'the first frame starts where the tag ends').toBe(0xff);

	const mono = ((file[at + 3]! >> 6) & 0x03) === 3;
	const xing = at + 4 + (mono ? 17 : 32);
	expect(file.toString('latin1', xing, xing + 4), 'a header frame is there').toBe('Info');

	const lame = xing + 120;
	return {
		frames: file.readUInt32BE(xing + 8),
		delay: (file[lame + 21]! << 4) | (file[lame + 22]! >> 4),
		padding: ((file[lame + 22]! & 0x0f) << 8) | file[lame + 23]!,
		// The header frame itself is not one of them, so the walk starts past it.
		actualFrames: walkFrames(file, at) - 1,
	};
}

/** How many frames a stream holds, by stepping header to header. */
function walkFrames(file: Buffer, from: number): number {
	const RATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
	const SAMPLE_RATES = [44100, 48000, 32000];
	let at = from;
	let count = 0;
	while (at + 4 <= file.length) {
		if (file[at] !== 0xff || (file[at + 1]! & 0xe0) !== 0xe0) break;
		const kbps = RATES[(file[at + 2]! >> 4) & 0x0f]!;
		const rate = SAMPLE_RATES[(file[at + 2]! >> 2) & 0x03]!;
		if (!kbps || !rate) break;
		at += Math.floor((144 * kbps * 1000) / rate) + ((file[at + 2]! >> 1) & 0x01);
		count++;
	}
	return count;
}

/** A 16-bit stereo WAV of a quiet tone, laid out the way `synth.js` writes one. */
function tone(samples: number): Buffer {
	const data = Buffer.alloc(samples * 4);
	for (let n = 0; n < samples; n++) {
		const value = Math.round(Math.sin((n / 44100) * 2 * Math.PI * 220) * 8000);
		data.writeInt16LE(value, n * 4);
		data.writeInt16LE(value, n * 4 + 2);
	}
	const head = Buffer.alloc(44);
	head.write('RIFF', 0);
	head.writeUInt32LE(36 + data.length, 4);
	head.write('WAVE', 8);
	head.write('fmt ', 12);
	head.writeUInt32LE(16, 16);
	head.writeUInt16LE(1, 20);
	head.writeUInt16LE(2, 22);
	head.writeUInt32LE(44100, 24);
	head.writeUInt32LE(44100 * 4, 28);
	head.writeUInt16LE(4, 32);
	head.writeUInt16LE(16, 34);
	head.write('data', 36);
	head.writeUInt32LE(data.length, 40);
	return Buffer.concat([head, data]);
}
