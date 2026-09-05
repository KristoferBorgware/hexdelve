/*
 * @hexdelve/authoring — the cycles, as the functions they are derived from.
 *
 * Nothing ships this. The game loads clips: a walk is a file of keys, and what
 * plays it is a blend tree over an axis in metres a second. This package is
 * where those files come FROM, and it is separate for exactly that reason —
 * a client that imported it would be carrying the derivation of every gait
 * around at runtime for the sake of animations it already has written down.
 *
 * Two halves. The pose functions themselves — a stride is a foot path with the
 * leg solved back from it, a wing beat is four bones lagging each other round
 * a cycle — and `bakeJobs`, which says which of them at which arguments makes
 * which clip. `tools/bake-clips.mjs` reads both and writes the asset tree.
 *
 * The functions stay code and are not going to stop being code. Deriving a
 * cycle is what a function is good at; a clip is what a person can open and
 * nudge, and what a tree can blend. Keeping the first out of the shipped
 * bundle is what makes that split real rather than stated.
 */

export { poseFunctions } from './poseFunctions.js';
export { bakeJobs, type BakeJob } from './bakeJobs.js';

/* The functions themselves, for the bench and for anything measuring one. */
export { groundPath, twoLink, plus, turn, span, bearing, heading, type Planar } from './planar.js';
export {
	HUMANOID_CHAIN,
	HUMANOID_SKELETON,
	LEG_LENGTH,
	shoulderOf,
	solveArm,
	solveLeg,
	type SolvedLimb,
	type Step,
	type Trunk,
} from './humanoid.js';
export {
	HUMANOID_SOLE,
	RUN_PERIOD,
	RUN_SPEED,
	STRIDE_CONTACTS,
	stridePeriod,
	stridePose,
	strideVelocity,
	WALK_PERIOD,
	WALK_SPEED,
} from './stride.js';
export { flyPose, lungePose, perchPose, FLAP_PERIOD } from './batpose.js';
export {
	runPose as houndRunPose,
	bitePose as houndBitePose,
	restPose as houndRestPose,
	HOUND_CHAIN,
	HOUND_RUN_CONTACTS,
	HOUND_STRIDE_PERIOD,
	BITE_CONTACT as HOUND_BITE_CONTACT,
} from './hellhoundpose.js';
export {
	runPose as direRunPose,
	bitePose as direBitePose,
	restPose as direRestPose,
	DIRE_CHAIN,
	DIRE_RUN_CONTACTS,
	DIRE_STRIDE_PERIOD,
	DIRE_BITE_CONTACT,
} from './direhoundpose.js';
export {
	scramblePose,
	shamblePose,
	SCRAMBLE_CONTACTS,
	SCRAMBLE_PERIOD,
	SHAMBLE_CONTACTS,
	SHAMBLE_PERIOD,
	GHOUL_SOLE,
	GHOUL_PALM,
} from './ghoulpose.js';
export { shufflePose, SHUFFLE_CONTACTS, SHUFFLE_PERIOD, ZOMBIE_SOLE } from './zombiepose.js';
export {
	runPose as spiderRunPose,
	spitPose as spiderSpitPose,
	SPIDER_CHAIN,
	SPIDER_RUN_CONTACTS,
	SPIDER_RUN_PERIOD,
	SPIDER_TIP,
	SPIT_AT,
	TIP_NAMES as SPIDER_TIPS,
} from './spiderpose.js';
export {
	stompPose as trollStompPose,
	smashPose as trollSmashPose,
	swipePose as trollSwipePose,
	pokePose as trollPokePose,
	sleepPose as trollSleepPose,
	STOMP_CONTACTS,
	STOMP_PERIOD,
	SMASH_HIT,
	SWIPE_HIT,
	POKE_HIT,
	TROLL_CHAIN,
	TROLL_SOLE,
} from './trollpose.js';
export {
	waddlePose as lemureWaddlePose,
	clawPose as lemureClawPose,
	CLAW_HIT,
	LEMURE_CHAIN,
	LEMURE_SOLE,
	WADDLE_CONTACTS,
	WADDLE_PERIOD,
} from './lemurepose.js';
