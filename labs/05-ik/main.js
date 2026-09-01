/*
 * Hexdelve — Lab 05: two-bone inverse kinematics.
 *
 * Everything up to lab 04 plays joint angles. That means contact is a
 * coincidence: the foot meets the ground because the clip was authored for
 * flat ground at one height, and the hammer meets the anvil because the pose
 * was tuned against one anvil at one standing distance. Change either and the
 * animation misses, because nothing in it refers to the world.
 *
 * Here the pose is evaluated as before, and then corrected:
 *
 *   feet    every hex tile is a flat plateau at its own height. Each foot is
 *           given the tile under it as a target, the pelvis drops far enough
 *           for the lower foot to reach, and each leg is solved. The correction
 *           is weighted by how planted the foot is, so a swinging leg keeps
 *           the clip's motion untouched.
 *
 *   hammer  the strike targets the anvil FACE rather than a fixed arm angle,
 *           with the weight ramped up around the moment of impact. Drag the
 *           anvil up or down and the same unmodified clip still lands on it.
 *
 * The solver is in ../shared/ik.js and has no renderer types in it.
 */

'use strict';

const { HexField, groundMaterial, hexGeometry, makeRandom, tintColor, SQRT3 } = Hexdelve.hex;
const { SKELETON, BONES, TIPS, HIPS_Y } = Hexdelve.skeleton;
const { buildRig, buildSkeletonView, applySparsePose } = Hexdelve.rigview;
const { buildBlacksmith } = Hexdelve.blacksmith;
const { walkPose, WALK_PERIOD } = Hexdelve.walk;
const { HAMMER } = Hexdelve.clips;
const { bakeClip, samplePose, measureGroundSpeed, solveWorld, DEG } = Hexdelve.anim;
const { solveTwoBone, solveToolChain, levelBone, attachmentPosition } = Hexdelve.ik;

const PI = Math.PI;
const TAU = PI * 2;

const GROUND_RADIUS = 7;
const BASE_Y = 0.16; // the top of a level-0 tile
const STEP_H = 0.19; // how much each terrace rises
const SOLE = 0.12; // foot bone height above the sole

const random = makeRandom(41);
const pick = (list) => list[Math.floor(random() * list.length)];

/* -------------------------------------------------------------- renderer -- */

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();

const VIEW = 5.5;
const ISO_PITCH = Math.atan(1 / Math.SQRT2);
const CAM_DIST = 60;
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);

const view = { azimuth: (62 * PI) / 180, target: new THREE.Vector3(0, 1, 0), zoom: 2, zoomGoal: 2 };

function applyCamera() {
	camera.position.set(
		view.target.x + CAM_DIST * Math.cos(view.azimuth) * Math.cos(ISO_PITCH),
		view.target.y + CAM_DIST * Math.sin(ISO_PITCH),
		view.target.z + CAM_DIST * Math.sin(view.azimuth) * Math.cos(ISO_PITCH),
	);
	camera.lookAt(view.target);
	camera.zoom = view.zoom;
	camera.updateProjectionMatrix();
}

function resize() {
	const w = window.innerWidth;
	const h = window.innerHeight;
	renderer.setSize(w, h);
	const aspect = w / h;
	camera.left = -VIEW * aspect;
	camera.right = VIEW * aspect;
	camera.top = VIEW;
	camera.bottom = -VIEW;
	applyCamera();
}
window.addEventListener('resize', resize);

scene.add(new THREE.HemisphereLight(0xcfe0ee, 0x6a5a44, 0.62));
const sun = new THREE.DirectionalLight(0xfff1dc, 0.95);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -13;
sun.shadow.camera.right = 13;
sun.shadow.camera.top = 13;
sun.shadow.camera.bottom = -13;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 90;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
{
	const a = (140 * PI) / 180;
	const el = (48 * PI) / 180;
	sun.position.set(30 * Math.cos(a) * Math.cos(el), 30 * Math.sin(el), 30 * Math.sin(a) * Math.cos(el));
}
scene.add(sun);
scene.add(sun.target);

/* --------------------------------------------------------------- terrain -- */

// Terraced hex tiles. Each tile is flat, so the ground is a step function —
// which is exactly what makes foot IK visible: a leg that ignores it will
// obviously sink or float.
const heights = new Map();
const key = (q, r) => `${q},${r}`;

function terraceLevel(q, r) {
	const x = SQRT3 * (q + r / 2);
	const z = 1.5 * r;
	const n = Math.sin(x * 0.34) * Math.cos(z * 0.42) + 0.55 * Math.sin((x + z) * 0.2);
	return Math.max(0, Math.min(3, Math.round((n + 1.1) * 1.15)));
}

function buildTerrain() {
	const field = new HexField();
	field.upright(0, -1.2, 0, SQRT3 * GROUND_RADIUS + 1.6, 1.2, new THREE.Color('#4a3b2c'), 90);

	for (let q = -GROUND_RADIUS; q <= GROUND_RADIUS; q++) {
		for (let r = -GROUND_RADIUS; r <= GROUND_RADIUS; r++) {
			if ((Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2 > GROUND_RADIUS) continue;
			const x = SQRT3 * (q + r / 2);
			const z = 1.5 * r;
			// The anvil needs a flat working area.
			const level = Math.hypot(x, z) < 2.2 ? 1 : terraceLevel(q, r);
			const top = BASE_Y + level * STEP_H;
			heights.set(key(q, r), top);
			const shade = ['#79a256', '#82aa5e', '#8fb26a', '#9cbb77'][level];
			field.upright(x, 0, z, 0.985, top, tintColor(random, shade, 0.05));
			if (random() < 0.07) {
				field.upright(x + (random() - 0.5) * 0.8, top, z + (random() - 0.5) * 0.8, 0.09, 0.22, tintColor(random, '#5c8040', 0.06), random() * 60);
			}
		}
	}

	scene.add(field.build(groundMaterial()));
}

// World position → the axial cell containing it, by cube rounding.
function cellAt(x, z) {
	const r = z / 1.5;
	const q = x / SQRT3 - r / 2;
	const cy = -q - r;
	let rq = Math.round(q);
	let rr = Math.round(r);
	const ry = Math.round(cy);
	const dq = Math.abs(rq - q);
	const dr = Math.abs(rr - r);
	const dy = Math.abs(ry - cy);
	if (dq > dr && dq > dy) rq = -rr - ry;
	else if (dr > dy) rr = -rq - ry;
	return { q: rq, r: rr };
}

function groundAt(x, z) {
	const cell = cellAt(x, z);
	const h = heights.get(key(cell.q, cell.r));
	return h === undefined ? BASE_Y : h;
}

buildTerrain();

/* ----------------------------------------------------------------- anvil -- */

const anvilGroup = new THREE.Group();
scene.add(anvilGroup);

let anvilFaceY = 1.03;

let anvilStump = null;

function buildAnvil() {
	const mat = new THREE.MeshPhongMaterial({ color: 0xffffff, flatShading: true, shininess: 6, specular: 0x1a1a1a });

	// The stump is stretched to meet the ground rather than moved with the
	// face, so raising the anvil makes a taller block instead of a floating one.
	anvilStump = new THREE.Mesh(hexGeometry(), mat.clone());
	anvilStump.material.color.set('#5c4127');
	anvilStump.rotation.y = (14 * PI) / 180;
	anvilStump.castShadow = true;
	anvilStump.receiveShadow = true;
	anvilGroup.add(anvilStump);

	const plate = new THREE.Mesh(hexGeometry(), mat.clone());
	plate.material.color.set('#3d4045');
	plate.position.set(0, -0.16, 0);
	plate.scale.set(0.3, 0.12, 0.3);
	plate.castShadow = true;
	anvilGroup.add(plate);
	// Body and horn, lying along x, their tops flush with the face.
	const body = new THREE.Mesh(hexGeometry(), mat.clone());
	body.material.color.set('#54585e');
	body.quaternion.copy(Hexdelve.hex.Q_AXIS_X);
	body.scale.set(0.24, 0.72, 0.24);
	body.position.set(0.02, -0.208, 0);
	body.castShadow = true;
	anvilGroup.add(body);

	const horn = new THREE.Mesh(hexGeometry(), mat.clone());
	horn.material.color.set('#484c52');
	horn.quaternion.copy(Hexdelve.hex.Q_AXIS_X);
	horn.scale.set(0.085, 0.28, 0.085);
	horn.position.set(0.5, -0.17, 0);
	horn.castShadow = true;
	anvilGroup.add(horn);
}

buildAnvil();

const ANVIL_XZ = { x: 0, z: 0 };

function placeAnvil() {
	anvilGroup.position.set(ANVIL_XZ.x, anvilFaceY, ANVIL_XZ.z);
	const groundY = groundAt(ANVIL_XZ.x, ANVIL_XZ.z);
	const stumpTop = anvilFaceY - 0.22;
	const height = Math.max(0.08, stumpTop - groundY);
	anvilStump.scale.set(0.48, height, 0.48);
	anvilStump.position.set(0, stumpTop - height / 2 - anvilFaceY, 0);
}

/* ------------------------------------------------------ rig and character -- */

const actorGroup = new THREE.Group();
scene.add(actorGroup);

const rig = buildRig(SKELETON, actorGroup);
const character = buildBlacksmith(rig);
const skeletonView = buildSkeletonView(rig, SKELETON, TIPS);

// Where the hammer head sits in the right hand's local space — the same
// numbers blacksmith.js builds the mesh from. IK needs it to aim the tool
// rather than the hand.
const HAMMER_OFFSET = [0, -0.341, 0.192];

const baked = bakeClip({
	name: 'walk',
	duration: WALK_PERIOD,
	loop: 'loop',
	samples: 240,
	tolerance: 1.2 * DEG,
	sample: (t) => walkPose((t / WALK_PERIOD) * TAU, 1),
});

const WALK_SPEED = measureGroundSpeed(SKELETON, (t) => samplePose(baked.clip, t), baked.clip.duration);

/* --------------------------------------------------------- target markers -- */

function marker(color) {
	const m = new THREE.Mesh(
		hexGeometry(),
		new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthTest: false }),
	);
	m.scale.set(0.07, 0.02, 0.07);
	m.renderOrder = 10;
	m.visible = false;
	scene.add(m);
	return m;
}

const markers = { footL: marker(0x3c8ac2), footR: marker(0xc2743c), hand: marker(0xc23c6f) };

/* -------------------------------------------------------------------- ui -- */

const ui = {
	modeWalk: document.getElementById('modeWalk'),
	modeAnvil: document.getElementById('modeAnvil'),
	speed: document.getElementById('speed'),
	speedOut: document.getElementById('speedOut'),
	anvil: document.getElementById('anvil'),
	anvilOut: document.getElementById('anvilOut'),
	ik: document.getElementById('ik'),
	freeze: document.getElementById('freeze'),
	targets: document.getElementById('targets'),
	showSkel: document.getElementById('showSkel'),
	follow: document.getElementById('follow'),
	stats: document.getElementById('stats'),
};

let mode = 'walk';

function setMode(next) {
	mode = next;
	ui.modeWalk.classList.toggle('on', mode === 'walk');
	ui.modeAnvil.classList.toggle('on', mode === 'anvil');
	for (const el of document.querySelectorAll('[data-mode]')) {
		el.classList.toggle('hidden', el.dataset.mode !== mode);
	}
	if (mode === 'anvil') {
		// Stand at the anvil, facing it. Close enough that the arm plus the
		// hammer can actually span the gap: the chain is 0.64 m of arm and
		// 0.39 m of haft, and IK cannot lengthen a bone.
		actor.x = -0.494;
		actor.z = -0.524;
		actor.yaw = Math.atan2(ANVIL_XZ.x - actor.x, ANVIL_XZ.z - actor.z);
		hammerTime = 0;
	}
}

ui.modeWalk.addEventListener('click', () => setMode('walk'));
ui.modeAnvil.addEventListener('click', () => setMode('anvil'));

function applyVisibility() {
	const showS = ui.showSkel.checked;
	for (const m of skeletonView.meshes) m.visible = showS;
	for (const mat of character.materials.values()) {
		mat.transparent = showS;
		mat.opacity = showS ? 0.34 : 1;
		mat.depthWrite = !showS;
		mat.needsUpdate = true;
	}
}
ui.showSkel.addEventListener('change', applyVisibility);
// Freezing at the anvil parks the clip on the blow, which is the frame worth
// looking at: drag the anvil from there and the arm re-solves live.
ui.freeze.addEventListener('change', () => {
	if (ui.freeze.checked && mode === 'anvil') hammerTime = 0.5;
});
ui.anvil.addEventListener('input', () => {
	anvilFaceY = +ui.anvil.value;
	ui.anvilOut.textContent = anvilFaceY.toFixed(2);
	placeAnvil();
});
ui.speed.addEventListener('input', () => {
	ui.speedOut.textContent = (+ui.speed.value).toFixed(2);
});

/* -------------------------------------------------------------- controls -- */

const drag = { active: false, pan: false, x: 0, y: 0 };

canvas.addEventListener('pointerdown', (e) => {
	drag.active = true;
	drag.pan = e.button === 2 || e.shiftKey;
	drag.x = e.clientX;
	drag.y = e.clientY;
	canvas.classList.add('dragging');
	canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
	if (!drag.active) return;
	const dx = e.clientX - drag.x;
	const dy = e.clientY - drag.y;
	drag.x = e.clientX;
	drag.y = e.clientY;
	if (drag.pan) {
		ui.follow.checked = false;
		const scale = (2 * VIEW) / (window.innerHeight * view.zoom);
		const fwd = new THREE.Vector3(-Math.cos(view.azimuth), 0, -Math.sin(view.azimuth));
		const right = new THREE.Vector3(-Math.sin(view.azimuth), 0, Math.cos(view.azimuth));
		view.target.addScaledVector(right, -dx * scale);
		view.target.addScaledVector(fwd, (dy * scale) / Math.sin(ISO_PITCH));
	} else {
		view.azimuth += dx * 0.007;
	}
	applyCamera();
});

canvas.addEventListener('pointerup', () => {
	drag.active = false;
	canvas.classList.remove('dragging');
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener(
	'wheel',
	(e) => {
		e.preventDefault();
		view.zoomGoal = Math.max(0.6, Math.min(5, view.zoomGoal * Math.exp(-e.deltaY * 0.0012)));
	},
	{ passive: false },
);

/* ------------------------------------------------------------------ actor -- */

const actor = { x: 0, z: -4.2, yaw: 0, y: BASE_Y, u: 0 };
let walkTime = 0;
let hammerTime = 0;

const wrapAngle = (a) => {
	while (a > PI) a -= TAU;
	while (a < -PI) a += TAU;
	return a;
};

// A gentle loop across the terraces.
function pathPoint(u) {
	return { x: 4.6 * Math.sin(u), z: 4.2 * Math.sin(u) * Math.cos(u) - 1.2 };
}

/* ----------------------------------------------------------------- the IK -- */

const pose = {};
const stats = { footL: 0, footR: 0, wL: 0, wR: 0, pelvis: 0, hammerErr: 0, ikErr: 0 };

// Rotate an actor-local XZ offset into world space.
function toWorldXZ(localX, localZ) {
	const s = Math.sin(actor.yaw);
	const c = Math.cos(actor.yaw);
	return { x: actor.x + localX * c + localZ * s, z: actor.z - localX * s + localZ * c };
}

/**
 * Foot planting.
 *
 * 1. Work out where each foot wants to be: keep the clip's horizontal motion,
 *    take the vertical from the tile underneath.
 * 2. Weight each correction by how planted that foot is — a foot high in its
 *    swing is left entirely alone, so the clip keeps its shape.
 * 3. Drop the pelvis by however much the lowest foot cannot otherwise reach,
 *    which is what lets him step down without the leg going straight.
 * 4. Solve each leg, then level the foot onto the tile.
 */
function applyFootIK(weightScale) {
	const world = solveWorld(SKELETON, pose);
	const targets = {};
	let pelvisDrop = 0;

	for (const side of ['L', 'R']) {
		const footBone = `foot${side}`;
		const p = world[footBone].p;
		const worldXZ = toWorldXZ(p[0], p[2]);
		const groundY = groundAt(worldXZ.x, worldXZ.z);
		// Everything in the pose is actor-local, so bring the tile height into
		// that space before comparing.
		const desiredLocalY = groundY - actor.y + SOLE;
		const above = p[1] - desiredLocalY;
		// Planted when the animation already has it near the ground; fades out
		// over the first 18cm of lift.
		const weight = Math.max(0, Math.min(1, 1 - above / 0.18)) * weightScale;
		targets[footBone] = { x: p[0], y: desiredLocalY, z: p[2], weight, groundY };
		if (weight > 0.02) pelvisDrop = Math.min(pelvisDrop, (desiredLocalY - p[1]) * weight);
		stats[footBone] = groundY;
		stats[side === 'L' ? 'wL' : 'wR'] = weight;
	}

	stats.pelvis = pelvisDrop;
	if (pelvisDrop < -0.0005) {
		if (!pose.root) pose.root = {};
		const rp = pose.root.pos || [0, 0, 0];
		pose.root.pos = [rp[0], rp[1] + pelvisDrop, rp[2]];
	}

	// Re-solve after moving the pelvis: the legs hang from it.
	const world2 = solveWorld(SKELETON, pose);
	for (const side of ['L', 'R']) {
		const t = targets[`foot${side}`];
		if (t.weight <= 0.02) continue;
		solveTwoBone(
			SKELETON,
			pose,
			{ root: `hip${side}`, mid: `shin${side}`, end: `foot${side}` },
			[t.x, t.y, t.z],
			world2[`shin${side}`].p, // keep the knee bending the way the clip had it
			t.weight,
			world2,
		);
		levelBone(SKELETON, pose, `foot${side}`, t.weight);
	}

	if (ui.targets.checked) {
		for (const side of ['L', 'R']) {
			const t = targets[`foot${side}`];
			const w = toWorldXZ(t.x, t.z);
			const m = markers[`foot${side}`];
			m.visible = true;
			m.position.set(w.x, t.groundY + 0.01, w.z);
			m.scale.set(0.07 + t.weight * 0.06, 0.02, 0.07 + t.weight * 0.06);
		}
	}
}

// A weight curve over the hammer clip: nothing during the raise, full at the
// blow, easing off through the recoil. This is what keeps IK from ironing the
// anticipation out of the swing.
// Times are in seconds, matching the hammer clip's own keys: it holds at the
// top around 0.36, strikes at 0.50, and recoils out to about 0.74.
const IK_START = 0.34;
const IK_PEAK = 0.5;
const IK_END = 0.74;

function hammerIKWeight(t) {
	const d = HAMMER.duration;
	let time = t % d;
	if (time < 0) time += d;
	if (time < IK_START || time > IK_END) return 0;
	if (time < IK_PEAK) {
		const u = (time - IK_START) / (IK_PEAK - IK_START);
		return u * u * (3 - 2 * u);
	}
	const u = 1 - (time - IK_PEAK) / (IK_END - IK_PEAK);
	return u * u * (3 - 2 * u);
}

function applyHammerIK(t, weightScale) {
	const weight = hammerIKWeight(t) * weightScale;
	const world = solveWorld(SKELETON, pose);

	// The anvil face in the actor's local space.
	const dx = ANVIL_XZ.x - actor.x;
	const dz = ANVIL_XZ.z - actor.z;
	const s = Math.sin(actor.yaw);
	const c = Math.cos(actor.yaw);
	const localTarget = [dx * c - dz * s, anvilFaceY - actor.y + 0.03, dx * s + dz * c];

	const before = attachmentPosition(SKELETON, pose, 'handR', HAMMER_OFFSET, world);
	stats.ikErr = Math.hypot(before[0] - localTarget[0], before[1] - localTarget[1], before[2] - localTarget[2]);

	stats.clamped = false;
	if (weight > 0.001) {
		const result = solveToolChain(
			SKELETON,
			pose,
			{ root: 'armR', mid: 'forearmR', end: 'handR' },
			'handR',
			HAMMER_OFFSET,
			localTarget,
			world.forearmR.p, // keep the elbow where the animation put it
			weight,
			world,
		);
		// IK cannot make a limb longer. When the target is outside the chain's
		// reach the solve straightens the arm at it and stops there — which is
		// the honest failure, and visible if the anvil is dragged far enough.
		stats.clamped = !!(result && result.clamped);
	}

	const after = attachmentPosition(SKELETON, pose, 'handR', HAMMER_OFFSET);
	stats.hammerErr = Math.hypot(after[0] - localTarget[0], after[1] - localTarget[1], after[2] - localTarget[2]);

	if (ui.targets.checked) {
		markers.hand.visible = true;
		markers.hand.position.set(ANVIL_XZ.x, anvilFaceY + 0.03, ANVIL_XZ.z);
		markers.hand.scale.set(0.09, 0.02, 0.09);
	}
	return weight;
}

/* ------------------------------------------------------------------ loop -- */

let last = performance.now();
let elapsed = 0;
let statTimer = 0;
let ikWeightNow = 0;

function frame(now) {
	const dt = Math.min((now - last) / 1000, 0.06);
	last = now;
	elapsed += dt;

	for (const m of Object.values(markers)) m.visible = false;
	const ikOn = ui.ik.checked ? 1 : 0;
	const step = ui.freeze.checked ? 0 : dt;

	if (mode === 'walk') {
		const speed = +ui.speed.value;
		walkTime += step;
		// Follow the loop across the terraces.
		const ahead = pathPoint(actor.u + 0.25);
		const desired = Math.atan2(ahead.x - actor.x, ahead.z - actor.z);
		const diff = wrapAngle(desired - actor.yaw);
		actor.yaw += Math.max(-2.2 * dt, Math.min(2.2 * dt, diff * 3));
		actor.u += step * speed * 0.34;
		actor.x += Math.sin(actor.yaw) * speed * step;
		actor.z += Math.cos(actor.yaw) * speed * step;

		// The body follows the terrain broadly; IK handles the per-foot detail.
		const under = groundAt(actor.x, actor.z);
		actor.y += (under - actor.y) * Math.min(1, dt * 6);

		// Playback rate is tied to travel so the stride matches the speed.
		const phase = (walkTime * (speed / WALK_SPEED) * TAU) / WALK_PERIOD;
		const sparse = walkPose(phase, 1);
		for (const k in pose) delete pose[k];
		Object.assign(pose, sparse);
		if (ikOn) applyFootIK(1);
	} else {
		hammerTime += step;
		const sparse = samplePose(HAMMER, hammerTime % HAMMER.duration);
		for (const k in pose) delete pose[k];
		Object.assign(pose, sparse);
		actor.y = groundAt(actor.x, actor.z);
		ikWeightNow = applyHammerIK(hammerTime, ikOn);
		if (ikOn) applyFootIK(1);
	}

	actorGroup.position.set(actor.x, actor.y, actor.z);
	actorGroup.rotation.y = actor.yaw;
	applySparsePose(rig, pose);

	const lead = Math.min(rig.bones.hipL.rotation.x, rig.bones.hipR.rotation.x);
	character.apron.quaternion.setFromEuler(new THREE.Euler(PI / 2 - 0.03 + lead * 0.5, PI / 6, 0));

	statTimer += dt;
	if (statTimer > 0.12) {
		statTimer = 0;
		if (mode === 'walk') {
			ui.stats.innerHTML =
				`<dt>Tile under L</dt><dd>${stats.footL.toFixed(2)} m</dd>` +
				`<dt>Tile under R</dt><dd>${stats.footR.toFixed(2)} m</dd>` +
				`<dt>Plant weight</dt><dd>L ${stats.wL.toFixed(2)} · R ${stats.wR.toFixed(2)}</dd>` +
				`<dt>Pelvis drop</dt><dd>${(stats.pelvis * 100).toFixed(1)} cm</dd>`;
		} else {
			const cls = stats.hammerErr < 0.03 ? 'good' : stats.hammerErr > 0.12 ? 'warn' : '';
			ui.stats.innerHTML =
				`<dt>Anvil face</dt><dd>${anvilFaceY.toFixed(2)} m</dd>` +
				`<dt>IK weight</dt><dd>${ikWeightNow.toFixed(2)}</dd>` +
				`<dt>Miss, clip only</dt><dd>${(stats.ikErr * 100).toFixed(1)} cm</dd>` +
				`<dt>Miss, solved</dt><dd class="${cls}">${(stats.hammerErr * 100).toFixed(1)} cm` +
				`${stats.clamped ? ' · out of reach' : ''}</dd>`;
		}
	}

	if (ui.follow.checked) {
		view.target.x += (actor.x - view.target.x) * Math.min(1, dt * 2.6);
		view.target.z += (actor.z - view.target.z) * Math.min(1, dt * 2.6);
		view.target.y += (actor.y + HIPS_Y + 0.1 - view.target.y) * Math.min(1, dt * 2.6);
		applyCamera();
	}
	if (Math.abs(view.zoom - view.zoomGoal) > 1e-4) {
		view.zoom += (view.zoomGoal - view.zoom) * Math.min(1, dt * 10);
		applyCamera();
	}

	renderer.render(scene, camera);
	requestAnimationFrame(frame);
}

/* ----------------------------------------------------------------- start -- */

placeAnvil();
applyVisibility();
setMode('walk');

{
	const qs = new URLSearchParams(location.search);
	if (qs.has('mode')) setMode(qs.get('mode'));
	if (qs.has('ik')) ui.ik.checked = qs.get('ik') !== '0';
	if (qs.has('targets')) ui.targets.checked = qs.get('targets') !== '0';
	if (qs.has('skel')) ui.showSkel.checked = qs.get('skel') !== '0';
	if (qs.has('speed')) ui.speed.value = qs.get('speed');
	if (qs.has('anvil')) {
		ui.anvil.value = qs.get('anvil');
		anvilFaceY = +qs.get('anvil');
		placeAnvil();
	}
	if (qs.has('zoom')) view.zoom = view.zoomGoal = +qs.get('zoom');
	if (qs.has('follow')) ui.follow.checked = qs.get('follow') !== '0';
	applyVisibility();
}

ui.speedOut.textContent = (+ui.speed.value).toFixed(2);
ui.anvilOut.textContent = anvilFaceY.toFixed(2);

window.lab = { rig, character, actor, pose, groundAt, stats, setMode, HAMMER };

resize();
requestAnimationFrame(frame);
