/*
 * Hexdelve — Lab 06: click to move.
 *
 * The capstone: everything the earlier labs built, wired to a mouse.
 *
 *   click a tile     A* over the hex grid (../shared/hexgrid.js), then follow the
 *                    path. A step is only walkable if it rises or falls by at
 *                    most one terrace, so cliffs are real and get routed around.
 *   click again      while he is already going, he breaks into a run — the
 *                    blend tree (lab 04) just gets a larger speed parameter.
 *   click the anvil  it is not a tile you can stand on, so the destination
 *                    becomes the neighbouring tile closest to him; on arrival
 *                    he turns to face it and swings, with the hammer aimed by
 *                    IK (lab 05) so the blow lands on the face.
 *
 * Locomotion, contact and navigation are three separate systems here, and they
 * meet only through the pose: the tree produces one, IK corrects it, the rig
 * draws it.
 */

'use strict';

const { attachPanel, attachView, startZoom } = Hexdelve.ui;
const { hexGeometry, makeRandom } = Hexdelve.hex;
const { worldToAxial, distance: hexDistance, neighbours, findPath, keyOf } = Hexdelve.hexgrid;
const { SKELETON, BONES, TIPS, HIPS_Y } = Hexdelve.skeleton;
const { buildRig, buildSkeletonView, applySparsePose } = Hexdelve.rigview;
const { buildBlacksmith } = Hexdelve.blacksmith;
const { walkPose, WALK_PERIOD, WALK_CONTACTS } = Hexdelve.walk;
const { IDLE, RUN, HAMMER, LEAN_LEFT, LEAN_RIGHT, UPRIGHT } = Hexdelve.clips;
const {
	bakeClip, samplePose, measureGroundSpeed, solveWorld, denseToSparse,
	createPose, lerpPose, bindClip, sampleBound, DEG,
} = Hexdelve.anim;
const { ClipNode, Blend1D, Additive, BlendTree, calibrateSpeed, parameterForSpeed, speedForParameter } =
	Hexdelve.blendtree;
const { solveTwoBone, solveToolChain, levelBone, attachmentPosition } = Hexdelve.ik;

const PI = Math.PI;
const TAU = PI * 2;

const GROUND_RADIUS = 8;
const BASE_Y = 0.16;
const STEP_H = 0.19;
const SOLE = 0.12;
const MAX_CLIMB = 1; // terraces he can step up or down in one move

const random = makeRandom(53);

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

const view = { azimuth: (62 * PI) / 180, target: new THREE.Vector3(0, 1, 0), zoom: 1.35, zoomGoal: 1.35 };

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
sun.shadow.camera.left = -16;
sun.shadow.camera.right = 16;
sun.shadow.camera.top = 16;
sun.shadow.camera.bottom = -16;
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

// Terrain, anvil, smithy and log house all come from ../shared/world.js, which
// labs 07 and 08 stand in too. What is left in this file is lab 06's own
// subject: getting him across that ground.
const world = Hexdelve.world.build(scene, { random: random, groundRadius: GROUND_RADIUS, baseY: BASE_Y, stepH: STEP_H });

const tiles = world.tiles;
const tileAt = world.tileAt;
const groundAt = world.groundAt;
const blocked = world.blocked;
const isAnvil = world.isAnvil;
const ANVIL_POS = world.anvil.pos;
const ANVIL_FACE_Y = world.anvil.faceY;
const ANVIL_CELL = world.anvil.cell;
const SMITHY = world.smithy;
const CABIN = world.cabin;

// He walks; one terrace up or down is as much as that allows.
function passable(cell, from) {
	return world.passable(cell, from, MAX_CLIMB);
}

/* ------------------------------------------------------ rig and character -- */

const actorGroup = new THREE.Group();
scene.add(actorGroup);

const rig = buildRig(SKELETON, actorGroup);
const character = buildBlacksmith(rig);
const skeletonView = buildSkeletonView(rig, SKELETON, TIPS);

const HAMMER_OFFSET = [0, -0.341, 0.192];

/*
 * Where he has to stand to actually hit something.
 *
 * The grid is for navigation, not for reach. Neighbouring tile centres are
 * √3 ≈ 1.73 m apart, while his arm plus the haft spans about 1.0 m from the
 * shoulder — so a character glued to tile centres swings at thin air. Rather
 * than pick a fudge distance, ask the clip: play it to the moment of impact,
 * see where the hammer head ends up relative to his own origin, and stand so
 * that point lands on the anvil.
 *
 * That makes the stance self-calibrating. Re-time the strike, re-author the
 * swing or change his proportions, and the spot he steps to moves with it.
 */
const STRIKE_STANCE = (function () {
	const pose = samplePose(HAMMER, 0.5); // the impact key
	const head = attachmentPosition(SKELETON, pose, 'handR', HAMMER_OFFSET);
	return {
		distance: Math.hypot(head[0], head[2]), // how far from the target to stand
		bearing: Math.atan2(head[0], head[2]), // and how far to turn off square
		height: head[1],
	};
})();

/* -------------------------------------------------------- the blend tree -- */

const baked = bakeClip({
	name: 'walk',
	duration: WALK_PERIOD,
	loop: 'loop',
	samples: 240,
	tolerance: 1.2 * DEG,
	sample: (t) => walkPose((t / WALK_PERIOD) * TAU, 1),
});

const WALK_SPEED = measureGroundSpeed(SKELETON, (t) => samplePose(baked.clip, t), baked.clip.duration);
const RUN_SPEED = measureGroundSpeed(SKELETON, (t) => samplePose(RUN, t), RUN.duration);

const gait = new Blend1D('speed', [
	{ node: new ClipNode(IDLE, { label: 'idle' }), at: 0 },
	{ node: new ClipNode(baked.clip, { label: 'walk', sync: true, contactPhase: WALK_CONTACTS[0] / WALK_PERIOD }), at: WALK_SPEED },
	{ node: new ClipNode(RUN, { label: 'run', sync: true, contactPhase: 0 }), at: RUN_SPEED },
]);

const bank = new Blend1D('turn', [
	{ node: new ClipNode(LEAN_RIGHT), at: -1 },
	{ node: new ClipNode(UPRIGHT), at: 0 },
	{ node: new ClipNode(LEAN_LEFT), at: 1 },
]);

const tree = new BlendTree(new Additive(gait, bank), BONES, { fallbackDuration: WALK_PERIOD });
const SPEED_TABLE = calibrateSpeed(tree, SKELETON, 'speed', [0, RUN_SPEED], 24, { turn: 0 });
const MAX_SPEED = SPEED_TABLE[SPEED_TABLE.length - 1].speed;
const CRUISE = { walk: Math.min(WALK_SPEED, MAX_SPEED), run: MAX_SPEED * 0.97 };

// The hammer is played outside the tree and crossfaded over it.
const boneIndex = new Map(BONES.map((n, i) => [n, i]));
const hammerEntry = { clip: HAMMER, bound: bindClip(HAMMER, boneIndex) };
const hammerPose = createPose(BONES.length);
const finalPose = createPose(BONES.length);
const sparse = {};

/* --------------------------------------------------------------- markers -- */

function flatMarker(color, radius, opacity) {
	const m = new THREE.Mesh(
		hexGeometry(),
		new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
	);
	m.scale.set(radius, 0.02, radius);
	m.visible = false;
	scene.add(m);
	return m;
}

const hover = flatMarker(0xffffff, 0.9, 0.28);
const goalMarker = flatMarker(0x4a7a3c, 0.8, 0.55);
const pathMarkers = [];
for (let i = 0; i < 48; i++) pathMarkers.push(flatMarker(0x6f9b4e, 0.22, 0.7));

function showPath(path) {
	for (const m of pathMarkers) m.visible = false;
	if (!path || !ui.showPath.checked) return;
	for (let i = 0; i < path.length && i < pathMarkers.length; i++) {
		const tile = tileAt(path[i].q, path[i].r);
		if (!tile) continue;
		const m = pathMarkers[i];
		m.visible = true;
		m.position.set(tile.x, tile.top + 0.02, tile.z);
	}
}

/* ---------------------------------------------------------- the controller -- */

const actor = { x: 0, z: -5.4, y: BASE_Y, yaw: 0 };
{
	const start = worldToAxial(actor.x, actor.z);
	const tile = tileAt(start.q, start.r);
	if (tile) actor.y = tile.top;
}

const control = {
	// idle → moving (on the grid) → approach (off the grid) → strike → retreat
	state: 'idle',
	path: null,
	index: 0,
	cruise: 0,
	goalCell: null,
	working: false,
	message: 'waiting',
	lastClickAt: -10,
	home: null, // the tile centre he steps back onto
	spot: null, // the off-grid stance he steps out to
	spotYaw: 0,
};

let hammerTime = 0;
let hammerBlend = 0;
let speedNow = 0;
let turnNow = 0;

const wrapAngle = (a) => {
	while (a > PI) a -= TAU;
	while (a < -PI) a += TAU;
	return a;
};

// Clicking the anvil means "work here", which is a different destination from
// the tile itself: the neighbour closest to where he already stands.
function anvilApproachCell() {
	const here = worldToAxial(actor.x, actor.z);
	let best = null;
	let bestScore = Infinity;
	for (const n of neighbours(ANVIL_CELL)) {
		if (!passable(n, null)) continue;
		const tile = tileAt(n.q, n.r);
		const score = hexDistance(here, n) + Math.abs(tile.level - tileAt(0, 0).level) * 2;
		if (score < bestScore) {
			bestScore = score;
			best = n;
		}
	}
	return best;
}

function goTo(cell, running) {
	const here = worldToAxial(actor.x, actor.z);
	const wantsAnvil = isAnvil(cell);
	const destination = wantsAnvil ? anvilApproachCell() : cell;

	if (!destination) {
		control.message = 'nowhere to stand';
		return;
	}
	const path = findPath(here, destination, { passable });
	if (!path) {
		control.message = 'no route';
		control.state = 'idle';
		control.path = null;
		showPath(null);
		goalMarker.visible = false;
		return;
	}

	control.path = path;
	control.index = 1;
	control.state = 'moving';
	control.cruise = running ? CRUISE.run : CRUISE.walk;
	control.goalCell = destination;
	control.working = wantsAnvil;
	control.message = running ? 'running' : 'walking';

	const tile = tileAt(destination.q, destination.r);
	goalMarker.visible = true;
	goalMarker.position.set(tile.x, tile.top + 0.02, tile.z);
	goalMarker.material.color.set(wantsAnvil ? 0xc25a3a : 0x4a7a3c);
	showPath(path);
}

/**
 * Leave the grid to reach the anvil.
 *
 * He keeps his tile as home, and steps out to a stance measured from the swing
 * itself: `distance` from the anvil, turned `bearing` off square so the hammer
 * — which he holds in his right hand, not down his centre line — comes down on
 * the face. One blow, then he steps back onto his hexagon.
 */
function beginApproach() {
	const tile = tileAt(control.goalCell.q, control.goalCell.r);
	control.home = { x: tile.x, z: tile.z };

	let dx = tile.x - ANVIL_POS.x;
	let dz = tile.z - ANVIL_POS.z;
	const len = Math.hypot(dx, dz) || 1;
	dx /= len;
	dz /= len;

	control.spot = {
		x: ANVIL_POS.x + dx * STRIKE_STANCE.distance,
		z: ANVIL_POS.z + dz * STRIKE_STANCE.distance,
	};
	control.spotYaw = Math.atan2(-dx, -dz) - STRIKE_STANCE.bearing;
	control.state = 'approach';
	control.message = 'stepping in';
	hammerTime = 0;
}

function arrive() {
	control.path = null;
	showPath(null);
	if (control.working) {
		beginApproach();
		return;
	}
	control.state = 'idle';
	control.message = 'idle';
	goalMarker.visible = false;
}

/* ---------------------------------------------------------------- picking -- */

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function pickCell(clientX, clientY) {
	const rect = canvas.getBoundingClientRect();
	ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
	ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
	raycaster.setFromCamera(ndc, camera);
	// The buildings are in the ray set purely so that clicking a wall does
	// nothing, rather than selecting the tile visible through it.
	const hits = raycaster.intersectObjects([world.groundMesh].concat(world.buildings));
	for (const hit of hits) {
		if (hit.object !== world.groundMesh) return null;
		const meta = world.groundMesh.userData.meta[hit.instanceId];
		if (meta) return meta;
	}
	return null;
}

// Orbit, pan, zoom and tap, from a mouse or from fingers — see ../shared/ui.js.
// What is lab-specific is only what a tap means and what the pointer is over.
// The panel opens and closes from ../shared/ui.js, which also reads ?panel=.
attachPanel();

attachView(canvas, view, {
	applyCamera: applyCamera,
	viewHeight: VIEW,
	pitch: ISO_PITCH,
	zoom: [0.6, 4],
	onPan: function () {
		ui.follow.checked = false;
	},
	onTap: function (x, y) {
		const cell = pickCell(x, y);
		if (!cell) return;
		// A second click while he is already on his way is the "and hurry up"
		// signal — no double-click timer, so the first click never has to wait.
		const now = performance.now() / 1000;
		const quick = now - control.lastClickAt < 0.45;
		control.lastClickAt = now;
		goTo(cell, quick || control.state === 'moving');
	},
	onHover: function (x, y) {
		const cell = pickCell(x, y);
		if (!cell) {
			hover.visible = false;
			return;
		}
		hover.visible = true;
		hover.position.set(cell.x, cell.top + 0.015, cell.z);
		hover.material.color.set(isAnvil(cell) ? 0xffb27a : 0xffffff);
	},
	onHoverEnd: function () {
		hover.visible = false;
	},
});

/* -------------------------------------------------------------------- ui -- */

const ui = {
	ik: document.getElementById('ik'),
	showPath: document.getElementById('showPath'),
	showSkel: document.getElementById('showSkel'),
	follow: document.getElementById('follow'),
	stats: document.getElementById('stats'),
};

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
ui.showPath.addEventListener('change', () => showPath(control.path));

/* --------------------------------------------------------------- the IK -- */

const ikStats = { pelvis: 0, hammerErr: 0, rawErr: 0, clamped: false };

function toWorldXZ(localX, localZ) {
	const s = Math.sin(actor.yaw);
	const c = Math.cos(actor.yaw);
	return { x: actor.x + localX * c + localZ * s, z: actor.z - localX * s + localZ * c };
}

function applyFootIK() {
	const world = solveWorld(SKELETON, sparse);
	const targets = {};
	let pelvisDrop = 0;

	for (const side of ['L', 'R']) {
		const bone = `foot${side}`;
		const p = world[bone].p;
		const w = toWorldXZ(p[0], p[2]);
		const groundY = groundAt(w.x, w.z);
		const desiredY = groundY - actor.y + SOLE;
		const above = p[1] - desiredY;
		const weight = Math.max(0, Math.min(1, 1 - above / 0.18));
		targets[bone] = { x: p[0], y: desiredY, z: p[2], weight };
		if (weight > 0.02) pelvisDrop = Math.min(pelvisDrop, (desiredY - p[1]) * weight);
	}

	ikStats.pelvis = pelvisDrop;
	if (pelvisDrop < -0.0005) {
		if (!sparse.root) sparse.root = { rot: [0, 0, 0], pos: [0, 0, 0] };
		sparse.root.pos[1] += pelvisDrop;
	}

	const world2 = solveWorld(SKELETON, sparse);
	for (const side of ['L', 'R']) {
		const t = targets[`foot${side}`];
		if (t.weight <= 0.02) continue;
		solveTwoBone(
			SKELETON, sparse,
			{ root: `hip${side}`, mid: `shin${side}`, end: `foot${side}` },
			[t.x, t.y, t.z], world2[`shin${side}`].p, t.weight, world2,
		);
		levelBone(SKELETON, sparse, `foot${side}`, t.weight);
	}
}

const IK_START = 0.34;
const IK_PEAK = 0.5;
const IK_END = 0.74;

function hammerIKWeight(t) {
	let time = t % HAMMER.duration;
	if (time < 0) time += HAMMER.duration;
	if (time < IK_START || time > IK_END) return 0;
	if (time < IK_PEAK) {
		const u = (time - IK_START) / (IK_PEAK - IK_START);
		return u * u * (3 - 2 * u);
	}
	const u = 1 - (time - IK_PEAK) / (IK_END - IK_PEAK);
	return u * u * (3 - 2 * u);
}

function applyHammerIK(t, scale) {
	const weight = hammerIKWeight(t) * scale;
	const world = solveWorld(SKELETON, sparse);
	const dx = ANVIL_POS.x - actor.x;
	const dz = ANVIL_POS.z - actor.z;
	const s = Math.sin(actor.yaw);
	const c = Math.cos(actor.yaw);
	const target = [dx * c - dz * s, ANVIL_FACE_Y - actor.y + 0.03, dx * s + dz * c];

	// Measured before and after, always, so the readout is never a stale number
	// from whenever the solver last happened to run.
	const before = attachmentPosition(SKELETON, sparse, 'handR', HAMMER_OFFSET, world);
	ikStats.rawErr = Math.hypot(before[0] - target[0], before[1] - target[1], before[2] - target[2]);

	ikStats.clamped = false;
	if (weight > 0.001) {
		const result = solveToolChain(
			SKELETON, sparse,
			{ root: 'armR', mid: 'forearmR', end: 'handR' },
			'handR', HAMMER_OFFSET, target, world.forearmR.p, weight, world,
		);
		ikStats.clamped = !!(result && result.clamped);
	}
	const after = attachmentPosition(SKELETON, sparse, 'handR', HAMMER_OFFSET);
	ikStats.hammerErr = Math.hypot(after[0] - target[0], after[1] - target[1], after[2] - target[2]);
}

/* ------------------------------------------------------------------ loop -- */

let last = performance.now();
let statTimer = 0;
let elapsed = 0;

/**
 * Short, precise moves off the grid: the step out to the anvil and the step
 * back. Unlike path following this drives position straight at the target
 * rather than along his heading, because it has to land on an exact spot and
 * the distance is under a metre — he shuffles into place rather than steering.
 * The returned speed still feeds the blend tree, so his legs do the stepping.
 */
function stepToward(tx, tz, yawTarget, dt, pace) {
	const dx = tx - actor.x;
	const dz = tz - actor.z;
	const dist = Math.hypot(dx, dz);
	const diff = wrapAngle(yawTarget - actor.yaw);
	actor.yaw += Math.max(-2.6 * dt, Math.min(2.6 * dt, diff));
	turnNow *= Math.max(0, 1 - dt * 4);
	if (dist < 1e-4) return 0;
	// Enough gain that the last centimetres do not crawl — a step into place
	// should read as one deliberate movement, not an asymptote.
	const speed = Math.min(pace, dist * 4 + 0.22);
	const move = Math.min(speed * dt, dist);
	actor.x += (dx / dist) * move;
	actor.z += (dz / dist) * move;
	return speed;
}

function followPath(dt) {
	const path = control.path;
	if (!path) return 0;
	const goal = path[path.length - 1];
	const goalTile = tileAt(goal.q, goal.r);

	// Retire waypoints. A fixed "close enough" radius does not work: the turn
	// radius is speed over turn rate, so at a run he can circle a waypoint
	// forever without ever entering it. So the radius grows with speed, and a
	// waypoint that has ended up behind him counts as reached regardless.
	const advanceRadius = Math.max(0.5, speedNow * 0.6);
	const fx = Math.sin(actor.yaw);
	const fz = Math.cos(actor.yaw);
	while (control.index < path.length - 1) {
		const t = tileAt(path[control.index].q, path[control.index].r);
		const ddx = t.x - actor.x;
		const ddz = t.z - actor.z;
		const d = Math.hypot(ddx, ddz);
		if (d < advanceRadius || (ddx * fx + ddz * fz < 0 && d < 1.5)) control.index++;
		else break;
	}

	const node = path[Math.min(control.index, path.length - 1)];
	const tile = tileAt(node.q, node.r);
	const dx = tile.x - actor.x;
	const dz = tile.z - actor.z;

	const toGoal = Math.hypot(goalTile.x - actor.x, goalTile.z - actor.z);
	const desired = Math.atan2(dx, dz);
	const diff = wrapAngle(desired - actor.yaw);
	const turnRate = Math.max(-3, Math.min(3, diff * 4));
	actor.yaw += turnRate * dt;
	turnNow = Math.max(-1, Math.min(1, turnRate / 1.4));

	// Ease down over the last stride, and do not sprint into a hard turn.
	const arriving = Math.min(1, toGoal / 1.1);
	const cornering = 1 - Math.min(0.55, Math.abs(diff) * 0.5);
	const target = control.cruise * arriving * cornering;

	// Arrive rather than orbit: once he is close and slow, settle onto the tile
	// centre instead of chasing it round in circles.
	if (toGoal < 0.3) {
		const pull = Math.min(1, dt * 4);
		actor.x += (goalTile.x - actor.x) * pull;
		actor.z += (goalTile.z - actor.z) * pull;
	}
	if (toGoal < 0.12) {
		arrive();
		return 0;
	}
	return target;
}

function frame(now) {
	const dt = Math.min((now - last) / 1000, 0.06);
	last = now;
	elapsed += dt;
	world.animateSmoke(elapsed);

	let wantSpeed = 0;
	if (control.state === 'moving') {
		wantSpeed = followPath(dt);
	} else if (control.state === 'approach') {
		wantSpeed = stepToward(control.spot.x, control.spot.z, control.spotYaw, dt, 0.62);
		const left = Math.hypot(control.spot.x - actor.x, control.spot.z - actor.z);
		const square = Math.abs(wrapAngle(control.spotYaw - actor.yaw));
		if (left < 0.09 && square < 0.14) {
			control.state = 'strike';
			control.message = 'strike';
			hammerTime = 0;
		}
	} else if (control.state === 'retreat') {
		const back = Math.atan2(control.home.x - actor.x, control.home.z - actor.z);
		wantSpeed = stepToward(control.home.x, control.home.z, back, dt, 0.58);
		if (Math.hypot(control.home.x - actor.x, control.home.z - actor.z) < 0.09) {
			control.state = 'idle';
			control.message = 'idle';
			control.working = false;
			goalMarker.visible = false;
		}
	} else {
		turnNow *= Math.max(0, 1 - dt * 4);
	}

	speedNow += (wantSpeed - speedNow) * Math.min(1, dt * 5);
	if (speedNow < 0.02) speedNow = wantSpeed === 0 ? 0 : speedNow;

	const param = parameterForSpeed(SPEED_TABLE, speedNow);
	const realSpeed = speedForParameter(SPEED_TABLE, param);

	if (control.state === 'moving') {
		actor.x += Math.sin(actor.yaw) * realSpeed * dt;
		actor.z += Math.cos(actor.yaw) * realSpeed * dt;
	}
	const under = groundAt(actor.x, actor.z);
	actor.y += (under - actor.y) * Math.min(1, dt * 7);

	// One blow, not a loop: when the clip runs out he steps back to his tile.
	if (control.state === 'strike') {
		hammerTime += dt;
		hammerBlend = Math.min(1, hammerBlend + dt * 5);
		if (hammerTime >= HAMMER.duration) {
			control.state = 'retreat';
			control.message = 'stepping back';
		}
	} else {
		hammerBlend = Math.max(0, hammerBlend - dt * 5);
	}

	// Locomotion from the tree, the swing crossfaded over the top of it.
	tree.update({ speed: param, turn: turnNow }, dt);
	if (hammerBlend > 0.001) {
		sampleBound(hammerEntry, hammerTime % HAMMER.duration, hammerPose);
		lerpPose(finalPose, tree.pose, hammerPose, hammerBlend);
	} else {
		finalPose.rot.set(tree.pose.rot);
		finalPose.pos.set(tree.pose.pos);
	}

	denseToSparse(BONES, finalPose, sparse);
	if (ui.ik.checked) {
		if (control.state === 'strike') applyHammerIK(hammerTime, hammerBlend);
		applyFootIK();
	}

	actorGroup.position.set(actor.x, actor.y, actor.z);
	actorGroup.rotation.y = actor.yaw;
	applySparsePose(rig, sparse);

	const lead = Math.min(rig.bones.hipL.rotation.x, rig.bones.hipR.rotation.x);
	character.apron.quaternion.setFromEuler(new THREE.Euler(PI / 2 - 0.03 + lead * 0.5, PI / 6, 0));

	statTimer += dt;
	if (statTimer > 0.12) {
		statTimer = 0;
		const cell = worldToAxial(actor.x, actor.z);
		const tile = tileAt(cell.q, cell.r);
		const busy = control.state !== 'idle';
		const rows = [
			['State', `<span class="${control.message === 'no route' ? 'warn' : busy ? 'busy' : ''}">${control.message}</span>`],
			['Speed', `${realSpeed.toFixed(2)} m/s`],
			['Cell', `${cell.q}, ${cell.r} · terrace ${tile ? tile.level : '–'}`],
		];
		if (control.path) rows.push(['Path', `${control.path.length - control.index} tiles left`]);
		if (control.state === 'strike') {
			rows.push(['Clip alone', `${(ikStats.rawErr * 100).toFixed(1)} cm off`]);
			rows.push(['Blow lands', `${(ikStats.hammerErr * 100).toFixed(1)} cm${ikStats.clamped ? ' · out of reach' : ''}`]);
		} else {
			rows.push(['Pelvis drop', `${(ikStats.pelvis * 100).toFixed(1)} cm`]);
		}
		ui.stats.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
	}

	if (ui.follow.checked) {
		view.target.x += (actor.x - view.target.x) * Math.min(1, dt * 2.4);
		view.target.z += (actor.z - view.target.z) * Math.min(1, dt * 2.4);
		view.target.y += (actor.y + HIPS_Y + 0.1 - view.target.y) * Math.min(1, dt * 2.4);
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

applyVisibility();
{
	// A portrait phone sees a much narrower slice of the world than a desktop
	// window does; open zoomed out to match.
	view.zoom = view.zoomGoal = startZoom(view.zoom);

	const qs = new URLSearchParams(location.search);
	if (qs.has('ik')) ui.ik.checked = qs.get('ik') !== '0';
	if (qs.has('skel')) ui.showSkel.checked = qs.get('skel') !== '0';
	if (qs.has('path')) ui.showPath.checked = qs.get('path') !== '0';
	if (qs.has('zoom')) view.zoom = view.zoomGoal = +qs.get('zoom');
	if (qs.has('follow')) ui.follow.checked = qs.get('follow') !== '0';
	applyVisibility();
}

window.lab = {
	control, actor, tiles, tileAt, goTo, pickCell, tree, SPEED_TABLE, CRUISE,
	ANVIL_CELL, ANVIL_POS, ANVIL_FACE_Y, ikStats, groundAt, STRIKE_STANCE,
	blocked, SMITHY, CABIN, view, passable,
};

resize();
requestAnimationFrame(frame);
