/*
 * tools/check-blend.mjs — does the blend tree blend what it says it does?
 *
 *     node tools/check-blend.mjs
 *
 * A blend tree is the part of an animation system that fails without telling
 * anyone. Nothing throws when two gaits drift out of phase: the weights are
 * still sensible, the tree still produces a pose, the character still walks —
 * he just skates, and whether he is skating is a judgement somebody has to
 * make by eye at the right moment. That is not a check, and the editor's bench
 * exists partly because there was nowhere to make it. This is the half of it
 * that a machine can make.
 *
 * Five things are asserted, and each of them was worth writing down because
 * each has a silent failure behind it:
 *
 *   thresholds   at a leaf's own threshold the tree must BE that leaf: the same
 *                cycle length and the same ground speed, or the numbers on the
 *                slider are decoration
 *   sync         the synced leaves must stay at zero phase spread across the
 *                whole speed axis and the whole cycle
 *   no sync      and must not, with it off — a toggle that changes nothing is
 *                worse than no toggle, because it argues that sync is free
 *   additive     a zero layer must change nothing, and a full one must add
 *                exactly its own values, not some fraction of them
 *   layer        a mask must move the bones it names and leave the rest alone
 *
 * Everything is imported from the built packages, so this checks the code the
 * editor and the game actually run rather than a copy of it.
 */

import {
	additive,
	blend1d,
	BlendTree,
	boneIndex,
	clipSource,
	layer,
	leaf,
	measureGroundSpeed,
	poseSource,
} from '../packages/engine/dist/index.js';
import {
	BONES,
	GUARD,
	LEAN_LEFT,
	RUN_PERIOD,
	SKELETON,
	STRIDE_CONTACTS,
	stridePose,
	strideVelocity,
	UPPER_BODY,
	UPRIGHT,
	WALK_PERIOD,
} from '../packages/client/dist/index.js';

const TAU = Math.PI * 2;
const FORWARD = { x: 0, z: 1 };

const WALK_SPEED = strideVelocity(FORWARD, 1, 0).z;
const RUN_SPEED = strideVelocity(FORWARD, 1, 1).z;

let failures = 0;

function ok(condition, message, detail = '') {
	if (condition) {
		console.log(`  ok    ${message}`);
		return;
	}
	failures++;
	console.error(`  FAIL  ${message}${detail ? ` — ${detail}` : ''}`);
}

function near(a, b, tolerance) {
	return Math.abs(a - b) <= tolerance;
}

/* ------------------------------------------------------------------ tree -- */

const index = boneIndex(SKELETON);

const idle = leaf(
	poseSource('idle', 1, BONES, (t, out) => stridePose(0, 0, FORWARD, 0, t, out)),
	{ label: 'idle' },
);
const walk = leaf(
	poseSource('walk', WALK_PERIOD, BONES, (t, out) =>
		stridePose((t / WALK_PERIOD) * TAU, 1, FORWARD, 0, t, out),
	),
	{ label: 'walk', sync: true, contactPhase: STRIDE_CONTACTS[0] },
);
const run = leaf(
	poseSource('run', RUN_PERIOD, BONES, (t, out) =>
		stridePose((t / RUN_PERIOD) * TAU, 1, FORWARD, 1, t, out),
	),
	{ label: 'run', sync: true, contactPhase: STRIDE_CONTACTS[0] },
);

const gait = blend1d('speed', [
	{ node: idle, at: 0 },
	{ node: walk, at: WALK_SPEED },
	{ node: run, at: RUN_SPEED },
]);

const bank = blend1d('turn', [
	{ node: leaf(clipSource(UPRIGHT, index)), at: 0 },
	{ node: leaf(clipSource(LEAN_LEFT, index)), at: 1 },
]);

const root = layer(
	additive(gait, bank, { gainParam: 'lean' }),
	leaf(clipSource(GUARD, index)),
	UPPER_BODY,
	{ weightParam: 'guard' },
);

const tree = new BlendTree(root, BONES, { fallbackDuration: WALK_PERIOD });

const BASE = { speed: 0, turn: 0, lean: 0, guard: 0 };

/** The tree's pose at a phase, as a fresh sparse pose. */
function poseAt(params, phase) {
	tree.resolve(params);
	tree.phase = phase;
	tree.elapsed = phase * tree.cycle;
	tree.evaluate();
	return tree.toSparse({});
}

function speedOf(params) {
	tree.resolve(params);
	return measureGroundSpeed(SKELETON, (phase, out) => {
		tree.phase = phase;
		tree.elapsed = phase * tree.cycle;
		tree.evaluate();
		return tree.toSparse(out);
	}, tree.cycle).z;
}

/* ------------------------------------------------------------ thresholds -- */

console.log('\nAt a leaf\'s own threshold the tree must be that leaf.');

tree.sync = true;

for (const [name, speed, period, expected] of [
	['walk', WALK_SPEED, WALK_PERIOD, WALK_SPEED],
	['run', RUN_SPEED, RUN_PERIOD, RUN_SPEED],
]) {
	const params = { ...BASE, speed };
	tree.resolve(params);
	ok(
		near(tree.cycle, period, 1e-6),
		`${name}: the cycle is the clip's own (${tree.cycle.toFixed(4)} s)`,
		`wanted ${period}`,
	);
	const measured = speedOf(params);
	ok(
		near(measured, expected, 1e-3),
		`${name}: it carries him at the threshold (${measured.toFixed(4)} m/s)`,
		`wanted ${expected.toFixed(4)}`,
	);
}

// And between them the cycle has to interpolate, or a blend of two gaits would
// step from one cadence to the other rather than winding up.
{
	const mid = (WALK_SPEED + RUN_SPEED) / 2;
	tree.resolve({ ...BASE, speed: mid });
	ok(
		tree.cycle < WALK_PERIOD && tree.cycle > RUN_PERIOD,
		`between them the cadence winds up smoothly (${tree.cycle.toFixed(4)} s)`,
	);
}

/* ------------------------------------------------------------------ sync -- */

console.log('\nSynced leaves share one phase, everywhere on the axis.');

let worstSynced = 0;
tree.sync = true;
for (let i = 0; i <= 20; i++) {
	const speed = (RUN_SPEED * i) / 20;
	for (let p = 0; p < 1; p += 1 / 16) {
		tree.resolve({ ...BASE, speed });
		tree.phase = p;
		worstSynced = Math.max(worstSynced, tree.phaseSpread());
	}
}
ok(
	worstSynced < 1e-9,
	`worst spread across the whole axis is ${worstSynced.toExponential(2)} of a cycle`,
);

// A speed that never carries him backwards is the consequence that matters:
// the skate the sync prevents shows up as a blend travelling the wrong way.
let slowest = Infinity;
for (let i = 0; i <= 20; i++) {
	slowest = Math.min(slowest, speedOf({ ...BASE, speed: (RUN_SPEED * i) / 20 }));
}
ok(slowest >= -1e-6, `and he never travels backwards (slowest ${slowest.toFixed(4)} m/s)`);

console.log('\nWithout it they drift, which is what the toggle is for.');

let worstFree = 0;
tree.sync = false;
{
	const params = { ...BASE, speed: (WALK_SPEED + RUN_SPEED) / 2 };
	for (let i = 0; i <= 200; i++) {
		tree.resolve(params);
		tree.elapsed = i * 0.05;
		tree.phase = 0;
		worstFree = Math.max(worstFree, tree.phaseSpread());
	}
}
ok(
	worstFree > 0.2,
	`the leaves drift up to ${(worstFree * 100).toFixed(1)} % of a cycle apart`,
	'sync is not doing anything',
);
tree.sync = true;

/* -------------------------------------------------------------- additive -- */

console.log('\nAn additive layer adds exactly itself, and nothing at zero gain.');

{
	const plain = poseAt({ ...BASE, speed: WALK_SPEED }, 0.3);
	const zeroGain = poseAt({ ...BASE, speed: WALK_SPEED, turn: 1, lean: 0 }, 0.3);
	let worst = 0;
	for (const bone of BONES) {
		for (let c = 0; c < 3; c++) {
			worst = Math.max(worst, Math.abs(plain[bone].rot[c] - zeroGain[bone].rot[c]));
		}
	}
	ok(worst < 1e-9, `gain 0 leaves the gait untouched (worst ${worst.toExponential(2)} rad)`);

	// LEAN_LEFT rolls the root by -0.1 about Z. At full gain that is exactly
	// what should appear on top of whatever the stride had there.
	const leaned = poseAt({ ...BASE, speed: WALK_SPEED, turn: 1, lean: 1 }, 0.3);
	/*
	 * A microradian, not nothing: poses are Float32Array, so a difference of
	 * two of them carries about seven digits and no more. Anything above this
	 * is the blend, not the storage.
	 */
	const EPSILON = 1e-6;
	const delta = leaned.root.rot[2] - plain.root.rot[2];
	ok(near(delta, -0.1, EPSILON), `gain 1 adds the lean whole (${delta.toFixed(6)} rad on root.z)`);

	const half = poseAt({ ...BASE, speed: WALK_SPEED, turn: 1, lean: 0.5 }, 0.3);
	const halfDelta = half.root.rot[2] - plain.root.rot[2];
	ok(
		near(halfDelta, -0.05, EPSILON),
		`and half a gain adds half of it (${halfDelta.toFixed(6)} rad)`,
	);
}

/* ----------------------------------------------------------------- layer -- */

console.log('\nA masked layer moves the bones it names and leaves the rest alone.');

{
	const plain = poseAt({ ...BASE, speed: WALK_SPEED }, 0.3);
	const guarded = poseAt({ ...BASE, speed: WALK_SPEED, guard: 1 }, 0.3);

	let movedMasked = 0;
	let movedFree = 0;
	for (const bone of BONES) {
		let moved = 0;
		for (let c = 0; c < 3; c++) {
			moved = Math.max(moved, Math.abs(plain[bone].rot[c] - guarded[bone].rot[c]));
		}
		if ((UPPER_BODY[bone] ?? 0) > 0) movedMasked = Math.max(movedMasked, moved);
		else movedFree = Math.max(movedFree, moved);
	}

	ok(movedMasked > 0.05, `the upper body takes the guard (${movedMasked.toFixed(3)} rad)`);
	ok(
		movedFree < 1e-9,
		`the legs go on striding (${movedFree.toExponential(2)} rad)`,
		'the mask is leaking',
	);

	// A weight of zero has to be the base exactly, not nearly.
	const none = poseAt({ ...BASE, speed: WALK_SPEED, guard: 0 }, 0.3);
	let worst = 0;
	for (const bone of BONES) {
		for (let c = 0; c < 3; c++) {
			worst = Math.max(worst, Math.abs(plain[bone].rot[c] - none[bone].rot[c]));
		}
	}
	ok(worst < 1e-12, 'and weight 0 is the base untouched');
}

/* ---------------------------------------------------------------- result -- */

if (failures > 0) {
	console.error(`\nFAIL  ${failures} blend-tree check${failures === 1 ? '' : 's'} did not hold`);
	process.exit(1);
}
console.log('\nok    the blend tree blends what it says it does');
