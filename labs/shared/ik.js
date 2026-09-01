/*
 * labs/shared/ik.js — analytic two-bone inverse kinematics.
 *
 * Engine-free, like anim.js: it reads a pose, works out where the joints would
 * have to be, and writes the corrected angles back into that same pose.
 *
 * Forward kinematics, which is everything the other labs do, sets joint angles
 * and lets the hand land wherever the chain puts it. Inverse kinematics goes
 * the other way: you say where the end of the chain must BE, and it solves for
 * the angles. For a two-bone limb that solve is closed-form — a triangle with
 * two known sides — so there is no iteration and no solver to tune.
 *
 *              mid
 *              /\            L1 = root→mid, L2 = mid→end
 *          L1 /  \ L2        d  = |target − root|
 *            /    \          cos of the angle at root  = (L1² + d² − L2²) / (2·L1·d)
 *        root ---- target    cos of the angle at mid   = (L1² + L2² − d²) / (2·L1·L2)
 *               d
 *
 * The triangle leaves one degree of freedom: it can spin about the root→target
 * axis. That is what the POLE is for — it says which way the knee or elbow
 * points. Passing the joint's currently animated position as the pole means IK
 * only corrects the reach and leaves the authored bend direction alone.
 *
 * Corrections are applied as a weighted slerp from the animated rotation, so a
 * weight of 0 leaves the animation untouched and anything in between eases the
 * correction in. That weighting is what keeps IK from flattening the life out
 * of a clip: you pin the foot only while it is actually planted.
 */

var Hexdelve = Hexdelve || {};

Hexdelve.ik = (function () {
'use strict';

const { solveWorld, quat } = Hexdelve.anim;

const DOWN = [0, -1, 0];
const IDENTITY = [0, 0, 0, 1];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.sqrt(dot(a, a));

function normalize(a) {
	const l = len(a);
	return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}

function parentMap(skeleton) {
	const parents = {};
	for (const bone of skeleton) parents[bone.name] = bone.parent;
	return parents;
}

function offsetOf(skeleton, name) {
	for (const bone of skeleton) if (bone.name === name) return bone.offset;
	return [0, 0, 0];
}

function poseRot(pose, name) {
	const entry = pose[name];
	return entry && entry.rot ? entry.rot : [0, 0, 0];
}

function setPoseRot(pose, name, rot) {
	if (!pose[name]) pose[name] = {};
	pose[name].rot = rot;
}

/**
 * Point a bone's own axis (its local −Y, which is how every limb in this rig
 * hangs) along `desiredDir`, keeping whatever twist the animation had, and
 * write the result back as a local Euler rotation.
 *
 * Returns the bone's new world rotation, so the next bone down can be aimed
 * against an up-to-date parent.
 */
function aimBoneAxis(pose, boneName, parentWorldQ, localAxis, desiredDir, weight) {
	const rot = poseRot(pose, boneName);
	const localQ = quat.fromEulerXYZ(rot[0], rot[1], rot[2]);
	const worldQ = quat.mul(parentWorldQ, localQ);
	const current = quat.rotate(worldQ, localAxis);
	let delta = quat.fromUnitVectors(current, desiredDir);
	if (weight < 0.999) delta = quat.slerp(IDENTITY, delta, weight);
	const newWorldQ = quat.mul(delta, worldQ);
	setPoseRot(pose, boneName, quat.toEulerXYZ(quat.mul(quat.conjugate(parentWorldQ), newWorldQ)));
	return newWorldQ;
}

function aimBone(pose, boneName, parentWorldQ, desiredDir, weight) {
	return aimBoneAxis(pose, boneName, parentWorldQ, DOWN, desiredDir, weight);
}

// The triangle solve, shared by the plain chain and the tool chain.
// Returns the two world-space directions the bones should point along.
function triangle(rootPos, target, L1, L2, poleDir) {
	const toTarget = sub(target, rootPos);
	const distance = len(toTarget);
	const maxReach = (L1 + L2) * 0.999;
	const minReach = Math.abs(L1 - L2) + 0.001;
	const d = Math.max(minReach, Math.min(maxReach, distance));
	const dir = normalize(toTarget);

	let bend = sub(poleDir, scale(dir, dot(poleDir, dir)));
	if (len(bend) < 1e-5) bend = [0, 0, 1];
	bend = normalize(bend);

	const cosRoot = Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)));
	const rootAngle = Math.acos(cosRoot);
	const u1 = add(scale(dir, Math.cos(rootAngle)), scale(bend, Math.sin(rootAngle)));
	const midPos = add(rootPos, scale(u1, L1));
	// Aim the far segment at the true target, so an unreachable one still
	// points the limb straight at it rather than somewhere arbitrary.
	const aimAt = distance > maxReach ? target : add(rootPos, scale(dir, d));
	const u2 = normalize(sub(aimAt, midPos));
	return { u1, u2, distance, reach: L1 + L2, clamped: distance > maxReach };
}

/**
 * Solve a two-bone chain so that `chain.end` lands on `target`.
 *
 * @param skeleton  the bone list
 * @param pose      sparse pose, MUTATED in place
 * @param chain     { root, mid, end } bone names, e.g. hip → shin → foot
 * @param target    world-space (actor-local) position for the end bone
 * @param pole      world-space position the mid joint should bend towards;
 *                  pass the animated mid position to preserve the authored bend
 * @param weight    0 = leave the animation alone, 1 = full correction
 * @param world     optional precomputed solveWorld() result, to save a pass
 * @returns { reach, distance, clamped } — reach is what the chain could manage
 */
function solveTwoBone(skeleton, pose, chain, target, pole, weight, world) {
	if (weight <= 0.0001) return null;
	const parents = parentMap(skeleton);
	const w = world || solveWorld(skeleton, pose);

	const rootPos = w[chain.root].p;
	const L1 = len(offsetOf(skeleton, chain.mid));
	const L2 = len(offsetOf(skeleton, chain.end));

	const tri = triangle(rootPos, target, L1, L2, sub(pole, rootPos));

	const rootParentQ = parents[chain.root] ? w[parents[chain.root]].q : IDENTITY;
	const newRootQ = aimBone(pose, chain.root, rootParentQ, tri.u1, weight);
	aimBone(pose, chain.mid, newRootQ, tri.u2, weight);

	return { reach: tri.reach, distance: tri.distance, clamped: tri.clamped };
}

/**
 * Solve a two-bone chain so that a rigidly HELD TOOL's tip lands on the target
 * — a hammer head on an anvil, rather than a hand at a point.
 *
 * The naive approach, backing the tool's offset out of the target to get a
 * hand position, does not converge: the offset is rotated by the hand, whose
 * rotation is exactly what the solve changes, and with a haft this long
 * relative to the arm the iteration diverges.
 *
 * The fix is to notice that the hand's LOCAL rotation is not touched by the
 * solve, so the tip sits at a fixed offset from the forearm. Elbow→tip is
 * therefore a rigid second segment of constant length, and the same triangle
 * solves it exactly, in one pass. The forearm is then aimed along its
 * tip axis instead of its own bone axis.
 */
function solveToolChain(skeleton, pose, chain, holdBone, localOffset, tipTarget, pole, weight, world) {
	if (weight <= 0.0001) return null;
	const parents = parentMap(skeleton);
	const w = world || solveWorld(skeleton, pose);

	const rootPos = w[chain.root].p;
	const L1 = len(offsetOf(skeleton, chain.mid));

	// Where the tip is relative to the mid joint, and which way that is in the
	// mid bone's own frame. Both are constant through the solve.
	const midPos = w[chain.mid].p;
	const midQ = w[chain.mid].q;
	const tipWorld = add(w[holdBone].p, quat.rotate(w[holdBone].q, localOffset));
	const tipFromMid = sub(tipWorld, midPos);
	const L2 = len(tipFromMid);
	if (L2 < 1e-5) return null;
	const tipAxisLocal = quat.rotate(quat.conjugate(midQ), normalize(tipFromMid));

	const tri = triangle(rootPos, tipTarget, L1, L2, sub(pole, rootPos));

	const rootParentQ = parents[chain.root] ? w[parents[chain.root]].q : IDENTITY;
	const newRootQ = aimBone(pose, chain.root, rootParentQ, tri.u1, weight);
	aimBoneAxis(pose, chain.mid, newRootQ, tipAxisLocal, tri.u2, weight);

	return { reach: tri.reach, distance: tri.distance, clamped: tri.clamped };
}

/**
 * Flatten a bone against level ground: keep its heading, drop its pitch and
 * roll. Used on the foot once the leg has been solved, so the sole lies on the
 * tile instead of pointing wherever the shin left it.
 */
function levelBone(skeleton, pose, boneName, weight, world) {
	if (weight <= 0.0001) return;
	const parents = parentMap(skeleton);
	const w = world || solveWorld(skeleton, pose);
	const parentQ = parents[boneName] ? w[parents[boneName]].q : IDENTITY;
	const localQ = quat.fromEulerXYZ(...poseRot(pose, boneName));
	const worldQ = quat.mul(parentQ, localQ);
	const forward = quat.rotate(worldQ, [0, 0, 1]);
	const yaw = Math.atan2(forward[0], forward[2]);
	const flat = quat.fromEulerXYZ(0, yaw, 0);
	const blended = quat.slerp(worldQ, flat, weight);
	setPoseRot(pose, boneName, quat.toEulerXYZ(quat.mul(quat.conjugate(parentQ), blended)));
}

/**
 * Where a rigid thing held by a bone currently is — a hammer head, say. The
 * offset is in the holding bone's local space.
 */
function attachmentPosition(skeleton, pose, boneName, localOffset, world) {
	const w = world || solveWorld(skeleton, pose);
	const bone = w[boneName];
	return add(bone.p, quat.rotate(bone.q, localOffset));
}

return { solveTwoBone, solveToolChain, levelBone, attachmentPosition };
})();
