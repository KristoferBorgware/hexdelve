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

const { HexField, groundMaterial, hexGeometry, makeRandom, tintColor, SQRT3, Q_AXIS_X, Q_AXIS_Z } = Hexdelve.hex;
const { axialToWorld, worldToAxial, distance: hexDistance, neighbours, findPath, keyOf } = Hexdelve.hexgrid;
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

/* --------------------------------------------------------------- terrain -- */

const ANVIL_CELL = { q: 0, r: 0 };
const tiles = new Map(); // key → { q, r, level, top, x, z }

function levelAt(x, z) {
	if (Math.hypot(x, z) < 2.4) return 1; // the flat working area round the anvil
	// A cone you can walk up: neighbouring tiles never differ by more than one.
	const cone = Math.hypot(x - 7.5, z + 5.0);
	let level = Math.max(0, Math.min(3, Math.round((7.0 - cone) / 1.75)));
	// A mesa with sheer sides: three terraces straight up, so there is no way on.
	if (Math.hypot(x + 6.5, z - 4.5) < 3.2) level = Math.max(level, 3);
	return level;
}

let groundMesh = null;

function buildTerrain() {
	const field = new HexField();
	field.upright(0, -1.4, 0, SQRT3 * GROUND_RADIUS + 1.6, 1.4, new THREE.Color('#4a3b2c'), 90);

	for (let q = -GROUND_RADIUS; q <= GROUND_RADIUS; q++) {
		for (let r = -GROUND_RADIUS; r <= GROUND_RADIUS; r++) {
			if ((Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2 > GROUND_RADIUS) continue;
			const { x, z } = axialToWorld(q, r);
			const level = levelAt(x, z);
			const top = BASE_Y + level * STEP_H;
			const cell = { q, r, level, top, x, z };
			tiles.set(keyOf(q, r), cell);
			const shade = ['#79a256', '#84ab61', '#90b46f', '#9dbd7e'][level];
			field.upright(x, 0, z, 0.985, top, tintColor(random, shade, 0.05), 0, cell);
			if (random() < 0.06) {
				field.upright(x + (random() - 0.5) * 0.8, top, z + (random() - 0.5) * 0.8, 0.085, 0.2, tintColor(random, '#5c8040', 0.06), random() * 60, cell);
			}
		}
	}

	groundMesh = field.build(groundMaterial());
	scene.add(groundMesh);
}

buildTerrain();

const tileAt = (q, r) => tiles.get(keyOf(q, r)) || null;

function groundAt(x, z) {
	const cell = worldToAxial(x, z);
	const tile = tileAt(cell.q, cell.r);
	return tile ? tile.top : BASE_Y;
}

const isAnvil = (cell) => cell.q === ANVIL_CELL.q && cell.r === ANVIL_CELL.r;

// A tile is walkable if it exists, is not the anvil's, and the step from where
// you came is climbable.
function passable(cell, from) {
	const tile = tileAt(cell.q, cell.r);
	if (!tile || isAnvil(cell)) return false;
	if (blocked.has(keyOf(cell.q, cell.r))) return false; // the smithy stands here
	if (!from) return true;
	const prev = tileAt(from.q, from.r);
	return !prev || Math.abs(tile.level - prev.level) <= MAX_CLIMB;
}

/* ----------------------------------------------------------------- anvil -- */

const ANVIL_POS = axialToWorld(ANVIL_CELL.q, ANVIL_CELL.r);
const ANVIL_FACE_Y = tileAt(0, 0).top + 0.86;

function buildAnvil() {
	const group = new THREE.Group();
	group.position.set(ANVIL_POS.x, ANVIL_FACE_Y, ANVIL_POS.z);
	const mat = new THREE.MeshPhongMaterial({ color: 0xffffff, flatShading: true, shininess: 6, specular: 0x1a1a1a });
	const add = (color, pos, scale, quat, yaw) => {
		const m = new THREE.Mesh(hexGeometry(), mat.clone());
		m.material.color.set(color);
		m.position.set(pos[0], pos[1], pos[2]);
		if (quat) m.quaternion.copy(quat);
		if (yaw) m.rotation.y = (yaw * PI) / 180;
		m.scale.set(scale[0], scale[1], scale[2]);
		m.castShadow = true;
		m.receiveShadow = true;
		group.add(m);
	};
	const stumpTop = -0.22;
	const stumpBottom = tileAt(0, 0).top - ANVIL_FACE_Y;
	const h = stumpTop - stumpBottom;
	add('#5c4127', [0, stumpTop - h / 2, 0], [0.48, h, 0.48], null, 14);
	add('#3d4045', [0, -0.16, 0], [0.3, 0.12, 0.3]);
	add('#54585e', [0.02, -0.208, 0], [0.24, 0.72, 0.24], Q_AXIS_X);
	add('#484c52', [0.5, -0.17, 0], [0.085, 0.28, 0.085], Q_AXIS_X);
	scene.add(group);
}

buildAnvil();

/* ---------------------------------------------------------------- smithy -- */

// Behind the anvil on flat ground, clear of both the walkable cone and the
// mesa. Built in its own local space and then placed, so the whole thing can
// be rotated to face the anvil by transforming one InstancedMesh.
const SMITHY = { x: -4.1, z: -3.5, yaw: Math.atan2(0 - -4.1, 0 - -3.5) };
const SMITHY_HALF_X = 1.95;
const SMITHY_HALF_Z = 1.5;

let smithyMesh = null;
const blocked = new Set();
const smoke = [];

// Puffs are parented to their building and animated in its local space, so a
// chimney is described in the coordinates it was modelled in.
function addSmoke(parent, x, y, z, count, rise) {
	for (let i = 0; i < count; i++) {
		const puff = new THREE.Mesh(
			hexGeometry(),
			new THREE.MeshLambertMaterial({ color: 0xd8d4cc, transparent: true, opacity: 0, depthWrite: false }),
		);
		puff.position.set(x, y, z);
		parent.add(puff);
		smoke.push({ mesh: puff, phase: i / count, wobble: random() * TAU, x, y, z, rise });
	}
}

function animateSmoke(time) {
	const period = 8;
	for (const p of smoke) {
		const u = (((time / period + p.phase) % 1) + 1) % 1;
		p.mesh.position.y = p.y + 0.2 + u * p.rise;
		p.mesh.position.x = p.x + 0.5 * u * Math.sin(p.wobble + u * 4);
		p.mesh.position.z = p.z + 0.35 * u * Math.cos(p.wobble + u * 3);
		p.mesh.rotation.y = p.wobble + u * 2;
		const s = 0.18 + u * 0.55;
		p.mesh.scale.set(s, s * 0.7, s);
		p.mesh.material.opacity = 0.4 * Math.sin(Math.PI * Math.min(u * 1.7, 1));
	}
}

// Mark every tile under a placed building solid, so paths go round it.
function blockFootprint(cx, cz, yaw, halfX, halfZ, margin) {
	const s = Math.sin(yaw);
	const c = Math.cos(yaw);
	for (const [, tile] of tiles) {
		const dx = tile.x - cx;
		const dz = tile.z - cz;
		const lx = dx * c - dz * s;
		const lz = dx * s + dz * c;
		if (Math.abs(lx) < halfX + margin && Math.abs(lz) < halfZ + margin) {
			blocked.add(keyOf(tile.q, tile.r));
		}
	}
}

function buildSmithy() {
	const field = new HexField();
	const logR = 0.26;
	const step = SQRT3 * logR;
	const courses = 5;
	const sill = 0.22;
	const wallTop = sill + courses * step;
	const pitch = 0.5;
	const eaveZ = SMITHY_HALF_Z + 0.5;
	const ridgeY = wallTop + 0.3 + pitch * eaveZ;
	const wood = ['#7d5230', '#8a5a34', '#734b2b', '#956441'];
	const stone = ['#8d8d86', '#94948c', '#858680'];

	// Stone sill under the timber, so the logs are not sitting in the mud.
	for (const [cx, cz, len, axis] of [
		[0, -SMITHY_HALF_Z, 2 * SMITHY_HALF_X + 0.6, 'x'],
		[-SMITHY_HALF_X, 0, 2 * SMITHY_HALF_Z + 0.6, 'z'],
		[SMITHY_HALF_X, 0, 2 * SMITHY_HALF_Z + 0.6, 'z'],
	]) {
		field.lying(axis, cx, sill / 2, cz, 0.3, len, tintColor(random, pick(stone), 0.04));
	}

	// Three walls of stacked logs; the front stays open onto the anvil.
	for (let k = 0; k < courses; k++) {
		const y = sill + (k + 0.5) * step;
		const colour = () => tintColor(random, wood[k % wood.length], 0.04);
		field.lying('x', 0, y, -SMITHY_HALF_Z, logR, 2 * SMITHY_HALF_X + 0.7, colour());
		const ys = sill + (k + 1) * step;
		field.lying('z', -SMITHY_HALF_X, ys, 0, logR, 2 * SMITHY_HALF_Z + 0.7, colour());
		field.lying('z', SMITHY_HALF_X, ys, 0, logR, 2 * SMITHY_HALF_Z + 0.7, colour());
	}

	// Front posts and the lintel they carry.
	for (const px of [-SMITHY_HALF_X, SMITHY_HALF_X]) {
		field.upright(px, sill, SMITHY_HALF_Z, 0.28, wallTop - sill, tintColor(random, '#5c3f24', 0.03), 10);
	}
	field.lying('x', 0, wallTop + 0.1, SMITHY_HALF_Z, 0.3, 2 * SMITHY_HALF_X + 0.7, tintColor(random, '#5c3f24', 0.03));

	// Gable roof: hexagon shingles tiled across each slope.
	const shingleR = 0.42;
	const cosT = 1 / Math.hypot(1, pitch);
	for (const sign of [1, -1]) {
		const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(sign * Math.atan(pitch), 0, 0));
		let row = 0;
		for (let z = 0.28; z < eaveZ + 0.2; z += 1.5 * shingleR * cosT, row++) {
			const offset = row % 2 ? (SQRT3 / 2) * shingleR : 0;
			for (let x = -SMITHY_HALF_X - 0.35 + offset; x <= SMITHY_HALF_X + 0.36; x += SQRT3 * shingleR) {
				field.compose(
					[x, ridgeY - pitch * z, sign * z],
					tilt,
					[shingleR, 0.09, shingleR],
					tintColor(random, pick(['#5c5148', '#665a4f', '#544a42']), 0.05),
				);
			}
		}
	}
	field.lying('x', 0, ridgeY + 0.1, 0, 0.34, 2 * SMITHY_HALF_X + 1.0, tintColor(random, '#4f3620', 0.02));

	// The forge itself, at the back wall, and its chimney going up past the roof.
	const forgeZ = -SMITHY_HALF_Z + 0.55;
	field.upright(-0.75, 0, forgeZ, 0.62, 0.8, tintColor(random, pick(stone), 0.05), 12);
	for (let k = 0; k < 9; k++) {
		field.upright(-0.75, 0.8 + k * 0.5, forgeZ, 0.42, 0.5, tintColor(random, pick(stone), 0.06), k % 2 ? 14 : 0);
	}
	field.upright(-0.75, 0.8 + 9 * 0.5, forgeZ, 0.52, 0.22, tintColor(random, '#5c5c58', 0.03));

	// A rack of stock and a barrel, to make it look worked in.
	field.lying('z', 1.35, 0.55, -0.2, 0.075, 1.6, tintColor(random, '#6b5334', 0.03));
	field.lying('z', 1.52, 0.55, 0.1, 0.075, 1.3, tintColor(random, '#6b5334', 0.03));
	field.upright(1.3, 0, 1.0, 0.34, 0.62, tintColor(random, '#6b4a2c', 0.04), 8);

	smithyMesh = field.build(groundMaterial());
	smithyMesh.position.set(SMITHY.x, tileAt(worldToAxial(SMITHY.x, SMITHY.z).q, worldToAxial(SMITHY.x, SMITHY.z).r).top, SMITHY.z);
	smithyMesh.rotation.y = SMITHY.yaw;
	scene.add(smithyMesh);

	// The coals, and the light they throw.
	const emberMat = new THREE.MeshBasicMaterial({ color: 0xff8a3c });
	const embers = new THREE.Mesh(hexGeometry(), emberMat);
	embers.scale.set(0.44, 0.06, 0.44);
	embers.position.set(-0.75, 0.83, forgeZ);
	smithyMesh.add(embers);

	const glow = new THREE.PointLight(0xff7a30, 1.5, 5.2, 2);
	glow.position.set(-0.75, 1.1, forgeZ);
	smithyMesh.add(glow);

	// From the default camera the chimney sits behind the ridge, but the smoke
	// clears the roofline from any angle — it is what tells you at a glance
	// that the forge is lit.
	addSmoke(smithyMesh, -0.75, 0.8 + 9 * 0.5 + 0.22, forgeZ, 8, 3.6);

	blockFootprint(SMITHY.x, SMITHY.z, SMITHY.yaw, SMITHY_HALF_X, SMITHY_HALF_Z, 0.5);
}

buildSmithy();

/* ------------------------------------------------------------- log house -- */

// The log house, from ../shared/cabin.js — the same construction lab 01 uses.
// It stands across the yard from the smithy, on the open flat ground in front
// of the anvil, turned to face back towards the forge.
const CABIN = { x: 0.2, z: 6.8, yaw: Math.atan2(0 - 0.2, 0 - 6.8) };
const CABIN_HALF_X = 2.2;
const CABIN_HALF_Z = 1.6;

let cabinMesh = null;

function buildCabin() {
	const field = new HexField();
	const built = Hexdelve.cabin.build(field, {
		random,
		halfX: CABIN_HALF_X,
		halfZ: CABIN_HALF_Z,
		logR: 0.24,
		courses: 5,
		base: 0.2,
		// Wooden shakes rather than lab 01's sod: at this distance a green roof
		// reads as more grass instead of as a building.
		palette: { roof: ['#7a5a3a', '#6d5134', '#84643f'] },
		woodpile: true,
	});

	cabinMesh = field.build(groundMaterial());
	const home = worldToAxial(CABIN.x, CABIN.z);
	cabinMesh.position.set(CABIN.x, tileAt(home.q, home.r).top, CABIN.z);
	cabinMesh.rotation.y = CABIN.yaw;
	scene.add(cabinMesh);

	addSmoke(cabinMesh, built.chimney.x, built.chimney.y, built.chimney.z, 7, 3.2);
	blockFootprint(CABIN.x, CABIN.z, CABIN.yaw, CABIN_HALF_X, CABIN_HALF_Z, 0.55);
}

buildCabin();

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
	const hits = raycaster.intersectObjects([groundMesh, smithyMesh, cabinMesh]);
	for (const hit of hits) {
		if (hit.object !== groundMesh) return null;
		const meta = groundMesh.userData.meta[hit.instanceId];
		if (meta) return meta;
	}
	return null;
}

const drag = { active: false, pan: false, moved: 0, x: 0, y: 0 };

canvas.addEventListener('pointerdown', (e) => {
	drag.active = true;
	drag.pan = e.button === 2 || e.shiftKey;
	drag.moved = 0;
	drag.x = e.clientX;
	drag.y = e.clientY;
	canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
	if (!drag.active) {
		const cell = pickCell(e.clientX, e.clientY);
		if (cell) {
			hover.visible = true;
			hover.position.set(cell.x, cell.top + 0.015, cell.z);
			hover.material.color.set(isAnvil(cell) ? 0xffb27a : 0xffffff);
		} else {
			hover.visible = false;
		}
		return;
	}
	const dx = e.clientX - drag.x;
	const dy = e.clientY - drag.y;
	drag.moved += Math.abs(dx) + Math.abs(dy);
	drag.x = e.clientX;
	drag.y = e.clientY;
	if (drag.moved > 5) canvas.classList.add('dragging');
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

canvas.addEventListener('pointerup', (e) => {
	const wasDrag = drag.moved > 5;
	drag.active = false;
	canvas.classList.remove('dragging');
	if (wasDrag || drag.pan) return;

	const cell = pickCell(e.clientX, e.clientY);
	if (!cell) return;
	// A second click while he is already on his way is the "and hurry up"
	// signal — no double-click timer, so the first click never has to wait.
	const now = performance.now() / 1000;
	const quick = now - control.lastClickAt < 0.45;
	control.lastClickAt = now;
	goTo(cell, quick || control.state === 'moving');
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
	animateSmoke(elapsed);

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
