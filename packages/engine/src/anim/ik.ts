/*
 * Analytic two-bone inverse kinematics.
 *
 * Forward kinematics — everything in skeleton.ts — sets joint angles and lets
 * the end of the chain land wherever that puts it. This goes the other way:
 * you say where the end must BE and it solves for the angles. For two bones
 * that solve is closed form, a triangle with two known sides, so there is no
 * iteration and no solver to tune.
 *
 *              mid
 *              /\            L1 = root->mid, L2 = mid->end
 *          L1 /  \ L2        d  = |target - root|
 *            /    \          cos of the angle at root = (L1^2 + d^2 - L2^2) / (2 L1 d)
 *        root ---- target
 *               d
 *
 * The triangle leaves one degree of freedom — it can spin about the
 * root-to-target axis — and that is what the pole is for: it says which way
 * the knee points. Passing the joint's currently animated position as the pole
 * means IK corrects the reach and leaves the authored bend direction alone.
 *
 * Corrections are a weighted slerp from the animated rotation, so weight 0
 * leaves the animation untouched. That weighting is what keeps IK from
 * flattening the life out of a clip: the foot is pinned only while it is
 * actually planted.
 */

import { quat, type QuatLike } from '@hexdelve/shared';

import type { SparsePose } from './pose.js';
import { findBone, parentMap, solveWorld, type Skeleton, type WorldPose } from './skeleton.js';

type Vec3Tuple = [number, number, number];

const DOWN: Vec3Tuple = [0, -1, 0];
const IDENTITY = quat.IDENTITY;

const sub = (a: ArrayLike<number>, b: ArrayLike<number>): Vec3Tuple => [
	a[0]! - b[0]!,
	a[1]! - b[1]!,
	a[2]! - b[2]!,
];
const add = (a: ArrayLike<number>, b: ArrayLike<number>): Vec3Tuple => [
	a[0]! + b[0]!,
	a[1]! + b[1]!,
	a[2]! + b[2]!,
];
const scaled = (a: ArrayLike<number>, s: number): Vec3Tuple => [a[0]! * s, a[1]! * s, a[2]! * s];
const dot = (a: ArrayLike<number>, b: ArrayLike<number>): number =>
	a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const length = (a: ArrayLike<number>): number => Math.sqrt(dot(a, a));

function normalise(a: ArrayLike<number>): Vec3Tuple {
	const l = length(a);
	return l > 1e-9 ? [a[0]! / l, a[1]! / l, a[2]! / l] : [0, 0, 0];
}

function poseRot(pose: SparsePose, name: string): readonly number[] {
	return pose[name]?.rot ?? [0, 0, 0];
}

function setPoseRot(pose: SparsePose, name: string, rot: Vec3Tuple): void {
	const entry = (pose[name] ??= {});
	entry.rot = rot;
}

const qLocal = quat.quat();
const qWorld = quat.quat();
const qDelta = quat.quat();
const qNew = quat.quat();
const qInverse = quat.quat();
const eulerOut: Vec3Tuple = [0, 0, 0];

/**
 * Point a bone's own axis along `desiredDir`, keeping whatever twist the
 * animation had, and write the result back as a local Euler rotation.
 *
 * Returns the bone's new world rotation, so the next bone down can be aimed
 * against an up-to-date parent rather than a stale one.
 */
function aimBoneAxis(
	pose: SparsePose,
	boneName: string,
	parentWorldQ: QuatLike,
	localAxis: ArrayLike<number>,
	desiredDir: ArrayLike<number>,
	weight: number,
): Float32Array {
	const rot = poseRot(pose, boneName);
	quat.fromEulerXYZ(qLocal, rot[0]!, rot[1]!, rot[2]!);
	quat.multiply(qWorld, parentWorldQ, qLocal);

	const current = quat.rotateVec3([0, 0, 0], qWorld, localAxis) as number[];
	quat.fromUnitVectors(qDelta, current, desiredDir);
	if (weight < 0.999) quat.slerp(qDelta, IDENTITY, qDelta, weight);

	quat.multiply(qNew, qDelta, qWorld);
	quat.conjugate(qInverse, parentWorldQ);
	quat.multiply(qLocal, qInverse, qNew);
	setPoseRot(pose, boneName, [...quat.toEulerXYZ(eulerOut, qLocal)] as Vec3Tuple);

	// A copy, because qNew is scratch and the caller holds this across a call.
	return new Float32Array(qNew);
}

function aimBone(
	pose: SparsePose,
	boneName: string,
	parentWorldQ: QuatLike,
	desiredDir: ArrayLike<number>,
	weight: number,
): Float32Array {
	return aimBoneAxis(pose, boneName, parentWorldQ, DOWN, desiredDir, weight);
}

interface Triangle {
	u1: Vec3Tuple;
	u2: Vec3Tuple;
	distance: number;
	reach: number;
	clamped: boolean;
}

function triangle(
	rootPos: ArrayLike<number>,
	target: ArrayLike<number>,
	L1: number,
	L2: number,
	poleDir: ArrayLike<number>,
): Triangle {
	const toTarget = sub(target, rootPos);
	const distance = length(toTarget);
	const maxReach = (L1 + L2) * 0.999;
	const minReach = Math.abs(L1 - L2) + 0.001;
	const d = Math.max(minReach, Math.min(maxReach, distance));
	const dir = normalise(toTarget);

	let bend = sub(poleDir, scaled(dir, dot(poleDir, dir)));
	if (length(bend) < 1e-5) bend = [0, 0, 1];
	bend = normalise(bend);

	const cosRoot = Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)));
	const rootAngle = Math.acos(cosRoot);
	const u1 = add(scaled(dir, Math.cos(rootAngle)), scaled(bend, Math.sin(rootAngle)));
	const midPos = add(rootPos, scaled(u1, L1));

	// Aim the far segment at the true target, so an out-of-reach one still
	// points the limb straight at it rather than somewhere arbitrary.
	const aimAt = distance > maxReach ? ([target[0]!, target[1]!, target[2]!] as Vec3Tuple) : add(rootPos, scaled(dir, d));
	const u2 = normalise(sub(aimAt, midPos));

	return { u1, u2, distance, reach: L1 + L2, clamped: distance > maxReach };
}

export interface IkChain {
	readonly root: string;
	readonly mid: string;
	readonly end: string;
}

export interface IkResult {
	readonly reach: number;
	readonly distance: number;
	readonly clamped: boolean;
}

/**
 * Solve a two-bone chain so that `chain.end` lands on `target`.
 *
 * `pose` is mutated in place. `pole` is a position the mid joint should bend
 * towards; passing the animated mid position preserves the authored bend.
 */
export function solveTwoBone(
	skeleton: Skeleton,
	pose: SparsePose,
	chain: IkChain,
	target: ArrayLike<number>,
	pole: ArrayLike<number>,
	weight: number,
	world?: WorldPose,
): IkResult | null {
	if (weight <= 0.0001) return null;

	const parents = parentMap(skeleton);
	const w = world ?? solveWorld(skeleton, pose);

	const rootPos = w[chain.root]!.p;
	const L1 = length(findBone(skeleton, chain.mid)?.offset ?? [0, 0, 0]);
	const L2 = length(findBone(skeleton, chain.end)?.offset ?? [0, 0, 0]);

	const tri = triangle(rootPos, target, L1, L2, sub(pole, rootPos));

	const rootParent = parents[chain.root];
	const rootParentQ = rootParent ? w[rootParent]!.q : IDENTITY;
	const newRootQ = aimBone(pose, chain.root, rootParentQ, tri.u1, weight);
	aimBone(pose, chain.mid, newRootQ, tri.u2, weight);

	return { reach: tri.reach, distance: tri.distance, clamped: tri.clamped };
}

/**
 * Flatten a bone against level ground: keep its heading, drop its pitch and
 * roll. Used on the foot once the leg is solved, so the sole lies on the
 * terrace instead of pointing wherever the shin left it.
 */
export function levelBone(
	skeleton: Skeleton,
	pose: SparsePose,
	boneName: string,
	weight: number,
	world?: WorldPose,
): void {
	if (weight <= 0.0001) return;

	const parents = parentMap(skeleton);
	const w = world ?? solveWorld(skeleton, pose);
	const parent = parents[boneName];
	const parentQ = parent ? w[parent]!.q : IDENTITY;

	const rot = poseRot(pose, boneName);
	quat.fromEulerXYZ(qLocal, rot[0]!, rot[1]!, rot[2]!);
	quat.multiply(qWorld, parentQ, qLocal);

	const forward = quat.rotateVec3([0, 0, 0], qWorld, [0, 0, 1]) as number[];
	const yaw = Math.atan2(forward[0]!, forward[2]!);
	quat.fromYaw(qDelta, yaw);
	quat.slerp(qNew, qWorld, qDelta, weight);

	quat.conjugate(qInverse, parentQ);
	quat.multiply(qLocal, qInverse, qNew);
	setPoseRot(pose, boneName, [...quat.toEulerXYZ(eulerOut, qLocal)] as Vec3Tuple);
}
