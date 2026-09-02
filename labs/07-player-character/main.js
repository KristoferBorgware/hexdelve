/*
 * Hexdelve — Lab 07: the player character.
 *
 * Lab 06's world, with the roles swapped. You drive the wanderer
 * (../shared/wanderer.js) — a second character on the same 17-bone rig,
 * carrying nothing at all — and the blacksmith has stopped being the camera's
 * subject and gone back to work: he stands at his anvil and hammers on his own
 * schedule whether or not you are watching.
 *
 * The point of the lab is that this costs almost nothing. An actor here is a
 * group, a rig, a character and a pose buffer; both are built by the same
 * `makeActor`, both are posed by the same code, and the IK is written against
 * an actor rather than against "the character". What differs is only where the
 * pose comes from:
 *
 *   the wanderer   the blend tree (lab 04) under a path from A* (lab 06)
 *   the blacksmith a clip crossfade under a two-line work schedule
 *
 * Neither knows the other exists. They meet in the scene, not in the code.
 *
 * The helmet is the third thing in the world with a transform of its own, and
 * it shows what the rig is worth: picking it up is one re-parent onto the head
 * bone, after which every clip carries it — no code anywhere below knows that
 * the helmet exists.
 */

'use strict';

const { hexGeometry, makeRandom } = Hexdelve.hex;
const { worldToAxial, distance: hexDistance, neighbours, findPath, keyOf } = Hexdelve.hexgrid;
const { SKELETON, BONES, TIPS, HIPS_Y } = Hexdelve.skeleton;
const { buildRig, buildSkeletonView, applySparsePose } = Hexdelve.rigview;
const { buildBlacksmith } = Hexdelve.blacksmith;
const { buildWanderer } = Hexdelve.wanderer;
const { buildHelmet, GROUND_LIFT } = Hexdelve.helmet;
const { attachPanel, attachView, startZoom } = Hexdelve.ui;
const { walkPose, WALK_PERIOD, WALK_CONTACTS } = Hexdelve.walk;
const { IDLE, RUN, HAMMER, DUCK, LEAN_LEFT, LEAN_RIGHT, UPRIGHT } = Hexdelve.clips;
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

// Terrain, anvil, smithy and log house all come from ../shared/world.js, which
// labs 06 and 08 stand in too. What is left in this file is the part that is
// actually lab 07: who is in the yard and what they do.
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

// He walks; one terrace up or down is as much as that allows.
function passable(cell, from) {
	return world.passable(cell, from, MAX_CLIMB);
}

/* ---------------------------------------------------------------- actors -- */

/*
 * An actor is the whole of what it takes to put a posed character in the
 * world: a group at its feet, a rig inside it, a character hung on the rig, a
 * skeleton view for the x-ray toggle, and one sparse pose buffer that the
 * animation writes and the IK corrects in place.
 *
 * Both characters here are the same object. The wanderer and the blacksmith
 * differ in their meshes and in who decides their pose — nothing below this
 * point in the file needs to know which is which.
 */
function makeActor(build, { x, z, yaw }) {
	const group = new THREE.Group();
	scene.add(group);
	const rig = buildRig(SKELETON, group);
	const character = build(rig);
	const skeletonView = buildSkeletonView(rig, SKELETON, TIPS);
	return {
		group, rig, character, skeletonView,
		x, z, yaw, y: groundAt(x, z),
		sparse: {},
		pelvisDrop: 0,
	};
}

const player = makeActor(buildWanderer, { x: 0, z: -5.4, yaw: 0 });

/*
 * Where the smith has to stand to actually hit the anvil.
 *
 * This is lab 06's measurement, kept: play the strike to the moment of impact,
 * see where the hammer head ends up relative to his own origin, and put him
 * where that point lands on the anvil face. There it moved him for one blow;
 * here it decides where he lives. Re-time the swing or change his proportions
 * and he moves, without a constant to re-tune.
 */
const HAMMER_OFFSET = [0, -0.341, 0.192];

const STRIKE_STANCE = (function () {
	const pose = samplePose(HAMMER, 0.5); // the impact key
	const head = attachmentPosition(SKELETON, pose, 'handR', HAMMER_OFFSET);
	return {
		distance: Math.hypot(head[0], head[2]), // how far from the target to stand
		bearing: Math.atan2(head[0], head[2]), // and how far to turn off square
		height: head[1],
	};
})();

// He works with his back to the forge, which is what puts the smithy behind him
// and leaves the open side of the anvil for you.
const smith = (function () {
	let dx = SMITHY.x - ANVIL_POS.x;
	let dz = SMITHY.z - ANVIL_POS.z;
	const len = Math.hypot(dx, dz) || 1;
	dx /= len;
	dz /= len;
	const actor = makeActor(buildBlacksmith, {
		x: ANVIL_POS.x + dx * STRIKE_STANCE.distance,
		z: ANVIL_POS.z + dz * STRIKE_STANCE.distance,
		yaw: Math.atan2(-dx, -dz) - STRIKE_STANCE.bearing,
	});
	// He is as solid as a building: paths route round him instead of through him.
	const cell = worldToAxial(actor.x, actor.z);
	blocked.add(keyOf(cell.q, cell.r));
	actor.cell = cell;
	return actor;
})();

const actors = [player, smith];

/* ----------------------------------------------------------------- prop -- */

/*
 * The helmet (../shared/helmet.js). It is one group with no bones, and the
 * whole of "picking it up" is which node it hangs from: the scene, or the
 * player's head bone. Because it was modelled around the head bone's origin,
 * the worn transform is the identity — no offset to tune, and no second model.
 *
 * It rests just off a tile centre, so he can stand on that tile without
 * standing inside it, and turns to face it while he stoops.
 */
const helmetView = buildHelmet();

const helmet = {
	group: helmetView.group,
	meshes: new Set(helmetView.meshes),
	worn: false,
	x: 0,
	z: 0,
	cell: null,
};

function groundHelmet(x, z, yaw) {
	scene.add(helmet.group); // re-parenting out of the head bone, if it was there
	helmet.group.position.set(x, groundAt(x, z) + GROUND_LIFT, z);
	helmet.group.rotation.set(0, yaw, 0);
	helmet.x = x;
	helmet.z = z;
	helmet.cell = worldToAxial(x, z);
	helmet.worn = false;
}

{
	// Out in the open yard east of the anvil, clear of both buildings.
	const home = worldToAxial(3.4, 1.4);
	const tile = tileAt(home.q, home.r);
	groundHelmet(tile.x + 0.46, tile.z + 0.3, -0.7);
}

function wearHelmet() {
	player.rig.bones.head.add(helmet.group);
	helmet.group.position.set(0, 0, 0);
	helmet.group.rotation.set(0, 0, 0);
	helmet.worn = true;
}

// He puts it down where he is looking, half a stride in front of his feet.
function putHelmetDown() {
	groundHelmet(
		player.x + Math.sin(player.yaw) * 0.55,
		player.z + Math.cos(player.yaw) * 0.55,
		player.yaw + 0.5,
	);
}

/* ------------------------------------------------- the wanderer's motion -- */

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

/* ------------------------------------------------- the blacksmith's work -- */

// No tree and no navigation: two bound clips and a timer. That is all an NPC
// standing at one spot needs, and it uses the same player as everything else.
const boneIndex = new Map(BONES.map((n, i) => [n, i]));
const smithClips = {
	idle: { clip: IDLE, bound: bindClip(IDLE, boneIndex) },
	hammer: { clip: HAMMER, bound: bindClip(HAMMER, boneIndex) },
};
const idlePose = createPose(BONES.length);
const hammerPose = createPose(BONES.length);
const smithPose = createPose(BONES.length);

const work = { mode: 'rest', timer: 0.8, blows: 0, clock: 0, idleClock: 0, blend: 0, look: 0 };

// Latched at the moment of impact: between blows the live numbers are the
// distance from a resting hand to the anvil, which says nothing about the blow.
const smithStats = { err: 0, raw: 0, clamped: false, live: { err: 0, raw: 0, clamped: false } };

/* ---------------------------------------------------- reaching for things -- */

/*
 * There is no "pick up" clip, and there does not need to be one: the duck from
 * lab 03 is a crouch with both hands forward, which is what reaching down looks
 * like. It is played once, forwards, and then crossfaded away while it holds at
 * the bottom — so he rises by blending back into whatever the tree is doing
 * rather than by playing the crouch backwards.
 */
const duckEntry = { clip: DUCK, bound: bindClip(DUCK, boneIndex) };
const duckPose = createPose(BONES.length);
const playerPose = createPose(BONES.length);

const STOOP = { grab: 0.4, release: 0.56, end: 0.95, hold: 0.85 };

const stoop = { clock: 0, blend: 0, intent: 'take', done: false, x: 0, z: 0 };

function beginStoop(intent, x, z) {
	stoop.clock = 0;
	stoop.intent = intent;
	stoop.done = false;
	stoop.x = x;
	stoop.z = z;
	control.state = 'stoop';
	control.message = intent === 'take' ? 'picking it up' : 'putting it down';
	control.path = null;
	showPath(null);
	goalMarker.visible = false;
}

/* --------------------------------------------------------------- sparks -- */

// Lab 03's particles, trimmed: hex prisms thrown off the anvil on the clip's
// own `impact` key, which is the only thing the swing tells the world.
class Bits {
	constructor(count, { color, gravity, life, size, glow }) {
		this.items = [];
		this.gravity = gravity;
		this.life = life;
		this.size = size;
		for (let i = 0; i < count; i++) {
			const material = glow
				? new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false })
				: new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0, depthWrite: false });
			const mesh = new THREE.Mesh(hexGeometry(), material);
			mesh.visible = false;
			scene.add(mesh);
			this.items.push({ mesh, t: 0, max: 1, vx: 0, vy: 0, vz: 0, spin: 0 });
		}
		this.next = 0;
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
			bit.spin = (random() - 0.5) * 12;
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
			bit.mesh.material.opacity = Math.min(1, u * 1.6) * 0.9;
		}
	}
}

const sparks = new Bits(30, { color: 0xffc46b, gravity: -7.5, life: 0.55, size: 0.045, glow: true });

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

/* ------------------------------------------------------------ controller -- */

const control = {
	// idle → moving → watching (at the smith) or stoop (at the helmet)
	state: 'idle',
	path: null,
	index: 0,
	cruise: 0,
	goalCell: null,
	watching: false,
	fetching: false,
	message: 'waiting',
	lastClickAt: -10,
};

let speedNow = 0;
let turnNow = 0;

// Clicking the anvil or the smith means "go and watch", which is a different
// destination from the tile itself: the free neighbour closest to where you
// already stand, and never the one the smith is standing on.
function watchCell() {
	const here = worldToAxial(player.x, player.z);
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

/**
 * Send him somewhere. `kind` is what was clicked, not where: the anvil and the
 * helmet are both things you walk *to* and then do something at, and clicking
 * the man himself is not a destination at all.
 */
function goTo(cell, running, kind = 'tile') {
	if (kind === 'self') {
		// Clicking him means putting the helmet down, and only if he is free.
		if (helmet.worn && (control.state === 'idle' || control.state === 'watching')) {
			beginStoop('drop', player.x + Math.sin(player.yaw) * 0.55, player.z + Math.cos(player.yaw) * 0.55);
		}
		return;
	}
	if (control.state === 'stoop') return; // let him finish reaching down

	const here = worldToAxial(player.x, player.z);
	const wantsAnvil = kind === 'anvil';
	const wantsHelmet = kind === 'helmet';
	const destination = wantsAnvil ? watchCell() : cell;

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
	control.watching = wantsAnvil;
	control.fetching = wantsHelmet;
	control.message = running ? 'running' : 'walking';

	const tile = tileAt(destination.q, destination.r);
	goalMarker.visible = true;
	goalMarker.position.set(tile.x, tile.top + 0.02, tile.z);
	goalMarker.material.color.set(wantsAnvil ? 0xc25a3a : wantsHelmet ? 0x5f7f9c : 0x4a7a3c);
	showPath(path);
}

function arrive() {
	control.path = null;
	showPath(null);
	if (control.fetching && !helmet.worn) {
		control.fetching = false;
		beginStoop('take', helmet.x, helmet.z);
		return;
	}
	control.fetching = false;
	if (control.watching) {
		// He has no hammer and nothing to do at the anvil, so arriving means
		// turning to face the work rather than stepping off the grid for it.
		control.state = 'watching';
		control.message = 'watching the smith';
		return;
	}
	control.state = 'idle';
	control.message = 'idle';
	goalMarker.visible = false;
}

/* ---------------------------------------------------------------- picking -- */

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const smithMeshes = new Set(smith.character.meshes);
const playerMeshes = new Set(player.character.meshes);

/*
 * Everything clickable, and what clicking it means. The buildings are in the
 * set only so that clicking a wall does nothing rather than selecting the tile
 * visible through it; the characters and the helmet are in it because they are
 * the things worth clicking. Each hit resolves to a tile to walk to plus what
 * was actually hit, which is what `goTo` needs to tell "go there" from "go and
 * do that".
 */
const PICKABLE = [
	world.groundMesh, ...world.buildings,
	...smith.character.meshes, ...player.character.meshes, ...helmetView.meshes,
];

function playerTile() {
	const cell = worldToAxial(player.x, player.z);
	return tileAt(cell.q, cell.r);
}

function pickCell(clientX, clientY) {
	const rect = canvas.getBoundingClientRect();
	ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
	ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
	raycaster.setFromCamera(ndc, camera);
	const hits = raycaster.intersectObjects(PICKABLE);
	for (const hit of hits) {
		if (smithMeshes.has(hit.object)) return { cell: tileAt(ANVIL_CELL.q, ANVIL_CELL.r), kind: 'anvil' };
		// Worn, the helmet is part of him, so clicking it means the same as
		// clicking him: take it off.
		if (helmet.meshes.has(hit.object)) {
			if (helmet.worn) return { cell: playerTile(), kind: 'self' };
			const tile = tileAt(helmet.cell.q, helmet.cell.r);
			return tile ? { cell: tile, kind: 'helmet' } : null;
		}
		if (playerMeshes.has(hit.object)) return { cell: playerTile(), kind: 'self' };
		if (hit.object !== world.groundMesh) return null;
		const meta = world.groundMesh.userData.meta[hit.instanceId];
		if (meta) return { cell: meta, kind: isAnvil(meta) ? 'anvil' : 'tile' };
	}
	return null;
}

/*
 * Orbit, pan, zoom and tap all come from ../shared/ui.js, which every lab uses:
 * what is lab-specific is only what a tap means and what the pointer is over.
 */
attachView(canvas, view, {
	applyCamera: applyCamera,
	viewHeight: VIEW,
	pitch: ISO_PITCH,
	zoom: [0.6, 4],
	onPan: function () {
		ui.follow.checked = false;
	},
	onTap: function (x, y) {
		const pick = pickCell(x, y);
		if (!pick) return;
		// A second click while he is already on his way is the "and hurry up"
		// signal — no double-click timer, so the first click never has to wait.
		const now = performance.now() / 1000;
		const quick = now - control.lastClickAt < 0.45;
		control.lastClickAt = now;
		goTo(pick.cell, quick || control.state === 'moving', pick.kind);
	},
	onHover: function (x, y) {
		const pick = pickCell(x, y);
		if (!pick) {
			hover.visible = false;
			return;
		}
		hover.visible = true;
		hover.position.set(pick.cell.x, pick.cell.top + 0.015, pick.cell.z);
		hover.material.color.set(
			pick.kind === 'anvil' ? 0xffb27a : pick.kind === 'helmet' ? 0x9fc4e0 : 0xffffff,
		);
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
ui.showPath.addEventListener('change', () => showPath(control.path));

// The panel opens and closes from ../shared/ui.js, which also reads ?panel=.
attachPanel();

/* --------------------------------------------------------------- the IK -- */

// Written against an actor, not against "the character": the same foot planting
// runs for whoever is passed in, which is what lets a second character into the
// scene without a second copy of the solver.
function toWorldXZ(actor, localX, localZ) {
	const s = Math.sin(actor.yaw);
	const c = Math.cos(actor.yaw);
	return { x: actor.x + localX * c + localZ * s, z: actor.z - localX * s + localZ * c };
}

function applyFootIK(actor) {
	const pose = actor.sparse;
	const world = solveWorld(SKELETON, pose);
	const targets = {};
	let pelvisDrop = 0;

	for (const side of ['L', 'R']) {
		const bone = `foot${side}`;
		const p = world[bone].p;
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

function applyHammerIK(actor, t, scale) {
	const pose = actor.sparse;
	const weight = hammerIKWeight(t) * scale;
	const world = solveWorld(SKELETON, pose);
	const dx = ANVIL_POS.x - actor.x;
	const dz = ANVIL_POS.z - actor.z;
	const s = Math.sin(actor.yaw);
	const c = Math.cos(actor.yaw);
	const target = [dx * c - dz * s, ANVIL_FACE_Y - actor.y + 0.03, dx * s + dz * c];

	const before = attachmentPosition(SKELETON, pose, 'handR', HAMMER_OFFSET, world);
	smithStats.live.raw = Math.hypot(before[0] - target[0], before[1] - target[1], before[2] - target[2]);

	smithStats.live.clamped = false;
	if (weight > 0.001) {
		const result = solveToolChain(
			SKELETON, pose,
			{ root: 'armR', mid: 'forearmR', end: 'handR' },
			'handR', HAMMER_OFFSET, target, world.forearmR.p, weight, world,
		);
		smithStats.live.clamped = !!(result && result.clamped);
	}
	const after = attachmentPosition(SKELETON, pose, 'handR', HAMMER_OFFSET);
	smithStats.live.err = Math.hypot(after[0] - target[0], after[1] - target[1], after[2] - target[2]);
}

/* -------------------------------------------------------- posing an actor -- */

function placeActor(actor) {
	actor.group.position.set(actor.x, actor.y, actor.z);
	actor.group.rotation.y = actor.yaw;
	applySparsePose(actor.rig, actor.sparse);
}

// The blacksmith's apron is the one garment loose enough to need telling about
// the legs; the wanderer wears nothing that hangs, which is why he has no
// equivalent here.
function dressActor(actor) {
	if (!actor.character.apron) return;
	const lead = Math.min(actor.rig.bones.hipL.rotation.x, actor.rig.bones.hipR.rotation.x);
	actor.character.apron.quaternion.setFromEuler(new THREE.Euler(PI / 2 - 0.03 + lead * 0.5, PI / 6, 0));
}

/* --------------------------------------------------- driving the wanderer -- */

/**
 * Follow the path. A fixed "close enough" radius does not work: the turn radius
 * is speed over turn rate, so at a run he can circle a waypoint forever without
 * entering it. The radius grows with speed, and a waypoint that has ended up
 * behind him counts as reached regardless.
 */
function followPath(dt) {
	const path = control.path;
	if (!path) return 0;
	const goal = path[path.length - 1];
	const goalTile = tileAt(goal.q, goal.r);

	const advanceRadius = Math.max(0.5, speedNow * 0.6);
	const fx = Math.sin(player.yaw);
	const fz = Math.cos(player.yaw);
	while (control.index < path.length - 1) {
		const t = tileAt(path[control.index].q, path[control.index].r);
		const ddx = t.x - player.x;
		const ddz = t.z - player.z;
		const d = Math.hypot(ddx, ddz);
		if (d < advanceRadius || (ddx * fx + ddz * fz < 0 && d < 1.5)) control.index++;
		else break;
	}

	const node = path[Math.min(control.index, path.length - 1)];
	const tile = tileAt(node.q, node.r);
	const dx = tile.x - player.x;
	const dz = tile.z - player.z;

	const toGoal = Math.hypot(goalTile.x - player.x, goalTile.z - player.z);
	const desired = Math.atan2(dx, dz);
	const diff = wrapAngle(desired - player.yaw);
	const turnRate = Math.max(-3, Math.min(3, diff * 4));
	player.yaw += turnRate * dt;
	turnNow = Math.max(-1, Math.min(1, turnRate / 1.4));

	// Ease down over the last stride, and do not sprint into a hard turn.
	const arriving = Math.min(1, toGoal / 1.1);
	const cornering = 1 - Math.min(0.55, Math.abs(diff) * 0.5);
	const target = control.cruise * arriving * cornering;

	// Arrive rather than orbit: once he is close and slow, settle onto the tile
	// centre instead of chasing it round in circles.
	if (toGoal < 0.3) {
		const pull = Math.min(1, dt * 4);
		player.x += (goalTile.x - player.x) * pull;
		player.z += (goalTile.z - player.z) * pull;
	}
	if (toGoal < 0.12) {
		arrive();
		return 0;
	}
	return target;
}

function turnTowards(actor, targetX, targetZ, dt, rate) {
	const want = Math.atan2(targetX - actor.x, targetZ - actor.z);
	const diff = wrapAngle(want - actor.yaw);
	actor.yaw += Math.max(-rate * dt, Math.min(rate * dt, diff));
	return Math.abs(diff);
}

function updatePlayer(dt) {
	let wantSpeed = 0;
	if (control.state === 'moving') {
		wantSpeed = followPath(dt);
	} else if (control.state === 'watching') {
		turnTowards(player, ANVIL_POS.x, ANVIL_POS.z, dt, 2.2);
		turnNow *= Math.max(0, 1 - dt * 4);
	} else if (control.state === 'stoop') {
		turnTowards(player, stoop.x, stoop.z, dt, 3.2);
		turnNow *= Math.max(0, 1 - dt * 4);
		stoop.clock += dt;
		if (!stoop.done && stoop.clock >= STOOP.grab) {
			stoop.done = true;
			// The whole of picking it up: the helmet changes parent.
			if (stoop.intent === 'take') wearHelmet();
			else putHelmetDown();
		}
		if (stoop.clock >= STOOP.end) {
			control.state = 'idle';
			control.message = helmet.worn ? 'wearing the helmet' : 'idle';
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

	// The crouch is a layer over the tree: it fades in on the way down, holds at
	// the bottom for the moment the helmet changes hands, and fades out — which
	// is how he stands back up without the clip ever being played backwards.
	const wantStoop = control.state === 'stoop' && stoop.clock < STOOP.release ? 1 : 0;
	stoop.blend += (wantStoop - stoop.blend) * Math.min(1, dt * 9);
	tree.update({ speed: param, turn: turnNow }, dt);
	if (stoop.blend > 0.002) {
		sampleBound(duckEntry, Math.min(stoop.clock, STOOP.hold), duckPose);
		lerpPose(playerPose, tree.pose, duckPose, stoop.blend);
	} else {
		playerPose.rot.set(tree.pose.rot);
		playerPose.pos.set(tree.pose.pos);
	}
	denseToSparse(BONES, playerPose, player.sparse);
	if (ui.ik.checked) applyFootIK(player);
	placeActor(player);
	dressActor(player);
	return realSpeed;
}

/* ------------------------------------------------- driving the blacksmith -- */

/**
 * His whole brain: rest, then a burst of blows, then rest again. The strike is
 * the same clip the wanderer never plays, crossfaded over an idle, and the
 * hammer is aimed by the same IK — so the blow lands on the anvil face rather
 * than wherever the authored angles happen to put it.
 */
function updateSmith(dt) {
	work.idleClock += dt;
	let impacted = false;

	if (work.mode === 'rest') {
		work.timer -= dt;
		work.blend = Math.max(0, work.blend - dt * 3.5);
		if (work.timer <= 0) {
			work.mode = 'work';
			work.blows = 2 + Math.floor(random() * 3);
			work.clock = 0;
		}
	} else {
		work.blend = Math.min(1, work.blend + dt * 5);
		const was = work.clock;
		work.clock += dt;
		if (was < 0.5 && work.clock >= 0.5) impacted = true;
		if (work.clock >= HAMMER.duration) {
			work.clock -= HAMMER.duration;
			if (--work.blows <= 0) {
				work.mode = 'rest';
				work.timer = 1.6 + random() * 2.2;
			}
		}
	}

	sampleBound(smithClips.idle, work.idleClock % IDLE.duration, idlePose);
	if (work.blend > 0.001) {
		sampleBound(smithClips.hammer, work.clock % HAMMER.duration, hammerPose);
		lerpPose(smithPose, idlePose, hammerPose, work.blend);
	} else {
		smithPose.rot.set(idlePose.rot);
		smithPose.pos.set(idlePose.pos);
	}
	denseToSparse(BONES, smithPose, smith.sparse);

	/*
	 * Between blows he glances at whoever has come to watch. It is one added
	 * yaw split over neck, chest and spine, faded out by the same weight that
	 * fades the swing in — so the look never fights the hammer, and because it
	 * happens before the IK, the solver simply absorbs whatever it does to his
	 * shoulder.
	 */
	const near = Math.hypot(player.x - smith.x, player.z - smith.z) < 3.2;
	const wantLook = near && work.blend < 0.35 ? 1 : 0;
	work.look += (wantLook - work.look) * Math.min(1, dt * 2.5);
	if (work.look > 0.002) {
		const bearing = wrapAngle(Math.atan2(player.x - smith.x, player.z - smith.z) - smith.yaw);
		const amount = work.look * (1 - work.blend) * Math.max(-1, Math.min(1, bearing / 1.4));
		for (const [bone, share] of [['spine', 0.18], ['chest', 0.3], ['neck', 0.22], ['head', 0.4]]) {
			const entry = smith.sparse[bone] || (smith.sparse[bone] = { rot: [0, 0, 0], pos: [0, 0, 0] });
			entry.rot[1] += amount * share;
		}
	}

	if (ui.ik.checked) {
		applyHammerIK(smith, work.clock, work.blend);
		applyFootIK(smith);
	}
	placeActor(smith);
	dressActor(smith);

	// The clip says when the blow lands; the world decides what that means, and
	// it is the only moment at which the aim is worth reading.
	if (impacted) {
		smithStats.err = smithStats.live.err;
		smithStats.raw = smithStats.live.raw;
		smithStats.clamped = smithStats.live.clamped;
	}
	if (impacted) sparks.spawn(ANVIL_POS.x, ANVIL_FACE_Y + 0.06, ANVIL_POS.z, 9, 1.9, 2.2);
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
	sparks.update(dt);

	const realSpeed = updatePlayer(dt);
	updateSmith(dt);

	statTimer += dt;
	if (statTimer > 0.12) {
		statTimer = 0;
		const cell = worldToAxial(player.x, player.z);
		const tile = tileAt(cell.q, cell.r);
		const busy = control.state !== 'idle';
		const rows = [
			['State', `<span class="${control.message === 'no route' ? 'warn' : busy ? 'busy' : ''}">${control.message}</span>`],
			['Speed', `${realSpeed.toFixed(2)} m/s`],
			['Cell', `${cell.q}, ${cell.r} · terrace ${tile ? tile.level : '–'}`],
		];
		if (control.path) rows.push(['Path', `${control.path.length - control.index} tiles left`]);
		else rows.push(['Pelvis drop', `${(player.pelvisDrop * 100).toFixed(1)} cm`]);
		rows.push(['Helmet', helmet.worn ? '<span class="busy">worn</span>' : 'on the ground']);
		rows.push([
			'Smith',
			work.mode === 'work'
				? `<span class="busy">striking · ${work.blows} to go</span>`
				: `resting · ${work.timer.toFixed(1)} s`,
		]);
		// Measured on the last blow that landed, not this frame.
		if (smithStats.raw > 0) {
			rows.push(['Last blow', `${(smithStats.err * 100).toFixed(1)} cm${smithStats.clamped ? ' · out of reach' : ''}`]);
			rows.push(['Clip alone', `${(smithStats.raw * 100).toFixed(1)} cm off`]);
		}
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
	control, player, smith, actors, work, helmet, stoop, tiles, tileAt, goTo, pickCell, tree,
	SPEED_TABLE, CRUISE, ANVIL_CELL, ANVIL_POS, ANVIL_FACE_Y, smithStats,
	groundAt, STRIKE_STANCE, blocked, world, view, passable,
};

resize();
requestAnimationFrame(frame);
