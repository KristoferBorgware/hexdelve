/*
 * A scene: one root, and the order a frame happens in.
 *
 * The order is the whole content of this file, and it is not arbitrary.
 *
 *   update   every component, parents before children. This is where things
 *            move: a script walks its object, a hunt decides where to fly.
 *   solve    every world transform, once, after the moving has finished.
 *            Solving first would draw the frame before last, and solving per
 *            object as it is asked for would solve a chain once per link.
 *
 * Drawing is deliberately not here. What a frame is drawn INTO is a renderer's
 * question and a scene has no opinion about it — the same tree feeds the yard's
 * instance buffers and a bench's, and neither is the scene's business.
 *
 * A scene owns nothing else. There is no camera in it, no light, no registry:
 * those are objects with components on them like anything else, which is the
 * point of having the tree in the first place.
 */

import { GameObject } from './GameObject.js';

export interface SceneOptions {
	/** What the root is called. Only matters when something goes looking. */
	name?: string;
}

export class Scene {
	readonly root: GameObject;

	constructor(options: SceneOptions = {}) {
		this.root = new GameObject(options.name ?? 'scene');
	}

	/** A new object under `parent`, or under the root. */
	spawn(name: string, parent: GameObject = this.root): GameObject {
		return parent.add(new GameObject(name));
	}

	/** The first object with this name anywhere in the scene, or null. */
	find(name: string): GameObject | null {
		return this.root.name === name ? this.root : this.root.find(name);
	}

	/** Every object in the scene, parents before children, the root first. */
	all(): GameObject[] {
		return [...this.root.walk()];
	}

	/**
	 * One frame's worth of thinking, then one solve.
	 *
	 * The two are separate methods as well, because a bench holds a frame still
	 * and has to be able to solve without advancing anything.
	 */
	update(dt: number): void {
		this.root.update(dt);
		this.solve();
	}

	/** Resolve every world transform from the root down. */
	solve(): void {
		this.root.solve(null);
	}
}
