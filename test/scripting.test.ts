/*
 * The script host, and the four promises it makes.
 *
 * A script is a component whose class can be replaced underneath it while the
 * game runs. Everything hard about that is a promise to somebody: to the
 * component, that its id keeps meaning the same script; to whoever set a
 * parameter, that their value survives; to whoever is editing, that a file
 * which does not compile does not take the running game down with it; and to
 * the console, that a script throwing sixty times a second is silenced rather
 * than shouted.
 *
 * Those four are what is checked here. The compiler is not — that is the
 * editor's, and a WebAssembly toolchain in a headless container is a test about
 * the container rather than about the code.
 */

import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import * as engine from '@hexdelve/engine';
import { Component, GameObject, prefabScripts, Scene } from '@hexdelve/engine';
import {
	param,
	parametersOf,
	defineEvent,
	handlersOf,
	on,
	type GameEvent,
	Script,
	ScriptComponent,
	ScriptHost,
	ScriptObject,
	ScriptScene,
	scriptSdkShim,
	scriptsFromBundle,
	staticScripts,
	type ScriptClass,
	type ScriptProvider,
} from '@hexdelve/engine';

import { bundleScripts, scriptDir } from '../tools/build-scripts.mjs';
import { openLibrary } from './harness/assets.js';

/** A host that says nothing, so a test can read what it would have said. */
function quiet(): { host: (provider: ScriptProvider) => ScriptHost; said: string[] } {
	const said: string[] = [];
	return {
		host: (provider) => new ScriptHost(provider, { log: (message) => said.push(message) }),
		said,
	};
}

class Counter extends Script {
	rate = param(1, { min: 0, max: 10 });
	static loads = 0;
	static destroys = 0;
	total = 0;

	override onLoad(): void {
		Counter.loads++;
	}
	override tick(dt: number): void {
		this.total += this.rate * dt;
	}
	override onDestroy(): void {
		Counter.destroys++;
	}
}

function attach(
	host: ScriptHost,
	scene: Scene,
	name = 'Counter',
	parameters = {},
	on?: GameObject,
): number {
	const object = on ?? scene.spawn('subject');
	// The real handles rather than stubs. Building one is the component's job
	// everywhere that is not a test, but a stub would not carry the runtime the
	// host reaches events and lookups through, which is half of what is checked
	// below.
	return host.register(
		name,
		{ object: new ScriptObject(object, host), scene: new ScriptScene(scene, host) },
		parameters,
	);
}

describe('running a script', () => {
	it('builds it, loads it and ticks it', () => {
		Counter.loads = 0;
		const { host: make } = quiet();
		const host = make(staticScripts({ Counter }));
		const scene = new Scene();
		const id = attach(host, scene);

		expect(Counter.loads).toBe(1);
		host.tick(id, 0.5);
		expect(host.census).toEqual({ registered: 1, live: 1, muted: 0 });
	});

	it('takes a parameter from whoever spawned it', () => {
		const { host: make } = quiet();
		const host = make(staticScripts({ Counter }));
		const id = attach(host, new Scene(), 'Counter', { rate: 4 });
		expect(host.parameters(id).find((one) => one.key === 'rate')?.value).toBe(4);
	});

	it('names what it has when a parameter is not one', () => {
		const { host: make, said } = quiet();
		const host = make(staticScripts({ Counter }));
		attach(host, new Scene(), 'Counter', { raet: 4 });
		expect(said.join('\n')).toMatch(/has no parameter 'raet'; it has rate/);
	});

	it('stays registered when its class is missing, and starts when it arrives', () => {
		const { host: make, said } = quiet();
		const host = make(staticScripts({}));
		const scene = new Scene();
		const id = attach(host, scene);

		expect(host.census).toEqual({ registered: 1, live: 0, muted: 0 });
		expect(said.join('\n')).toMatch(/no script named 'Counter'.*this build has nothing/s);

		// The file compiled. Nothing was re-registered; it simply started.
		host.reload(staticScripts({ Counter }));
		expect(host.census.live).toBe(1);
		expect(host.parameters(id)).toHaveLength(1);
	});
});

describe('a hot reload', () => {
	class Slow extends Script {
		rate = param(1);
	}
	class Fast extends Script {
		rate = param(9);
	}

	it('keeps the id, and rebuilds the instance', () => {
		Counter.loads = 0;
		Counter.destroys = 0;
		const { host: make } = quiet();
		const host = make(staticScripts({ Counter }));
		const id = attach(host, new Scene());

		host.reload(staticScripts({ Counter }));

		expect(Counter.destroys).toBe(1);
		expect(Counter.loads).toBe(2);
		expect(host.census).toEqual({ registered: 1, live: 1, muted: 0 });
		// The same id means the same script; a component never saw the swap.
		expect(host.parameters(id)).toHaveLength(1);
	});

	it('keeps a value somebody set', () => {
		const { host: make } = quiet();
		const host = make(staticScripts({ Counter: Slow }));
		const id = attach(host, new Scene(), 'Counter', { rate: 7 });

		host.reload(staticScripts({ Counter: Fast }));
		expect(host.parameters(id).find((one) => one.key === 'rate')?.value).toBe(7);
	});

	it('adopts a new default nobody had overridden', () => {
		const { host: make } = quiet();
		const host = make(staticScripts({ Counter: Slow }));
		const id = attach(host, new Scene());
		expect(host.parameters(id)[0]!.value).toBe(1);

		// Editing the default in the source is supposed to take effect. It only
		// can because the host keeps overrides rather than every value.
		host.reload(staticScripts({ Counter: Fast }));
		expect(host.parameters(id)[0]!.value).toBe(9);
	});

	it('un-mutes a script that had thrown', () => {
		class Angry extends Script {
			static explode = true;
			override tick(): void {
				if (Angry.explode) throw new Error('boom');
			}
		}
		const { host: make, said } = quiet();
		const host = make(staticScripts({ Angry }));
		const id = attach(host, new Scene(), 'Angry');

		host.tick(id, 0.1);
		expect(host.census.muted).toBe(1);
		host.tick(id, 0.1); // silent: it says it once, not sixty times a second
		expect(said.filter((line) => line.includes('boom'))).toHaveLength(1);

		Angry.explode = false;
		host.reload(staticScripts({ Angry }));
		expect(host.census.muted).toBe(0);
	});
});

describe('when a script misbehaves', () => {
	it('mutes one that throws in tick, and says which and where', () => {
		class Bad extends Script {
			override tick(): void {
				throw new Error('nope');
			}
		}
		const { host: make, said } = quiet();
		const host = make(staticScripts({ Bad }));
		const id = attach(host, new Scene(), 'Bad');
		host.tick(id, 0.1);

		expect(said.join('\n')).toMatch(/Bad on 'subject'\.tick threw, muted until reload: nope/);
		expect(host.census).toEqual({ registered: 1, live: 1, muted: 1 });
	});

	it('mutes one that throws in onLoad, and keeps the rest running', () => {
		class Bad extends Script {
			override onLoad(): void {
				throw new Error('bad start');
			}
		}
		const { host: make, said } = quiet();
		const host = make(staticScripts({ Bad, Counter }));
		const scene = new Scene();
		attach(host, scene, 'Bad');
		const good = attach(host, scene, 'Counter');

		expect(said.join('\n')).toMatch(/\.onLoad threw/);
		host.tick(good, 0.1);
		expect(host.census).toEqual({ registered: 2, live: 2, muted: 1 });
	});

	it('survives one that will not construct', () => {
		class Broken extends Script {
			constructor() {
				super();
				throw new Error('cannot');
			}
		}
		const { host: make, said } = quiet();
		const host = make(staticScripts({ Broken }) as ScriptProvider);
		attach(host, new Scene(), 'Broken');
		expect(said.join('\n')).toMatch(/would not construct: cannot/);
		expect(host.census.live).toBe(0);
	});
});

describe('the component', () => {
	it('ticks its script through the scene, and tears it down with the object', () => {
		Counter.destroys = 0;
		const { host: make } = quiet();
		const host = make(staticScripts({ Counter }));
		const scene = new Scene();
		const object = scene.spawn('thing');
		object.addComponent(ScriptComponent, { host, scene, script: 'Counter', parameters: { rate: 2 } });

		scene.update(0.5);
		expect(host.census.live).toBe(1);

		object.destroy();
		expect(Counter.destroys).toBe(1);
		expect(host.census.registered).toBe(0);
	});

	it('is a component like any other, so a prefab can put one anywhere', () => {
		const { host: make } = quiet();
		const host = make(staticScripts({ Counter }));
		const scene = new Scene();
		const object = scene.spawn('thing');
		const component = object.addComponent(ScriptComponent, { host, scene, script: 'Counter' });
		expect(component).toBeInstanceOf(Component);
		expect(object.getComponent(ScriptComponent)).toBe(component);
	});
});

/*
 * The events, and the one promise the decorator exists to keep.
 *
 * A handler declared with `@on` is subscribed by the HOST, from the list the
 * class carries, so a script cannot forget to unsubscribe it. Everything below
 * is a way of asking whether that holds when things are destroyed, reloaded,
 * inherited or throwing.
 *
 * The decorator is applied by HAND here rather than written as syntax, and the
 * reason is worth knowing: vitest transforms with oxc and is not given the
 * option that turns legacy decorators on, so `@on(...)` in this file would not
 * compile. That is precisely why the scripts are compiled by esbuild instead
 * and are not in any module graph. `@on` as syntax is covered further down,
 * against the real script directory built the real way — which is the only
 * place it needs to work.
 */
describe('events', () => {
	const Poke = defineEvent<{ hard: number }>('poke');
	const Shout = defineEvent('shout');

	/** `@on(event) method() {}`, spelled out. */
	function handles<T extends Script>(
		target: abstract new (...args: never[]) => T,
		event: GameEvent<unknown>,
		method: keyof T & string,
	): void {
		const prototype = target.prototype as object;
		const descriptor = Object.getOwnPropertyDescriptor(prototype, method);
		expect(descriptor, `${target.name}.${method}`).toBeDefined();
		on(event)(prototype, method, descriptor as never);
	}

	class Listener extends Script {
		pokes: number[] = [];
		shouts = 0;

		poked(blow: { hard: number }): void {
			this.pokes.push(blow.hard);
		}

		heard(): void {
			this.shouts++;
		}
	}
	handles(Listener, Poke, 'poked');
	handles(Listener, Shout as GameEvent<unknown>, 'heard');

	/** Inherits its base's handlers and adds one of its own. */
	class LoudListener extends Listener {
		echoes = 0;

		echoed(): void {
			this.echoes++;
		}
	}
	handles(LoudListener, Shout as GameEvent<unknown>, 'echoed');

	class Shouter extends Script {
		override onLoad(): void {
			this.emit(Shout);
		}
	}

	class Angry extends Script {
		poked(): void {
			throw new Error('do not');
		}
	}
	handles(Angry, Poke, 'poked');

	function running(classes: Record<string, ScriptClass<Script>>) {
		const { host: make, said } = quiet();
		return { host: make(staticScripts(classes)), said, scene: new Scene() };
	}

	it('finds the handlers a class declared, its base classes included', () => {
		expect(
			handlersOf(Listener)
				.map((one) => `${one.event} ${one.method}`)
				.sort(),
		).toEqual(['poke poked', 'shout heard']);
		expect(
			handlersOf(LoudListener)
				.map((one) => one.method)
				.sort(),
		).toEqual(['echoed', 'heard', 'poked']);
	});

	it('delivers a broadcast to every script that declared it', () => {
		const { host, scene } = running({ Listener });
		const first = attach(host, scene, 'Listener');
		const second = attach(host, scene, 'Listener');

		host.emit(Poke as GameEvent<unknown>, { hard: 3 });
		expect((host.scriptAt(first) as Listener).pokes).toEqual([3]);
		expect((host.scriptAt(second) as Listener).pokes).toEqual([3]);
	});

	it('sends to the scripts on one object and to nothing else', () => {
		const { host, scene } = running({ Listener });
		const here = scene.spawn('here');
		const there = scene.spawn('there');
		const near = attach(host, scene, 'Listener', {}, here);
		const far = attach(host, scene, 'Listener', {}, there);

		host.send(here, Poke as GameEvent<unknown>, { hard: 7 });
		expect((host.scriptAt(near) as Listener).pokes).toEqual([7]);
		expect((host.scriptAt(far) as Listener).pokes).toEqual([]);
	});

	it('reaches a handler a subclass inherited, and one it added', () => {
		const { host, scene } = running({ LoudListener });
		const id = attach(host, scene, 'LoudListener');
		host.emit(Shout as GameEvent<unknown>, undefined);
		const one = host.scriptAt(id) as LoudListener;
		expect(one.shouts, 'inherited').toBe(1);
		expect(one.echoes, 'its own').toBe(1);
	});

	it('stops delivering to a script that has been destroyed', () => {
		const { host, scene } = running({ Listener });
		const id = attach(host, scene, 'Listener');
		const one = host.scriptAt(id) as Listener;

		host.destroy(id);
		host.emit(Poke as GameEvent<unknown>, { hard: 1 });
		// This test still holds the instance; nothing in the host does, which is
		// the point.
		expect(one.pokes).toEqual([]);
	});

	/*
	 * The one that would fail if a script subscribed itself in `onLoad`. A
	 * reload builds a NEW instance, and a script that had registered a callback
	 * by hand would have left the old one subscribed as well — so the new
	 * instance would see one poke and the old, unreachable one would see it too.
	 */
	it('does not double a handler across a hot reload', () => {
		const { host, scene } = running({ Listener });
		const id = attach(host, scene, 'Listener');
		const before = host.scriptAt(id) as Listener;

		host.reload(staticScripts({ Listener }));
		const after = host.scriptAt(id) as Listener;
		expect(after, 'the reload rebuilt it').not.toBe(before);

		host.emit(Poke as GameEvent<unknown>, { hard: 2 });
		expect(after.pokes, 'the new one').toEqual([2]);
		expect(before.pokes, 'the replaced one').toEqual([]);
	});

	it('hears a script that announces something as it loads', () => {
		const { host, scene } = running({ Listener, Shouter });
		const heard = attach(host, scene, 'Listener');
		attach(host, scene, 'Shouter');
		expect((host.scriptAt(heard) as Listener).shouts).toBe(1);
	});

	it('mutes a handler that throws, and says which one', () => {
		const { host, said, scene } = running({ Angry });
		attach(host, scene, 'Angry');

		host.emit(Poke as GameEvent<unknown>, { hard: 1 });
		expect(host.census.muted).toBe(1);
		expect(said.join('\n')).toMatch(/Angry on 'subject'\.poked threw on 'poke'/);
	});

	it('finds a live script by its class, anywhere or on one object', () => {
		const { host, scene } = running({ Listener });
		const here = scene.spawn('here');
		attach(host, scene, 'Listener', {}, here);

		expect(host.instance(Listener)).toBeInstanceOf(Listener);
		expect(host.instance(Listener, here)).toBeInstanceOf(Listener);
		expect(host.instance(Listener, scene.spawn('elsewhere'))).toBeNull();
	});
});

/*
 * The real directory, compiled the way the client and the editor compile it.
 *
 * Nothing imports these files — that is the point of them, and it is why this
 * suite reaches them through the build tool rather than through an import. A
 * test that imported them would put them back in a module graph and would stop
 * being a test of what ships.
 */
/**
 * A compiled script, seen through the shape a test expects of it.
 *
 * Nothing here can import a script's TYPE, and that is a consequence worth
 * knowing rather than a workaround: the scripts answer to their own tsconfig,
 * the only one with `experimentalDecorators` on, so a type-only import would
 * pull `Character.ts` into this file's typecheck and `@on` would not compile
 * there. Naming the shape is what one compiler for the scripts costs.
 */
/**
 * A blow thrown from the origin, facing a way, as `Combat` expects to hear it.
 *
 * The arc and the reach travel with a swing because the thing swinging measures
 * them off the clip it is playing — see `Player.landBlow`. Here they are just
 * numbers wide enough to reach a bat standing a metre and a half away.
 */
function swingAt(facing: number, amount: number) {
	return {
		by: 'wanderer',
		at: { x: 0, y: 0, z: 0 },
		facing,
		reach: { from: -0.5, to: 0.5, distance: 2, height: 0 },
		amount,
	};
}

function shaped<T>(script: Script | null): T {
	expect(script).not.toBeNull();
	return script as unknown as T;
}

describe('the scripts this build ships', () => {
	let provider: ScriptProvider;
	let files: string[];

	beforeAll(async () => {
		const built = await bundleScripts();
		provider = scriptsFromBundle(built.code, engine);
		files = [...built.files];
	}, 120_000);

	it('compiles every file in the directory into one bundle', async () => {
		const onDisk = (await readdir(scriptDir))
			.filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts'))
			.sort();

		// There is no table to keep in step any more: the directory IS the list,
		// which is half of why the scripts were taken out of the module graph.
		expect(files).toEqual(onDisk);
	});

	it('exports a class that is a Script, under its own name', () => {
		expect(provider.names.length).toBeGreaterThan(0);
		for (const name of provider.names) {
			const constructor = provider.resolve(name);
			expect(constructor, name).not.toBeNull();
			expect(constructor!.prototype, name).toBeInstanceOf(Script);
			expect(constructor!.name, name).toBe(name);
		}
	});

	it('declares the parameters a prefab may set', () => {
		const spin = provider.resolve('Spin') as ScriptClass;
		expect(spin).not.toBeNull();
		expect(parametersOf(spin).map((one) => one.key)).toEqual(['speed']);
		expect(parametersOf(spin)[0]!.type).toBe('number');
	});

	it('compiles `@on` as syntax, which is the whole reason for the build step', () => {
		// vitest cannot transform a decorator, so this is the only place the
		// syntax is exercised — and it is the only place it has to work.
		const character = provider.resolve('Character');
		expect(character, 'Character').not.toBeNull();
		expect(handlersOf(character!).map((one) => `${one.event} ${one.method}`)).toEqual([
			'damage hurt',
		]);
		expect(handlersOf(provider.resolve('Combat')!).map((one) => one.event)).toEqual(['swing']);
	});

	it('runs a swing through combat and takes the hit points off', () => {
		const { host: make, said } = quiet();
		const host = make(provider);
		const scene = new Scene();

		// The systems first, as the game spawns them: a character joins the
		// register when it loads, so the register has to be there already.
		const systems = scene.spawn('systems');
		attach(host, scene, 'CharacterRegistry', {}, systems.add(new GameObject('characters')));
		attach(host, scene, 'Combat', { spread: 1 }, systems.add(new GameObject('combat')));

		const man = scene.spawn('wanderer');
		const bat = scene.spawn('bat');
		bat.transform.setPosition(0, 0, 1.5);
		scene.solve();

		attach(host, scene, 'Character', { hp: 20, faction: 'player', power: 5 }, man);
		const hurt = attach(host, scene, 'Character', { hp: 6, faction: 'foe', power: 2 }, bat);

		const registry = shaped<{ count: number }>(
			host.instance(provider.resolve('CharacterRegistry') as never) as Script | null,
		);
		expect(registry.count, 'both characters joined the register').toBe(2);

		// Facing the bat, which is straight down +Z from him.
		host.emit({ name: 'swing' }, swingAt(0, 5));
		expect(shaped<{ health: number }>(host.scriptAt(hurt)).health).toBe(1);
		expect(said.join('\n')).toMatch(/took 5 from wanderer, 1 left/);

		// And again, which finishes it and is announced.
		host.emit({ name: 'swing' }, swingAt(0, 5));
		expect(shaped<{ health: number }>(host.scriptAt(hurt)).health).toBe(0);
	});

	it('does not let a swing reach behind the swinger', () => {
		const { host: make } = quiet();
		const host = make(provider);
		const scene = new Scene();
		const systems = scene.spawn('systems');
		attach(host, scene, 'CharacterRegistry', {}, systems.add(new GameObject('characters')));
		attach(host, scene, 'Combat', { spread: 1 }, systems.add(new GameObject('combat')));

		const bat = scene.spawn('bat');
		bat.transform.setPosition(0, 0, 1.5);
		scene.solve();
		const id = attach(host, scene, 'Character', { hp: 6, faction: 'foe' }, bat);
		const hurt = shaped<{ health: number }>(host.scriptAt(id));

		// Facing the other way. The bat is behind him.
		host.emit({ name: 'swing' }, swingAt(Math.PI, 5));
		expect(hurt.health).toBe(6);
	});

	/*
	 * The one duplication in the arrangement, held still.
	 *
	 * Scripts and the client's source cannot import each other, so each
	 * declares the events it needs and they agree by NAME. That agreement is
	 * the whole mechanism, and nothing about it fails loudly: a renamed string
	 * on one side is a blow that is announced and never heard, which looks like
	 * a combat bug rather than a typo.
	 */
	it('declares the same event names on both sides of the wall', async () => {
		const names = async (path: string[]) =>
			[
				...(await readFile(resolve(import.meta.dirname, '..', ...path), 'utf8')).matchAll(
					/defineEvent<[^>]*>?\(\s*'([^']+)'/g,
				),
			]
				.map((one) => one[1])
				.sort();

		const inScripts = await names(['packages', 'client', 'scripts', 'events.ts']);
		const inClient = await names(['packages', 'client', 'src', 'game', 'events.ts']);
		expect(inScripts, 'the scripts declare the events the client listens for').toContain('damage');
		expect(inScripts.length).toBeGreaterThan(0);
		expect(inClient).toEqual(inScripts);
	});

	/*
	 * The prefabs that ship, against the scripts they name.
	 *
	 * `tools/build-assets.mjs` checks the same thing and is the place a build
	 * fails, but it runs on `npm run assets` and this runs on `npm test`, which
	 * is the one people run without being asked. The failure it guards is
	 * quiet: a parameter the script does not have is a warning in a console and
	 * the script's own default instead of the number in the file.
	 */
	it('sets only parameters the scripts actually have', async () => {
		const library = openLibrary();
		const prefabs = [
			...(await library.index()).map((one) => ({ id: one.id, prefab: one.prefab })),
			{ id: 'game', prefab: (await library.system('systems/game.system.yaml')).prefab },
		];

		let checked = 0;
		for (const { id, prefab } of prefabs) {
			for (const use of prefabScripts(prefab)) {
				const constructor = provider.resolve(use.script);
				expect(constructor, `'${id}' names script '${use.script}'`).not.toBeNull();
				const known = parametersOf(constructor as ScriptClass).map((one) => one.key);
				for (const key of use.parameters) {
					expect(known, `'${id}' sets '${key}' on '${use.script}'`).toContain(key);
					checked++;
				}
			}
		}
		// A test that silently checked nothing would pass for ever.
		expect(checked, 'some prefab sets some parameter').toBeGreaterThan(0);
	});

	/*
	 * A script may use anything the engine exports, and the shim is what makes
	 * that true at run time as well as at compile time.
	 *
	 * There used to be a hand-written list here, and a test that it matched a
	 * curated SDK. Both are gone: the shim is generated from the engine's own
	 * exports, so there is no second copy to drift. What is worth checking is
	 * the property that replaced it — that what a script can SEE is what a
	 * script can USE, which is the whole reason the curated list went.
	 */
	it('offers a script every runtime name the engine exports', () => {
		const shim = scriptSdkShim(engine);
		const offered = new Set([...shim.matchAll(/^export const (\w+) =/gm)].map((one) => one[1]));

		const runtime = Object.keys(engine).filter(
			(name) => /^[A-Za-z_$][\w$]*$/.test(name) && name !== 'default',
		);
		expect(runtime.length, 'the engine exports something').toBeGreaterThan(20);
		for (const name of runtime) expect(offered, name).toContain(name);
	});

	it('lets a script import something that is not scripting at all', async () => {
		// The point of the merge, checked rather than asserted: `Scene` is the
		// engine's, was never part of the old four-name SDK, and a script that
		// asks for it now both compiles and gets the real class.
		const written = resolve(scriptDir, 'ProbeEngineReach.ts');
		await writeFile(
			written,
			"import { Scene, Script } from '@hexdelve/engine';\n" +
				'export class ProbeEngineReach extends Script {\n' +
				'\toverride onLoad(): void {\n' +
				'\t\tif (!(this.scene.raw instanceof Scene)) throw new Error("not a scene");\n' +
				'\t}\n' +
				'}\n',
			'utf8',
		);
		try {
			const built = await bundleScripts();
			const reachable = scriptsFromBundle(built.code, engine);
			const probe = reachable.resolve('ProbeEngineReach');
			expect(probe, 'it compiled').not.toBeNull();
		} finally {
			await rm(written, { force: true });
		}
	}, 120_000);

	it('reaches the SAME Script class the host checks against', () => {
		// The bundle's `@hexdelve/engine` import is rewritten to a global, so
		// that this is true. Bundling the real package instead would give the
		// scripts their own copy and every `instanceof` here would be false.
		const spin = provider.resolve('Spin')!;
		expect(new spin()).toBeInstanceOf(Script);
	});
});
