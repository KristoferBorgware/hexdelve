/*
 * A bat's pose, built from a handful of numbers describing what it is doing.
 *
 * Everything it can look like is one graph: the wings underneath, somewhere
 * between folded and thrashing, and a lunge laid over whatever that is. What
 * varies between one frame and the next is not the shape of the graph but the
 * weights, so this takes the weights and nothing else.
 *
 *   wake      0 folded on its feet, 1 up and working
 *   beat      how hard the wings are working, in the units `flight` was
 *             baked at: under half is a settle, 1 a cruise, half again a thrash
 *   rate      how fast the beat runs against the wall clock
 *   lunge     how far through a strike, and how much of it is showing
 *   reachIn   how far it throws itself along its own +Z to close the grid
 *   fall      0 flying, 1 down
 *
 * ## Why this is not the hunt
 *
 * `BatHunt` decides it is biting; this decides what biting looks like. The
 * same split `Player` and `HumanoidAnimator` make, and for the same reason:
 * a class that already owns pathing and turn-taking should not also own four
 * blend weights and three pose buffers.
 *
 * ## Wake and beat, against one axis
 *
 * The `flight` tree is one axis from a perch through a hover and a cruise to a
 * thrash, so the two numbers the hunt thinks in have to become one. Waking
 * takes it off the perch and up to a hover; the beat carries it the rest of
 * the way. That is the whole of the mapping, and it is here rather than in the
 * hunt because which leaf a beat lands on is a fact about the tree.
 *
 * The beat runs on the WALL clock rather than the turn clock, deliberately: a
 * bat's wings beat whether or not it is its move, and freezing them between
 * turns would make the world look paused rather than waiting. So the tree's
 * playhead is advanced at `rate` while its own elapsed clock runs plainly —
 * the perch breathes at its own pace whatever the wings are doing.
 */

import {
	Animator,
	bindClip,
	Component,
	createPose,
	denseToSparse,
	lerpPose,
	Rig,
	sampleBound,
	type BlendTree,
	type BoundClip,
	type Clip,
	type DensePose,
	type GameObject,
} from '@hexdelve/engine';

import { topple } from './actor.js';

/** Face down and over, which is a bat dropping rather than a plank falling. */
const FALL_PITCH = 0.9;
const FALL_ROLL = 1.7;

/** Where the axis puts a hover, a cruise and a thrash — the tree's own thresholds. */
const HOVER_AT = 0.4;
const CRUISE_AT = 0.8;
/** The beats those were baked at. */
const HOVER_BEAT = 0.45;
const CRUISE_BEAT = 1;
const THRASH_BEAT = 1.45;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export class BatAnimator extends Component {
	/* ------------------------------------------------------------ the drive -- */

	/** 0 folded on its feet, 1 up and working. */
	wake = 0;
	/** How hard the wings work: 0.45 a hover, 1 a cruise, 1.45 a thrash. */
	beat = CRUISE_BEAT;
	/** How fast that beat runs, as a multiple of the cycle it was baked at. */
	rate = 1;
	/** How far through a strike, 0 to 1. */
	lunge = 0;
	/** How much of the strike is showing, so it comes on and off rather than snapping. */
	lungeWeight = 0;
	/** How far it throws itself forward, in metres along its own +Z. */
	reachIn = 0;
	/** 0 flying, 1 down. */
	fall = 0;

	/* ------------------------------------------------------------ the graph -- */

	private readonly rigOn: Rig;
	private readonly bones: readonly string[];
	private readonly tree: BlendTree;
	private readonly lungeClip: BoundClip;
	private readonly lungeDuration: number;
	/** The strike's keys, for anything that wants to measure a reach off them. */
	readonly strike: Clip;

	private readonly basePose: DensePose;
	private readonly overlayPose: DensePose;
	private readonly outPose: DensePose;

	constructor(object: GameObject) {
		super(object);
		const rig = object.getComponent(Rig);
		const animator = object.getComponent(Animator);
		if (!rig || !animator) {
			throw new Error(`'${object.name}' needs a rig and an animator before a bat pose`);
		}
		this.rigOn = rig;
		this.bones = rig.asset.bones;

		this.tree = animator.tree('flight').tree();
		const lunge = animator.clip('lunge');
		this.strike = lunge;
		this.lungeClip = bindClip(lunge, rig.asset.index);
		this.lungeDuration = lunge.duration;

		this.basePose = createPose(this.bones.length);
		this.overlayPose = createPose(this.bones.length);
		this.outPose = createPose(this.bones.length);
	}

	/**
	 * Where on the tree's one axis this frame sits.
	 *
	 * Folded to hovering is the wake; hovering to thrashing is the beat, split
	 * at the cruise the middle leaf was baked at so that asking for a cruise
	 * gets the cruise rather than a blend that happens to look like one.
	 */
	get effort(): number {
		const up = clamp01(this.wake) * HOVER_AT;
		if (this.beat <= HOVER_BEAT) return up;
		const span =
			this.beat <= CRUISE_BEAT
				? HOVER_AT +
					((CRUISE_AT - HOVER_AT) * (this.beat - HOVER_BEAT)) / (CRUISE_BEAT - HOVER_BEAT)
				: CRUISE_AT + ((1 - CRUISE_AT) * (this.beat - CRUISE_BEAT)) / (THRASH_BEAT - CRUISE_BEAT);
		// Awake decides how much of that it is allowed: a folded bat is on its
		// perch however hard it would beat if it were up.
		return up + clamp01(this.wake) * (Math.min(1, span) - HOVER_AT);
	}

	/** Build this frame's pose into the rig, from whatever the drive now says. */
	build(dt: number): void {
		const pose = this.rigOn.pose;

		/*
		 * Resolved and stepped by hand rather than through `advance`, because
		 * the two clocks are not the same one: the playhead runs at `rate` so
		 * the wings beat faster when it is going somewhere, and the elapsed
		 * clock runs plainly so the perch breathes at its own pace.
		 */
		this.tree.resolve({ effort: this.effort });
		this.tree.elapsed += dt;
		if (this.tree.cycle > 1e-5) {
			this.tree.phase = wrap01(this.tree.phase + (dt * this.rate) / this.tree.cycle);
		}
		const base = this.tree.evaluate();
		this.basePose.rot.set(base.rot);
		this.basePose.pos.set(base.pos);

		// The strike, over whatever it was doing, and taken off again.
		if (this.lungeWeight > 0.001) {
			sampleBound(this.lungeClip, clamp01(this.lunge) * this.lungeDuration, this.overlayPose);
			lerpPose(this.outPose, this.basePose, this.overlayPose, clamp01(this.lungeWeight));
		} else {
			this.outPose.rot.set(this.basePose.rot);
			this.outPose.pos.set(this.basePose.pos);
		}

		denseToSparse(this.bones, this.outPose, pose);

		/*
		 * The lean into the bite: what the lunge cannot reach across a hexagon,
		 * out and back. It goes in as root translation along its own +Z, which
		 * is where it is facing, which is what it is biting.
		 */
		if (this.reachIn > 1e-4) {
			const root = (pose['root'] ??= { rot: [0, 0, 0], pos: [0, 0, 0] });
			root.pos ??= [0, 0, 0];
			root.pos[2]! += this.reachIn;
		}

		/*
		 * And over, if it is going down. No drop: whatever brought it here has
		 * already put it on the ground, so all that is left is to stop it lying
		 * there as neatly as a bat that chose to perch.
		 */
		if (this.fall > 0) {
			topple(pose, FALL_PITCH * this.fall, FALL_ROLL * this.fall, 0);
		}
	}
}

function wrap01(value: number): number {
	const v = value % 1;
	return v < 0 ? v + 1 : v;
}
