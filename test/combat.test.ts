/*
 * A blow, all the way through.
 *
 * This is the test the whole event arrangement exists to be able to write. It
 * drives the real `Simulation` — no canvas, no GPU — with the real system
 * prefab and the real compiled scripts, walks the man up to the bat, and swings.
 * Five separate pieces have to agree for the hit points to move:
 *
 *   the entity files   say the bat is a character with six of them
 *   the system prefab  puts a register and a combat rule in the scene
 *   Player             announces a swing, with the reach it measured off the
 *                      clip that is playing
 *   Combat             finds what was in front of it and sends the damage
 *   Character          takes the points off
 *
 * None of those five knows more than one of the others. That is the claim, and
 * a chain this long is worth testing at the end rather than only in the middle:
 * every link is covered in `scripting.test.ts` against classes written for the
 * purpose, and none of that would catch a name misspelt in a YAML file.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { Damage, Simulation, type Cast } from '@hexdelve/client';
import { HexInstances } from '@hexdelve/engine';
import { scriptsFromBundle, type ScriptProvider } from '@hexdelve/scripting';
import { axialDistance, axialNeighbours, type Axial } from '@hexdelve/shared';

import { bundleScripts } from '../tools/build-scripts.mjs';
import { loadYardCast, openLibrary } from './harness/assets.js';

/** The frame the client runs at, near enough. */
const FRAME = 1 / 60;

describe('a blow, end to end', () => {
	let cast: Cast;
	let scripts: ScriptProvider;
	let systems: Awaited<ReturnType<ReturnType<typeof openLibrary>['system']>>;

	beforeAll(async () => {
		cast = await loadYardCast();
		systems = await openLibrary().system('systems/game.system.yaml');
		scripts = scriptsFromBundle((await bundleScripts()).code);
	}, 120_000);

	function yard(): Simulation {
		return new Simulation({ cast, seed: 37, systems: [systems], scripts });
	}

	function run(sim: Simulation, seconds: number): void {
		for (let i = 0; i < Math.round(seconds / FRAME); i++) sim.update(FRAME, { hover: null });
	}

	/** Health, read back off the script the bat is actually carrying. */
	function healthOf(sim: Simulation, object: { id: number }): number {
		for (const one of registry(sim).all as { object: { id: number }; health: number }[]) {
			if (one.object.id === object.id) return one.health;
		}
		throw new Error('that thing is not in the register');
	}

	function registry(sim: Simulation): { all: readonly unknown[]; count: number } {
		const constructor = scripts.resolve('CharacterRegistry');
		expect(constructor, 'the build compiles a CharacterRegistry').not.toBeNull();
		const found = sim.scripts.instance(constructor as never);
		expect(found, 'the system prefab put one in the scene').not.toBeNull();
		return found as unknown as { all: readonly unknown[]; count: number };
	}

	it('registers both creatures, from their entity files', () => {
		const sim = yard();
		// Nobody wrote this down anywhere in TypeScript: the wanderer and the bat
		// each carry a `Character` in their own entity file, and joining the
		// register is something that script does when it loads.
		expect(registry(sim).count).toBe(2);
	});

	it('takes the bat down to one hit point, and then finishes it', () => {
		const sim = yard();
		const bat = sim.bat.object;
		expect(healthOf(sim, bat), 'as its entity file says').toBe(6);

		// Up to it and cut. `attack` orders a walk to whatever hexagon it is on,
		// and the last step of that order is the swing.
		expect(sim.attack()).toBe(true);
		run(sim, 40);

		expect(sim.player.swing.cuts, 'he got there and swung').toBeGreaterThan(0);
		expect(sim.player.swing.hits, 'and at least one landed').toBeGreaterThan(0);

		// Five a blow, off six, so the first one leaves it on one.
		expect(healthOf(sim, bat)).toBeLessThanOrEqual(1);
	});

	it('says so in the readout, which is still the man’s', () => {
		const sim = yard();
		expect(sim.attack()).toBe(true);
		run(sim, 40);
		// The rule that decided this lives in a script; the sentence does not.
		expect(['hit it', 'cut air', 'the blow fell short']).toContain(sim.stats.message);
		expect(sim.stats.hits + sim.stats.missed).toBe(sim.player.swing.cuts);
	});

	/*
	 * The negative case, and the one worth having: a swing announced into a
	 * yard with no rules in it must not quietly land. Without the system prefab
	 * there is no `Combat`, so nothing answers, and the man should record a
	 * swing that did nothing rather than a hit nobody adjudicated.
	 */
	it('lands nothing when there is no combat rule in the scene', () => {
		const sim = new Simulation({ cast, seed: 37, scripts });
		expect(sim.attack()).toBe(true);
		run(sim, 40);

		expect(sim.player.swing.cuts, 'he still swings').toBeGreaterThan(0);
		expect(sim.player.swing.hits, 'and connects with nothing').toBe(0);
	});

	/*
	 * He is hurt in that fight, and every point of it comes from the bat. A
	 * rule that let a swing find the swinger would show up here as a five,
	 * since his cut takes five and its bite takes two.
	 */
	it('never lets a blow find whoever threw it', () => {
		const sim = yard();
		const blows: { from: string; amount: number }[] = [];
		sim.scripts.on(Damage, (blow) => blows.push({ from: blow.from, amount: blow.amount }));

		expect(sim.attack()).toBe(true);
		run(sim, 40);

		expect(blows.length, 'blows landed on somebody').toBeGreaterThan(0);
		expect([...new Set(blows.map((one) => one.from))].sort()).toEqual(['bat', 'player']);
		const hurtHim = blows.filter((one) => one.from === 'bat');
		expect(20 - healthOf(sim, sim.player.object), 'all of it from the bat').toBe(
			hurtHim.reduce((total, one) => total + one.amount, 0),
		);
	});

	/*
	 * The loop closed. Six hit points and five a blow means the second cut
	 * finishes it, and a thing that has been finished stops taking turns —
	 * otherwise a dead bat goes on biting, which is what this found.
	 */
	it('stops a creature taking turns once it has fallen', () => {
		const sim = yard();
		const before = sim.schedule.members.length;
		expect(before).toBe(2);

		expect(sim.attack()).toBe(true);
		run(sim, 40);

		expect(healthOf(sim, sim.bat.object)).toBe(0);
		expect(sim.schedule.members).not.toContain(sim.bat);
		expect(sim.bat.bites, 'and bit nothing after it fell').toBeLessThan(4);
	});

	/*
	 * The picture, not the rule. A creature that has been killed and looks
	 * exactly like one that has not is worse than no death animation at all,
	 * because the player cannot tell whether the blow worked — which is the one
	 * thing a fight has to communicate.
	 *
	 * Checked as instances rather than as a flag: the bat is asked to draw
	 * itself before and after it falls, and the two have to differ. A `fallen`
	 * boolean that nothing read would pass a test of itself.
	 */
	it('draws a fallen creature differently from a standing one', () => {
		const sim = yard();
		// One frame first: a body draws from its solved pose, and nothing has
		// solved one yet.
		run(sim, 0.1);

		const standing = new HexInstances(4096);
		sim.bat.emit(standing, standing, false);
		expect(standing.count).toBeGreaterThan(0);
		const before = Float32Array.from(standing.data);

		expect(sim.attack()).toBe(true);
		run(sim, 40);
		expect(healthOf(sim, sim.bat.object), 'it is dead').toBe(0);
		expect(sim.bat.falling, 'and it was told so').toBe(true);

		// Long enough for the fall to finish on the wall clock.
		run(sim, 3);
		expect(sim.bat.fall, 'the fall ran to the end').toBeGreaterThan(0.99);

		const fallen = new HexInstances(4096);
		sim.bat.emit(fallen, fallen, false);
		expect(fallen.count, 'it is still drawn').toBe(standing.count);

		let moved = 0;
		for (let i = 0; i < before.length; i++) {
			if (Math.abs(fallen.data[i]! - before[i]!) > 0.05) moved++;
		}
		expect(moved, 'most of it is somewhere else').toBeGreaterThan(before.length / 4);
	});

	it('leaves a fallen creature on the ground rather than in the air', () => {
		const sim = yard();
		expect(sim.attack()).toBe(true);
		run(sim, 40);
		run(sim, 3);

		// Its wings stop holding it up, so it ends at ground level rather than
		// at the height it hovers at. `wake` carries that, and dying drives it
		// to nothing the same way falling asleep does.
		const ground = sim.world.groundAt(sim.bat.x, sim.bat.z);
		expect(sim.bat.y - ground).toBeLessThan(0.05);
	});

	it('puts the bat next to him before any of this is true', () => {
		// Not a rule, a precondition: the fight only happens because the walk
		// ends adjacent. Stated so that a failure above says which half broke.
		const sim = yard();
		expect(sim.attack()).toBe(true);
		run(sim, 40);
		const gap = axialDistance(sim.player.cell, sim.bat.cell);
		expect(gap, 'he ended his walk next to it').toBeLessThanOrEqual(1);
		expect(axialNeighbours(sim.player.cell).some((one: Axial) => sameCell(one, sim.bat.cell))).toBe(
			gap === 1,
		);
	});
});

function sameCell(a: Axial, b: Axial): boolean {
	return a.q === b.q && a.r === b.r;
}
