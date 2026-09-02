/*
 * Hexdelve — Lab 09: free movement.
 *
 * The same yard, driven a different way. Labs 06–08 moved him by asking the
 * grid: click a hexagon, A* answers with a list of tiles, and he walks down it
 * facing whichever one is next. Here there is no path and nothing to click.
 * The keys give a heading and a throttle, the mouse gives a facing, and the two
 * are not the same number.
 *
 * That last part is the whole lab. Every character in labs 02–08 walked where
 * it was looking, which is why a forward cycle was all any of them needed. Once
 * the mouse owns the facing, he has to be able to travel along a line his chest
 * is not pointing down — backing away from something he is watching, or
 * side-stepping round it — and a blend tree of forward clips has nothing to say
 * about that.
 *
 * The answer is in ../shared/stride.js, and it is only possible because the
 * walk was never a clip: it is a function of one phase angle, so the direction
 * of travel can be another argument to it. The stride turns; one cycle covers
 * the circle. What it will not do is turn evenly — sideways there is another
 * leg in the way — so the stride is an ellipse, and the speed for a heading is
 * measured off the pose rather than typed in. That is the number in the
 * readout, and it is why a side-step is worth about half a walk.
 *
 * The rest is the same parts as ever: the wanderer on the 17-bone rig, the
 * three props from lab 08 lying in the grass, foot IK from lab 05 planting him
 * on the terraces, and the guard and the cut laid over the top through the
 * masks from skeleton.js.
 */

'use strict';

const { hexGeometry, makeRandom } = Hexdelve.hex;
const { worldToAxial } = Hexdelve.hexgrid;
const { SKELETON, BONES, TIPS, HIPS_Y, UPPER_BODY } = Hexdelve.skeleton;
const { buildRig, buildSkeletonView, applySparsePose } = Hexdelve.rigview;
const { buildWanderer } = Hexdelve.wanderer;
const { makeItem } = Hexdelve.props;
const { attachPanel, attachView, startZoom } = Hexdelve.ui;
const { stridePose, stridePeriod, strideVelocity } = Hexdelve.stride;
const { SLASH, GUARD, DUCK } = Hexdelve.clips;
const {
	createPose, lerpPose, lerpPoseMasked, makeMask, bindClip, sampleBound,
	denseToSparse, sparseToDense, solveWorld,
} = Hexdelve.anim;
const { solveTwoBone, levelBone } = Hexdelve.ik;

const PI = Math.PI;
const TAU = PI * 2;

const GROUND_RADIUS = 8;
const BASE_Y = 0.16;
const STEP_H = 0.19;
const SOLE = 0.12;
const MAX_CLIMB = 1; // terraces he can step up or down in one move

// How wide he is, for the purpose of not walking into the smithy. Off the grid
// he is a point with a radius rather than a tile, so the tile test is made
// half a metre ahead of him instead of underneath him.
const BODY = 0.44;

// How fast he comes round to the mouse. Fast enough that pointing feels
// immediate, slow enough that a flick of the wrist is a turn and not a cut.
const TURN_RATE = 11;

// How fast the legs re-aim, which is a different thing again: the heading is
// slewed as an angle rather than a vector, so W to S swings the stride round
// through a side-step instead of collapsing through zero.
const HEADING_RATE = 14;

const PICKUP = 0.72; // how close he has to pass a prop to pick it up

const random = makeRandom(37);

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

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

/*
 * The grid is still here, and it is still the thing that says where he may
 * stand — a building's footprint, the anvil, the sheer side of the mesa, the
 * edge of the world. What has changed is the question. Labs 06–08 asked it for
 * a route; this one asks it for a wall, one step at a time, at a point half a
 * metre in front of him rather than under his feet.
 */
function standable(x, z, from) {
	return world.passable(worldToAxial(x, z), from, MAX_CLIMB);
}

/* ---------------------------------------------------------------- player -- */

const player = (function () {
	const group = new THREE.Group();
	scene.add(group);
	const rig = buildRig(SKELETON, group);
	const character = buildWanderer(rig);
	const skeletonView = buildSkeletonView(rig, SKELETON, TIPS);
	const x = 0;
	const z = -5.4;
	return {
		group, rig, character, skeletonView,
		x, z, y: groundAt(x, z), yaw: 0,
		sparse: {},
		pelvisDrop: 0,
	};
})();

/* ------------------------------------------------------------------ gear -- */

/*
 * The three props from lab 08, in the grass between where he starts and the
 * anvil. No bones apiece: one group each, modelled around the origin of the
 * bone it belongs to, so picking one up is a re-parent and every clip carries
 * it afterwards. Here he does not have to be told to fetch them — walking over
 * one is the whole interaction, which is the only kind this lab has.
 */
const items = [
	makeItem(scene, {
		label: 'helmet',
		bone: 'head',
		build: Hexdelve.helmet.buildHelmet,
		lift: Hexdelve.helmet.GROUND_LIFT,
		tilt: 0,
	}),
	makeItem(scene, {
		label: 'sword',
		bone: 'handR',
		build: Hexdelve.sword.buildSword,
		lift: Hexdelve.sword.GROUND_LIFT,
		tilt: Hexdelve.sword.GROUND_TILT,
	}),
	makeItem(scene, {
		label: 'shield',
		bone: 'forearmL',
		build: Hexdelve.shield.buildShield,
		lift: Hexdelve.shield.GROUND_LIFT,
		tilt: Hexdelve.shield.GROUND_TILT,
	}),
];

const [helmet, sword, shield] = items;

// Spread across his way in, and not in a line: collecting all three should be
// a walk that turns.
{
	const spots = [
		{ item: helmet, at: [-2.4, -3.1], yaw: -0.7 },
		{ item: sword, at: [1.9, -3.4], yaw: 1.1 },
		{ item: shield, at: [-3.4, 0.4], yaw: 2.3 },
	];
	for (const spot of spots) {
		const cell = worldToAxial(spot.at[0], spot.at[1]);
		const tile = tileAt(cell.q, cell.r);
		spot.item.ground(tile.x + 0.3, tile.z + 0.2, spot.yaw, tile.top);
	}
}

const armed = () => sword.worn;

/* ----------------------------------------------------------------- input -- */

/*
 * Two devices, one intention. A keyboard says which way to travel relative to
 * where he is looking and a mouse says where that is; a thumb has to say both
 * at once, so on a touch screen the stick sets the facing as well and the two
 * come back together. Nothing downstream knows which of them is driving: both
 * end up as a heading in his own frame and a throttle.
 */
const keys = { fwd: 0, back: 0, left: 0, right: 0, run: 0, camL: 0, camR: 0 };

const BIND = {
	KeyW: 'fwd', ArrowUp: 'fwd',
	KeyS: 'back', ArrowDown: 'back',
	KeyA: 'left', ArrowLeft: 'left',
	KeyD: 'right', ArrowRight: 'right',
	ShiftLeft: 'run', ShiftRight: 'run',
	KeyQ: 'camL', KeyE: 'camR',
};

window.addEventListener('keydown', function (e) {
	if (e.code === 'Space') {
		e.preventDefault();
		if (!e.repeat) strike();
		return;
	}
	const bind = BIND[e.code];
	if (!bind) return;
	e.preventDefault();
	keys[bind] = 1;
});

window.addEventListener('keyup', function (e) {
	const bind = BIND[e.code];
	if (bind) keys[bind] = 0;
});

// A key held while the window loses focus is a key that never comes up.
window.addEventListener('blur', function () {
	for (const k of Object.keys(keys)) keys[k] = 0;
});

const stickEl = document.getElementById('stick');
const stick = { active: false, id: -1, ox: 0, oy: 0, x: 0, z: 0, throttle: 0 };
const STICK_DEAD = 9;
const STICK_FULL = 62;

canvas.addEventListener('pointerdown', function (e) {
	if (e.pointerType === 'mouse') return;
	// A second finger belongs to the camera (ui.js pinches with it), so it takes
	// the stick away rather than fighting it.
	if (stick.active) {
		endStick();
		return;
	}
	stick.active = true;
	stick.id = e.pointerId;
	stick.ox = e.clientX;
	stick.oy = e.clientY;
	stick.throttle = 0;
	stickEl.hidden = false;
	stickEl.style.left = e.clientX + 'px';
	stickEl.style.top = e.clientY + 'px';
	stickEl.firstElementChild.style.transform = 'translate(0px, 0px)';
});

canvas.addEventListener('pointermove', function (e) {
	if (e.pointerType === 'mouse') {
		pointer.x = e.clientX;
		pointer.y = e.clientY;
		pointer.has = true;
		return;
	}
	if (!stick.active || e.pointerId !== stick.id) return;
	const dx = e.clientX - stick.ox;
	const dy = e.clientY - stick.oy;
	const len = Math.hypot(dx, dy);
	stick.throttle = clamp((len - STICK_DEAD) / (STICK_FULL - STICK_DEAD), 0, 1);
	if (stick.throttle > 0) {
		// Screen to ground, through the camera: up the screen is away from it.
		const ux = dx / len;
		const uy = dy / len;
		const rx = -Math.sin(view.azimuth);
		const rz = Math.cos(view.azimuth);
		const fx = -Math.cos(view.azimuth);
		const fz = -Math.sin(view.azimuth);
		stick.x = rx * ux - fx * uy;
		stick.z = rz * ux - fz * uy;
	}
	// The knob follows the thumb, up to the rim of the ring.
	const pull = len > STICK_FULL ? STICK_FULL / len : 1;
	stickEl.firstElementChild.style.transform =
		'translate(' + (dx * pull).toFixed(1) + 'px, ' + (dy * pull).toFixed(1) + 'px)';
});

function endStick() {
	stick.active = false;
	stick.id = -1;
	stick.throttle = 0;
	stickEl.hidden = true;
}

canvas.addEventListener('pointerup', function (e) {
	if (e.pointerId === stick.id) endStick();
});
canvas.addEventListener('pointercancel', function (e) {
	if (e.pointerId === stick.id) endStick();
});

/* ------------------------------------------------------------------- aim -- */

/*
 * Where he is looking: the cursor, dropped onto the plane he is standing on.
 * It is re-asked every frame rather than on movement, because orbiting the
 * camera under a still mouse moves the point it is over — the cursor is over a
 * place in the world, not a place on the screen.
 */
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const aimHit = new THREE.Vector3();
const pointer = { x: 0, y: 0, has: false };
const aim = { x: 0, z: 1, has: false };

function updateAim() {
	if (!pointer.has) return;
	const rect = canvas.getBoundingClientRect();
	ndc.x = ((pointer.x - rect.left) / rect.width) * 2 - 1;
	ndc.y = -((pointer.y - rect.top) / rect.height) * 2 + 1;
	raycaster.setFromCamera(ndc, camera);
	aimPlane.constant = -(player.y + 0.15);
	if (!raycaster.ray.intersectPlane(aimPlane, aimHit)) return;
	aim.x = aimHit.x;
	aim.z = aimHit.z;
	aim.has = true;
}

canvas.addEventListener('pointerleave', function (e) {
	if (e.pointerType === 'mouse') pointer.has = false;
});

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

const aimMarker = flatMarker(0xffffff, 0.34, 0.4);

/*
 * The two vectors, drawn on the ground where they can be compared: white is
 * where he is facing, green is where he is going. In every lab before this one
 * they were the same arrow.
 */
function groundArrow(color) {
	// Drawn over everything rather than into the scene: it is a readout, not a
	// thing in the yard, and a terrace half a metre away would otherwise bury it.
	const material = new THREE.MeshBasicMaterial({
		color, transparent: true, opacity: 0.7, depthWrite: false, depthTest: false,
		side: THREE.DoubleSide,
	});
	const group = new THREE.Group();
	group.renderOrder = 2;
	const shaft = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 1), material);
	shaft.rotation.x = PI / 2;
	shaft.position.z = 0.5;
	const head = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.26, 3), material);
	head.rotation.x = PI / 2;
	group.add(shaft);
	group.add(head);
	group.visible = false;
	scene.add(group);
	return {
		group,
		set: function (x, y, z, bearing, length) {
			group.position.set(x, y, z);
			group.rotation.y = bearing;
			shaft.scale.y = Math.max(0.001, length - 0.2);
			shaft.position.z = (length - 0.2) / 2;
			head.position.z = length - 0.1;
		},
	};
}

const facingArrow = groundArrow(0xf4f7f2);
const travelArrow = groundArrow(0x5f9b3e);

/* ----------------------------------------------------- what his hands do -- */

const boneIndex = new Map(BONES.map((n, i) => [n, i]));
const duckEntry = { clip: DUCK, bound: bindClip(DUCK, boneIndex) };
const slashEntry = { clip: SLASH, bound: bindClip(SLASH, boneIndex) };
const guardEntry = { clip: GUARD, bound: bindClip(GUARD, boneIndex) };

const strideBuf = {};
const basePose = createPose(BONES.length);
const guardPose = createPose(BONES.length);
const stancePose = createPose(BONES.length);
const overlayPose = createPose(BONES.length);
const playerPose = createPose(BONES.length);

// Lab 08's three guard masks, unchanged: the shield arm holds it out whatever
// his legs are doing, the sword side eases off as he speeds up so a run gets
// some counter-swing back, and the bladed stance at the root is only for a man
// who is standing still.
const GUARD_SHIELD = makeMask(BONES, { armL: 1, forearmL: 1, handL: 1 }, 0);
const GUARD_SWORD = makeMask(BONES, {
	armR: 1, forearmR: 1, handR: 1, spine: 0.45, chest: 1, neck: 1, head: 1,
}, 0);
const ROOT_ONLY = makeMask(BONES, { root: 1 }, 0);
const GUARD_AT_RUN = 0.65;

/*
 * The cut is a whole-body clip — the hips and spine turn first and drag the arm
 * round after them — and that is fine for a man standing still. Cutting on the
 * move, it has to give the legs back: they are carrying him somewhere. So the
 * mask it plays through is itself blended, from every bone when he is standing
 * to the upper body alone when he is not.
 */
const SWING_ALL = makeMask(BONES, {}, 1);
const SWING_UPPER = makeMask(BONES, UPPER_BODY, 0);
const swingMask = new Float32Array(BONES.length);

let guardWeight = 0;

// The stoop is lab 03's duck: a crouch with both hands forward, faded away
// while it holds at the bottom so he rises by blending back into the stride
// rather than playing it backwards.
const STOOP = { grab: 0.4, release: 0.56, end: 0.95, hold: 0.85 };
const stoop = { clock: 0, blend: 0, done: false, item: null };
const swing = { active: false, clock: 0, blend: 0, cuts: 0 };

const control = { state: 'idle', message: 'waiting' };

function beginStoop(item) {
	stoop.clock = 0;
	stoop.done = false;
	stoop.item = item;
	control.state = 'stoop';
	control.message = 'picking up the ' + item.label;
}

function strike() {
	if (control.state !== 'idle' || !armed()) return;
	swing.active = true;
	swing.clock = 0;
	control.state = 'swinging';
	control.message = 'cutting';
}

/* -------------------------------------------------------------------- ui -- */

const ui = {
	ik: document.getElementById('ik'),
	vectors: document.getElementById('vectors'),
	showSkel: document.getElementById('showSkel'),
	follow: document.getElementById('follow'),
	stats: document.getElementById('stats'),
};

attachPanel();

function applyVisibility() {
	const showS = ui.showSkel.checked;
	function ghost(materials) {
		for (const mat of materials.values()) {
			mat.transparent = showS;
			mat.opacity = showS ? 0.34 : 1;
			mat.depthWrite = !showS;
			mat.needsUpdate = true;
		}
	}
	for (const m of player.skeletonView.meshes) m.visible = showS;
	ghost(player.character.materials);
	for (const item of items) ghost(item.materials);
}
ui.showSkel.addEventListener('change', applyVisibility);

attachView(canvas, view, {
	applyCamera: applyCamera,
	viewHeight: VIEW,
	pitch: ISO_PITCH,
	zoom: [0.6, 4],
	touchDrag: 'lab', // one finger is the thumbstick, not the camera
	onPan: function () {
		ui.follow.checked = false;
	},
	onTap: function () {
		strike();
	},
});

/* --------------------------------------------------------------- the IK -- */

function toWorldXZ(actor, localX, localZ) {
	const s = Math.sin(actor.yaw);
	const c = Math.cos(actor.yaw);
	return { x: actor.x + localX * c + localZ * s, z: actor.z - localX * s + localZ * c };
}

function applyFootIK(actor) {
	const pose = actor.sparse;
	const world0 = solveWorld(SKELETON, pose);
	const targets = {};
	let pelvisDrop = 0;

	for (const side of ['L', 'R']) {
		const bone = 'foot' + side;
		const p = world0[bone].p;
		const w = toWorldXZ(actor, p[0], p[2]);
		const groundY = groundAt(w.x, w.z);
		const desiredY = groundY - actor.y + SOLE;
		const above = p[1] - desiredY;
		const weight = clamp(1 - above / 0.18, 0, 1);
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
		const t = targets['foot' + side];
		if (t.weight <= 0.02) continue;
		solveTwoBone(
			SKELETON, pose,
			{ root: 'hip' + side, mid: 'shin' + side, end: 'foot' + side },
			[t.x, t.y, t.z], world2['shin' + side].p, t.weight, world2,
		);
		levelBone(SKELETON, pose, 'foot' + side, t.weight);
	}
}

/* ------------------------------------------------------------- the drive -- */

// His own frame: +z is where he is facing, +x is his left.
const travel = { x: 0, z: 1 };
let heading = 0; // the same thing as an angle, which is what gets slewed
let theta = 0; // stride phase
let amp = 0; // 0 standing, 1 full stride
let gait = 0; // 0 walking, 1 running
let speedNow = 0;
let slipNow = 0;
let yawRate = 0;
let bank = 0;

function wishFrom() {
	// A thumb gives a direction in the world and he faces down it; a keyboard
	// gives one relative to the face the mouse has already chosen.
	if (stick.active && stick.throttle > 0) {
		return { x: 0, z: 1, throttle: stick.throttle, run: stick.throttle > 0.92 };
	}
	const x = keys.left - keys.right;
	const z = keys.fwd - keys.back;
	const len = Math.hypot(x, z);
	if (len < 1e-6) return { x: 0, z: 0, throttle: 0, run: false };
	return { x: x / len, z: z / len, throttle: 1, run: !!keys.run };
}

function faceTowards(targetX, targetZ, dt) {
	const want = Math.atan2(targetX - player.x, targetZ - player.z);
	const diff = wrapAngle(want - player.yaw);
	const turn = clamp(diff * TURN_RATE, -TURN_RATE, TURN_RATE);
	player.yaw += turn * dt;
	yawRate = turn;
}

/**
 * One step, and every reason it might not happen.
 *
 * He is a point with a radius now, so what gets tested is a spot in front of
 * him rather than the tile he is on — and if that spot is a wall he keeps
 * whichever axis of the move is still free, which is what stops a wall from
 * being flypaper.
 */
function moveBy(dx, dz) {
	const from = worldToAxial(player.x, player.z);
	const len = Math.hypot(dx, dz);
	if (len < 1e-6) return;
	const px = (dx / len) * BODY;
	const pz = (dz / len) * BODY;
	if (standable(player.x + dx + px, player.z + dz + pz, from)) {
		player.x += dx;
		player.z += dz;
		return;
	}
	if (standable(player.x + dx + Math.sign(dx) * BODY, player.z, from)) player.x += dx;
	if (standable(player.x, player.z + dz + Math.sign(dz) * BODY, from)) player.z += dz;
}

function nearestItem() {
	let best = null;
	let bestGap = PICKUP;
	for (const item of items) {
		if (item.worn) continue;
		const gap = Math.hypot(item.x - player.x, item.z - player.z);
		if (gap < bestGap) {
			bestGap = gap;
			best = item;
		}
	}
	return best;
}

function updatePlayer(dt, elapsed) {
	const wish = wishFrom();
	const busy = control.state === 'stoop';

	/* ------------------------------------------------------- where he looks */
	if (stick.active && stick.throttle > 0) {
		// A thumb cannot point and steer at once, so on a touch screen the two
		// go back together: he faces the way the stick is pushed.
		faceTowards(player.x + stick.x, player.z + stick.z, dt);
	} else if (control.state === 'stoop' && stoop.item) {
		faceTowards(stoop.item.x, stoop.item.z, dt);
	} else if (aim.has) {
		faceTowards(aim.x, aim.z, dt);
	} else {
		yawRate = 0;
	}

	/* ------------------------------------------------------ where he goes */
	const throttle = busy ? 0 : wish.throttle;
	if (throttle > 0) {
		const want = Math.atan2(wish.x, wish.z);
		heading += clamp(wrapAngle(want - heading), -HEADING_RATE * dt, HEADING_RATE * dt);
		travel.x = Math.sin(heading);
		travel.z = Math.cos(heading);
	}
	amp += (throttle - amp) * Math.min(1, dt * 9);
	gait += ((wish.run && throttle > 0.5 ? 1 : 0) - gait) * Math.min(1, dt * 3.5);

	/*
	 * How fast that is — asked of the pose rather than of a table. Two solves of
	 * a 17-bone rig per frame buys a speed that is right for this heading at this
	 * stride length, so the feet do not slide at any bearing or any throttle,
	 * including the fifth of a second it takes him to get going.
	 */
	const velocity = strideVelocity(SKELETON, travel, amp, gait);
	speedNow = velocity.x * travel.x + velocity.z * travel.z;
	slipNow = velocity.x * travel.z - velocity.z * travel.x;

	if (amp > 0.03) theta = (theta + (TAU / stridePeriod(gait)) * dt) % TAU;

	if (speedNow > 1e-4 && amp > 0.01) {
		const s = Math.sin(player.yaw);
		const c = Math.cos(player.yaw);
		// His heading, out into the world.
		const wx = travel.z * s + travel.x * c;
		const wz = travel.z * c - travel.x * s;
		moveBy(wx * speedNow * dt, wz * speedNow * dt);
	}

	const under = groundAt(player.x, player.z);
	player.y += (under - player.y) * Math.min(1, dt * 7);

	/* --------------------------------------------------------- what he does */
	if (control.state === 'idle') {
		const item = nearestItem();
		if (item) beginStoop(item);
		else control.message = amp > 0.05 ? (gait > 0.5 ? 'running' : 'walking') : armed() ? 'armed' : 'waiting';
	} else if (control.state === 'stoop') {
		stoop.clock += dt;
		if (!stoop.done && stoop.clock >= STOOP.grab) {
			stoop.done = true;
			// The whole of picking it up: the prop changes parent.
			stoop.item.equip(player.rig);
		}
		if (stoop.clock >= STOOP.end) {
			control.state = 'idle';
			control.message = armed() ? 'armed' : 'waiting';
		}
	} else if (control.state === 'swinging') {
		swing.clock += dt;
		if (swing.clock >= SLASH.duration) {
			swing.active = false;
			swing.cuts++;
			control.state = 'idle';
			control.message = 'armed';
		}
	}

	/* ------------------------------------------------------------- the pose */
	stridePose(theta, amp, travel, gait, elapsed, strideBuf);

	// A lean into the turn, which is the one thing the stride cannot know: it is
	// handed a heading, not the fact that the whole man is coming round.
	const wantBank = -clamp(yawRate * 0.05, -0.2, 0.2) * Math.min(1, speedNow / 1.2);
	bank += (wantBank - bank) * Math.min(1, dt * 6);
	strideBuf.root.rot[2] += bank;

	sparseToDense(BONES, strideBuf, basePose);

	const wantStoop = control.state === 'stoop' && stoop.clock < STOOP.release ? 1 : 0;
	stoop.blend += (wantStoop - stoop.blend) * Math.min(1, dt * 9);
	swing.blend = swing.active
		? Math.min(1, Math.min(swing.clock / 0.1, (SLASH.duration - swing.clock) / 0.2))
		: Math.max(0, swing.blend - dt * 6);

	// The guard, over the top, masked to the arms so the legs keep the gait.
	const carrying = sword.worn || shield.worn;
	const wantGuard = carrying && control.state !== 'stoop' ? 1 : 0;
	guardWeight += (wantGuard - guardWeight) * Math.min(1, dt * 4);
	let base = basePose;
	if (guardWeight > 0.002) {
		sampleBound(guardEntry, 0, guardPose);
		let src = basePose;
		if (shield.worn) {
			lerpPoseMasked(stancePose, src, guardPose, guardWeight, GUARD_SHIELD);
			src = stancePose;
		}
		if (sword.worn) {
			const hold = 1 - (1 - GUARD_AT_RUN) * Math.min(1, speedNow / 2.4);
			lerpPoseMasked(stancePose, src, guardPose, guardWeight * hold, GUARD_SWORD);
			src = stancePose;
		}
		const settled = 1 - Math.min(1, speedNow / 1.2);
		if (settled > 0.01) {
			lerpPoseMasked(stancePose, src, guardPose, guardWeight * settled, ROOT_ONLY);
			src = stancePose;
		}
		base = src;
	}

	// Then the one thing his whole body is doing, if it is doing one.
	if (stoop.blend > 0.002) {
		sampleBound(duckEntry, Math.min(stoop.clock, STOOP.hold), overlayPose);
		lerpPose(playerPose, base, overlayPose, stoop.blend);
	} else if (swing.blend > 0.002) {
		sampleBound(slashEntry, Math.min(swing.clock, SLASH.duration), overlayPose);
		// Standing, it gets all of him; moving, it gets his arms and gives the
		// legs back to the stride.
		const moving = Math.min(1, amp * 1.4);
		for (let i = 0; i < swingMask.length; i++) {
			swingMask[i] = SWING_ALL[i] + (SWING_UPPER[i] - SWING_ALL[i]) * moving;
		}
		lerpPoseMasked(playerPose, base, overlayPose, swing.blend, swingMask);
	} else {
		playerPose.rot.set(base.rot);
		playerPose.pos.set(base.pos);
	}

	denseToSparse(BONES, playerPose, player.sparse);
	if (ui.ik.checked) applyFootIK(player);
	player.group.position.set(player.x, player.y, player.z);
	player.group.rotation.y = player.yaw;
	applySparsePose(player.rig, player.sparse);
}

/* ------------------------------------------------------------------ loop -- */

let last = performance.now();
let statTimer = 0;
let elapsed = 0;

const BEARINGS = [
	{ to: 0.4, name: 'forward' },
	{ to: 1.2, name: 'half left' },
	{ to: 2.0, name: 'left' },
	{ to: 2.75, name: 'back left' },
	{ to: PI + 0.01, name: 'backwards' },
];

function bearingName(angle) {
	const a = Math.abs(angle);
	for (const band of BEARINGS) {
		if (a <= band.to) return angle < 0 ? band.name.replace('left', 'right') : band.name;
	}
	return 'backwards';
}

function frame(now) {
	const dt = Math.min((now - last) / 1000, 0.06);
	last = now;
	elapsed += dt;
	world.animateSmoke(elapsed);

	if (keys.camL || keys.camR) {
		view.azimuth += (keys.camR - keys.camL) * 1.6 * dt;
		applyCamera();
	}

	updateAim();
	updatePlayer(dt, elapsed);

	aimMarker.visible = aim.has && !stick.active;
	if (aimMarker.visible) aimMarker.position.set(aim.x, groundAt(aim.x, aim.z) + 0.02, aim.z);

	{
		const show = ui.vectors.checked;
		const y = player.y + 0.03;
		facingArrow.group.visible = show;
		travelArrow.group.visible = show && amp > 0.05;
		if (show) {
			facingArrow.set(player.x, y, player.z, player.yaw, 1.5);
			travelArrow.set(player.x, y + 0.01, player.z, player.yaw + heading, 0.8 + speedNow * 0.5);
		}
	}

	statTimer += dt;
	if (statTimer > 0.12) {
		statTimer = 0;
		const cell = worldToAxial(player.x, player.z);
		const tile = tileAt(cell.q, cell.r);
		const off = amp > 0.05 ? wrapAngle(heading) : 0;
		const step = (speedNow * stridePeriod(gait)) / 2;
		const carried = items.filter((i) => i.worn).map((i) => i.label);
		const rows = [
			['You', '<span class="' + (control.state !== 'idle' ? 'busy' : '') + '">' + control.message + '</span>'],
			['Speed', speedNow.toFixed(2) + ' m/s · ' + (gait > 0.5 ? 'run' : 'walk')],
			['Going', amp > 0.05
				? bearingName(off) + ' · ' + Math.round(Math.abs((off * 180) / PI)) + '° off his face'
				: '—'],
			['Step', amp > 0.05 ? (step * 100).toFixed(0) + ' cm' : '—'],
			['Foot slip', Math.abs(slipNow * 100).toFixed(0) + ' cm/s'],
			['Cell', cell.q + ', ' + cell.r + ' · terrace ' + (tile ? tile.level : '–')],
			['Carrying', carried.length ? '<span class="busy">' + carried.join(', ') + '</span>' : 'nothing'],
		];
		if (swing.cuts) rows.push(['Cuts', String(swing.cuts)]);
		if (ui.ik.checked) rows.push(['Pelvis drop', (player.pelvisDrop * 100).toFixed(1) + ' cm']);
		ui.stats.innerHTML = rows.map(([k, v]) => '<dt>' + k + '</dt><dd>' + v + '</dd>').join('');
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
	if (qs.has('vec')) ui.vectors.checked = qs.get('vec') !== '0';
	if (qs.has('follow')) ui.follow.checked = qs.get('follow') !== '0';
	if (qs.has('zoom')) view.zoom = view.zoomGoal = +qs.get('zoom');
	// Handy for sharing a view of the guard and the cut without walking the
	// yard first.
	if (qs.get('gear') === '1') for (const item of items) item.equip(player.rig);
	applyVisibility();
}

window.lab = {
	player, control, items, helmet, sword, shield, world, tileAt, view, keys, stick,
	aim, swing, stoop, strike,
	state: function () {
		return { x: player.x, z: player.z, yaw: player.yaw, speed: speedNow, slip: slipNow, amp, gait, heading, theta };
	},
};

resize();
requestAnimationFrame(frame);
