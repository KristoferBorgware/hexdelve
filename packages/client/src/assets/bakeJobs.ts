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

/**
 * Every clip in the tree that came off a pose function.
 *
 * The two wanderers share one set: the same rig at the same arguments is the
 * same cycle, and a second copy of it would be a second thing to re-bake.
 */
export const bakeJobs: readonly BakeJob[] = [
	// The man. One function at three settings — standing, a full walk, a run —
	// which the tree then blends continuously between.
	{ id: 'wanderer-idle', label: 'Idle', rig: HUMANOID, procedural: 'stride', args: { amp: 0 }, duration: (Math.PI * 2) / 1.8 },
	{ id: 'wanderer-walk', label: 'Walk', rig: HUMANOID, procedural: 'stride', args: { amp: 1, gait: 0 } },
	{ id: 'wanderer-run', label: 'Run', rig: HUMANOID, procedural: 'stride', args: { amp: 1, gait: 1 } },

	// The ghoul, on the man's rig and none of his animations: a hunched shamble
	// and a scramble on all fours. Its stand takes two breaths to a cycle so
	// the slow sway in it closes.
	{ id: 'ghoul-idle', label: 'Idle', rig: HUMANOID, procedural: 'ghoulShamble', args: { amp: 0 }, duration: (Math.PI * 2) / 0.85 },
	{ id: 'ghoul-walk', label: 'Walk', rig: HUMANOID, procedural: 'ghoulShamble', args: { amp: 1 } },
	{ id: 'ghoul-run', label: 'Run', rig: HUMANOID, procedural: 'ghoulScramble', args: { amp: 1 } },

	// The hellhound: a trot, and the three things it does when it is not
	// trotting. Its stand and its rest both run to the slowest rhythm in them.
	{ id: 'hellhound-idle', label: 'Idle', rig: HELLHOUND, procedural: 'houndRun', args: { amp: 0 }, duration: (Math.PI * 2) / 0.85 },
	{ id: 'hellhound-run', label: 'Run', rig: HELLHOUND, procedural: 'houndRun', args: { amp: 1 } },
	{ id: 'hellhound-bite', label: 'Bite', rig: HELLHOUND, procedural: 'houndBite' },
	{ id: 'hellhound-rest', label: 'Rest', rig: HELLHOUND, procedural: 'houndRest' },
];
