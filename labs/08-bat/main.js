/*
 * Hexdelve — Lab 08: the bat.
 *
 * An enemy, and the first thing in these labs that is not built on the
 * humanoid rig. It has its own skeleton (../shared/batrig.js), its own poses
 * (../shared/batpose.js) and its own body (../shared/bat.js) — and none of the
 * machinery cared. The same `buildRig` wires it, the same `buildSkeletonView`
 * draws it, the same `solveWorld` measures it, the same A* moves it. A rig here
 * is a list of names, parents and offsets; nothing downstream ever asked what
 * shape the animal was.
 *
 * What it does:
 *
 *   asleep     folded on its hexagon, wings wrapped round it, breathing
 *   wakes      when you come within three tiles — perch pose blended into flight
 *   hunts      A* over the same grid you walk, re-pathed as you move; it is not
 *              flying free, it goes tile to tile like everything else here
 *   strikes    steps off the grid to a stance measured from its own lunge, the
 *              way the smith steps off his to reach the anvil, bites, backs off
 *   gives up   loses you at six tiles and flies home to its perch
 *
 * The one place it differs from a man is what a step costs: its wings clear two
 * terraces where he can only manage one. That is a number passed to
 * `world.passable`, not a different pathfinder.
 */

'use strict';

const { hexGeometry, makeRandom } = Hexdelve.hex;
const { worldToAxial, distance: hexDistance, neighbours, findPath, keyOf } = Hexdelve.hexgrid;
const { SKELETON, BONES, TIPS, HIPS_Y } = Hexdelve.skeleton;
const { buildRig, buildSkeletonView, applySparsePose } = Hexdelve.rigview;
const { buildWanderer } = Hexdelve.wanderer;
const { attachPanel, attachView, startZoom } = Hexdelve.ui;
const { walkPose, WALK_PERIOD, WALK_CONTACTS } = Hexdelve.walk;
const { IDLE, RUN, LEAN_LEFT, LEAN_RIGHT, UPRIGHT } = Hexdelve.clips;
const { bakeClip, samplePose, measureGroundSpeed, solveWorld, denseToSparse, DEG } = Hexdelve.anim;
const { ClipNode, Blend1D, Additive, BlendTree, calibrateSpeed, parameterForSpeed, speedForParameter } =
	Hexdelve.blendtree;
const { solveTwoBone, levelBone, attachmentPosition } = Hexdelve.ik;

const BAT = Hexdelve.batrig;
const { perchPose, flyPose, lungePose, mixPose, FLAP_PERIOD, LUNGE_CONTACT } = Hexdelve.batpose;

const PI = Math.PI;
const TAU = PI * 2;

const GROUND_RADIUS = 8;
const BASE_Y = 0.16;
const STEP_H = 0.19;
const SOLE = 0.12;
const MAX_CLIMB = 1; // terraces the man can step up or down in one move
const BAT_CLIMB = 2; // ... and what a pair of wings is worth

const WAKE_RANGE = 3; // tiles: how close you get before it notices you
const LOSE_RANGE = 6; // tiles: how far you get before it stops caring
const BITE_COOLDOWN = 1.1;
const HOVER_LIFT = 0.62; // how far off the ground the wings hold it, once awake

const random = makeRandom(53);

const wrapAngle = (a) => {
	while (a > PI) a -= TAU;
	while (a < -PI) a += TAU;
	return a;
};

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

const world = Hexdelve.world.build(scene, { random: random, groundRadius: GROUND_RADIUS, baseY: BASE_Y, stepH: STEP_H });

const tileAt = world.tileAt;
const groundAt = world.groundAt;

// The same ground, asked two different questions. He walks, so a terrace is a
// step up; it flies, so a terrace is a flap.
const walkable = (cell, from) => world.passable(cell, from, MAX_CLIMB);
const flyable = (cell, from) => world.passable(cell, from, BAT_CLIMB);

/* ---------------------------------------------------------------- actors -- */

/*
 * An actor is a group at ground level, a rig inside it, a body hung on the rig
 * and one sparse pose buffer. The only thing that varies between the man and
 * the bat is which skeleton goes in — which is the whole argument of this lab.
 */
function makeActor(skeleton, tips, build, { x, z, yaw }) {
	const group = new THREE.Group();
	scene.add(group);
	const rig = buildRig(skeleton, group);
	const character = build(rig);
	const skeletonView = buildSkeletonView(rig, skeleton, tips);
	return {
		group, rig, character, skeletonView, skeleton,
		x, z, yaw, y: groundAt(x, z),
		sparse: {},
		pelvisDrop: 0,
	};
}

const player = makeActor(SKELETON, TIPS, buildWanderer, { x: 0, z: -5.4, yaw: 0 });

// It sleeps out in the open ground east of the anvil, three or four tiles from
// where you start — close enough to find, far enough to see it wake.
const PERCH = worldToAxial(3.9, 1.2);
const bat = makeActor(BAT.SKELETON, BAT.TIPS, Hexdelve.bat.buildBat, {
	x: tileAt(PERCH.q, PERCH.r).x,
	z: tileAt(PERCH.q, PERCH.r).z,
	yaw: 2.4,
});
bat.cell = PERCH;

const actors = [player, bat];

/*
 * How close it has to be to bite you.
 *
 * The same measurement lab 06 makes for the hammer, on a different animal: play
 * the lunge to the moment the jaws arrive, ask where they end up relative to
 * the bat's own origin, and stand so that point lands on you. Re-time the
 * strike or lengthen its neck and the stance follows, with nothing to re-tune.
 */
const JAW_TIP = [0, -0.02, 0.16];

const BITE_STANCE = (function () {
	const pose = lungePose(LUNGE_CONTACT);
	const jaws = attachmentPosition(BAT.SKELETON, pose, 'jaw', JAW_TIP);
	return {
		distance: Math.hypot(jaws[0], jaws[2]),
		bearing: Math.atan2(jaws[0], jaws[2]),
		height: jaws[1],
	};
})();

/* ------------------------------------------------------- the man's motion -- */

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

// Deliberately under a sprint: it should be able to run you down while you dawdle
// and lose you while you run, so that the range numbers mean something.
const BAT_SPEED = MAX_SPEED * 0.72;

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
const perchMarker = flatMarker(0x8d6bb0, 0.75, 0.3);
const pathMarkers = [];
for (let i = 0; i < 48; i++) pathMarkers.push(flatMarker(0x6f9b4e, 0.22, 0.7));
const batMarkers = [];
for (let i = 0; i < 24; i++) batMarkers.push(flatMarker(0xb0553f, 0.19, 0.75));

function showPathOn(markers, path) {
	for (const m of markers) m.visible = false;
	if (!path || !ui.showPath.checked) return;
	for (let i = 0; i < path.length && i < markers.length; i++) {
		const tile = tileAt(path[i].q, path[i].r);
		if (!tile) continue;
		markers[i].visible = true;
		markers[i].position.set(tile.x, tile.top + 0.02, tile.z);
	}
}

{
	const tile = tileAt(PERCH.q, PERCH.r);
	perchMarker.position.set(tile.x, tile.top + 0.015, tile.z);
}

/* ------------------------------------------------------------ the motes -- */

// A dozen dark flecks thrown off a bite, on the one frame the jaws arrive.
class Bits {
	constructor(count, color, gravity, life, size) {
		this.items = [];
		this.gravity = gravity;
		this.life = life;
		this.size = size;
		this.next = 0;
		for (let i = 0; i < count; i++) {
			const mesh = new THREE.Mesh(
				hexGeometry(),
				new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0, depthWrite: false }),
			);
			mesh.visible = false;
			scene.add(mesh);
			this.items.push({ mesh, t: 0, max: 1, vx: 0, vy: 0, vz: 0, spin: 0 });
		}
	}

	spawn(x, y, z, n, spread, up) {
		for (let i = 0; i < n; i++) {
			const bit = this.items[this.next];
			this.next = (this.next + 1) % this.items.length;
			bit.t = this.life * (0.7 + random() * 0.3);
			bit.max = bit.t;
			bit.mesh.position.set(x, y, z);
			const a = random() * TAU;
			const r = spread * (0.3 + random());
			bit.vx = Math.cos(a) * r;
			bit.vz = Math.sin(a) * r;
			bit.vy = up * (0.5 + random());
			bit.spin = (random() - 0.5) * 14;
			bit.mesh.visible = true;
		}
	}

	update(dt) {
		for (const bit of this.items) {
			if (bit.t <= 0) continue;
			bit.t -= dt;
			if (bit.t <= 0) {
				bit.mesh.visible = false;
				continue;
			}
			bit.vy += this.gravity * dt;
			bit.mesh.position.x += bit.vx * dt;
			bit.mesh.position.y += bit.vy * dt;
			bit.mesh.position.z += bit.vz * dt;
			bit.mesh.rotation.y += bit.spin * dt;
			const u = bit.t / bit.max;
			const s = this.size * (0.4 + 0.6 * u);
			bit.mesh.scale.set(s, s * 0.8, s);
			bit.mesh.material.opacity = Math.min(1, u * 1.6) * 0.85;
		}
	}
}

const motes = new Bits(14, 0x4a3a3c, -5.5, 0.5, 0.05);

/* ------------------------------------------------------------ controller -- */

const control = {
	state: 'idle', // idle → moving
	path: null,
	index: 0,
	cruise: 0,
	goalCell: null,
	message: 'waiting',
	lastClickAt: -10,
};

let speedNow = 0;
let turnNow = 0;

function goTo(cell, running) {
	const here = worldToAxial(player.x, player.z);
	const path = findPath(here, cell, { passable: walkable });
	if (!path) {
		control.message = 'no route';
		control.state = 'idle';
		control.path = null;
		showPathOn(pathMarkers, null);
		goalMarker.visible = false;
		return;
	}

	control.path = path;
	control.index = 1;
	control.state = 'moving';
	control.cruise = running ? CRUISE.run : CRUISE.walk;
	control.goalCell = cell;
	control.message = running ? 'running' : 'walking';

	const tile = tileAt(cell.q, cell.r);
	goalMarker.visible = true;
	goalMarker.position.set(tile.x, tile.top + 0.02, tile.z);
	showPathOn(pathMarkers, path);
}

/* ---------------------------------------------------------------- picking -- */

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const PICKABLE = [world.groundMesh].concat(world.buildings);

function pickCell(clientX, clientY) {
	const rect = canvas.getBoundingClientRect();
	ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
	ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
	raycaster.setFromCamera(ndc, camera);
	const hits = raycaster.intersectObjects(PICKABLE);
	for (const hit of hits) {
		if (hit.object !== world.groundMesh) return null;
		const meta = world.groundMesh.userData.meta[hit.instanceId];
		if (meta) return meta;
	}
	return null;
}

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

attachPanel();

function applyVisibility() {
	const showS = ui.showSkel.checked;
	for (const actor of actors) {
		for (const m of actor.skeletonView.meshes) m.visible = showS;
		for (const mat of actor.character.materials.values()) {
			mat.transparent = showS;
			mat.opacity = showS ? 0.34 : 1;
			mat.depthWrite = !showS;
			mat.needsUpdate = true;
		}
	}
}
ui.showSkel.addEventListener('change', applyVisibility);
ui.showPath.addEventListener('change', () => {
	showPathOn(pathMarkers, control.path);
	showPathOn(batMarkers, hunt.path);
});

/* --------------------------------------------------------------- the IK -- */

function toWorldXZ(actor, localX, localZ) {
	const s = Math.sin(actor.yaw);
	const c = Math.cos(actor.yaw);
	return { x: actor.x + localX * c + localZ * s, z: actor.z - localX * s + localZ * c };
}

// Only the man has feet that have to meet the ground; the bat's hang.
function applyFootIK(actor) {
	const pose = actor.sparse;
	const world0 = solveWorld(SKELETON, pose);
	const targets = {};
	let pelvisDrop = 0;

	for (const side of ['L', 'R']) {
		const bone = `foot${side}`;
		const p = world0[bone].p;
		const w = toWorldXZ(actor, p[0], p[2]);
		const groundY = groundAt(w.x, w.z);
		const desiredY = groundY - actor.y + SOLE;
		const above = p[1] - desiredY;
		const weight = Math.max(0, Math.min(1, 1 - above / 0.18));
		targets[bone] = { x: p[0], y: desiredY, z: p[2], weight };
		if (weight > 0.02) pelvisDrop = Math.min(pelvisDrop, (desiredY - p[1]) * weight);
	}

	actor.pelvisDrop = pelvisDrop;
	if (pelvisDrop < -0.0005) {
		if (!pose.root) pose.root = { rot: [0, 0, 0], pos: [0, 0, 0] };
		pose.root.pos[1] += pelvisDrop;
	}

	const world2 = solveWorld(SKELETON, pose);
	for (const side of ['L', 'R']) {
		const t = targets[`foot${side}`];
		if (t.weight <= 0.02) continue;
		solveTwoBone(
			SKELETON, pose,
			{ root: `hip${side}`, mid: `shin${side}`, end: `foot${side}` },
			[t.x, t.y, t.z], world2[`shin${side}`].p, t.weight, world2,
		);
		levelBone(SKELETON, pose, `foot${side}`, t.weight);
	}
}

/* ---------------------------------------------------- driving the wanderer -- */

function placeActor(actor) {
	actor.group.position.set(actor.x, actor.y, actor.z);
	actor.group.rotation.y = actor.yaw;
	applySparsePose(actor.rig, actor.sparse);
}

function turnTowards(actor, targetX, targetZ, dt, rate) {
	const want = Math.atan2(targetX - actor.x, targetZ - actor.z);
	const diff = wrapAngle(want - actor.yaw);
	actor.yaw += Math.max(-rate * dt, Math.min(rate * dt, diff));
	return Math.abs(diff);
}

/**
 * Follow a path of tiles. Shared in spirit with lab 06's version and identical
 * in the parts that matter: waypoints retire on a radius that grows with speed,
 * because at a run a fixed one can be circled forever.
 */
function followPath(actor, state, dt, cruise, turnRate) {
	const path = state.path;
	if (!path) return 0;
	const goal = path[path.length - 1];
	const goalTile = tileAt(goal.q, goal.r);
	if (!goalTile) return 0;

	const advanceRadius = Math.max(0.5, state.speed * 0.6);
	const fx = Math.sin(actor.yaw);
	const fz = Math.cos(actor.yaw);
	while (state.index < path.length - 1) {
		const t = tileAt(path[state.index].q, path[state.index].r);
		const ddx = t.x - actor.x;
		const ddz = t.z - actor.z;
		const d = Math.hypot(ddx, ddz);
		if (d < advanceRadius || (ddx * fx + ddz * fz < 0 && d < 1.5)) state.index++;
		else break;
	}

	const node = path[Math.min(state.index, path.length - 1)];
	const tile = tileAt(node.q, node.r);
	const dx = tile.x - actor.x;
	const dz = tile.z - actor.z;

	const toGoal = Math.hypot(goalTile.x - actor.x, goalTile.z - actor.z);
	const desired = Math.atan2(dx, dz);
	const diff = wrapAngle(desired - actor.yaw);
	const turn = Math.max(-turnRate, Math.min(turnRate, diff * 4));
	actor.yaw += turn * dt;
	state.turn = Math.max(-1, Math.min(1, turn / 1.4));

	const arriving = Math.min(1, toGoal / 1.1);
	const cornering = 1 - Math.min(0.55, Math.abs(diff) * 0.5);
	if (toGoal < 0.3) {
		const pull = Math.min(1, dt * 4);
		actor.x += (goalTile.x - actor.x) * pull;
		actor.z += (goalTile.z - actor.z) * pull;
	}
	if (toGoal < 0.12) {
		state.arrived = true;
		return 0;
	}
	return cruise * arriving * cornering;
}

function updatePlayer(dt) {
	let wantSpeed = 0;
	if (control.state === 'moving') {
		const state = { path: control.path, index: control.index, speed: speedNow, turn: turnNow, arrived: false };
		wantSpeed = followPath(player, state, dt, control.cruise, 3);
		control.index = state.index;
		turnNow = state.turn;
		if (state.arrived) {
			control.state = 'idle';
			control.message = 'idle';
			control.path = null;
			showPathOn(pathMarkers, null);
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
		player.x += Math.sin(player.yaw) * realSpeed * dt;
		player.z += Math.cos(player.yaw) * realSpeed * dt;
	}
	const under = groundAt(player.x, player.z);
	player.y += (under - player.y) * Math.min(1, dt * 7);

	tree.update({ speed: param, turn: turnNow }, dt);
	denseToSparse(BONES, tree.pose, player.sparse);
	if (ui.ik.checked) applyFootIK(player);
	placeActor(player);
	return realSpeed;
}

/* --------------------------------------------------------- driving the bat -- */

/*
 * Its whole mind, and it fits in one object: where it is going, how long since
 * it last thought about it, and what it is doing while it gets there.
 *
 *   asleep → waking → hunting ⇄ striking → recovering
 *                        ↓
 *                    returning → asleep
 */
const hunt = {
	state: 'asleep',
	path: null,
	index: 0,
	speed: 0,
	turn: 0,
	arrived: false,
	repathIn: 0,
	lastGoal: null,
	wake: 0, // 0 folded, 1 flying
	flap: 0, // wing phase
	lunge: 0, // 0 → 1 across a strike
	lungeBlend: 0,
	bitten: false,
	cooldown: 0,
	bites: 0,
	spot: null,
	home: null,
	message: 'asleep',
};

// Pose buffers, allocated once: everything below writes into these rather than
// building a new pose sixty times a second.
const flyBuf = {};
const perchBuf = {};
const lungeBuf = {};

const batCell = () => worldToAxial(bat.x, bat.z);
const playerCell = () => worldToAxial(player.x, player.z);
const tilesToPlayer = () => hexDistance(batCell(), playerCell());
const metresToPlayer = () => Math.hypot(player.x - bat.x, player.z - bat.z);

// Where to stand to bite: `distance` out from the man along the line between
// them, turned by the bearing its own jaws sit at.
function biteSpot() {
	let dx = bat.x - player.x;
	let dz = bat.z - player.z;
	const len = Math.hypot(dx, dz) || 1;
	dx /= len;
	dz /= len;
	return {
		x: player.x + dx * BITE_STANCE.distance,
		z: player.z + dz * BITE_STANCE.distance,
		yaw: Math.atan2(-dx, -dz) - BITE_STANCE.bearing,
	};
}

// Path to a tile beside the man, not onto him: the grid is for getting there,
// the last half metre is the strike's business.
function repath() {
	const from = batCell();
	const goal = playerCell();
	let best = null;
	let bestScore = Infinity;
	for (const n of neighbours(goal)) {
		if (!flyable(n, null)) continue;
		const d = hexDistance(from, n);
		if (d < bestScore) {
			bestScore = d;
			best = n;
		}
	}
	if (!best) best = goal;
	const path = findPath(from, best, { passable: flyable });
	if (path) {
		hunt.path = path;
		hunt.index = 1;
		hunt.lastGoal = best;
		showPathOn(batMarkers, path);
	}
	hunt.repathIn = 0.45;
}

function goHome() {
	const path = findPath(batCell(), PERCH, { passable: flyable });
	hunt.path = path;
	hunt.index = 1;
	hunt.lastGoal = PERCH;
	showPathOn(batMarkers, path);
}

function updateBat(dt, time) {
	const near = tilesToPlayer();
	let wantSpeed = 0;
	let flapAmp = 1;

	switch (hunt.state) {
		case 'asleep':
			hunt.message = 'asleep';
			// It hears you coming. Three tiles, measured on the grid it lives on.
			if (near <= WAKE_RANGE) {
				hunt.state = 'waking';
				hunt.wake = 0;
				hunt.message = 'waking';
			}
			break;

		case 'waking':
			hunt.wake = Math.min(1, hunt.wake + dt * 1.4);
			turnTowards(bat, player.x, player.z, dt, 2.4);
			if (hunt.wake >= 1) {
				hunt.state = 'hunting';
				repath();
			}
			break;

		case 'hunting': {
			hunt.message = 'hunting';
			hunt.repathIn -= dt;
			// Re-think when you have moved a tile, or every half second anyway.
			const goal = playerCell();
			if (hunt.repathIn <= 0 || !hunt.lastGoal || hexDistance(hunt.lastGoal, goal) > 1) repath();

			const state = { path: hunt.path, index: hunt.index, speed: hunt.speed, turn: 0, arrived: false };
			wantSpeed = followPath(bat, state, dt, BAT_SPEED, 2.6);
			hunt.index = state.index;
			if (state.arrived) hunt.path = null;

			if (metresToPlayer() < BITE_STANCE.distance + 0.9 && hunt.cooldown <= 0) {
				hunt.state = 'striking';
				hunt.message = 'striking';
				hunt.spot = biteSpot();
				hunt.home = { x: bat.x, z: bat.z };
				hunt.lunge = 0;
				hunt.bitten = false;
				showPathOn(batMarkers, null);
			} else if (near > LOSE_RANGE) {
				hunt.state = 'returning';
				hunt.message = 'losing you';
				goHome();
			}
			break;
		}

		case 'striking': {
			// Off the grid, exactly as the smith steps off his to reach the anvil.
			const spot = hunt.spot;
			const dx = spot.x - bat.x;
			const dz = spot.z - bat.z;
			const dist = Math.hypot(dx, dz);
			const diff = wrapAngle(spot.yaw - bat.yaw);
			bat.yaw += Math.max(-3.4 * dt, Math.min(3.4 * dt, diff));
			if (dist > 1e-4) {
				const step = Math.min(Math.min(2.2, dist * 5 + 0.4) * dt, dist);
				bat.x += (dx / dist) * step;
				bat.z += (dz / dist) * step;
				wantSpeed = step / dt;
			}

			if (dist < 0.12 || hunt.lunge > 0) {
				hunt.lunge = Math.min(1, hunt.lunge + dt / 0.85);
				hunt.lungeBlend = Math.min(1, hunt.lungeBlend + dt * 7);
				flapAmp = 0.35;
				if (!hunt.bitten && hunt.lunge >= LUNGE_CONTACT) {
					hunt.bitten = true;
					hunt.bites++;
					const jaws = attachmentPosition(BAT.SKELETON, bat.sparse, 'jaw', JAW_TIP);
					const w = toWorldXZ(bat, jaws[0], jaws[2]);
					motes.spawn(w.x, bat.y + jaws[1], w.z, 7, 1.3, 1.6);
				}
				if (hunt.lunge >= 1) {
					hunt.state = 'recovering';
					hunt.message = 'backing off';
					hunt.cooldown = BITE_COOLDOWN;
				}
			}
			break;
		}

		case 'recovering': {
			hunt.lungeBlend = Math.max(0, hunt.lungeBlend - dt * 5);
			const back = hunt.home;
			const dx = back.x - bat.x;
			const dz = back.z - bat.z;
			const dist = Math.hypot(dx, dz);
			turnTowards(bat, player.x, player.z, dt, 2.0);
			if (dist > 0.06) {
				const step = Math.min(1.6 * dt, dist);
				bat.x += (dx / dist) * step;
				bat.z += (dz / dist) * step;
				wantSpeed = step / dt;
			} else if (hunt.cooldown <= 0) {
				hunt.state = 'hunting';
				hunt.lunge = 0;
				repath();
			}
			break;
		}

		case 'returning': {
			hunt.message = 'going home';
			const state = { path: hunt.path, index: hunt.index, speed: hunt.speed, turn: 0, arrived: false };
			wantSpeed = followPath(bat, state, dt, BAT_SPEED * 0.8, 2.2);
			hunt.index = state.index;
			if (state.arrived || !hunt.path) {
				hunt.state = 'settling';
				hunt.path = null;
				showPathOn(batMarkers, null);
			}
			// You came back before it got home.
			if (near <= WAKE_RANGE) {
				hunt.state = 'hunting';
				repath();
			}
			break;
		}

		case 'settling':
			hunt.message = 'settling';
			hunt.wake = Math.max(0, hunt.wake - dt * 1.2);
			flapAmp = 0.4;
			if (hunt.wake <= 0) {
				hunt.state = 'asleep';
				bat.yaw = 2.4;
			}
			if (near <= WAKE_RANGE) hunt.state = 'waking';
			break;
	}

	if (hunt.cooldown > 0) hunt.cooldown -= dt;
	hunt.speed += (wantSpeed - hunt.speed) * Math.min(1, dt * 6);

	// Following a path steers and sets a pace; flying it is this line. The two
	// off-grid states move themselves, straight at their target, because a
	// half-metre lunge is not something to steer into.
	if (hunt.state === 'hunting' || hunt.state === 'returning') {
		bat.x += Math.sin(bat.yaw) * hunt.speed * dt;
		bat.z += Math.cos(bat.yaw) * hunt.speed * dt;
	}

	/*
	 * Height. It follows the ground the way everything here does — one tile at a
	 * time, terrace by terrace — and rides above it by however awake it is. Fast
	 * enough to look like flight, slow enough that it settles onto its feet when
	 * it folds up, and never so free of the grid that it stops being a thing you
	 * can walk away from.
	 */
	const under = groundAt(bat.x, bat.z) + HOVER_LIFT * hunt.wake;
	bat.y += (under - bat.y) * Math.min(1, dt * 6);

	/*
	 * The pose, in one place. Beat rate rises with speed — a bat cruising beats
	 * slower than one closing — and every state is a blend of at most two of the
	 * three poses the creature has.
	 */
	const beat = TAU / FLAP_PERIOD;
	hunt.flap += beat * (0.55 + 0.55 * Math.min(1, hunt.speed / BAT_SPEED)) * dt;
	if (hunt.flap > TAU) hunt.flap -= TAU;

	const amp = flapAmp * Math.max(0.35, Math.min(1, 0.45 + hunt.speed / BAT_SPEED));

	if (hunt.wake >= 1) {
		flyPose(hunt.flap, amp, time, bat.sparse);
	} else if (hunt.wake <= 0) {
		perchPose(time, bat.sparse);
	} else {
		// Waking, and the only moment both poses exist at once: it unfolds.
		const u = hunt.wake * hunt.wake * (3 - 2 * hunt.wake);
		mixPose(bat.sparse, perchPose(time, perchBuf), flyPose(hunt.flap, amp, time, flyBuf), u);
	}

	// The strike is laid over whatever it was doing, and taken off again.
	if (hunt.lungeBlend > 0.001) {
		mixPose(bat.sparse, bat.sparse, lungePose(hunt.lunge, lungeBuf), hunt.lungeBlend);
	}

	placeActor(bat);
	return hunt.speed;
}

/* ------------------------------------------------------------------ loop -- */

let last = performance.now();
let statTimer = 0;
let elapsed = 0;

function frame(now) {
	const dt = Math.min((now - last) / 1000, 0.06);
	last = now;
	elapsed += dt;
	world.animateSmoke(elapsed);
	motes.update(dt);

	const manSpeed = updatePlayer(dt);
	const batSpeed = updateBat(dt, elapsed);

	perchMarker.visible = ui.showPath.checked && hunt.state === 'asleep';

	statTimer += dt;
	if (statTimer > 0.12) {
		statTimer = 0;
		const cell = playerCell();
		const tile = tileAt(cell.q, cell.r);
		const hunting = hunt.state !== 'asleep' && hunt.state !== 'settling';
		const rows = [
			['You', `<span class="${control.message === 'no route' ? 'warn' : control.state !== 'idle' ? 'busy' : ''}">${control.message}</span> · ${manSpeed.toFixed(2)} m/s`],
			['Cell', `${cell.q}, ${cell.r} · terrace ${tile ? tile.level : '–'}`],
			['Bat', `<span class="${hunting ? 'warn' : ''}">${hunt.message}</span> · ${batSpeed.toFixed(2)} m/s`],
			['Range', `${tilesToPlayer()} tiles · wakes at ${WAKE_RANGE}`],
			['Bites', `${hunt.bites}`],
		];
		if (ui.ik.checked) rows.push(['Pelvis drop', `${(player.pelvisDrop * 100).toFixed(1)} cm`]);
		ui.stats.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
	}

	if (ui.follow.checked) {
		view.target.x += (player.x - view.target.x) * Math.min(1, dt * 2.4);
		view.target.z += (player.z - view.target.z) * Math.min(1, dt * 2.4);
		view.target.y += (player.y + HIPS_Y + 0.1 - view.target.y) * Math.min(1, dt * 2.4);
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
	control, player, bat, hunt, actors, world, tileAt, goTo, pickCell, view,
	BITE_STANCE, WAKE_RANGE, LOSE_RANGE, PERCH, BAT_SPEED, CRUISE,
	tilesToPlayer, walkable, flyable,
};

resize();
requestAnimationFrame(frame);
