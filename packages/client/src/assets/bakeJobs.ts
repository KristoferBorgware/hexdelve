/*
 * What gets baked into a clip, and from what.
 *
 * A pose function derives a cycle; a clip is the cycle, written down. Once an
 * entity names the clip, the arguments it was derived FROM are no longer
 * anywhere in the asset tree — and without them the gait can be tuned once and
 * never again, because a re-bake has nothing to read. So the arguments live
 * here, beside the functions they are arguments to.
 *
 * This is authoring data rather than game data, which is why it is a module
 * and not a file under `public/assets`: nothing the game loads reads it, and
 * it travels with the pose functions when they leave the client.
 *
 * A job is one clip. The entity is named for its rig — a clip's numbers are
 * about a particular skeleton — and the rest is what the entity's animator used
 * to say inline: which function, at what arguments, over what cycle.
 */

export interface BakeJob {
	/** The clip written, as `clips/<id>.clip.yaml`. */
	readonly id: string;
	/** A name for the file, and the label an entity gets if it states none. */
	readonly label: string;
	/** The rig its numbers are about, as a path from the asset root. */
	readonly rig: string;
	/** The pose function, by the id it is registered under. */
	readonly procedural: string;
	readonly args?: Readonly<Record<string, number>>;
	/** One cycle in seconds. Absent takes the function's own. */
	readonly duration?: number;
	/** Where in the cycle (0..1) each foot lands. Absent takes the function's. */
	readonly contacts?: readonly number[];
}

const HUMANOID = '../rigs/humanoid.rig.yaml';
const HELLHOUND = '../rigs/hellhound.rig.yaml';
const DIREHOUND = '../rigs/direhound.rig.yaml';
const BAT = '../rigs/bat.rig.yaml';
const SPIDER = '../rigs/spider.rig.yaml';
const TROLL = '../rigs/troll.rig.yaml';

/** A cycle stated by its rate, which is how every stand below picks one. */
const cycle = (rate: number): number => (Math.PI * 2) / rate;

/**
 * Every clip in the tree that came off a pose function.
 *
 * The two wanderers share one set: the same rig at the same arguments is the
 * same cycle, and a second copy of it would be a second thing to re-bake.
 */
export const bakeJobs: readonly BakeJob[] = [
	// The man. One function at three settings — standing, a full walk, a run —
	// which the tree then blends continuously between.
	{ id: 'wanderer-idle', label: 'Idle', rig: HUMANOID, procedural: 'stride', args: { amp: 0 }, duration: cycle(1.8) },
	{ id: 'wanderer-walk', label: 'Walk', rig: HUMANOID, procedural: 'stride', args: { amp: 1, gait: 0 } },
	{ id: 'wanderer-run', label: 'Run', rig: HUMANOID, procedural: 'stride', args: { amp: 1, gait: 1 } },

	// The ghoul, on the man's rig and none of his animations: a hunched shamble
	// and a scramble on all fours. Its stand takes two breaths to a cycle so
	// the slow sway in it closes.
	{ id: 'ghoul-idle', label: 'Idle', rig: HUMANOID, procedural: 'ghoulShamble', args: { amp: 0 }, duration: cycle(0.85) },
	{ id: 'ghoul-walk', label: 'Walk', rig: HUMANOID, procedural: 'ghoulShamble', args: { amp: 1 } },
	{ id: 'ghoul-run', label: 'Run', rig: HUMANOID, procedural: 'ghoulScramble', args: { amp: 1 } },

	// The hellhound: a trot, and the three things it does when it is not
	// trotting. Its stand and its rest both run to the slowest rhythm in them.
	{ id: 'hellhound-idle', label: 'Idle', rig: HELLHOUND, procedural: 'houndRun', args: { amp: 0 }, duration: cycle(0.85) },
	{ id: 'hellhound-run', label: 'Run', rig: HELLHOUND, procedural: 'houndRun', args: { amp: 1 } },
	{ id: 'hellhound-bite', label: 'Bite', rig: HELLHOUND, procedural: 'houndBite' },
	{ id: 'hellhound-rest', label: 'Rest', rig: HELLHOUND, procedural: 'houndRest' },

	// The dire hellhound: a gallop, a strike, and the stare it does neither
	// from. Both of the still ones run to the slowest rhythm they carry.
	{ id: 'direhound-idle', label: 'Idle', rig: DIREHOUND, procedural: 'direRun', args: { amp: 0 }, duration: cycle(0.8) },
	{ id: 'direhound-run', label: 'Run', rig: DIREHOUND, procedural: 'direRun', args: { amp: 1 } },
	{ id: 'direhound-bite', label: 'Attack bite', rig: DIREHOUND, procedural: 'direBite' },
	{ id: 'direhound-rest', label: 'Rest', rig: DIREHOUND, procedural: 'direRest', duration: cycle(0.65) },

	// The bat. A hover is the same beat at a shallower amplitude, which is what
	// a bat does rather than beating faster.
	{ id: 'bat-fly', label: 'Fly', rig: BAT, procedural: 'flight', args: { amp: 1 } },
	{ id: 'bat-hover', label: 'Hover', rig: BAT, procedural: 'flight', args: { amp: 0.45 } },
	{ id: 'bat-perch', label: 'Perch', rig: BAT, procedural: 'perch', duration: cycle(0.75) },
	{ id: 'bat-lunge', label: 'Lunge', rig: BAT, procedural: 'lunge' },

	// The zombie: one shuffle, and the stand it drags itself out of.
	{ id: 'zombie-idle', label: 'Idle', rig: HUMANOID, procedural: 'zombieShuffle', args: { amp: 0 }, duration: cycle(0.7) },
	{ id: 'zombie-walk', label: 'Walk', rig: HUMANOID, procedural: 'zombieShuffle', args: { amp: 1 } },

	// The spider: eight legs solved onto the ground, and the wait between.
	{ id: 'spider-idle', label: 'Idle', rig: SPIDER, procedural: 'spiderRun', args: { amp: 0 }, duration: cycle(0.8) },
	{ id: 'spider-run', label: 'Run', rig: SPIDER, procedural: 'spiderRun', args: { amp: 1 } },
	{ id: 'spider-spit', label: 'Spit', rig: SPIDER, procedural: 'spiderSpit' },

	// The troll: a stomp, three ways of swinging a club, and a sleep.
	{ id: 'troll-idle', label: 'Idle', rig: TROLL, procedural: 'trollStomp', args: { amp: 0 }, duration: cycle(1.1) },
	{ id: 'troll-walk', label: 'Walk', rig: TROLL, procedural: 'trollStomp', args: { amp: 1 } },
	{ id: 'troll-smash', label: 'Attack smash', rig: TROLL, procedural: 'trollSmash' },
	{ id: 'troll-swipe', label: 'Attack swipe', rig: TROLL, procedural: 'trollSwipe' },
	{ id: 'troll-poke', label: 'Attack poke', rig: TROLL, procedural: 'trollPoke' },
	{ id: 'troll-rest', label: 'Rest', rig: TROLL, procedural: 'trollSleep', duration: cycle(1.2) },
];
