/*
 * Particles: the shape of an effect, the running of one, and the file it is
 * written in.
 *
 * Four things are worth pinning, and they are the four that fail quietly.
 *
 *   the pool      a capacity is a CEILING. A system asked for more than it can
 *                 hold drops the surplus rather than growing, and a death is a
 *                 swap with the last live particle — an off-by-one there loses
 *                 a live particle or resurrects a dead one, and neither shows
 *                 up as anything but a slightly wrong picture.
 *   the clock     a rate is particles a SECOND, not particles a frame. A count
 *                 rounded per frame makes an effect a function of the frame
 *                 rate, which is invisible at sixty and obvious at fifteen.
 *   the curves    a value between two stops, held before the first and after
 *                 the last. Extrapolating past the end sends a size negative,
 *                 and a negative prism is inside out.
 *   the round     an effect written back and read again is the same effect. A
 *                 bench that saves is only trustworthy while that holds, and
 *                 it holds by nobody forgetting to write a field they added.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
	defaultEffect,
	GameObject,
	HexInstances,
	instantiate,
	Particles,
	ParticleSystem,
	readParticleEffect,
	registerSceneComponents,
	sampleCurve,
	sampleGradient,
	Scene,
	writeParticleEffect,
	AssetLibrary,
	ComponentRegistry,
	readOnly,
	readEntity,
	type ParticleEffect,
} from '@hexdelve/engine';
import { makeRandom, rgbFromHex } from '@hexdelve/shared';

import { ASSET_ROOT, diskIO } from './harness/assets.js';

/** An effect built from the default with a few fields replaced. */
function effectOf(changes: Partial<ParticleEffect>): ParticleEffect {
	return { ...defaultEffect('test'), ...changes };
}

/** A one-shot: a burst of `count`, nothing after it, particles living a second. */
function burstEffect(count: number, capacity = 64): ParticleEffect {
	const base = defaultEffect('burst');
	return {
		...base,
		capacity,
		duration: 0.05,
		loop: false,
		emit: { ...base.emit, rate: { mean: 0, variance: 0 }, burst: { mean: count, variance: 0 } },
		particle: { ...base.particle, life: { mean: 1, variance: 0 } },
	};
}

describe('the pool', () => {
	it('throws the burst it was asked for', () => {
		const system = new ParticleSystem(burstEffect(12));
		expect(system.count).toBe(12);
	});

	it('drops what will not fit rather than growing past the capacity', () => {
		const system = new ParticleSystem(burstEffect(40, 10));
		expect(system.count).toBe(10);
		expect(system.capacity).toBe(10);
	});

	it('takes back exactly the particles whose life ran out', () => {
		// Lives spread over a second, so they die at different moments and the
		// swap-with-the-last is exercised from the middle of the array rather
		// than only off the end.
		const base = burstEffect(20);
		const system = new ParticleSystem({
			...base,
			particle: { ...base.particle, life: { mean: 0.6, variance: 0.4 } },
		});

		expect(system.count).toBe(20);
		for (let i = 0; i < 12; i++) system.update(1 / 30);
		// 0.4 s in: everything born under 0.4 s is gone, everything over is not.
		expect(system.count).toBeGreaterThan(0);
		expect(system.count).toBeLessThan(20);

		for (let i = 0; i < 30; i++) system.update(1 / 30);
		expect(system.count).toBe(0);
	});

	it('is finished once it has stopped emitting and the last one has gone', () => {
		const system = new ParticleSystem(burstEffect(6));
		expect(system.finished).toBe(false);
		for (let i = 0; i < 70; i++) system.update(1 / 60);
		expect(system.finished).toBe(true);
	});

	it('never finishes while it loops, which is what a chimney is', () => {
		const system = new ParticleSystem(defaultEffect('endless'));
		for (let i = 0; i < 200; i++) system.update(1 / 60);
		expect(system.finished).toBe(false);
		expect(system.count).toBeGreaterThan(0);
	});
});

describe('the clock', () => {
	/** How many are alive after a second, stepped at this frame rate. */
	function afterOneSecond(steps: number): number {
		const base = defaultEffect('rate');
		const system = new ParticleSystem({
			...base,
			capacity: 512,
			emit: { ...base.emit, rate: { mean: 30, variance: 0 } },
			// Longer than the run, so nothing dies and the count is the tally.
			particle: { ...base.particle, life: { mean: 10, variance: 0 } },
		});
		for (let i = 0; i < steps; i++) system.update(1 / steps);
		return system.count;
	}

	it('emits at a rate a second, whatever the frame rate is', () => {
		// Thirty a second, within the one particle the accumulator may be
		// holding when the second ends.
		expect(afterOneSecond(60)).toBeGreaterThanOrEqual(29);
		expect(afterOneSecond(60)).toBeLessThanOrEqual(31);
		expect(afterOneSecond(15)).toBeGreaterThanOrEqual(29);
		expect(afterOneSecond(15)).toBeLessThanOrEqual(31);
	});

	it('re-issues the burst on each loop, once however long the frame was', () => {
		const base = defaultEffect('looping');
		const effect: ParticleEffect = {
			...base,
			capacity: 256,
			duration: 0.1,
			loop: true,
			emit: { ...base.emit, rate: { mean: 0, variance: 0 }, burst: { mean: 5, variance: 0 } },
			particle: { ...base.particle, life: { mean: 100, variance: 0 } },
		};

		const system = new ParticleSystem(effect);
		expect(system.count).toBe(5);
		// One frame six durations long. A hitch must not fire six bursts.
		system.update(0.6);
		expect(system.count).toBe(10);
	});

	it('prewarms a continuous effect and leaves a one-shot alone', () => {
		const base = defaultEffect('warm');
		const continuous = new ParticleSystem({
			...base,
			prewarm: true,
			emit: { ...base.emit, rate: { mean: 20, variance: 0 } },
			particle: { ...base.particle, life: { mean: 1, variance: 0 } },
		});
		// A full lifetime's worth, before a single frame has been stepped.
		expect(continuous.count).toBeGreaterThan(10);

		const oneShot = new ParticleSystem({ ...burstEffect(6), prewarm: true });
		expect(oneShot.count).toBe(6);
	});
});

describe('curves', () => {
	it('holds before the first stop and after the last, rather than running on', () => {
		const curve = [
			{ at: 0.25, value: 2 },
			{ at: 0.75, value: 6 },
		];
		expect(sampleCurve(curve, 0)).toBe(2);
		expect(sampleCurve(curve, 0.25)).toBe(2);
		expect(sampleCurve(curve, 0.5)).toBe(4);
		expect(sampleCurve(curve, 0.75)).toBe(6);
		expect(sampleCurve(curve, 1)).toBe(6);
	});

	it('is one value everywhere when it has one stop', () => {
		expect(sampleCurve([{ at: 0.4, value: 3 }], 0)).toBe(3);
		expect(sampleCurve([{ at: 0.4, value: 3 }], 1)).toBe(3);
	});

	it('mixes a gradient into the caller’s own colour', () => {
		const gradient = [
			{ at: 0, color: rgbFromHex(0x000000) },
			{ at: 1, color: rgbFromHex(0xffffff) },
		];
		const out = { r: 0, g: 0, b: 0 };
		expect(sampleGradient(gradient, 0.5, out).r).toBeCloseTo(0.5, 5);
		// The same object back, because this runs once per particle per frame.
		expect(sampleGradient(gradient, 1, out)).toBe(out);
		expect(out.r).toBe(1);
	});
});

describe('drawing', () => {
	it('writes one prism per live particle', () => {
		const system = new ParticleSystem(burstEffect(9));
		const out = new HexInstances(64);
		system.emit(out);
		expect(out.count).toBe(9);
	});

	it('skips a particle whose alpha has reached zero', () => {
		const base = burstEffect(9);
		const system = new ParticleSystem({
			...base,
			alpha: { curve: [{ at: 0, value: 0 }], variance: 0 },
		});
		const out = new HexInstances(64);
		system.emit(out);
		expect(system.count).toBe(9);
		expect(out.count).toBe(0);
	});

	it('is the same run twice, so a picture of an effect is of the effect', () => {
		const positions = (): number[] => {
			const system = new ParticleSystem(burstEffect(8), { random: makeRandom(11) });
			for (let i = 0; i < 6; i++) system.update(1 / 60);
			const out = new HexInstances(32);
			system.emit(out);
			return [...out.data];
		};
		expect(positions()).toEqual(positions());
	});

	it('carries a world-space particle out to where the emitter is, once', () => {
		const base = burstEffect(4);
		const effect: ParticleEffect = {
			...base,
			motion: { ...base.motion, space: 'world' },
			particle: { ...base.particle, speed: { mean: 0, variance: 0 } },
		};

		const system = new ParticleSystem(effect, { autoPlay: false });
		system.moveTo({ position: [5, 2, -3], rotation: new Float32Array([0, 0, 0, 1]) as never });
		system.play();

		const out = new HexInstances(16);
		system.emit(out);
		expect(out.data[0]).toBeCloseTo(5, 5);
		expect(out.data[1]).toBeCloseTo(2, 5);
		expect(out.data[2]).toBeCloseTo(-3, 5);

		// Moving the emitter afterwards leaves them where they were: that is the
		// whole of what makes an emitter draw a trail rather than drag a plume.
		system.moveTo({ position: [0, 0, 0], rotation: new Float32Array([0, 0, 0, 1]) as never });
		out.clear();
		system.emit(out);
		expect(out.data[0]).toBeCloseTo(5, 5);
	});

	it('carries a local-space particle at draw time, so the plume travels', () => {
		const base = burstEffect(4);
		const effect: ParticleEffect = {
			...base,
			motion: { ...base.motion, space: 'local' },
			particle: { ...base.particle, speed: { mean: 0, variance: 0 } },
		};

		const system = new ParticleSystem(effect);
		system.moveTo({ position: [5, 2, -3], rotation: new Float32Array([0, 0, 0, 1]) as never });

		const out = new HexInstances(16);
		system.emit(out);
		expect(out.data[0]).toBeCloseTo(5, 5);

		system.moveTo({ position: [1, 0, 0], rotation: new Float32Array([0, 0, 0, 1]) as never });
		out.clear();
		system.emit(out);
		expect(out.data[0]).toBeCloseTo(1, 5);
	});
});

describe('the component', () => {
	it('starts where its object is, not at the world origin', () => {
		const scene = new Scene();
		const object = scene.spawn('emitter');
		object.transform.setPosition(2, 1, 4);
		object.attachComponent(new Particles(object, burstEffect(5)));

		// The scene solves after every component has updated, so the first
		// update is the first frame at which the object knows where it is.
		scene.update(1 / 60);

		const out = new HexInstances(32);
		object.getComponent(Particles)!.emit(out);
		expect(out.count).toBe(5);
		expect(out.data[0]).toBeCloseTo(2, 1);
		expect(out.data[2]).toBeCloseTo(4, 1);
	});

	it('leaves the scene when a one-shot is over, if it was asked to', () => {
		const scene = new Scene();
		const object = scene.spawn('burst');
		object.attachComponent(new Particles(object, burstEffect(4)), { autoDestroy: true });

		for (let i = 0; i < 80 && !object.isDestroyed; i++) scene.update(1 / 60);
		expect(object.isDestroyed).toBe(true);
		expect(scene.root.children).toHaveLength(0);
	});

	it('stays while it loops, however long it is left running', () => {
		const scene = new Scene();
		const object = scene.spawn('chimney');
		object.attachComponent(new Particles(object, defaultEffect('endless')), { autoDestroy: true });

		for (let i = 0; i < 200; i++) scene.update(1 / 60);
		expect(object.isDestroyed).toBe(false);
	});

	it('stops producing when `playing` is cleared, and lets the live ones fade', () => {
		const scene = new Scene();
		const object = scene.spawn('chimney');
		const emitter = object.attachComponent(new Particles(object, defaultEffect('endless')));

		for (let i = 0; i < 60; i++) scene.update(1 / 60);
		const alive = emitter.system.count;
		expect(alive).toBeGreaterThan(0);

		emitter.playing = false;
		scene.update(1 / 60);
		expect(emitter.system.running).toBe(false);
		for (let i = 0; i < 200; i++) scene.update(1 / 60);
		expect(emitter.system.count).toBe(0);
	});
});

describe('the file', () => {
	const path = resolve(ASSET_ROOT, 'particles');

	it('reads the effects the yard uses', async () => {
		for (const id of ['smoke', 'blood']) {
			const file = `${id}.particles.yaml`;
			const effect = readParticleEffect(await readFile(resolve(path, file), 'utf8'), file);
			expect(effect.id).toBe(id);
			expect(effect.size.curve.length).toBeGreaterThan(0);
			expect(effect.color.curve.length).toBeGreaterThan(0);
		}
	});

	it('is the same effect after a rewrite, field for field', async () => {
		for (const id of ['smoke', 'blood']) {
			const file = `${id}.particles.yaml`;
			const effect = readParticleEffect(await readFile(resolve(path, file), 'utf8'), file);
			expect(readParticleEffect(writeParticleEffect(effect), 'rewritten')).toEqual(effect);
		}
	});

	it('writes a colour as the hexadecimal every other file in the tree uses', () => {
		const text = writeParticleEffect({
			...defaultEffect('hue'),
			color: { curve: [{ at: 0, color: rgbFromHex(0xd8d4cc) }], variance: 0 },
		});
		expect(text).toContain('value: 0xd8d4cc');
	});

	it('falls back field by field, so a file may say only what it changes', () => {
		const effect = readParticleEffect('id: sparks\nemit: { rate: 40 }\n', 'sparks.particles.yaml');
		const fallback = defaultEffect('sparks');
		expect(effect.emit.rate.mean).toBe(40);
		expect(effect.particle.life).toEqual(fallback.particle.life);
		expect(effect.size.curve).toEqual(fallback.size.curve);
	});

	it('sorts a curve rather than reading it in the order it was typed', () => {
		const effect = readParticleEffect(
			'id: s\nalpha: { curve: [{ at: 1, value: 0 }, { at: 0, value: 1 }] }\n',
			's.particles.yaml',
		);
		expect(effect.alpha.curve.map((stop) => stop.at)).toEqual([0, 1]);
	});

	it('refuses a stop outside the life it is read over', () => {
		expect(() =>
			readParticleEffect('id: s\nsize: { curve: [{ at: 5, value: 1 }] }\n', 's.particles.yaml'),
		).toThrow(/between 0 and 1/);
	});

	it('refuses a key nobody reads, since a typo is otherwise silent', () => {
		expect(() => readParticleEffect('id: s\nlooping: true\n', 's.particles.yaml')).toThrow(
			/unknown key/,
		);
	});
});

describe('the manifest and the prefab', () => {
	it('lists the effects, and reads each of them', async () => {
		const library = new AssetLibrary(readOnly(diskIO(ASSET_ROOT)));
		const effects = await library.effectIndex();
		expect(effects.map((one) => one.id)).toEqual(['smoke', 'blood']);
	});

	it('builds an emitter from a `particles` record in a prefab', async () => {
		const library = new AssetLibrary(readOnly(diskIO(ASSET_ROOT)));
		const file = 'entities/torch.entity.yaml';
		// Written here rather than kept in the tree: nothing in the game carries
		// a particles component yet, and what is being checked is the component
		// FACTORY rather than any particular entity.
		const document = readEntity(
			[
				'id: torch',
				'object:',
				'  name: torch',
				'  components:',
				'    - { type: particles, effect: ../particles/smoke.particles.yaml, autoDestroy: true }',
				'',
			].join('\n'),
			file,
		);

		// The library binds a record's files while it loads an entity; here the
		// one record is bound by hand, which is what that binding amounts to.
		const effect = await library.effect('particles/smoke.particles.yaml');
		const bound = {
			...document.prefab,
			components: document.prefab.components.map((spec) => ({
				...spec,
				assets: { ...spec.assets, effect },
			})),
		};

		const scene = new Scene();
		const registry = registerSceneComponents(new ComponentRegistry());
		const object = instantiate(bound, scene, registry, { file });

		const emitter = object.getComponent(Particles);
		expect(emitter).not.toBeNull();
		expect(emitter!.effect.id).toBe('smoke');
		expect(emitter!.autoDestroy).toBe(true);
	});

	it('says what a build has when a prefab names a type it does not', () => {
		const registry = registerSceneComponents(new ComponentRegistry());
		expect(registry.types).toContain('particles');
	});
});

describe('an emitter on an object', () => {
	it('is found by a walk of the scene, wherever it hangs', () => {
		const scene = new Scene();
		const roof = scene.spawn('roof');
		const chimney = scene.spawn('chimney', roof);
		chimney.attachComponent(new Particles(chimney, defaultEffect('smoke')));

		expect(scene.getComponents(Particles)).toHaveLength(1);
		expect(new GameObject('loose').getComponents(Particles)).toHaveLength(0);
	});

	it('gives two emitters on one effect their own randomness', () => {
		const scene = new Scene();
		const effect = effectOf({ capacity: 64 });
		const one = scene.spawn('one');
		const two = scene.spawn('two');
		one.transform.setPosition(0, 0, 0);
		two.transform.setPosition(0, 0, 0);
		one.attachComponent(new Particles(one, effect));
		two.attachComponent(new Particles(two, effect));

		for (let i = 0; i < 40; i++) scene.update(1 / 60);

		const first = new HexInstances(128);
		const second = new HexInstances(128);
		one.getComponent(Particles)!.emit(first);
		two.getComponent(Particles)!.emit(second);
		expect([...first.data]).not.toEqual([...second.data]);
	});
});
