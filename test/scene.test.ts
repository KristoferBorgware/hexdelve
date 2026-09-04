/*
 * The scene graph, and the four things about it that are easy to get wrong.
 *
 * A tree of objects with components on them is a shape everybody recognises,
 * which is exactly why it is worth testing: the parts that bite are not the
 * shape but the ORDER, and every one of them fails silently.
 *
 *   composition   a child's place in the world is its parent's rotation applied
 *                 to its own position, then its parent's position — the same
 *                 statement `solveWorld` makes about bones. Get the two the
 *                 wrong way round and a sword in a hand is in the right place
 *                 exactly while the hand is at the origin.
 *   update order  components before children, and a solve after all of them.
 *                 Solve first and every frame draws the one before it.
 *   teardown      a destroyed object's components hear about it while they can
 *                 still see where they were, or nothing can take itself out of
 *                 a registry.
 *   reentrancy    a component may destroy or spawn things while updating, and
 *                 the traversal has to survive its own list changing.
 */

import { describe, expect, it } from 'vitest';

import { Component, Scene, Transform } from '@hexdelve/engine';

const PI = Math.PI;

/** A component that writes down every hook it is given, in order. */
class Recorder extends Component {
	static readonly log: string[] = [];

	private get label(): string {
		return `${this.object.name}`;
	}

	override onAttach(): void {
		Recorder.log.push(`attach ${this.label}`);
	}
	override update(): void {
		Recorder.log.push(`update ${this.label}`);
	}
	override onDetach(): void {
		// Reads the tree during teardown on purpose: a component that has
		// registered itself somewhere has to be able to find its way back out,
		// and that means the object is still where it was when this runs.
		Recorder.log.push(`detach ${this.label} under ${this.object.parent?.name ?? 'nothing'}`);
	}
}

function clean(): void {
	Recorder.log.length = 0;
}

describe('Transform', () => {
	it('reads back the yaw it was given, to a float32 quaternion’s precision', () => {
		const transform = new Transform();
		for (const angle of [0, 0.4, -1.2, PI / 2, -PI / 2]) {
			transform.yaw = angle;
			// Seven digits, not seventeen: yaw is a view of a Float32Array, which
			// is what every rotation in this project is. See the note on the
			// accessor — this is the precision, not a rounding accident.
			expect(transform.yaw).toBeCloseTo(angle, 6);
		}
	});

	it('has no scale, because a size in this project belongs to a part', () => {
		expect(Object.keys(new Transform())).toEqual(['position', 'rotation']);
	});
});

describe('world transforms', () => {
	it('carries a child’s position by its parent’s rotation, not the other way round', () => {
		const scene = new Scene();
		const hand = scene.spawn('hand');
		const sword = scene.spawn('sword', hand);

		// A hand two metres up, turned a quarter turn about +Y; a sword one
		// metre out along the hand's +Z.
		hand.transform.setPosition(0, 2, 0);
		hand.transform.yaw = PI / 2;
		sword.transform.setPosition(0, 0, 1);

		scene.solve();

		// A quarter turn about +Y takes +Z onto +X, so the sword is one metre
		// along X — at the hand's height, not at the origin's.
		expect(sword.world.position[0]).toBeCloseTo(1, 6);
		expect(sword.world.position[1]).toBeCloseTo(2, 6);
		expect(sword.world.position[2]).toBeCloseTo(0, 6);
	});

	it('composes rotations down a chain', () => {
		const scene = new Scene();
		const a = scene.spawn('a');
		const b = scene.spawn('b', a);
		const c = scene.spawn('c', b);
		for (const object of [a, b, c]) object.transform.yaw = PI / 4;

		scene.solve();
		expect(c.world.rotation[1]!).toBeCloseTo(Math.sin((3 * PI) / 8), 5);
	});

	it('leaves a root where it stands', () => {
		const scene = new Scene();
		const object = scene.spawn('lonely');
		object.transform.setPosition(3, -1, 4.5);
		scene.solve();
		expect(object.world.position).toEqual([3, -1, 4.5]);
	});

	it('re-solves after something moves, without reallocating', () => {
		const scene = new Scene();
		const object = scene.spawn('mover');
		scene.solve();
		const before = object.world.position;

		object.transform.setPosition(1, 2, 3);
		scene.solve();

		expect(object.world.position).toBe(before); // the same array, written in place
		expect(object.world.position).toEqual([1, 2, 3]);
	});
});

describe('the frame', () => {
	it('updates components before children, and solves after all of them', () => {
		clean();
		const scene = new Scene();
		const parent = scene.spawn('parent');
		const child = scene.spawn('child', parent);
		parent.addComponent(Recorder);
		child.addComponent(Recorder);

		/*
		 * A component that moves its object during update. If the solve ran
		 * first, the world transform below would still be the old one — which
		 * is the bug this ordering exists to prevent, and it looks like a frame
		 * of latency rather than like a mistake.
		 */
		class Walker extends Component {
			override update(): void {
				this.object.transform.setPosition(5, 0, 0);
			}
		}
		parent.addComponent(Walker);

		scene.update(1 / 60);

		expect(Recorder.log).toEqual([
			'attach parent',
			'attach child',
			'update parent',
			'update child',
		]);
		expect(child.world.position[0]).toBe(5);
	});

	it('survives a component destroying another object mid-update', () => {
		const scene = new Scene();
		const first = scene.spawn('first');
		const doomed = scene.spawn('doomed');
		const third = scene.spawn('third');

		clean();
		doomed.addComponent(Recorder);
		third.addComponent(Recorder);

		class Killer extends Component {
			override update(): void {
				doomed.destroy();
			}
		}
		first.addComponent(Killer);

		expect(() => scene.update(1 / 60)).not.toThrow();
		expect(Recorder.log).toContain('detach doomed under scene');
		// The survivor still gets its turn, even though the list shrank under
		// the traversal while it was walking it.
		expect(Recorder.log).toContain('update third');
	});

	it('does not update an object spawned during the same frame', () => {
		const scene = new Scene();
		const spawner = scene.spawn('spawner');
		clean();

		class Spawner extends Component {
			override update(): void {
				scene.spawn('newborn').addComponent(Recorder);
			}
		}
		spawner.addComponent(Spawner);

		scene.update(1 / 60);
		expect(Recorder.log).toEqual(['attach newborn']);
	});
});

describe('teardown', () => {
	it('detaches a whole subtree, deepest first, while it is still parented', () => {
		clean();
		const scene = new Scene();
		const body = scene.spawn('body');
		const arm = scene.spawn('arm', body);
		const hand = scene.spawn('hand', arm);
		for (const object of [body, arm, hand]) object.addComponent(Recorder);

		body.destroy();

		expect(Recorder.log.filter((line) => line.startsWith('detach'))).toEqual([
			'detach hand under arm',
			'detach arm under body',
			'detach body under scene',
		]);
		expect(scene.find('hand')).toBeNull();
		expect(body.isDestroyed).toBe(true);
	});

	it('is idempotent', () => {
		clean();
		const scene = new Scene();
		const object = scene.spawn('once');
		object.addComponent(Recorder);

		object.destroy();
		object.destroy();

		expect(Recorder.log.filter((line) => line.startsWith('detach'))).toHaveLength(1);
	});

	it('fires onDetach when one component is removed on its own', () => {
		clean();
		const scene = new Scene();
		const object = scene.spawn('subject');
		const component = object.addComponent(Recorder);

		expect(object.removeComponent(component)).toBe(true);
		expect(object.removeComponent(component)).toBe(false);
		expect(Recorder.log).toEqual(['attach subject', 'detach subject under scene']);
	});
});

describe('the hierarchy', () => {
	it('moves a child rather than copying it', () => {
		const scene = new Scene();
		const first = scene.spawn('first');
		const second = scene.spawn('second');
		const carried = scene.spawn('carried', first);

		second.add(carried);

		expect(first.children).toHaveLength(0);
		expect(second.children).toEqual([carried]);
		expect(carried.parent).toBe(second);
	});

	it('refuses a cycle', () => {
		const scene = new Scene();
		const a = scene.spawn('a');
		const b = scene.spawn('b', a);
		expect(() => b.add(a)).toThrow(/already above/);
		expect(() => a.add(a)).toThrow(/its own parent/);
	});

	it('finds a component on an ancestor', () => {
		const scene = new Scene();
		const body = scene.spawn('body');
		const hand = scene.spawn('hand', body);
		const sword = scene.spawn('sword', hand);
		const wanted = body.addComponent(Recorder);

		expect(sword.getComponentInParent(Recorder)).toBe(wanted);
		expect(sword.getComponent(Recorder)).toBeNull();
	});

	it('walks parents before children', () => {
		const scene = new Scene();
		const a = scene.spawn('a');
		scene.spawn('a1', a);
		scene.spawn('b');
		expect(scene.all().map((object) => object.name)).toEqual(['scene', 'a', 'a1', 'b']);
	});
});
