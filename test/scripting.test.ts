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

import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { Component, GameObject, Scene } from '@hexdelve/engine';
import {
	param,
	parametersOf,
	Script,
	ScriptComponent,
	ScriptHost,
	staticScripts,
	type ScriptClass,
	type ScriptProvider,
} from '@hexdelve/scripting';
import { scripts } from '../packages/client/src/scripts/index.js';

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

function attach(host: ScriptHost, scene: Scene, name = 'Counter', parameters = {}): number {
	const object = scene.spawn('subject');
	return host.register(name, { object: handleFor(object), scene: sceneHandle(scene) }, parameters);
}

// The handles the host wants. Built here rather than exported from the package,
// because building one is the component's job everywhere that is not a test.
function handleFor(object: GameObject) {
	return new (class {
		get name() {
			return object.name;
		}
		get raw() {
			return object;
		}
	})() as never;
}
function sceneHandle(scene: Scene) {
	return { raw: scene } as never;
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

describe('the scripts this build ships', () => {
	it('lists every file in the directory', async () => {
		const directory = resolve(import.meta.dirname, '..', 'packages', 'client', 'src', 'scripts');
		const files = (await readdir(directory))
			.filter((name) => name.endsWith('.ts') && name !== 'index.ts')
			.map((name) => name.replace(/\.ts$/, ''))
			.sort();

		// The table is written out rather than globbed, because a glob is
		// Vite's and the client is built twice. This is what stops the list
		// drifting from the directory beside it.
		expect(Object.keys(scripts).sort()).toEqual(files);
	});

	it('exports a class that is a Script, under its own name', () => {
		for (const [name, constructor] of Object.entries(scripts)) {
			expect(constructor.prototype, name).toBeInstanceOf(Script);
			expect(constructor.name, name).toBe(name);
		}
	});

	it('declares the parameters a prefab may set', () => {
		const spin = scripts.Spin as ScriptClass;
		expect(parametersOf(spin).map((one) => one.key)).toEqual(['speed']);
		expect(parametersOf(spin)[0]!.type).toBe('number');
	});
});
