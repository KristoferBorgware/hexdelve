/*
 * Hexdelve — Lab 04: an idle → walk → run blend tree.
 *
 * Lab 03 played one clip at a time and crossfaded between them. That works for
 * events (a strike, a jump) but not for locomotion, where the character has to
 * be continuously anywhere between standing and running. A blend tree replaces
 * "play walk" with "speed = 1.2 m/s" and works out the rest.
 *
 * The tree here is:
 *
 *   Additive
 *   ├─ Blend1D "speed"          the gait: idle / walk / run by threshold
 *   └─ Blend1D "turn"           banking, added on top rather than blended in
 *
 * Three things make it work beyond just weighting clips:
 *
 *   phase sync   walk (0.95s) and run (0.62s) share one normalised phase and
 *                are offset so their footfalls coincide. Without it the blend
 *                averages a planting foot with a lifting one and he skates.
 *   calibration  the parameter is a speed in m/s, so the tree is swept once at
 *                load and its real ground speed measured at each step; asking
 *                for 1.2 m/s then gives the parameter that actually produces it.
 *   additive     the lean is added to whatever the gait is doing instead of
 *                replacing it, so it composes with every speed.
 */

'use strict';

const { HexField, groundMaterial, makeRandom, tintColor, SQRT3 } = Hexdelve.hex;
const { SKELETON, BONES, TIPS, HIPS_Y } = Hexdelve.skeleton;
const { buildRig, buildSkeletonView, applyPose } = Hexdelve.rigview;
const { buildBlacksmith } = Hexdelve.blacksmith;
const { WALK_PERIOD } = Hexdelve.walk;
const { IDLE, RUN, LEAN_LEFT, LEAN_RIGHT, UPRIGHT } = Hexdelve.clips;
const { bakeClip, samplePose, measureGroundSpeed, DEG } = Hexdelve.anim;
const { ClipNode, Blend1D, Additive, BlendTree, calibrateSpeed, parameterForSpeed, speedForParameter } =
	Hexdelve.blendtree;
const { walkPose, WALK_CONTACTS } = Hexdelve.walk;

const PI = Math.PI;
const TAU = PI * 2;

const GROUND_RADIUS = 8;
const GROUND_Y = 0.16; // the top face of a ground tile — where feet belong

const random = makeRandom(31);
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

const view = { azimuth: (62 * PI) / 180, target: new THREE.Vector3(0, 1, 0), zoom: 1.5, zoomGoal: 1.5 };

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
sun.shadow.camera.left = -14;
sun.shadow.camera.right = 14;
sun.shadow.camera.top = 14;
sun.shadow.camera.bottom = -14;
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

/* ----------------------------------------------------------------- world -- */

const PAL = {
	grass: ['#79a256', '#71994f', '#82aa5e', '#6d944c'],
	worn: ['#a08a5e', '#98865f', '#a89365'],
	stone: ['#8d8d86', '#94948c', '#858680'],
	flower: ['#e8788a', '#e8d06a', '#f0f0e8', '#c77ddb'],
	spruce: ['#3f5f38', '#476b3e', '#385633'],
};

// A figure eight, so the turn parameter changes sign twice a lap and the
// additive lean has something to do.
const PATH = { a: 5.2, b: 3.4 };

function pathPoint(u) {
	return { x: PATH.a * Math.sin(u), z: PATH.b * Math.sin(u) * Math.cos(u) };
}

function nearPath(x, z) {
	// Cheap: sample the curve and keep the closest approach.
	let best = Infinity;
	for (let i = 0; i < 96; i++) {
		const p = pathPoint((i / 96) * TAU);
		best = Math.min(best, Math.hypot(p.x - x, p.z - z));
	}
	return best;
}

function spruce(field, x, z, s) {
	const yaw = random() * 60;
	field.upright(x, GROUND_Y, z, 0.26 * s, 1.1 * s, tintColor(random, '#6b4a2c', 0.03), yaw);
	for (const tier of [
		{ r: 1.5, h: 0.62, y: 0.95 },
		{ r: 1.15, h: 0.58, y: 1.62 },
		{ r: 0.8, h: 0.54, y: 2.26 },
		{ r: 0.45, h: 0.5, y: 2.86 },
	]) {
		field.upright(x, GROUND_Y + tier.y * s, z, tier.r * s, tier.h * s, tintColor(random, pick(PAL.spruce), 0.05), yaw + random() * 30);
	}
	field.upright(x, GROUND_Y + 3.34 * s, z, 0.18 * s, 0.42 * s, tintColor(random, pick(PAL.spruce), 0.05), yaw);
}

function buildWorld() {
	const field = new HexField();
	field.upright(0, -0.85, 0, SQRT3 * GROUND_RADIUS + 1.6, 0.86, new THREE.Color('#4a3b2c'), 90);

	const tiles = [];
	for (let q = -GROUND_RADIUS; q <= GROUND_RADIUS; q++) {
		for (let r = -GROUND_RADIUS; r <= GROUND_RADIUS; r++) {
			if ((Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2 > GROUND_RADIUS) continue;
			const x = SQRT3 * (q + r / 2);
			const z = 1.5 * r;
			const worn = nearPath(x, z) < 1.0;
			field.upright(x, 0, z, 0.985, GROUND_Y, tintColor(random, pick(worn ? PAL.worn : PAL.grass), 0.06));
			if (!worn) tiles.push({ x, z });
		}
	}

	for (const tile of tiles) {
		const roll = random();
		const dx = (random() - 0.5) * 0.9;
		const dz = (random() - 0.5) * 0.9;
		if (roll < 0.05) {
			field.upright(tile.x + dx, GROUND_Y, tile.z + dz, 0.1, 0.1 + random() * 0.08, tintColor(random, pick(PAL.flower), 0.06), random() * 60);
		} else if (roll < 0.11) {
			field.upright(tile.x + dx, GROUND_Y, tile.z + dz, 0.085, 0.2 + random() * 0.12, tintColor(random, '#5c8040', 0.06), random() * 60);
		}
	}

	spruce(field, -7.2, 4.6, 1.05);
	spruce(field, 7.6, -4.2, 0.9);
	spruce(field, 2.0, 7.8, 0.8);
	field.upright(-6.4, GROUND_Y, -5.4, 0.5, 0.32, tintColor(random, pick(PAL.stone), 0.05), random() * 60);
	field.upright(6.8, GROUND_Y, 5.8, 0.42, 0.26, tintColor(random, pick(PAL.stone), 0.05), random() * 60);

	scene.add(field.build(groundMaterial()));
}

buildWorld();

/* ------------------------------------------------------ rig and character -- */

const actorGroup = new THREE.Group();
scene.add(actorGroup);

const rig = buildRig(SKELETON, actorGroup);
const character = buildBlacksmith(rig);
const skeletonView = buildSkeletonView(rig, SKELETON, TIPS);

/* -------------------------------------------------------------- the tree -- */

// The walk leaf is the clip baked from lab 02's procedural walk, same as lab 03.
const baked = bakeClip({
	name: 'walk',
	duration: WALK_PERIOD,
	loop: 'loop',
	samples: 240,
	tolerance: 1.2 * DEG,
	sample: (t) => walkPose((t / WALK_PERIOD) * TAU, 1),
});

// Each locomotion clip's own speed, measured from its feet. These become the
// thresholds, so the parameter is in metres per second from the start.
const WALK_SPEED = measureGroundSpeed(SKELETON, (t) => samplePose(baked.clip, t), baked.clip.duration);
const RUN_SPEED = measureGroundSpeed(SKELETON, (t) => samplePose(RUN, t), RUN.duration);

// contactPhase: where in each clip's own cycle the left foot lands. This is
// what the sync uses to line the gaits up — the walk was baked with contacts a
// quarter of the way in, the run was authored with one at zero.
const idleLeaf = new ClipNode(IDLE, { label: 'idle' });
const walkLeaf = new ClipNode(baked.clip, {
	label: 'walk',
	sync: true,
	contactPhase: WALK_CONTACTS[0] / WALK_PERIOD,
});
const runLeaf = new ClipNode(RUN, { label: 'run', sync: true, contactPhase: 0 });

const gait = new Blend1D(
	'speed',
	[
		{ node: idleLeaf, at: 0 },
		{ node: walkLeaf, at: WALK_SPEED },
		{ node: runLeaf, at: RUN_SPEED },
	],
	{ label: 'speed (m/s)' },
);

const bank = new Blend1D(
	'turn',
	[
		{ node: new ClipNode(LEAN_RIGHT, { label: 'leanRight' }), at: -1 },
		{ node: new ClipNode(UPRIGHT, { label: 'upright' }), at: 0 },
		{ node: new ClipNode(LEAN_LEFT, { label: 'leanLeft' }), at: 1 },
	],
	{ label: 'turn (−1..1)' },
);

const root = new Additive(gait, bank, { label: 'additive', gainParam: 'leanGain' });

const tree = new BlendTree(root, BONES, { fallbackDuration: WALK_PERIOD });

// Sweep the tree once and record what speed each parameter value really
// produces, so the slider can be in true m/s.
const SPEED_TABLE = calibrateSpeed(tree, SKELETON, 'speed', [0, RUN_SPEED], 24, { turn: 0, leanGain: 0 });
const MAX_SPEED = SPEED_TABLE[SPEED_TABLE.length - 1].speed;

/* -------------------------------------------------------------------- ui -- */

const ui = {
	speed: document.getElementById('speed'),
	speedOut: document.getElementById('speedOut'),
	turn: document.getElementById('turn'),
	turnOut: document.getElementById('turnOut'),
	drive: document.getElementById('drive'),
	sync: document.getElementById('sync'),
	lean: document.getElementById('lean'),
	showSkel: document.getElementById('showSkel'),
	follow: document.getElementById('follow'),
	tree: document.getElementById('tree'),
	stats: document.getElementById('stats'),
};

ui.speed.max = MAX_SPEED.toFixed(2);

function applyVisibility() {
	const showS = ui.showSkel.checked;
	for (const m of skeletonView.meshes) m.visible = showS;
	for (const mat of character.materials.values()) {
		mat.transparent = showS;
		mat.opacity = showS ? 0.32 : 1;
		mat.depthWrite = !showS;
		mat.needsUpdate = true;
	}
}
ui.showSkel.addEventListener('change', applyVisibility);
ui.speed.addEventListener('input', () => {
	ui.drive.checked = false;
});
ui.turn.addEventListener('input', () => {
	ui.drive.checked = false;
});

// The tree diagram is generated from the tree itself, so it cannot drift out
// of sync with what is actually being evaluated.
const treeRows = [];

function buildTreeView() {
	ui.tree.innerHTML = '';
	const render = (node, depth, additive, prefix) => {
		const row = document.createElement('div');
		const isLeaf = node.kind === 'clip';
		row.className = `node ${isLeaf ? 'leaf' : 'op'}${additive ? ' additive' : ''}`;
		if (isLeaf) {
			row.innerHTML =
				`<span class="glyph">${prefix}</span>` +
				`<span class="name">${node.label}</span>` +
				`<span class="at"></span>` +
				`<span class="bar"><span></span></span>` +
				`<span class="pct">0%</span>`;
			treeRows.push({ node, el: row, bar: row.querySelector('.bar span'), pct: row.querySelector('.pct') });
		} else {
			const kind = node.kind === 'blend1d' ? 'Blend1D' : 'Additive';
			row.innerHTML =
				`<span class="glyph">${prefix}</span>` +
				`<span class="kind">${kind}</span>` +
				`<span>${node.label || ''}</span>`;
		}
		ui.tree.appendChild(row);

		if (node.kind === 'blend1d') {
			node.entries.forEach((entry, i) => {
				const last = i === node.entries.length - 1;
				render(entry.node, depth + 1, additive, prefix.replace(/[├└]/, ' ').replace(/─/g, ' ') + (last ? '└─' : '├─'));
				const added = treeRows[treeRows.length - 1];
				if (added && added.node === entry.node) {
					added.el.querySelector('.at').textContent = entry.at.toFixed(2);
				}
			});
		} else if (node.kind === 'additive') {
			render(node.base, depth + 1, additive, prefix.replace(/[├└]/, ' ').replace(/─/g, ' ') + '├─');
			render(node.add, depth + 1, true, prefix.replace(/[├└]/, ' ').replace(/─/g, ' ') + '└─');
		}
	};
	render(tree.root, 0, false, '');
}

function updateTreeView(weights) {
	const map = new Map();
	for (const leaf of weights.base) map.set(leaf.node, leaf.weight);
	for (const leaf of weights.add) map.set(leaf.node, leaf.weight);
	for (const row of treeRows) {
		const w = map.get(row.node) || 0;
		row.bar.style.width = `${(w * 100).toFixed(1)}%`;
		row.pct.textContent = `${Math.round(w * 100)}%`;
		row.el.classList.toggle('off', w < 0.005);
	}
}

buildTreeView();
applyVisibility();

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
		view.zoomGoal = Math.max(0.6, Math.min(4, view.zoomGoal * Math.exp(-e.deltaY * 0.0012)));
	},
	{ passive: false },
);

/* ------------------------------------------------------------------ actor -- */

const actor = { x: 0, z: 0, yaw: 0, u: 0 };
const params = { speed: 0, turn: 0, leanGain: 1 };

// Real blend trees damp their inputs: a parameter that jumps makes the pose
// jump, however good the blending is.
const smooth = { speed: 0, turn: 0 };

const wrapAngle = (a) => {
	while (a > PI) a -= TAU;
	while (a < -PI) a += TAU;
	return a;
};

// Contact slide: at any instant one foot should be carrying the character, and
// a foot that is carrying is not moving. So take whichever foot is moving
// SLOWER through the world — no height threshold needed, and no assumption
// about which foot is down. Near zero means someone is properly planted; a
// large value means both feet are travelling at once, which is skating.
//
// It never reaches zero here, because nothing constrains these feet to the
// ground: the clips were authored by eye and the ankle only approximately
// cancels the leg. Pinning it properly is a job for IK.
const footState = {
	footL: { prev: new THREE.Vector3(), cur: new THREE.Vector3(), has: false },
	footR: { prev: new THREE.Vector3(), cur: new THREE.Vector3(), has: false },
};
let slide = 0;

function measureSlide(dt) {
	if (dt <= 0) return;
	let slowest = Infinity;
	for (const name of ['footL', 'footR']) {
		const state = footState[name];
		rig.bones[name].getWorldPosition(state.cur);
		if (state.has) {
			const dx = state.cur.x - state.prev.x;
			const dz = state.cur.z - state.prev.z;
			slowest = Math.min(slowest, Math.hypot(dx, dz) / dt);
		}
		state.prev.copy(state.cur);
		state.has = true;
	}
	if (slowest < Infinity) slide += (slowest - slide) * Math.min(1, dt * 2.5);
}

/* ------------------------------------------------------------------ loop -- */

let last = performance.now();
let elapsed = 0;
let statTimer = 0;

function frame(now) {
	const dt = Math.min((now - last) / 1000, 0.06);
	last = now;
	elapsed += dt;

	// Auto-drive sweeps the speed so the blend can be watched hands-free.
	if (ui.drive.checked) {
		const t = elapsed * 0.22;
		const wave = 0.5 - 0.5 * Math.cos(t);
		ui.speed.value = (wave * MAX_SPEED).toFixed(2);
	}

	const wantSpeed = +ui.speed.value;
	smooth.speed += (wantSpeed - smooth.speed) * Math.min(1, dt * 4.5);

	// The slider is in m/s, so ask the calibration which parameter value
	// actually produces that speed.
	params.speed = parameterForSpeed(SPEED_TABLE, smooth.speed);
	const realSpeed = speedForParameter(SPEED_TABLE, params.speed);

	// Follow the figure eight; the turn parameter comes from how hard he is
	// actually turning, unless it is being driven by hand.
	let turnTarget = +ui.turn.value;
	if (ui.drive.checked) {
		const ahead = pathPoint(actor.u + 0.22);
		const desired = Math.atan2(ahead.x - actor.x, ahead.z - actor.z);
		const diff = wrapAngle(desired - actor.yaw);
		const turnRate = Math.max(-2.4, Math.min(2.4, diff * 3.2));
		actor.yaw += turnRate * dt;
		turnTarget = Math.max(-1, Math.min(1, turnRate / 1.1));
		actor.u += dt * realSpeed * 0.28;
		ui.turn.value = turnTarget.toFixed(2);
	} else {
		actor.yaw += turnTarget * 1.1 * dt;
	}
	smooth.turn += (turnTarget - smooth.turn) * Math.min(1, dt * 3.5);
	params.turn = smooth.turn;
	params.leanGain = ui.lean.checked ? 1 : 0;

	actor.x += Math.sin(actor.yaw) * realSpeed * dt;
	actor.z += Math.cos(actor.yaw) * realSpeed * dt;

	// Keep him on the island: near the edge, steer back towards the middle
	// rather than clamping, which would slam him to a stop.
	const radius = Math.hypot(actor.x, actor.z);
	if (radius > 8) {
		const inward = Math.atan2(-actor.x, -actor.z);
		const diff = wrapAngle(inward - actor.yaw);
		const rate = Math.min(2.2, (radius - 8) * 2.5) * dt;
		actor.yaw += Math.max(-rate, Math.min(rate, diff));
	}

	actorGroup.position.set(actor.x, GROUND_Y, actor.z);
	actorGroup.rotation.y = actor.yaw;

	const weights = tree.weights(params);
	tree.update(params, dt, { sync: ui.sync.checked });
	applyPose(rig, BONES, tree.pose);

	// Secondary motion, same spring as lab 03.
	const lead = Math.min(rig.bones.hipL.rotation.x, rig.bones.hipR.rotation.x);
	character.apron.quaternion.setFromEuler(new THREE.Euler(PI / 2 - 0.03 + lead * 0.5, PI / 6, 0));

	measureSlide(dt);

	// Panel
	ui.speedOut.textContent = smooth.speed.toFixed(2);
	ui.turnOut.textContent = smooth.turn.toFixed(2);
	statTimer += dt;
	if (statTimer > 0.1) {
		statTimer = 0;
		updateTreeView(weights);
		const duration = tree.syncedDuration(weights);
		const spread = tree.phaseSpread(weights, ui.sync.checked);
		ui.stats.innerHTML =
			`<dt>Parameter</dt><dd>${params.speed.toFixed(2)}</dd>` +
			`<dt>Cycle</dt><dd>${duration.toFixed(3)} s</dd>` +
			`<dt>Phase spread</dt><dd class="${spread > 0.02 ? 'warn' : ''}">${spread.toFixed(3)}</dd>` +
			`<dt>Contact slide</dt><dd>${slide.toFixed(2)} m/s</dd>`;
	}

	if (ui.follow.checked) {
		view.target.x += (actor.x - view.target.x) * Math.min(1, dt * 2.6);
		view.target.z += (actor.z - view.target.z) * Math.min(1, dt * 2.6);
		view.target.y += (GROUND_Y + HIPS_Y + 0.15 - view.target.y) * Math.min(1, dt * 2.6);
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

{
	const qs = new URLSearchParams(location.search);
	if (qs.has('speed')) {
		ui.speed.value = qs.get('speed');
		smooth.speed = +qs.get('speed');
		ui.drive.checked = false;
	}
	if (qs.has('drive')) ui.drive.checked = qs.get('drive') !== '0';
	if (qs.has('sync')) ui.sync.checked = qs.get('sync') !== '0';
	if (qs.has('lean')) ui.lean.checked = qs.get('lean') !== '0';
	if (qs.has('skel')) ui.showSkel.checked = qs.get('skel') !== '0';
	if (qs.has('zoom')) view.zoom = view.zoomGoal = +qs.get('zoom');
	if (qs.has('follow')) ui.follow.checked = qs.get('follow') !== '0';
	applyVisibility();
}

window.lab = { tree, params, actor, SPEED_TABLE, WALK_SPEED, RUN_SPEED, rig, character, view };

resize();
requestAnimationFrame(frame);
