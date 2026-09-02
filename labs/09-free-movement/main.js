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
const { worldToAxial, distance: hexDistance, neighbours, findPath } = Hexdelve.hexgrid;
const { SKELETON, BONES, TIPS, HIPS_Y, UPPER_BODY } = Hexdelve.skeleton;
const { buildRig, buildSkeletonView, applySparsePose } = Hexdelve.rigview;
const { buildWanderer } = Hexdelve.wanderer;
const { makeItem } = Hexdelve.props;
const { attachPanel, attachView, startZoom } = Hexdelve.ui;
const { stridePose, stridePeriod, strideVelocity } = Hexdelve.stride;
const { SLASH, GUARD, DUCK } = Hexdelve.clips;
const {
	createPose, lerpPose, lerpPoseMasked, makeMask, bindClip, sampleBound,
	denseToSparse, sparseToDense, solveWorld, samplePose,
} = Hexdelve.anim;
const { solveTwoBone, levelBone, attachmentPosition } = Hexdelve.ik;

const BAT = Hexdelve.batrig;
const { perchPose, flyPose, lungePose, mixPose, FLAP_PERIOD, LUNGE_CONTACT } = Hexdelve.batpose;

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

/*
 * The bat, and its numbers, unchanged from lab 08 — which is the point of
 * bringing it here. It hunts over the grid; he no longer walks on one. Nothing
 * about the way it thinks had to be told that.
 */
const BAT_CLIMB = 2; // terraces a pair of wings clears in one step
const WAKE_RANGE = 3; // tiles: how close you get before it notices you
const LOSE_RANGE = 6; // tiles: how far you get before it stops caring
const BITE_COOLDOWN = 1.1;
const BITE_TOLERANCE = 0.55; // how far off the jaws can be and still have caught him
const HOVER_LIFT = 0.62; // how far off the ground the wings hold it, once awake
const JAW_TIP = [0, -0.02, 0.16];

/*
 * No closer than this. It is not a body radius, it is geometry: hexagons here
 * are 1.73 m centre to centre, so their circumradius is exactly 1.0 m. A shade
 * beyond it and he is outside the bat's hexagon in every direction.
 */
const KEEP_APART = 1.15;

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
 * edge of the world, and the hexagon the bat is standing in. What has changed
 * is the question. Labs 06–08 asked it for a route; he asks it for a wall, one
 * step at a time, at a point half a metre in front of him rather than under his
 * feet. The bat still asks it for a route.
 */
const cellOf = (actor) => worldToAxial(actor.x, actor.z);
const sameCell = (a, b) => a.q === b.q && a.r === b.r;

function standable(x, z, from) {
	const cell = worldToAxial(x, z);
	if (sameCell(cell, cellOf(bat))) return false;
	return world.passable(cell, from, MAX_CLIMB);
}

// And the same ground asked the other way: a terrace is a step to him and a
// flap to it, and neither may enter the cell the other is in.
const flyable = (cell, from) =>
	!sameCell(cell, cellOf(player)) && world.passable(cell, from, BAT_CLIMB);

/* ---------------------------------------------------------------- actors -- */

/*
 * An actor is a group at ground level, a rig inside it, a body hung on the rig
 * and one sparse pose buffer. Lab 08's arrangement exactly — the man and the
 * bat differ only in which skeleton goes in and where the pose comes from.
 */
function makeActor(skeleton, tips, build, x, z, yaw) {
	const group = new THREE.Group();
	scene.add(group);
	const rig = buildRig(skeleton, group);
	const character = build(rig);
	const skeletonView = buildSkeletonView(rig, skeleton, tips);
	return {
		group, rig, character, skeletonView, skeleton,
		x, z, y: groundAt(x, z), yaw,
		sparse: {},
		pelvisDrop: 0,
	};
}

const player = makeActor(SKELETON, TIPS, buildWanderer, 0, -5.4, 0);

// It sleeps out in the open east of the anvil, far enough from where he starts
// that he can collect the gear before it hears him — but not much further.
const PERCH = worldToAxial(3.9, 1.2);
const bat = (function () {
	const tile = tileAt(PERCH.q, PERCH.r);
	return makeActor(BAT.SKELETON, BAT.TIPS, Hexdelve.bat.buildBat, tile.x, tile.z, 2.4);
})();

const actors = [player, bat];

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

// The hexagon the bat is standing on. It is as solid as a wall as far as he is
// concerned, so it is worth being able to see.
const batCellMarker = flatMarker(0xd2603a, 0.93, 0.34);
const perchMarker = flatMarker(0x8d6bb0, 0.75, 0.3);
const batMarkers = [];
for (let i = 0; i < 24; i++) batMarkers.push(flatMarker(0xb0553f, 0.19, 0.75));

function showBatPath(path) {
	for (const m of batMarkers) m.visible = false;
	if (!path || !ui.paths.checked) return;
	for (let i = 0; i < path.length && i < batMarkers.length; i++) {
		const tile = tileAt(path[i].q, path[i].r);
		if (!tile) continue;
		batMarkers[i].visible = true;
		batMarkers[i].position.set(tile.x, tile.top + 0.02, tile.z);
	}
}

{
	const tile = tileAt(PERCH.q, PERCH.r);
	perchMarker.position.set(tile.x, tile.top + 0.015, tile.z);
}

/* ---------------------------------------------------------- the reaches -- */

/*
 * How far it can bite, and how far he can cut. Both are measured off the clips
 * rather than typed in, and both are lab 08's measurement brought over
 * unchanged — but the cut is doing more work here, because in lab 08 he was
 * walked into range by the pathfinder and turned to face the thing for you.
 * Now the arc is aimed by the mouse, so where it starts and stops matters.
 *
 * The blade is sampled right through the strike, not at the contact key alone,
 * because a cut sweeps: what comes back is how far it reaches and between which
 * two bearings it passes. The follow-through behind his shoulder is thrown
 * away, since a sword finishing its arc back there is not cutting anything he
 * is fighting.
 */
const SWING_CONTACT = 0.44;

const REACH = (function () {
	let distance = 0;
	let height = 0;
	let from = Infinity;
	let to = -Infinity;
	for (let t = 0.34; t <= 0.58; t += 0.02) {
		const tip = attachmentPosition(SKELETON, samplePose(SLASH, t), 'handR', Hexdelve.sword.TIP);
		const bearing = Math.atan2(tip[0], tip[2]);
		if (Math.abs(bearing) > 1.9) continue;
		const d = Math.hypot(tip[0], tip[2]);
		if (d > distance) {
			distance = d;
			height = tip[1];
		}
		from = Math.min(from, bearing);
		to = Math.max(to, bearing);
	}
	return { distance, height, from, to };
})();

// A body is not a point, so the arc gets a little either side of it.
const ARC_PAD = 0.35;

const BITE = (function () {
	const jaws = attachmentPosition(BAT.SKELETON, lungePose(LUNGE_CONTACT), 'jaw', JAW_TIP);
	return { reach: Math.hypot(jaws[0], jaws[2]), height: jaws[1] };
})();

/* ------------------------------------------------------------- the motes -- */

// A dozen dark flecks thrown off a blow, on the one frame it lands.
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
const swing = { active: false, clock: 0, blend: 0, hit: false, cuts: 0, hits: 0, missed: 0 };

const control = { state: 'idle', message: 'waiting' };

function beginStoop(item) {
	stoop.clock = 0;
	stoop.done = false;
	stoop.item = item;
	control.state = 'stoop';
	control.message = 'picking up the ' + item.label;
}

/**
 * The moment the blade arrives. Everything that decides whether it connects is
 * here: close enough, inside the arc the clip actually sweeps, and roughly
 * level with the thing. In lab 08 he was turned to face the bat for the whole
 * approach; here nothing aims for you, so a cut thrown at where it *was* misses
 * exactly as it should.
 */
function landSwing() {
	const dx = bat.x - player.x;
	const dz = bat.z - player.z;
	const gap = Math.hypot(dx, dz) || 1e-6;
	const off = wrapAngle(Math.atan2(dx, dz) - player.yaw);
	const bladeY = player.y + REACH.height;
	const bodyY = bat.y + BAT.HOVER_Y;

	const inArc = off >= REACH.from - ARC_PAD && off <= REACH.to + ARC_PAD;
	if (gap > REACH.distance + 0.35 || !inArc || Math.abs(bodyY - bladeY) > 1.0) {
		swing.missed++;
		return;
	}

	swing.hits++;
	motes.spawn(bat.x, bodyY, bat.z, 9, 1.6, 1.9);
	reel();
}

function strike() {
	if (control.state !== 'idle' || !armed()) return;
	swing.active = true;
	swing.clock = 0;
	swing.hit = false;
	control.state = 'swinging';
	control.message = 'cutting';
}

/* -------------------------------------------------------------------- ui -- */

const ui = {
	ik: document.getElementById('ik'),
	vectors: document.getElementById('vectors'),
	paths: document.getElementById('paths'),
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
	for (const actor of actors) {
		for (const m of actor.skeletonView.meshes) m.visible = showS;
		ghost(actor.character.materials);
	}
	// The gear turns to glass with him, so the rig shows through what he is
	// wearing rather than the helmet hiding the skull.
	for (const item of items) ghost(item.materials);
}
ui.showSkel.addEventListener('change', applyVisibility);
ui.paths.addEventListener('change', () => showBatPath(hunt.path));

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

/* ---------------------------------------------------------- both of them -- */

function placeActor(actor) {
	actor.group.position.set(actor.x, actor.y, actor.z);
	actor.group.rotation.y = actor.yaw;
	applySparsePose(actor.rig, actor.sparse);
}

function turnTowards(actor, targetX, targetZ, dt, rate) {
	const want = Math.atan2(targetX - actor.x, targetZ - actor.z);
	const diff = wrapAngle(want - actor.yaw);
	actor.yaw += clamp(diff, -rate * dt, rate * dt);
	return Math.abs(diff);
}

/**
 * Follow a path of tiles — lab 06's version, and only the bat needs it now.
 * Waypoints retire on a radius that grows with speed, because at a run a fixed
 * one can be circled forever.
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
	const toGoal = Math.hypot(goalTile.x - actor.x, goalTile.z - actor.z);
	const diff = wrapAngle(Math.atan2(tile.x - actor.x, tile.z - actor.z) - actor.yaw);
	actor.yaw += clamp(diff * 4, -turnRate, turnRate) * dt;

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

	/*
	 * Nobody stands inside anybody. Of the two it is the man who gives way,
	 * because he is the one moving freely — the bat is locked to its hexagon and
	 * shoving it out of the way would be shoving it off the grid.
	 */
	{
		const dx = player.x - bat.x;
		const dz = player.z - bat.z;
		const d = Math.hypot(dx, dz);
		if (d < KEEP_APART && d > 1e-4) {
			player.x = bat.x + (dx / d) * KEEP_APART;
			player.z = bat.z + (dz / d) * KEEP_APART;
		}
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
		if (!swing.hit && swing.clock >= SWING_CONTACT) {
			swing.hit = true;
			landSwing();
		}
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
	placeActor(player);
}

/* --------------------------------------------------------- driving the bat -- */

/*
 * Lab 08's bat, moved across whole, because the interesting thing is how little
 * of it had to change. It hunts over the hexagons, bites from whichever one it
 * is standing on, and never leaves the grid; the man it is hunting is now
 * nowhere on that grid in particular. The only line that noticed is the one
 * that asks which cell he is in — `worldToAxial(player.x, player.z)` — which is
 * the same question it always asked, and it was never the same thing as "the
 * tile he is walking to".
 *
 *   asleep → waking → hunting ⇄ striking → recovering
 *                        ↓
 *                    returning → asleep
 */
const RUN_SPEED = strideVelocity(SKELETON, { x: 0, z: 1 }, 1, 1).z;

// Deliberately under a sprint: it should run you down while you dawdle and lose
// you while you run, so that the range numbers mean something.
const BAT_SPEED = RUN_SPEED * 0.72;

const hunt = {
	state: 'asleep',
	path: null,
	index: 0,
	speed: 0,
	repathIn: 0,
	reel: 0,
	lastGoal: null,
	wake: 0, // 0 folded, 1 flying
	flap: 0, // wing phase
	lunge: 0, // 0 → 1 across a strike
	lungeBlend: 0,
	bitten: false,
	cooldown: 0,
	bites: 0,
	missed: 0,
	message: 'asleep',
};

// Pose buffers, allocated once.
const flyBuf = {};
const perchBuf = {};
const lungeBuf = {};

const tilesToPlayer = () => hexDistance(cellOf(bat), cellOf(player));

// Path to a tile beside the man, not onto him: the grid is for getting there,
// the last half metre is the strike's business.
function repath() {
	const from = cellOf(bat);
	const goal = cellOf(player);
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
		showBatPath(path);
	}
	hunt.repathIn = 0.45;
}

function goHome() {
	hunt.path = findPath(cellOf(bat), PERCH, { passable: flyable });
	hunt.index = 1;
	hunt.lastGoal = PERCH;
	showBatPath(hunt.path);
}

/**
 * Hit. Whatever it was doing stops — including a lunge halfway to his throat —
 * and it is thrown back, wings thrashing, before it comes round and starts
 * again.
 */
function reel() {
	hunt.state = 'reeling';
	hunt.message = 'hit';
	hunt.reel = 0.55;
	hunt.lunge = 0;
	hunt.lungeBlend = 0;
	hunt.wake = 1;
	hunt.path = null;
	showBatPath(null);
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
			const goal = cellOf(player);
			if (hunt.repathIn <= 0 || !hunt.lastGoal || hexDistance(hunt.lastGoal, goal) > 1) repath();

			const state = { path: hunt.path, index: hunt.index, speed: hunt.speed, arrived: false };
			wantSpeed = followPath(bat, state, dt, BAT_SPEED, 2.6);
			hunt.index = state.index;
			if (state.arrived) hunt.path = null;

			// It attacks from the hexagon it is on, so the condition is about the
			// grid rather than about metres: next to him, settled on the cell, and
			// off cooldown.
			const settled = state.arrived || hunt.speed < 0.4;
			if (near <= 1 && settled && hunt.cooldown <= 0) {
				hunt.state = 'striking';
				hunt.message = 'striking';
				hunt.lunge = 0;
				hunt.bitten = false;
				showBatPath(null);
			} else if (near > LOSE_RANGE) {
				hunt.state = 'returning';
				hunt.message = 'losing you';
				goHome();
			}
			break;
		}

		case 'striking': {
			// Rooted to its cell. The only movement is turning to face him and the
			// lunge itself, which throws the body a metre forward and pulls it back
			// inside the pose.
			turnTowards(bat, player.x, player.z, dt, 3.4);
			hunt.lunge = Math.min(1, hunt.lunge + dt / 0.85);
			hunt.lungeBlend = Math.min(1, hunt.lungeBlend + dt * 7);
			flapAmp = 0.5;

			if (!hunt.bitten && hunt.lunge >= LUNGE_CONTACT) {
				hunt.bitten = true;
				// Where the jaws actually got to, not where it aimed.
				const jaws = attachmentPosition(BAT.SKELETON, bat.sparse, 'jaw', JAW_TIP);
				const w = toWorldXZ(bat, jaws[0], jaws[2]);
				if (Math.hypot(w.x - player.x, w.z - player.z) <= BITE_TOLERANCE) {
					hunt.bites++;
					motes.spawn(w.x, bat.y + jaws[1], w.z, 7, 1.3, 1.6);
				} else {
					hunt.missed++;
				}
			}
			if (hunt.lunge >= 1) {
				hunt.state = 'recovering';
				hunt.message = 'backing off';
				hunt.cooldown = BITE_COOLDOWN;
			}
			break;
		}

		case 'recovering':
			// It never left its cell, so there is nothing to walk back from: this is
			// only the beat between blows.
			hunt.lungeBlend = Math.max(0, hunt.lungeBlend - dt * 5);
			turnTowards(bat, player.x, player.z, dt, 2.0);
			if (hunt.cooldown <= 0) {
				hunt.state = 'hunting';
				hunt.lunge = 0;
				repath();
			}
			break;

		case 'reeling': {
			hunt.reel -= dt;
			const dx = bat.x - player.x;
			const dz = bat.z - player.z;
			const d = Math.hypot(dx, dz) || 1;
			const push = 2.6 * Math.max(0, hunt.reel / 0.55);
			bat.x += (dx / d) * push * dt;
			bat.z += (dz / d) * push * dt;
			wantSpeed = push;
			flapAmp = 1.45; // thrashing, not cruising
			turnTowards(bat, player.x, player.z, dt, 1.6);
			if (hunt.reel <= 0) {
				hunt.state = 'hunting';
				hunt.cooldown = 0.7;
				repath();
			}
			break;
		}

		case 'returning': {
			hunt.message = 'going home';
			const state = { path: hunt.path, index: hunt.index, speed: hunt.speed, arrived: false };
			wantSpeed = followPath(bat, state, dt, BAT_SPEED * 0.8, 2.2);
			hunt.index = state.index;
			if (state.arrived || !hunt.path) {
				hunt.state = 'settling';
				hunt.path = null;
				showBatPath(null);
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

	/*
	 * A* will not route it through the hexagon he is standing in, but a path is
	 * only checked at the corners — between them it flies in a straight line, and
	 * that line was taking it clean through him. So a step is only taken if it
	 * leaves them a body apart, or if it is moving away.
	 */
	if (hunt.state === 'hunting' || hunt.state === 'returning') {
		const nx = bat.x + Math.sin(bat.yaw) * hunt.speed * dt;
		const nz = bat.z + Math.cos(bat.yaw) * hunt.speed * dt;
		const now = Math.hypot(bat.x - player.x, bat.z - player.z);
		const next = Math.hypot(nx - player.x, nz - player.z);
		if (next > KEEP_APART || next >= now) {
			bat.x = nx;
			bat.z = nz;
		}
	}

	// Height: it follows the ground terrace by terrace, and rides above it by
	// however awake it is.
	const under = groundAt(bat.x, bat.z) + HOVER_LIFT * hunt.wake;
	bat.y += (under - bat.y) * Math.min(1, dt * 6);

	// The pose. Beat rate rises with speed, and every state is a blend of at most
	// two of the three poses the creature has.
	hunt.flap += (TAU / FLAP_PERIOD) * (0.55 + 0.55 * Math.min(1, hunt.speed / BAT_SPEED)) * dt;
	if (hunt.flap > TAU) hunt.flap -= TAU;
	const amp = flapAmp * Math.max(0.35, Math.min(1, 0.45 + hunt.speed / BAT_SPEED));

	if (hunt.wake >= 1) {
		flyPose(hunt.flap, amp, time, bat.sparse);
	} else if (hunt.wake <= 0) {
		perchPose(time, bat.sparse);
	} else {
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

	motes.update(dt);
	updateAim();
	updatePlayer(dt, elapsed);
	updateBat(dt, elapsed);

	perchMarker.visible = ui.paths.checked && hunt.state === 'asleep';
	{
		const c = cellOf(bat);
		const tile = tileAt(c.q, c.r);
		batCellMarker.visible = !!tile;
		if (tile) batCellMarker.position.set(tile.x, tile.top + 0.03, tile.z);
	}

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
		const hunting = hunt.state !== 'asleep' && hunt.state !== 'settling';
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
			['Bat', '<span class="' + (hunting ? 'warn' : '') + '">' + hunt.message + '</span> · '
				+ hunt.speed.toFixed(2) + ' m/s'],
			['Range', tilesToPlayer() + ' tiles · wakes at ' + WAKE_RANGE],
			['Bites / missed', hunt.bites + ' · ' + hunt.missed],
		];
		if (swing.cuts) rows.push(['Cuts / hits', swing.cuts + ' · ' + swing.hits]);
		if (armed()) {
			rows.push(['Reach', (REACH.distance * 100).toFixed(0) + ' cm · arc '
				+ Math.round((REACH.to - REACH.from) * 57.3) + '°']);
		}
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
	player, bat, hunt, actors, control, items, helmet, sword, shield, world, tileAt,
	view, keys, stick, aim, swing, stoop, strike, REACH, BITE, PERCH, BAT_SPEED,
	tilesToPlayer, armed,
	state: function () {
		return { x: player.x, z: player.z, yaw: player.yaw, speed: speedNow, slip: slipNow, amp, gait, heading, theta };
	},
};

resize();
requestAnimationFrame(frame);
