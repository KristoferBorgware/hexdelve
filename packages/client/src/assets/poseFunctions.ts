/*
 * The pose functions the asset files may name.
 *
 * Half the animation in this project has no keys and cannot have any. The
 * stride is a handful of harmonics of one phase angle and a direction of
 * travel; the wing beat is four bones lagging each other round a cycle; the
 * hound's trot is two diagonal pairs half a cycle apart. That is not a gap in
 * the file format — it is the reason the format has a registry instead. A
 * function of a heading covers the whole circle of directions where a blend
 * space over clips covers four of them, so these stay functions.
 *
 * What the files hold is everything around them: that the wanderer has a walk,
 * that its cycle is 0.95 seconds, that the run is the same function at gait 1,
 * that its feet land a quarter and three quarters of the way through. The
 * tuning is data; the curve is code; the entity file names the code and hands
 * it the numbers.
 *
 * This is also the one place where the direction of the dependency shows. The
 * engine owns the mechanism and knows nothing about a character; the client
 * owns the characters. So the registry is filled here, by the package that has
 * something to put in it.
 */

import type { PoseFunction } from '@hexdelve/engine';
import { PoseFunctionRegistry } from '@hexdelve/engine';

import { flyPose, lungePose, perchPose } from '../game/batpose.js';
import {
	bitePose as direBitePose,
	DIRE_RUN_CONTACTS,
	DIRE_STRIDE_PERIOD,
	restPose as direRestPose,
	runPose as direRunPose,
} from '../game/direhoundpose.js';
import {
	SCRAMBLE_CONTACTS,
	SCRAMBLE_PERIOD,
	scramblePose,
	SHAMBLE_CONTACTS,
	SHAMBLE_PERIOD,
	shamblePose,
} from '../game/ghoulpose.js';
import {
	bitePose,
	HOUND_RUN_CONTACTS,
	HOUND_STRIDE_PERIOD,
	restPose,
	runPose,
} from '../game/hellhoundpose.js';
import { runPose as spiderRunPose, spitPose as spiderSpitPose, SPIDER_RUN_CONTACTS, SPIDER_RUN_PERIOD } from '../game/spiderpose.js';
import { stridePose, stridePeriod, STRIDE_CONTACTS, type Direction } from '../game/stride.js';
import {
	pokePose as trollPokePose,
	sleepPose as trollSleepPose,
	smashPose as trollSmashPose,
	STOMP_CONTACTS,
	STOMP_PERIOD,
	stompPose,
	swipePose as trollSwipePose,
} from '../game/trollpose.js';
import { SHUFFLE_CONTACTS, SHUFFLE_PERIOD, shufflePose } from '../game/zombiepose.js';

const TAU = Math.PI * 2;

/** An argument, or what the function does when the file leaves it out. */
const arg = (args: Readonly<Record<string, number>>, name: string, fallback: number): number =>
	args[name] ?? fallback;

/**
 * The humanoid gait: idle, walk, run and every strafe in between.
 *
 * One function rather than three animations, because it was one function
 * already — `amp` is the throttle between standing and a full stride and
 * `gait` the throttle between a walk and a run, so the file asks for a point
 * on those two axes and gets the cycle that belongs to it.
 *
 * At amp 0 the phase is frozen and `time` drives the breathing instead, which
 * is what makes the idle the same function as the walk rather than a special
 * case beside it.
 */
const stride: PoseFunction = {
	id: 'stride',
	duration: (args) => stridePeriod(arg(args, 'gait', 0)),
	contacts: STRIDE_CONTACTS,
	build: ({ args, duration }) => {
		const amp = arg(args, 'amp', 1);
		const gait = arg(args, 'gait', 0);
		const direction: Direction = { x: arg(args, 'x', 0), z: arg(args, 'z', 1) };
		const moving = amp >= 0.02;
		return (t, out) =>
			stridePose(moving ? (t / duration) * TAU : 0, amp, direction, gait, t, out);
	},
};

/**
 * The bat's wings working. `amp` is how hard: a hover is a little under half a
 * full beat, and the cycle is the same length either way — a bat does not beat
 * faster to hover, it beats shallower.
 */
const flight: PoseFunction = {
	id: 'flight',
	duration: 0.72,
	build: ({ args, duration }) => {
		const amp = arg(args, 'amp', 1);
		return (t, out) => flyPose((t / duration) * TAU, amp, t, out);
	},
};

/** Asleep on its feet, wings wrapped round itself, breathing. */
const perch: PoseFunction = {
	id: 'perch',
	// One breath: the pose breathes at 1.5 rad/s, so this is exactly one.
	duration: TAU / 1.5,
	build: () => (t, out) => perchPose(t, out),
};

/**
 * The bat's strike. Keyed by hand rather than a cycle, because it has a
 * beginning, a moment of contact and a recovery, and a sine wave cannot do
 * that — so it does not loop.
 */
const lunge: PoseFunction = {
	id: 'lunge',
	duration: 0.9,
	loop: false,
	build: ({ duration }) => (t, out) => lungePose(t / duration, out),
};

/**
 * The hellhound's trot, and its standstill.
 *
 * Its paws are solved onto the ground the way the dire hellhound's and the
 * ghoul's are, so a planted paw travels straight back at a constant rate and
 * the ground speed measured at the schedule below is the ground the animal
 * actually covers — `test/assets.test.ts` checks the sign and the magnitude.
 */
const houndRun: PoseFunction = {
	id: 'houndRun',
	duration: HOUND_STRIDE_PERIOD,
	contacts: HOUND_RUN_CONTACTS,
	build: ({ args, duration }) => {
		const amp = arg(args, 'amp', 1);
		const moving = amp >= 0.02;
		return (t, out) => runPose(moving ? (t / duration) * TAU : 0, amp, t, out);
	},
};

/** The pounce: gather, throw, contact, recover. */
const houndBite: PoseFunction = {
	id: 'houndBite',
	duration: 0.85,
	loop: false,
	build: ({ duration }) => (t, out) => bitePose(t / duration, out),
};

/**
 * Down on the ground, head up and watching.
 *
 * The cycle is the slowest rhythm in the pose rather than the breath, because
 * a cycle is played by wrapping a playhead at the duration it declares and a
 * rhythm that does not divide into that duration arrives back somewhere other
 * than where it started. The head and the tail move at half the breathing
 * rate, so a cycle is two breaths.
 */
const houndRest: PoseFunction = {
	id: 'houndRest',
	duration: TAU / 0.7,
	build: () => (t, out) => restPose(t, out),
};

/**
 * The dire hellhound's gallop, and its stare.
 *
 * Its rig names a hind paw and a front paw as the pair that alternate, because
 * in a gallop that is the pair that does — a left and a right hind land a tenth
 * of a cycle apart and would read as standing still. `test/assets.test.ts`
 * checks the measured speed comes out forwards.
 */
const direRun: PoseFunction = {
	id: 'direRun',
	duration: DIRE_STRIDE_PERIOD,
	contacts: DIRE_RUN_CONTACTS,
	build: ({ args, duration }) => {
		const amp = arg(args, 'amp', 1);
		const moving = amp >= 0.02;
		return (t, out) => direRunPose(moving ? (t / duration) * TAU : 0, amp, t, out);
	},
};

/** The strike: gather, throw, contact, wrench, recover. */
const direBite: PoseFunction = {
	id: 'direBite',
	duration: 0.9,
	loop: false,
	build: ({ duration }) => (t, out) => direBitePose(t / duration, out),
};

/** Down on its chest, head up and watching. One breath, at 1.3 rad/s. */
const direRest: PoseFunction = {
	id: 'direRest',
	duration: TAU / 1.3,
	build: () => (t, out) => direRestPose(t, out),
};

/**
 * The ghoul's shamble, and the hunched stand it starts from. The wanderer's
 * rig under a gait of its own: the legs are solved against the ground the
 * way the dire hellhound's are, so the crouch never lifts a planted foot.
 */
const ghoulShamble: PoseFunction = {
	id: 'ghoulShamble',
	duration: SHAMBLE_PERIOD,
	contacts: SHAMBLE_CONTACTS,
	build: ({ args, duration }) => {
		const amp = arg(args, 'amp', 1);
		const moving = amp >= 0.02;
		return (t, out) => shamblePose(moving ? (t / duration) * TAU : 0, amp, t, out);
	},
};

/** The ghoul's run: on all fours, diagonal pairs, hands and feet both solved onto the ground. */
const ghoulScramble: PoseFunction = {
	id: 'ghoulScramble',
	duration: SCRAMBLE_PERIOD,
	contacts: SCRAMBLE_CONTACTS,
	build: ({ args, duration }) => {
		const amp = arg(args, 'amp', 1);
		const moving = amp >= 0.02;
		return (t, out) => scramblePose(moving ? (t / duration) * TAU : 0, amp, t, out);
	},
};

/** The zombie's shuffle, and its stand: one leg stepping, the other dragged. */
const zombieShuffle: PoseFunction = {
	id: 'zombieShuffle',
	duration: SHUFFLE_PERIOD,
	contacts: SHUFFLE_CONTACTS,
	build: ({ args, duration }) => {
		const amp = arg(args, 'amp', 1);
		const moving = amp >= 0.02;
		return (t, out) => shufflePose(moving ? (t / duration) * TAU : 0, amp, t, out);
	},
};

/** The spider's scuttle, and its stand: two sets of four legs, each solved onto the ground. */
const spiderRun: PoseFunction = {
	id: 'spiderRun',
	duration: SPIDER_RUN_PERIOD,
	contacts: SPIDER_RUN_CONTACTS,
	build: ({ args, duration }) => {
		const amp = arg(args, 'amp', 1);
		const moving = amp >= 0.02;
		return (t, out) => spiderRunPose(moving ? (t / duration) * TAU : 0, amp, t, out);
	},
};

/** The spider's strike: rear, spit, settle. */
const spiderSpit: PoseFunction = {
	id: 'spiderSpit',
	duration: 1.1,
	loop: false,
	build: ({ duration }) => (t, out) => spiderSpitPose(t / duration, out),
};

/** The troll's stomp, and its stand: each leg solved onto the ground from wherever the pelvis is. */
const trollStomp: PoseFunction = {
	id: 'trollStomp',
	duration: STOMP_PERIOD,
	contacts: STOMP_CONTACTS,
	build: ({ args, duration }) => {
		const amp = arg(args, 'amp', 1);
		const moving = amp >= 0.02;
		return (t, out) => stompPose(moving ? (t / duration) * TAU : 0, amp, t, out);
	},
};

/**
 * The troll's three strikes, keyed by hand and not looping: the club up and
 * down, the club round level, the club driven forward.
 */
const trollSmash: PoseFunction = {
	id: 'trollSmash',
	duration: 1.7,
	loop: false,
	build: ({ duration }) => (t, out) => trollSmashPose(t / duration, out),
};

const trollSwipe: PoseFunction = {
	id: 'trollSwipe',
	duration: 1.4,
	loop: false,
	build: ({ duration }) => (t, out) => trollSwipePose(t / duration, out),
};

const trollPoke: PoseFunction = {
	id: 'trollPoke',
	duration: 1.3,
	loop: false,
	build: ({ duration }) => (t, out) => trollPokePose(t / duration, out),
};

/** Asleep on his side. One breath: the pose breathes at 1.2 rad/s, so this is exactly one. */
const trollSleep: PoseFunction = {
	id: 'trollSleep',
	duration: TAU / 1.2,
	build: () => (t, out) => trollSleepPose(t, out),
};

/**
 * Every pose function this package owns.
 *
 * One registry, exported rather than constructed per caller, because two
 * libraries disagreeing about what `stride` means is not a state worth being
 * able to reach.
 */
export const poseFunctions = new PoseFunctionRegistry().register(
	stride,
	flight,
	perch,
	lunge,
	houndRun,
	houndBite,
	houndRest,
	direRun,
	direBite,
	direRest,
	ghoulShamble,
	ghoulScramble,
	zombieShuffle,
	spiderRun,
	spiderSpit,
	trollStomp,
	trollSmash,
	trollSwipe,
	trollPoke,
	trollSleep,
);
