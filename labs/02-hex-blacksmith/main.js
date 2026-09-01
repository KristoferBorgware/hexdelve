/*
 * Hexdelve — Lab 02: a humanoid skeleton rig, and a blacksmith made of hexagons.
 *
 * The rig is a plain hierarchy of joints — no fingers or toes, just the basic
 * humanoid set — described as data in ../shared/skeleton.js. The character
 * is hexagonal prisms parented to those joints, so posing the rig poses the
 * character. The walk is procedural: every joint angle is a function of one
 * phase variable, evaluated fresh each frame (../shared/walk.js). Lab 03
 * bakes that same function into keyframes.
 */

'use strict';

const { attachPanel, attachView, startZoom } = Hexdelve.ui;
const { HexField, groundMaterial, makeRandom, tintColor, SQRT3 } = Hexdelve.hex;
const { SKELETON, BONES, TIPS } = Hexdelve.skeleton;
const { buildRig, buildSkeletonView, applySparsePose } = Hexdelve.rigview;
const { buildBlacksmith } = Hexdelve.blacksmith;
const { walkPose, WALK_PERIOD } = Hexdelve.walk;
const { measureGroundSpeed } = Hexdelve.anim;

const PI = Math.PI;
const TAU = PI * 2;

const GROUND_RADIUS = 7;
const PATH_R = 3.6; // the smith's worn circle around the anvil
const GROUND_Y = 0.16; // the top face of a ground tile — where feet belong

const random = makeRandom(11);
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

const view = { azimuth: (62 * PI) / 180, target: new THREE.Vector3(0, 1.0, 0), zoom: 1, zoomGoal: 1 };

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
sun.shadow.camera.left = -12;
sun.shadow.camera.right = 12;
sun.shadow.camera.top = 12;
sun.shadow.camera.bottom = -12;
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

function spruce(field, x, z, s) {
	const yaw = random() * 60;
	field.upright(x, 0.16, z, 0.26 * s, 1.1 * s, tintColor(random, '#6b4a2c', 0.03), yaw);
	for (const tier of [
		{ r: 1.5, h: 0.62, y: 0.95 },
		{ r: 1.15, h: 0.58, y: 1.62 },
		{ r: 0.8, h: 0.54, y: 2.26 },
		{ r: 0.45, h: 0.5, y: 2.86 },
	]) {
		field.upright(x, tier.y * s, z, tier.r * s, tier.h * s, tintColor(random, pick(PAL.spruce), 0.05), yaw + random() * 30);
	}
	field.upright(x, 3.34 * s, z, 0.18 * s, 0.42 * s, tintColor(random, pick(PAL.spruce), 0.05), yaw);
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
			const d = Math.hypot(x, z);
			const worn = Math.abs(d - PATH_R) < 0.95;
			field.upright(x, 0, z, 0.985, 0.16, tintColor(random, pick(worn ? PAL.worn : PAL.grass), 0.06));
			if (!worn && d > 1.4) tiles.push({ x, z });
		}
	}

	for (const tile of tiles) {
		const roll = random();
		const dx = (random() - 0.5) * 0.9;
		const dz = (random() - 0.5) * 0.9;
		if (roll < 0.05) {
			field.upright(tile.x + dx, 0.16, tile.z + dz, 0.1, 0.1 + random() * 0.08, tintColor(random, pick(PAL.flower), 0.06), random() * 60);
		} else if (roll < 0.11) {
			field.upright(tile.x + dx, 0.16, tile.z + dz, 0.085, 0.2 + random() * 0.12, tintColor(random, '#5c8040', 0.06), random() * 60);
		}
	}

	// The anvil at the centre of the circle.
	field.upright(0, 0.16, 0, 0.48, 0.46, tintColor(random, '#5c4127', 0.03), 14);
	field.upright(0, 0.62, 0, 0.3, 0.12, tintColor(random, '#3d4045', 0.02));
	field.lying('x', 0.02, 0.9, 0, 0.24, 0.72, tintColor(random, '#54585e', 0.02));
	field.lying('x', 0.5, 0.94, 0, 0.085, 0.28, tintColor(random, '#484c52', 0.02));

	spruce(field, -5.0, -3.6, 1.0);
	field.upright(4.6, 0.16, 4.4, 0.5, 0.32, tintColor(random, pick(PAL.stone), 0.05), random() * 60);
	field.upright(-4.4, 0.16, 4.8, 0.38, 0.24, tintColor(random, pick(PAL.stone), 0.05), random() * 60);
	field.upright(5.8, 0.16, -2.6, 0.42, 0.28, tintColor(random, pick(PAL.stone), 0.05), random() * 60);

	scene.add(field.build(groundMaterial()));
}

buildWorld();

/* ------------------------------------------------------ rig and character -- */

const actor = new THREE.Group();
scene.add(actor);

const rig = buildRig(SKELETON, actor);
const character = buildBlacksmith(rig);
const skeletonView = buildSkeletonView(rig, SKELETON, TIPS);

document.getElementById('boneCount').textContent = BONES.length;
document.getElementById('hexCount').textContent = character.meshes.length;

// How fast the ground must pass under the walk for the feet not to slide,
// measured from the pose function rather than tuned by hand.
const GROUND_SPEED = measureGroundSpeed(
	SKELETON,
	(t) => walkPose((t / WALK_PERIOD) * TAU, 1),
	WALK_PERIOD,
);

/* -------------------------------------------------------------------- ui -- */

const ui = {
	speed: document.getElementById('speed'),
	showChar: document.getElementById('showChar'),
	showSkel: document.getElementById('showSkel'),
	roam: document.getElementById('roam'),
	spin: document.getElementById('spin'),
};

function applyVisibility() {
	const showC = ui.showChar.checked;
	const showS = ui.showSkel.checked;
	const xray = showC && showS;
	for (const m of character.meshes) m.visible = showC;
	for (const m of skeletonView.meshes) m.visible = showS;
	for (const mat of character.materials.values()) {
		mat.transparent = xray;
		mat.opacity = xray ? 0.32 : 1;
		mat.depthWrite = !xray;
		mat.needsUpdate = true;
	}
}
ui.showChar.addEventListener('change', applyVisibility);
ui.showSkel.addEventListener('change', applyVisibility);

{
	// A portrait phone sees a much narrower slice of the world than a desktop
	// window does; open zoomed out to match.
	view.zoom = view.zoomGoal = startZoom(view.zoom);

	const qs = new URLSearchParams(location.search);
	if (qs.has('speed')) ui.speed.value = qs.get('speed');
	if (qs.has('char')) ui.showChar.checked = qs.get('char') !== '0';
	if (qs.has('skel')) ui.showSkel.checked = qs.get('skel') !== '0';
	if (qs.has('roam')) ui.roam.checked = qs.get('roam') !== '0';
	if (qs.has('spin')) ui.spin.checked = qs.get('spin') !== '0';
	if (qs.has('zoom')) view.zoom = view.zoomGoal = +qs.get('zoom');
	if (qs.has('tx')) view.target.x = +qs.get('tx');
	if (qs.has('tz')) view.target.z = +qs.get('tz');
}
applyVisibility();

/* -------------------------------------------------------------- controls -- */

// Orbit, pan and zoom, from a mouse or from fingers — see ../shared/ui.js.
// The panel opens and closes from ../shared/ui.js, which also reads ?panel=.
attachPanel();

attachView(canvas, view, {
	applyCamera: applyCamera,
	viewHeight: VIEW,
	pitch: ISO_PITCH,
	zoom: [0.5, 4],
	// The camera stays over the ground it is showing.
	clampTarget: function (target) {
		const lim = SQRT3 * GROUND_RADIUS;
		target.x = Math.max(-lim, Math.min(lim, target.x));
		target.z = Math.max(-lim, Math.min(lim, target.z));
	},
});

/* ------------------------------------------------------------------ loop -- */

const walk = { theta: 0, pathAngle: 0 };
let last = performance.now();
let elapsed = 0;

function frame(now) {
	const dt = Math.min((now - last) / 1000, 0.1);
	last = now;
	elapsed += dt;

	const speed = +ui.speed.value;
	const amp = Math.min(speed, 1);

	walk.theta += dt * speed * (TAU / WALK_PERIOD);
	if (ui.roam.checked && speed > 0.01) {
		walk.pathAngle += (dt * GROUND_SPEED * speed) / PATH_R;
		actor.position.set(PATH_R * Math.cos(walk.pathAngle), GROUND_Y, PATH_R * Math.sin(walk.pathAngle));
		actor.rotation.y = -walk.pathAngle;
	} else {
		actor.position.set(0, GROUND_Y, PATH_R);
		actor.rotation.y = 0;
	}

	applySparsePose(rig, walkPose(walk.theta, amp, elapsed));

	// The apron is not part of the pose: it is cloth, so it swings against
	// whichever thigh is leading.
	const lead = Math.min(rig.bones.hipL.rotation.x, rig.bones.hipR.rotation.x);
	character.apron.quaternion.setFromEuler(new THREE.Euler(PI / 2 - 0.03 + lead * 0.5, PI / 6, 0));

	if (ui.spin.checked && !drag.active) {
		view.azimuth += dt * 0.18;
		applyCamera();
	}
	if (Math.abs(view.zoom - view.zoomGoal) > 1e-4) {
		view.zoom += (view.zoomGoal - view.zoom) * Math.min(1, dt * 10);
		applyCamera();
	}

	renderer.render(scene, camera);
	requestAnimationFrame(frame);
}

resize();
requestAnimationFrame(frame);
