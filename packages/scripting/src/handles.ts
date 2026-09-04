/*
 * What a script is allowed to touch.
 *
 * A script could be handed the `GameObject` itself and would work. It is
 * handed these instead, and the reason is not safety — everything here runs in
 * one process and a determined script can do as it likes. It is that a
 * SANCTIONED surface is a promise: what is on these handles is what scripts may
 * go on using, and everything else in the engine is free to change without a
 * hundred script files having to be read.
 *
 * The rule for what belongs here is the same one the asset files follow. A
 * script says what a character DOES. Anything that is really a question about
 * how the engine draws, how a pose is solved, or how a frame is scheduled is
 * not that, and stays out.
 *
 * Handles are cheap objects made on demand rather than kept, so a script that
 * holds one across a hot reload holds a view of an object that may be gone —
 * which is why `alive` is on it, and why nothing here caches.
 */

import type { GameObject, Scene } from '@hexdelve/engine';

/** Where something is and which way it is turned. */
export class ScriptTransform {
	constructor(private readonly target: GameObject) {}

	get x(): number {
		return this.target.transform.position[0];
	}
	set x(value: number) {
		this.target.transform.position[0] = value;
	}

	get y(): number {
		return this.target.transform.position[1];
	}
	set y(value: number) {
		this.target.transform.position[1] = value;
	}

	get z(): number {
		return this.target.transform.position[2];
	}
	set z(value: number) {
		this.target.transform.position[2] = value;
	}

	/** The turn about +Y, which is the only rotation this game's objects use. */
	get yaw(): number {
		return this.target.transform.yaw;
	}
	set yaw(value: number) {
		this.target.transform.yaw = value;
	}

	setPosition(x: number, y: number, z: number): void {
		this.target.transform.setPosition(x, y, z);
	}

	/** Where it ended up in the world, as of the last solve. Read-only. */
	get worldX(): number {
		return this.target.world.position[0];
	}
	get worldY(): number {
		return this.target.world.position[1];
	}
	get worldZ(): number {
		return this.target.world.position[2];
	}
}

/** One object in the scene, as a script sees it. */
export class ScriptObject {
	constructor(private readonly target: GameObject) {}

	get name(): string {
		return this.target.name;
	}

	get id(): number {
		return this.target.id;
	}

	/** False once it has been destroyed — a handle outlives what it points at. */
	get alive(): boolean {
		return !this.target.isDestroyed;
	}

	get transform(): ScriptTransform {
		return new ScriptTransform(this.target);
	}

	get parent(): ScriptObject | null {
		return this.target.parent ? new ScriptObject(this.target.parent) : null;
	}

	/** The first object with this name underneath, or null. */
	child(name: string): ScriptObject | null {
		const found = this.target.find(name);
		return found ? new ScriptObject(found) : null;
	}

	/** Take it out of the scene. Everything on it, and under it, is torn down. */
	destroy(): void {
		this.target.destroy();
	}

	/** The object itself, for the parts of the game that are not scripts yet. */
	get raw(): GameObject {
		return this.target;
	}
}

/** The scene, as a script sees it. */
export class ScriptScene {
	constructor(private readonly target: Scene) {}

	/** The first object anywhere with this name, or null. */
	find(name: string): ScriptObject | null {
		const found = this.target.find(name);
		return found ? new ScriptObject(found) : null;
	}

	get raw(): Scene {
		return this.target;
	}
}
