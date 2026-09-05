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
	secondsPerGameTurn,
	setWalkSpeed,
	Schedule,
	playerOrders,
	Simulation,
	WALK_SPEED,
	actionSeconds,
	energyPerTurn,
	gameTurnsPerAction,
	hexSpeed,
	speedFactor,
	type PlayerOrders,
	type TurnMember,
} from '@hexdelve/client';

import {
	calibrateSpeed,
	entityAnimations,
	entityBlendTrees,
	entityMesh,
	entityRig,
	HexInstances,
	MeshRenderer,
	scriptsFromBundle,
	type ScriptProvider,
	type SystemAsset,
} from '@hexdelve/engine';

import { bundleScripts } from '../tools/build-scripts.mjs';
import { loadYardCast, openLibrary } from './harness/assets.js';
import { SDK_MODULES } from './harness/sdk.js';

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
		expect(HEX_SPACING / actionSeconds(ACTION_ENERGY, NORMAL_SPEED)).toBeCloseTo(clipWalk, 6);
		expect(secondsPerGameTurn() * gameTurnsPerAction(NORMAL_SPEED)).toBeCloseTo(
			HEX_SPACING / clipWalk,
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

/*
 * The clock, before anything asks it the time.
 *
 * One game turn is a tenth of the time the player's walk takes to cross a
 * hexagon, and what that walk carries him at is measured off the clip he is
 * drawn with — so it comes off the asset tree rather than out of an import,
 * exactly as it does when the game builds a simulation.
 */
let clipWalk = 0;

beforeAll(async () => {
	const wanderer = await openLibrary().entity('entities/wanderer.entity.yaml');
	clipWalk = entityAnimations(wanderer).get('walk')!.speed()!.z;
	setWalkSpeed(clipWalk);
});

describe('the rules asking the gait for a speed', () => {
	/*
	 * What `strideFor` used to answer by bisecting the pose function, the blend
	 * tree's calibration answers by sweeping the tree it will actually be
	 * played through. The question is the same one and it is the load-bearing
	 * one: the rules give him a speed, and if his legs deliver something else
	 * the readout is lying about the fight.
	 */
	let axis: { min: number; max: number };
	let calibration: Awaited<ReturnType<typeof calibrate>>;

	async function calibrate() {
		const library = openLibrary();
		const wanderer = await library.entity('entities/wanderer.entity.yaml');
		const rig = entityRig(wanderer)!;
		const tree = entityBlendTrees(wanderer).get('locomotion')!;
		const speed = tree.parameters.find((one) => one.name === 'speed')!;
		axis = { min: speed.min, max: speed.max };
		return calibrateSpeed(tree.tree(), rig.skeleton, 'speed', [speed.min, speed.max], {
			feet: rig.feet!,
			params: { turn: 0, lean: 0, guard: 0 },
		});
	}

	beforeAll(async () => {
		calibration = await calibrate();
	});

	it('answers a normal-speed step with a plain walk', async () => {
		const asked = hexSpeed(NORMAL_SPEED);
		expect(asked).toBeCloseTo(clipWalk, 6);
		expect(calibration.speedFor(calibration.parameterFor(asked))).toBeCloseTo(asked, 3);
	});

	it('hits any speed between a walk and a run', () => {
		const middle = (WALK_SPEED + RUN_SPEED) / 2;
		expect(calibration.speedFor(calibration.parameterFor(middle))).toBeCloseTo(middle, 3);
	});

	it('says so honestly past a full run rather than hiding the shortfall', () => {
		// There is no more leg past the top of the axis, so asking for more
		// pins the parameter there and the difference is the feet sliding.
		const beyond = RUN_SPEED * 1.5;
		expect(calibration.parameterFor(beyond)).toBeCloseTo(axis.max, 6);
		expect(calibration.maxSpeed).toBeLessThan(beyond);
	});

	it('shortens the step rather than slowing the cycle below a walk', async () => {
		const library = openLibrary();
		const wanderer = await library.entity('entities/wanderer.entity.yaml');
		const tree = entityBlendTrees(wanderer).get('locomotion')!;
		const walk = entityAnimations(wanderer).get('walk')!;

		// Below a walk the tree mixes the idle in, and the idle does not take
		// part in the shared cycle — so the cadence stays the walk's and what
		// shortens is the stride. That is what `sync: false` on the idle buys.
		const built = tree.tree();
		built.resolve({ speed: calibration.parameterFor(WALK_SPEED / 2), turn: 0, lean: 0, guard: 0 });
		expect(built.cycle).toBeCloseTo(walk.duration, 6);
		expect(calibration.speedFor(calibration.parameterFor(WALK_SPEED / 2))).toBeCloseTo(
			WALK_SPEED / 2,
			2,
		);
	});

	it('turns a row of the energy table into a gait', () => {
		// +10 has to cross a hexagon in half the time, and the only thing that
		// can be is a run.
		const hasted = hexSpeed(NORMAL_SPEED + 10);
		expect(calibration.parameterFor(hasted)).toBeGreaterThan(WALK_SPEED);
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
			entityRig(cast.player)!.skeleton,
			clipOf(cast.player, 'slash'),
			entityMesh(sword)!.anchors.tip!.at,
		);
		const bite = measureBiteReach(
			entityRig(cast.enemy)!,
			entityAnimations(cast.enemy).get('lunge')!.clip!,
		);

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
	let scripts: ScriptProvider;
	let systems: SystemAsset;

	/*
	 * The yard needs its scripts compiled and its systems spawned, because both
	 * halves of what these tests check are scripts now: what a click means is
	 * `PlayerInput`, and who acts next is `Turns` on the system prefab. A
	 * simulation built without them has two bodies that can be drawn and no
	 * clock to move them.
	 */
	beforeAll(async () => {
		cast = await loadYardCast();
		systems = await openLibrary().system('systems/game.system.yaml');
		scripts = scriptsFromBundle((await bundleScripts()).code, SDK_MODULES);
	}, 120_000);

	/** The orders on the man in a yard, which every test here has given him. */
	function orders(sim: Simulation): PlayerOrders {
		const found = playerOrders(sim.player.object);
		if (!found) throw new Error('the yard spawned no PlayerInput on the man');
		return found;
	}

	const axialEqual = (a: Axial, b: Axial): boolean => a.q === b.q && a.r === b.r;

	/** Run the simulation as a client would, for a number of seconds. */
	function run(sim: Simulation, seconds: number): void {
		for (let i = 0; i < Math.round(seconds / FRAME); i++) sim.update(FRAME, { hover: null });
	}

	it('holds still until you ask for something', () => {
		const sim = new Simulation({ cast, seed: 37, systems: [systems], scripts });
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
		const sim = new Simulation({ cast, seed: 37, systems: [systems], scripts });
		const from = { ...sim.player.cell };

		// Three tiles away, and away from the bat so the walk is not a fight.
		const goal: Axial = { q: from.q - 3, r: from.r };
		expect(sim.pickCell(goal)).toBe(true);

		// A route at least as long as the crow flies. It can be longer: a
		// terrace he cannot climb is a wall, so the way round it is the way.
		const planned = orders(sim).path.length;
		expect(planned).toBeGreaterThanOrEqual(axialDistance(from, goal));
		expect(orders(sim).path[planned - 1]).toEqual(goal);

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
		const sim = new Simulation({ cast, seed: 37, systems: [systems], scripts });
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
		const sim = new Simulation({ cast, seed: 37, systems: [systems], scripts });
		// Well outside the ground's radius, so there is no tile at all.
		expect(sim.pickCell({ q: 40, r: 40 })).toBe(false);
		expect(orders(sim).goal).toBeNull();
	});

	it('picks a thing up by standing on its hexagon', () => {
		const sim = new Simulation({ cast, seed: 37, systems: [systems], scripts });
		const sword = sim.items.find((i) => i.name === 'sword')!;
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
		const sim = new Simulation({ cast, seed: 37, systems: [systems], scripts });
		const sword = sim.items.find((i) => i.name === 'sword')!;

		expect(sim.pickCell({ ...sword.cell })).toBe(true);
		run(sim, 14);
		expect(sword.worn, 'he picked it up').toBe(true);

		// The new path: one draw call, off the object's world transform.
		const now = new HexInstances(256);
		sword.emit(now);
		expect(now.count, 'the sword drew something').toBeGreaterThan(0);

		// The old one: the model, the wearer's pose, and the wearer's placement.
		const before = new HexInstances(256);
		sword.object.getComponent(MeshRenderer)!.model.emit(
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
		const sim = new Simulation({ cast, seed: 37, systems: [systems], scripts });
		const sword = sim.items.find((i) => i.name === 'sword')!;

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
		const sim = new Simulation({ cast, seed: 37, systems: [systems], scripts });
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

	/*
	 * The other half of the hunt, and the half nothing else here walks: it gives
	 * up, goes home, and folds its wings. Home is the hexagon it was standing on
	 * when it first acted rather than a number handed to it, so this is also
	 * what pins that — a bat that learned the wrong perch would settle in the
	 * wrong place, or never settle at all.
	 *
	 * Walking away does not do it, and that is a fact about the game rather
	 * than about this test: it is twice his speed, so a man on foot cannot open
	 * a gap of `loseRange` in the first place. What loses it is the quarry
	 * ceasing to be where it thinks — so the quarry is moved, and the hunt is
	 * left to notice.
	 */
	it('sends the bat home to the hexagon it woke from, and back to sleep', () => {
		const sim = new Simulation({ cast, seed: 37, systems: [systems], scripts });
		const perch = { ...sim.bat.cell };

		/*
		 * The quarry is moved rather than walked at, and both halves of the test
		 * do it. Walking him at the bat would start a fight — the yard has its
		 * combat rule in it now — and a bat being bitten and reeling is not what
		 * this is about. What it hunts is whatever its opponent says, which is
		 * the only thing it reads him through.
		 *
		 * He still has to ask for something each round, because a turn is only
		 * handed out while he has: a yard where nobody wants anything does not
		 * tick, which is the whole of what turn-based means here.
		 */
		const step = (until: () => boolean): void => {
			for (let i = 0; i < 60 && !until(); i++) {
				sim.hold();
				run(sim, 2);
			}
		};

		sim.bat.opponent = { cell: { q: perch.q - 2, r: perch.r }, x: 0, z: 0 };
		step(() => sim.bat.state !== 'asleep');
		expect(sim.bat.state, 'it woke and came for him').not.toBe('asleep');
		step(() => !axialEqual(sim.bat.cell, perch));
		expect(sim.bat.cell, 'and left the perch').not.toEqual(perch);

		// Somewhere it can never reach and never sees again.
		sim.bat.opponent = { cell: { q: 60, r: 60 }, x: 120, z: 120 };
		step(() => sim.bat.state === 'asleep');

		expect(sim.bat.cell, 'it flew back to where it started').toEqual(perch);
		expect(sim.bat.state).toBe('asleep');
	});

	/*
	 * The ranges are the script's parameters, set in `bat.entity.yaml`. Read
	 * back through the readout, which is the only place they are shown: a hunt
	 * whose numbers did not arrive from the file would hunt at its defaults and
	 * nothing on screen would say so.
	 */
	it('takes the bat’s ranges from its entity file', () => {
		const sim = new Simulation({ cast, seed: 37, systems: [systems], scripts });
		expect(sim.stats.wakeRange).toBe(3);
		expect(sim.stats.loseRange).toBe(6);
	});

	it('never lets either of them stand on the other', () => {
		const sim = new Simulation({ cast, seed: 37, systems: [systems], scripts });
		expect(sim.pickCell(sim.bat.cell)).toBe(true);
		for (let i = 0; i < 60 * 30; i++) {
			sim.update(FRAME, { hover: null });
			expect(axialDistance(sim.player.cell, sim.bat.cell)).toBeGreaterThan(0);
		}
	});

	it('only ever has one of them mid-action', () => {
		const sim = new Simulation({ cast, seed: 37, systems: [systems], scripts });
		expect(sim.pickCell(sim.bat.cell)).toBe(true);
		for (let i = 0; i < 60 * 20; i++) {
			sim.update(FRAME, { hover: null });
			expect(sim.player.busy && sim.bat.busy).toBe(false);
		}
	});

	it('marks a hexagon as unreachable when it is', () => {
		const sim = new Simulation({ cast, seed: 37, systems: [systems], scripts });
		// The anvil's own cell is solid; its neighbours are not.
		expect(orders(sim).reachable(sim.world.anvil.cell)).toBe(true);
		const beside = axialNeighbours(sim.world.anvil.cell).some((c) => orders(sim).reachable(c));
		expect(beside).toBe(true);
		expect(orders(sim).reachable({ q: 40, r: 40 })).toBe(false);
	});
});
