/*
 * Does the clock do what the table says?
 *
 * The turn system is the one part of this project whose correctness is a claim
 * about arithmetic rather than about a picture, so it is the part most worth
 * testing directly. Three groups:
 *
 *   the table      `extract_energy`, against the anchors in
 *                  docs/angband/02-time-energy-speed.md
 *   the schedule   that a speed is a *rate* — that +10 acts twice as often
 *                  rather than merely first, and that a speed which is not a
 *                  neat multiple still comes out right because the change is
 *                  banked
 *   the yard       the two claims the whole rewrite rests on: nothing moves
 *                  while you have not asked for anything, and one click
 *                  eventually puts him on the hexagon you clicked
 *
 * The last group runs the real `Simulation` — the same object the client and
 * the editor drive — with no canvas and no GPU, which is possible only because
 * the rules and the drawing were kept apart.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { HEX_SPACING, axialDistance, axialNeighbours, type Axial } from '@hexdelve/shared';
import {
	ACTION_ENERGY,
	batLean,
	measureBiteReach,
	leanIn,
	NORMAL_SPEED,
	measureReach,
	clipOf,
	type Cast,
	RUN_SPEED,
	SECONDS_PER_GAME_TURN,
	Schedule,
	Simulation,
	WALK_SPEED,
	actionSeconds,
	energyPerTurn,
	gameTurnsPerAction,
	hexSpeed,
	speedFactor,
	strideFor,
	type TurnMember,
} from '@hexdelve/client';

import { HexInstances } from '@hexdelve/engine';

import { loadYardCast } from './harness/assets.js';

describe('the energy table', () => {
	/*
	 * Every anchor the chapter states outright. If this drifts, it is either a
	 * typo in the table or somebody changed a row for game-feel reasons — and
	 * either way the readout stops being able to say "twice normal speed" and
	 * mean it.
	 */
	const ANCHORS: readonly [number, number][] = [
		[0, 1],
		[50, 1],
		[60, 1],
		[69, 1],
		[70, 2],
		[79, 2],
		[86, 2],
		[87, 3],
		[94, 3],
		[95, 4],
		[100, 5],
		[109, 9],
		[110, 10],
		[119, 19],
		[120, 20],
		[130, 30],
		[140, 38],
		[150, 42],
		[160, 45],
		[170, 47],
		[180, 49],
		[199, 49],
	];

	it('matches every anchor the chapter gives', () => {
		for (const [speed, energy] of ANCHORS) {
			expect(energyPerTurn(speed), `speed ${speed}`).toBe(energy);
		}
	});

	it('never decreases as speed rises', () => {
		for (let s = 1; s < 200; s++) {
			expect(energyPerTurn(s), `speed ${s}`).toBeGreaterThanOrEqual(energyPerTurn(s - 1));
		}
	});

	it('clamps rather than falling off either end', () => {
		expect(energyPerTurn(-40)).toBe(energyPerTurn(0));
		expect(energyPerTurn(4000)).toBe(energyPerTurn(199));
	});

	it('reads +10 as double, +20 as triple and -10 as half', () => {
		expect(speedFactor(NORMAL_SPEED)).toBe(1);
		expect(speedFactor(NORMAL_SPEED + 10)).toBe(2);
		expect(speedFactor(NORMAL_SPEED + 20)).toBe(3);
		expect(speedFactor(NORMAL_SPEED - 10)).toBe(0.5);
	});

	it('puts a normal action at ten game turns', () => {
		expect(gameTurnsPerAction(NORMAL_SPEED)).toBe(10);
		expect(gameTurnsPerAction(NORMAL_SPEED + 10)).toBe(5);
	});
});

describe('the schedule', () => {
	const member = (name: string, speed: number, energy = 0): TurnMember => ({
		name,
		speed,
		energy,
	});

	/** Run the schedule for a while and count who acted. */
	function tally(members: TurnMember[], actions: number): Record<string, number> {
		const schedule = new Schedule(members);
		const counts: Record<string, number> = {};
		for (let i = 0; i < actions; i++) {
			const who = schedule.next();
			expect(who).not.toBeNull();
			schedule.spend(who!);
			counts[who!.name] = (counts[who!.name] ?? 0) + 1;
		}
		return counts;
	}

	it('gives a +10 creature two actions for every one of a normal creature', () => {
		const counts = tally([member('man', 110), member('bat', 120)], 300);
		// Exactly double over a long enough run; allow one action of phase.
		expect(counts['bat']! / counts['man']!).toBeCloseTo(2, 1);
		expect(counts['man']! + counts['bat']!).toBe(300);
	});

	it('banks the change, so a speed that is not a neat multiple still comes out right', () => {
		// +5 gains 15 a turn, so it affords an action every 6 2/3 game turns —
		// which only works out if the leftover 5 carries.
		const schedule = new Schedule([member('quick', 115)]);
		const at: number[] = [];
		for (let i = 0; i < 3; i++) {
			const who = schedule.next()!;
			at.push(schedule.gameTurn);
			schedule.spend(who);
		}
		expect(at).toEqual([7, 14, 20]);
	});

	it('lets whoever is listed first take an equal-energy tie', () => {
		const you = member('you', 110, ACTION_ENERGY);
		const them = member('them', 110, ACTION_ENERGY);
		const schedule = new Schedule([you, them]);
		expect(schedule.next()).toBe(you);
	});

	it('sends the creature with more energy in first', () => {
		const you = member('you', 110, ACTION_ENERGY);
		const them = member('them', 120, ACTION_ENERGY + 30);
		const schedule = new Schedule([you, them]);
		expect(schedule.next()).toBe(them);
	});

	it('does not move the clock when somebody can already act', () => {
		const schedule = new Schedule([member('ready', 110, ACTION_ENERGY)]);
		schedule.next();
		expect(schedule.gameTurn).toBe(0);
	});
});

describe('the wall clock', () => {
	it('draws a normal-speed step at exactly the speed his legs walk', () => {
		expect(HEX_SPACING / actionSeconds(ACTION_ENERGY, NORMAL_SPEED)).toBeCloseTo(WALK_SPEED, 6);
		expect(SECONDS_PER_GAME_TURN * gameTurnsPerAction(NORMAL_SPEED)).toBeCloseTo(
			HEX_SPACING / WALK_SPEED,
			6,
		);
	});

	it('halves the time on screen for a creature that acts twice as often', () => {
		expect(actionSeconds(ACTION_ENERGY, NORMAL_SPEED + 10) * 2).toBeCloseTo(
			actionSeconds(ACTION_ENERGY, NORMAL_SPEED),
			6,
		);
	});
});

describe('the stride solved backwards', () => {
	it('answers a normal-speed step with a plain walk and no slip', () => {
		const setting = strideFor(hexSpeed(NORMAL_SPEED));
		expect(setting.amp).toBeCloseTo(1, 3);
		expect(setting.gait).toBeCloseTo(0, 3);
		expect(setting.speed).toBeCloseTo(WALK_SPEED, 4);
		expect(setting.slip).toBe(0);
	});

	it('hits any speed between a walk and a run, and says so honestly past one', () => {
		const middle = (WALK_SPEED + RUN_SPEED) / 2;
		const solved = strideFor(middle);
		expect(solved.speed).toBeCloseTo(middle, 4);
		expect(solved.gait).toBeGreaterThan(0);
		expect(solved.gait).toBeLessThan(1);
		expect(solved.slip).toBe(0);

		// Past a full run there is no more leg, and the shortfall is reported
		// rather than hidden.
		const beyond = strideFor(RUN_SPEED * 1.5);
		expect(beyond.gait).toBe(1);
		expect(beyond.slip).toBeCloseTo(RUN_SPEED * 0.5, 4);
	});

	it('shortens the step rather than slowing the cycle below a walk', () => {
		const slow = strideFor(WALK_SPEED / 2);
		expect(slow.gait).toBe(0);
		expect(slow.amp).toBeLessThan(1);
		expect(slow.speed).toBeCloseTo(WALK_SPEED / 2, 3);
	});

	it('turns a row of the energy table into a gait', () => {
		// +10 has to cross a hexagon in half the time, and the only thing that
		// can be is a run.
		expect(strideFor(hexSpeed(NORMAL_SPEED + 10)).gait).toBeGreaterThan(0.9);
	});
});

describe('reach against the grid', () => {
	/*
	 * The README's "the grid is for navigation, not for reach", as an identity.
	 * Both fighters are rooted to tile centres and neither's weapon spans the
	 * 1.73 m between them, so each leans in by exactly the shortfall — and if
	 * anybody re-times a swing, these two numbers move together and this still
	 * holds.
	 */
	it('closes the gap between a measured reach and a hexagon exactly', async () => {
		const cast = await loadYardCast();
		const sword = cast.props.find((prop) => prop.id === 'sword')!;
		const reach = measureReach(
			cast.player.rig!.skeleton,
			clipOf(cast.player, 'slash'),
			sword.mesh.anchors.tip!.at,
		);
		const bite = measureBiteReach(cast.enemy.rig!);

		expect(reach.distance).toBeLessThan(HEX_SPACING);
		expect(reach.distance + leanIn(reach)).toBeCloseTo(HEX_SPACING, 9);

		expect(bite.distance).toBeLessThan(HEX_SPACING);
		expect(bite.distance + batLean(bite)).toBeCloseTo(HEX_SPACING, 9);
	});
});

describe('the yard', () => {
	const FRAME = 1 / 60;

	/*
	 * One read of the asset tree for the whole block. Building a Simulation
	 * needs a cast now — the rigs, the bodies and the clips are files — and
	 * reading them once is both quicker and the honest shape: every yard in
	 * here is the same yard.
	 */
	let cast: Cast;
	beforeAll(async () => {
		cast = await loadYardCast();
	});

	/** Run the simulation as a client would, for a number of seconds. */
	function run(sim: Simulation, seconds: number): void {
		for (let i = 0; i < Math.round(seconds / FRAME); i++) sim.update(FRAME, { hover: null });
	}

	it('holds still until you ask for something', () => {
		const sim = new Simulation({ cast, seed: 37 });
		const where = { ...sim.bat.cell };
		const state = sim.bat.state;

		run(sim, 4);

		// Four seconds of frames, and not one game turn: no energy was handed
		// out, so nothing could act. This is the whole of what "turn-based"
		// buys, and it is one getter — `player.hasOrders` — that buys it.
		expect(sim.schedule.gameTurn).toBe(0);
		expect(sim.stats.actions).toBe(0);
		expect(sim.stats.waitingForYou).toBe(true);
		expect(sim.bat.cell).toEqual(where);
		expect(sim.bat.state).toBe(state);
	});

	it('walks him to the hexagon you clicked, one hexagon per turn', () => {
		const sim = new Simulation({ cast, seed: 37 });
		const from = { ...sim.player.cell };

		// Three tiles away, and away from the bat so the walk is not a fight.
		const goal: Axial = { q: from.q - 3, r: from.r };
		expect(sim.pickCell(goal)).toBe(true);

		// A route at least as long as the crow flies. It can be longer: a
		// terrace he cannot climb is a wall, so the way round it is the way.
		const planned = sim.player.path.length;
		expect(planned).toBeGreaterThanOrEqual(axialDistance(from, goal));
		expect(sim.player.path[planned - 1]).toEqual(goal);

		run(sim, 12);

		expect(sim.player.cell).toEqual(goal);
		/*
		 * And the clock turned exactly as far as the walk was long. He arrives
		 * with a full reservoir, so the first step is free and the rest cost
		 * ten game turns each — which is also the arithmetic that says the bat,
		 * asleep out east, gained exactly twice that much energy while he
		 * walked.
		 */
		expect(sim.schedule.gameTurn).toBe((planned - 1) * 10);
		expect(sim.stats.waitingForYou).toBe(true);
	});

	it('spends one turn on a click where he already stands', () => {
		const sim = new Simulation({ cast, seed: 37 });
		run(sim, 0.2);
		expect(sim.schedule.gameTurn).toBe(0);

		// Clicking his own hexagon is how you wait with a mouse.
		sim.pickCell(sim.player.cell);
		run(sim, 0.2);
		expect(sim.stats.actions).toBe(1);

		/*
		 * Still turn zero, and that is Angband's rule rather than an accident:
		 * he starts topped up to a full action, so the first thing he does
		 * costs no game time. The second one is what moves the clock.
		 */
		expect(sim.schedule.gameTurn).toBe(0);
		expect(sim.player.stats.energy).toBe(0);

		sim.pickCell(sim.player.cell);
		run(sim, 0.2);
		expect(sim.stats.actions).toBeGreaterThan(1);
		expect(sim.schedule.gameTurn).toBe(10);
	});

	it('refuses a hexagon there is no way to', () => {
		const sim = new Simulation({ cast, seed: 37 });
		// Well outside the ground's radius, so there is no tile at all.
		expect(sim.pickCell({ q: 40, r: 40 })).toBe(false);
		expect(sim.player.goal).toBeNull();
	});

	it('picks a thing up by standing on its hexagon', () => {
		const sim = new Simulation({ cast, seed: 37 });
		const sword = sim.items.find((i) => i.label === 'sword')!;
		expect(sword.worn).toBe(false);

		// Where it is LYING, read before he sets off. A carried thing's cell is
		// wherever the carrier is, so after the walk this is no longer a fact
		// about the grass.
		const lying = { ...sword.cell };

		expect(sim.pickCell(lying)).toBe(true);
		run(sim, 14);

		expect(sim.player.cell).toEqual(lying);
		expect(sword.worn).toBe(true);
		expect(sim.player.armed).toBe(true);
	});

	/*
	 * The equivalence the change rests on, checked rather than reasoned about.
	 *
	 * The arrangement this replaced drew a worn prop by handing the model the
	 * wearer's pose and a bone name; it now draws it from the prop object's own
	 * world transform, which the scene composed from that same bone. Those are
	 * the same two operations in the same order — parent times bone times part —
	 * so the picture must be identical, and this is what says so. A difference
	 * here is a prop that has moved on screen, which is the one thing this was
	 * not allowed to do.
	 *
	 * Compared with a tolerance rather than exactly, because the two orders
	 * associate the multiplications differently and the last bit of a float32
	 * is allowed to disagree.
	 */
	it('draws a carried prop exactly where the old two-path arrangement did', () => {
		const sim = new Simulation({ cast, seed: 37 });
		const sword = sim.items.find((i) => i.label === 'sword')!;

		expect(sim.pickCell({ ...sword.cell })).toBe(true);
		run(sim, 14);
		expect(sword.worn, 'he picked it up').toBe(true);

		// The new path: one draw call, off the object's world transform.
		const now = new HexInstances(256);
		sword.emit(now);
		expect(now.count, 'the sword drew something').toBeGreaterThan(0);

		// The old one: the model, the wearer's pose, and the wearer's placement.
		const before = new HexInstances(256);
		sword.model.emit(
			before,
			sim.player.world,
			sim.player.x,
			sim.player.y,
			sim.player.z,
			sim.player.yaw,
		);

		expect(now.count).toBe(before.count);
		const a = now.data;
		const b = before.data;
		let worst = 0;
		for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i]! - b[i]!));
		expect(worst, 'every float of every instance').toBeLessThan(1e-5);
	});

	/*
	 * The other half of the same change, and the one worth having: being
	 * carried is being a child of the carrier, so the sword's own place in the
	 * world moves with him. Under the arrangement this replaced its transform
	 * stayed where it was dropped for ever, and only the drawing knew better.
	 */
	it('carries what it picked up, in the scene rather than only in the picture', () => {
		const sim = new Simulation({ cast, seed: 37 });
		const sword = sim.items.find((i) => i.label === 'sword')!;

		expect(sim.pickCell({ ...sword.cell })).toBe(true);
		run(sim, 14);
		expect(sword.worn).toBe(true);
		expect(sword.object.parent).toBe(sim.player.object);

		const carried = { x: sword.x, z: sword.z };
		expect(Math.hypot(carried.x - sim.player.x, carried.z - sim.player.z)).toBeLessThan(1.5);

		// Walk him somewhere else. The sword goes too, because it is part of him.
		const away = { q: sim.player.cell.q - 2, r: sim.player.cell.r };
		expect(sim.pickCell(away)).toBe(true);
		run(sim, 14);

		expect(sim.player.cell).toEqual(away);
		expect(Math.hypot(sword.x - sim.player.x, sword.z - sim.player.z)).toBeLessThan(1.5);
		expect(Math.hypot(sword.x - carried.x, sword.z - carried.z)).toBeGreaterThan(1);
	});

	it('lets the bat take two hexagons for every one of his', () => {
		const sim = new Simulation({ cast, seed: 37 });
		// Walk him at the bat until it wakes and comes for him.
		expect(sim.pickCell(sim.bat.cell)).toBe(true);

		const start = { ...sim.bat.cell };
		run(sim, 20);

		expect(sim.bat.state).not.toBe('asleep');
		// It left its perch under its own steam, which only happens on its turn.
		expect(sim.bat.cell).not.toEqual(start);
		// Both of them have spent the same energy per action, so twice as many
		// of the actions taken belong to the faster one.
		expect(sim.stats.batEnergy).toBeLessThan(ACTION_ENERGY);
	});

	it('never lets either of them stand on the other', () => {
		const sim = new Simulation({ cast, seed: 37 });
		expect(sim.pickCell(sim.bat.cell)).toBe(true);
		for (let i = 0; i < 60 * 30; i++) {
			sim.update(FRAME, { hover: null });
			expect(axialDistance(sim.player.cell, sim.bat.cell)).toBeGreaterThan(0);
		}
	});

	it('only ever has one of them mid-action', () => {
		const sim = new Simulation({ cast, seed: 37 });
		expect(sim.pickCell(sim.bat.cell)).toBe(true);
		for (let i = 0; i < 60 * 20; i++) {
			sim.update(FRAME, { hover: null });
			expect(sim.player.busy && sim.bat.busy).toBe(false);
		}
	});

	it('marks a hexagon as unreachable when it is', () => {
		const sim = new Simulation({ cast, seed: 37 });
		// The anvil's own cell is solid; its neighbours are not.
		expect(sim.player.reachable(sim.world.anvil.cell)).toBe(true);
		const beside = axialNeighbours(sim.world.anvil.cell).some((c) => sim.player.reachable(c));
		expect(beside).toBe(true);
		expect(sim.player.reachable({ q: 40, r: 40 })).toBe(false);
	});
});
