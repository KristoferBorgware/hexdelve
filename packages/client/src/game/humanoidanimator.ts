/*
 * A man's pose, built from a handful of numbers describing what he is doing.
 *
 * Everything he can look like is one graph: a stride underneath, a guard held
 * over it masked to the arms, and at most one whole-body clip — a stoop or a
 * cut — over that. What varies between one frame and the next is not the shape
 * of the graph but the weights, so this takes the weights and nothing else.
 *
 *   amp, gait, theta     the stride: how big, how fast, how far through
 *   yawRate              the lean into a turn, which the stride cannot know
 *   reachIn              how far he leans into a blow, along his own +Z
 *   armed, shielded      whether the guard is held, and by which arm
 *   overlay, phase       what his whole body is doing, and how far through it
 *   fall                 0 upright, 1 lying still
 *
 * ## Why this is not the behaviour
 *
 * `Player` decides he is cutting; this decides what cutting looks like. That
 * split is what lets the same body be driven by a bench slider, and it is what
 * stops a class that already owns turn-taking and pathing from also owning four
 * blend weights and five pose buffers.
 *
 * ## Why it is not the engine's `Animator` either
 *
 * `Animator` holds the animations an entity has, by name, and knows nothing
 * about what any of them mean. This knows that `guard` goes on the arms, that a
 * stoop and a cut are exclusive, and that a run gets some counter-swing back —
 * which are facts about a man with a sword, not about animation. The engine has
 * never heard of a guard and should not.
 *
 * The clips come off the `Animator` beside it, so what he plays is what his
 * entity file gave him.
 */

import {
	Animator,
	bindClip,
	Component,
	createPose,
	denseToSparse,
	lerpPose,
	lerpPoseMasked,
	makeMask,
	Rig,
	sampleBound,
	sparseToDense,
	type BoundClip,
	type Clip,
	type DensePose,
	type GameObject,
	type SparsePose,
} from '@hexdelve/engine';

import { clamp, topple } from './actor.js';
import { stridePose, type Direction } from './stride.js';

const PI = Math.PI;

/** On the grid he walks where he faces, so the stride needs one direction. */
const FORWARD: Direction = { x: 0, z: 1 };

/** How much of the guard the sword arm keeps at a full run. */
const GUARD_AT_SPEED = 0.65;

/** Face down and a quarter turn over, which is a man falling rather than a plank. */
const FALL_PITCH = 1.45;
const FALL_ROLL = 0.35;
/** How much of his hip height he loses on the way down. */
const FALL_SETTLE = 0.78;

/** What his whole body is doing, if it is doing one thing. */
export type HumanoidOverlay = 'none' | 'stoop' | 'swing';

export class HumanoidAnimator extends Component {
	/* ------------------------------------------------------------ the drive -- */

	/** 0 standing, 1 a full stride. */
	amp = 0;
	/** 0 a walk, 1 a run. */
	gait = 0;
	/** How far through the gait cycle he is, in radians. */
	theta = 0;
	/** Radians a second he is coming round, for the lean into it. */
	yawRate = 0;
	/** How far to reach into a blow, in metres along his own +Z. */
	reachIn = 0;
	armed = false;
	shielded = false;
	overlay: HumanoidOverlay = 'none';
	/** How far through that overlay, 0 to 1. */
	phase = 1;
	/** True once the overlay has finished but the action has not. */
	overlayDone = false;
	/** 0 upright, 1 lying still. */
	fall = 0;

	/* ------------------------------------------------------------ the graph -- */

	private readonly rigOn: Rig;
	private readonly bones: readonly string[];
	private readonly hipHeight: number;

	private readonly clips: { readonly duck: Clip; readonly slash: Clip; readonly guard: Clip };
	private readonly duckClip: BoundClip;
	private readonly slashClip: BoundClip;
	private readonly guardClip: BoundClip;

	/**
	 * The guard masks. The shield arm holds it out whatever his legs are doing,
	 * the sword side eases off as he speeds up so a run gets some counter-swing
	 * back, and the bladed stance at the root is only for a man standing still.
	 */
	private readonly GUARD_SHIELD: Float32Array;
	private readonly GUARD_SWORD: Float32Array;
	private readonly ROOT_ONLY: Float32Array;
	private readonly UPPER: Float32Array;

	// Pose buffers, allocated once.
	private readonly strideBuf: SparsePose = {};
	private readonly basePose: DensePose;
	private readonly guardPose: DensePose;
	private readonly stancePose: DensePose;
	private readonly overlayPose: DensePose;
	private readonly outPose: DensePose;

	private bank = 0;
	private lean = 0;
	private guardWeight = 0;
	private stoopBlend = 0;
	private swingBlend = 0;

	constructor(object: GameObject) {
		super(object);
		const rig = object.getComponent(Rig);
		const animator = object.getComponent(Animator);
		if (!rig || !animator) {
			throw new Error(`'${object.name}' needs a rig and an animator before a humanoid pose`);
		}
		this.rigOn = rig;

		const asset = rig.asset;
		this.bones = asset.bones;
		this.hipHeight = asset.metrics['hipHeight'] ?? 0.9;

		this.clips = {
			duck: animator.clip('duck'),
			slash: animator.clip('slash'),
			guard: animator.clip('guard'),
		};
		this.duckClip = bindClip(this.clips.duck, asset.index);
		this.slashClip = bindClip(this.clips.slash, asset.index);
		this.guardClip = bindClip(this.clips.guard, asset.index);

		this.GUARD_SHIELD = makeMask(this.bones, { armL: 1, forearmL: 1, handL: 1 }, 0);
		this.GUARD_SWORD = makeMask(
			this.bones,
			{ armR: 1, forearmR: 1, handR: 1, spine: 0.45, chest: 1, neck: 1, head: 1 },
			0,
		);
		this.ROOT_ONLY = makeMask(this.bones, { root: 1 }, 0);
		// The upper-body one is the rig's own, because a mask is a fact about a
		// skeleton and belongs in the file that has one.
		this.UPPER = makeMask(this.bones, asset.masks['upperBody'] ?? {}, 0);

		this.basePose = createPose(this.bones.length);
		this.guardPose = createPose(this.bones.length);
		this.stancePose = createPose(this.bones.length);
		this.overlayPose = createPose(this.bones.length);
		this.outPose = createPose(this.bones.length);
	}

	/** The clips he plays, for anything that wants to measure one. */
	get clip(): { readonly duck: Clip; readonly slash: Clip; readonly guard: Clip } {
		return this.clips;
	}

	/** Build this frame's pose into the rig, from whatever the drive now says. */
	build(dt: number, elapsed: number): void {
		const pose = this.rigOn.pose;
		stridePose(this.theta, this.amp, FORWARD, this.gait, elapsed, this.strideBuf);

		// A lean into the turn, which is the one thing the stride cannot know:
		// it is handed a heading, not the fact that the whole man is coming
		// round.
		const wantBank = -clamp(this.yawRate * 0.05, -0.2, 0.2) * this.amp;
		this.bank += (wantBank - this.bank) * Math.min(1, dt * 6);
		this.strideBuf['root']!.rot![2]! += this.bank;

		/*
		 * The lean into a blow: the shortfall between his reach and the grid,
		 * out and back across the swing. It goes in as root translation along
		 * his own +Z, which is where he is facing, which is what he is cutting.
		 */
		const wantLean =
			this.overlay === 'swing' ? this.reachIn * Math.sin(PI * Math.min(1, this.phase)) : 0;
		this.lean += (wantLean - this.lean) * Math.min(1, dt * 12);
		if (this.lean > 1e-4) this.strideBuf['root']!.pos![2]! += this.lean;

		sparseToDense(this.bones, this.strideBuf, this.basePose);

		const stooping = this.overlay === 'stoop';
		const striking = this.overlay === 'swing';
		const wantStoop = stooping && !this.overlayDone ? 1 : 0;
		this.stoopBlend += (wantStoop - this.stoopBlend) * Math.min(1, dt * 9);
		const wantSwing = striking ? 1 : 0;
		this.swingBlend += (wantSwing - this.swingBlend) * Math.min(1, dt * 14);

		// The guard, over the top, masked to the arms so the legs keep the gait.
		const carrying = this.armed || this.shielded;
		const wantGuard = carrying && !stooping ? 1 : 0;
		this.guardWeight += (wantGuard - this.guardWeight) * Math.min(1, dt * 4);

		let base = this.basePose;
		if (this.guardWeight > 0.002) {
			sampleBound(this.guardClip, 0, this.guardPose);
			let src = this.basePose;
			if (this.shielded) {
				lerpPoseMasked(this.stancePose, src, this.guardPose, this.guardWeight, this.GUARD_SHIELD);
				src = this.stancePose;
			}
			if (this.armed) {
				const hold = 1 - (1 - GUARD_AT_SPEED) * this.amp;
				lerpPoseMasked(this.stancePose, src, this.guardPose, this.guardWeight * hold, this.GUARD_SWORD);
				src = this.stancePose;
			}
			const settled = 1 - this.amp;
			if (settled > 0.01) {
				lerpPoseMasked(this.stancePose, src, this.guardPose, this.guardWeight * settled, this.ROOT_ONLY);
				src = this.stancePose;
			}
			base = src;
		}

		/*
		 * Then the one thing his whole body is doing, if it is doing one.
		 *
		 * Both clips are played *over the action*, not at their authored rate:
		 * `phase` is a fraction of the turn rather than a time in seconds. So a
		 * faster creature's cut is a faster cut, by the same table that gives it
		 * the extra turn — and the contact key lands at the same fraction of the
		 * blow however long the blow is.
		 */
		if (this.stoopBlend > 0.002) {
			sampleBound(this.duckClip, this.phase * this.clips.duck.duration, this.overlayPose);
			lerpPose(this.outPose, base, this.overlayPose, this.stoopBlend);
		} else if (this.swingBlend > 0.002) {
			sampleBound(this.slashClip, this.phase * this.clips.slash.duration, this.overlayPose);
			// Standing, the cut gets all of him; mid-stride it gets his arms and
			// leaves the legs to the walk. He cannot do both on the grid, but
			// the mask is what makes that a rule of the game rather than of the
			// animation.
			const mask = this.amp > 0.05 ? this.UPPER : null;
			if (mask) lerpPoseMasked(this.outPose, base, this.overlayPose, this.swingBlend, mask);
			else lerpPose(this.outPose, base, this.overlayPose, this.swingBlend);
		} else {
			this.outPose.rot.set(base.rot);
			this.outPose.pos.set(base.pos);
		}

		denseToSparse(this.bones, this.outPose, pose);

		/*
		 * And then, if he is going down, he goes down out of whatever that was.
		 *
		 * Forward and a little to the side rather than straight back, which is
		 * what a man does when his legs stop rather than what a plank does. The
		 * drop is most of a hip height, so he comes to rest on the grass instead
		 * of lying in the air where his hips used to be.
		 */
		if (this.fall > 0) {
			const t = this.fall;
			topple(pose, FALL_PITCH * t, FALL_ROLL * t, this.hipHeight * FALL_SETTLE * t);
		}
	}
}
