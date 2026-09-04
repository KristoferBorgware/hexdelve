/*
 * A script, attached to an object.
 *
 * It holds a number and nothing else. Which class that number means, whether
 * an instance exists, what its parameters are — all of it is the host's, and
 * that is what lets a hot reload replace the instance without this component
 * ever knowing. A component that held the instance would be a component that
 * had to be rebuilt on every save, and rebuilding a component means rebuilding
 * the object it is on.
 */

import { Component } from '../scene/GameObject.js';
import type { GameObject } from '../scene/GameObject.js';

import type { ScriptHost } from './ScriptHost.js';
import { ScriptObject, ScriptScene } from './handles.js';
import type { Scene } from '../scene/Scene.js';

export interface ScriptComponentOptions {
	readonly host: ScriptHost;
	/** The class name, as the script file exports it. */
	readonly script: string;
	/** The scene it is in, for the handle a script reaches things through. */
	readonly scene: Scene;
	/** Values for the fields the script declared with `param()`. */
	readonly parameters?: Readonly<Record<string, unknown>>;
}

export class ScriptComponent extends Component {
	/** Stable across hot reloads. What the host knows this script by. */
	readonly id: number;
	readonly script: string;

	private readonly host: ScriptHost;

	constructor(object: GameObject, options: ScriptComponentOptions) {
		super(object);
		this.host = options.host;
		this.script = options.script;
		this.id = options.host.register(
			options.script,
			{
				object: new ScriptObject(object, options.host),
				scene: new ScriptScene(options.scene, options.host),
			},
			options.parameters ?? {},
		);
	}

	override update(dt: number): void {
		this.host.tick(this.id, dt);
	}

	override onDetach(): void {
		this.host.destroy(this.id);
	}
}
