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

const { HexField, groundMaterial, hexGeometry, makeRandom, tintColor, SQRT3, Q_AXIS_X } = Hexdelve.hex;
const { axialToWorld, worldToAxial, distance: hexDistance, neighbours, findPath, keyOf } = Hexdelve.hexgrid;
const { SKELETON, BONES, TIPS, HIPS_Y } = Hexdelve.skeleton;
const { buildRig, buildSkeletonView, applySparsePose } = Hexdelve.rigview;
const { buildBlacksmith } = Hexdelve.blacksmith;
const { buildWanderer } = Hexdelve.wanderer;
const { buildHelmet, GROUND_LIFT } = Hexdelve.helmet;
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
const pick = (list) => list[Math.floor(random() * list.length)];

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

/* --------------------------------------------------------------- terrain -- */

const ANVIL_CELL = { q: 0, r: 0 };
const tiles = new Map(); // key → { q, r, level, top, x, z }
const blocked = new Set(); // tiles a building or the smith stands on

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

// A tile is walkable if it exists, is not the anvil's or a building's, and the
// step from where you came is climbable.
function passable(cell, from) {
	const tile = tileAt(cell.q, cell.r);
	if (!tile || isAnvil(cell)) return false;
	if (blocked.has(keyOf(cell.q, cell.r))) return false;
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

const SMITHY = { x: -4.1, z: -3.5, yaw: Math.atan2(0 - -4.1, 0 - -3.5) };
const SMITHY_HALF_X = 1.95;
const SMITHY_HALF_Z = 1.5;

let smithyMesh = null;
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
	const home = worldToAxial(SMITHY.x, SMITHY.z);
	smithyMesh.position.set(SMITHY.x, tileAt(home.q, home.r).top, SMITHY.z);
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

	addSmoke(smithyMesh, -0.75, 0.8 + 9 * 0.5 + 0.22, forgeZ, 8, 3.6);

	blockFootprint(SMITHY.x, SMITHY.z, SMITHY.yaw, SMITHY_HALF_X, SMITHY_HALF_Z, 0.5);
}

buildSmithy();

/* ------------------------------------------------------------- log house -- */

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
	groundMesh, smithyMesh, cabinMesh,
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
		if (hit.object !== groundMesh) return null;
		const meta = groundMesh.userData.meta[hit.instanceId];
		if (meta) return { cell: meta, kind: isAnvil(meta) ? 'anvil' : 'tile' };
	}
	return null;
}

/*
 * One set of pointer handlers for mouse and touch alike. A phone has no right
 * button and no wheel, so the second finger stands in for both: two pointers
 * down means pinch to zoom and drag to pan, which is what the mouse gets from
 * the wheel and the right button.
 */
const drag = { active: false, pan: false, moved: 0, x: 0, y: 0, touch: false };
const pointers = new Map();
const pinch = { active: false, distance: 0, x: 0, y: 0 };

function pinchState() {
	const [a, b] = [...pointers.values()];
	return {
		distance: Math.hypot(a.x - b.x, a.y - b.y),
		x: (a.x + b.x) / 2,
		y: (a.y + b.y) / 2,
	};
}

// Pan the camera target by a screen-space delta, in metres of world.
function panView(dx, dy) {
	ui.follow.checked = false;
	const scale = (2 * VIEW) / (window.innerHeight * view.zoom);
	const fwd = new THREE.Vector3(-Math.cos(view.azimuth), 0, -Math.sin(view.azimuth));
	const right = new THREE.Vector3(-Math.sin(view.azimuth), 0, Math.cos(view.azimuth));
	view.target.addScaledVector(right, -dx * scale);
	view.target.addScaledVector(fwd, (dy * scale) / Math.sin(ISO_PITCH));
}

function setZoom(z) {
	view.zoomGoal = Math.max(0.6, Math.min(4, z));
}

canvas.addEventListener('pointerdown', (e) => {
	pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
	canvas.setPointerCapture(e.pointerId);

	if (pointers.size === 2) {
		// The second finger cancels whatever the first was doing: a pinch is
		// never also a tap, and it must not leave a click queued behind it.
		const p = pinchState();
		pinch.active = true;
		pinch.distance = p.distance;
		pinch.x = p.x;
		pinch.y = p.y;
		drag.active = false;
		drag.moved = 999;
		canvas.classList.remove('dragging');
		return;
	}
	if (pointers.size > 2) return;

	drag.active = true;
	drag.touch = e.pointerType !== 'mouse';
	drag.pan = e.button === 2 || e.shiftKey;
	drag.moved = 0;
	drag.x = e.clientX;
	drag.y = e.clientY;
});

canvas.addEventListener('pointermove', (e) => {
	if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

	if (pinch.active && pointers.size >= 2) {
		const p = pinchState();
		if (pinch.distance > 0) setZoom(view.zoomGoal * (p.distance / pinch.distance));
		view.zoom = view.zoomGoal;
		panView(p.x - pinch.x, p.y - pinch.y);
		pinch.distance = p.distance;
		pinch.x = p.x;
		pinch.y = p.y;
		applyCamera();
		return;
	}

	if (!drag.active) {
		// Hover is a mouse idea; a finger only "hovers" while it is pressed.
		if (e.pointerType !== 'mouse') return;
		const pick = pickCell(e.clientX, e.clientY);
		if (pick) {
			hover.visible = true;
			hover.position.set(pick.cell.x, pick.cell.top + 0.015, pick.cell.z);
			hover.material.color.set(
				pick.kind === 'anvil' ? 0xffb27a : pick.kind === 'helmet' ? 0x9fc4e0 : 0xffffff,
			);
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
	// A finger never lands as still as a mouse, so it gets more room to be a tap.
	if (drag.moved > (drag.touch ? 12 : 5)) canvas.classList.add('dragging');
	if (drag.pan) panView(dx, dy);
	else view.azimuth += dx * 0.007;
	applyCamera();
});

function endPointer(e) {
	pointers.delete(e.pointerId);
	if (pointers.size < 2) pinch.active = false;
}

canvas.addEventListener('pointercancel', (e) => {
	endPointer(e);
	drag.active = false;
	canvas.classList.remove('dragging');
});

canvas.addEventListener('pointerup', (e) => {
	const wasDrag = drag.moved > (drag.touch ? 12 : 5);
	const wasActive = drag.active;
	endPointer(e);
	drag.active = false;
	canvas.classList.remove('dragging');
	if (!wasActive || wasDrag || drag.pan) return;

	const pick = pickCell(e.clientX, e.clientY);
	// A tap leaves no cursor behind, so the hover marker goes with the finger.
	if (drag.touch) hover.visible = false;
	if (!pick) return;
	// A second click while he is already on his way is the "and hurry up"
	// signal — no double-click timer, so the first click never has to wait.
	const now = performance.now() / 1000;
	const quick = now - control.lastClickAt < 0.45;
	control.lastClickAt = now;
	goTo(pick.cell, quick || control.state === 'moving', pick.kind);
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener(
	'wheel',
	(e) => {
		e.preventDefault();
		setZoom(view.zoomGoal * Math.exp(-e.deltaY * 0.0012));
	},
	{ passive: false },
);

/* -------------------------------------------------------------------- ui -- */

const ui = {
	panel: document.getElementById('panel'),
	panelToggle: document.getElementById('panelToggle'),
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

// The panel starts as its own title bar: on a phone the notes would otherwise
// cover the scene they are about. `?panel=1` opens it on load.
function setPanelOpen(open) {
	ui.panel.classList.toggle('collapsed', !open);
	ui.panelToggle.setAttribute('aria-expanded', String(open));
}
ui.panelToggle.addEventListener('click', () => {
	setPanelOpen(ui.panel.classList.contains('collapsed'));
});

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
	animateSmoke(elapsed);
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
	/*
	 * A portrait phone sees a much narrower slice of the world than a desktop
	 * window: the orthographic frustum is sized from the height, so the width
	 * falls away with the aspect ratio and the default zoom would put two
	 * hexagons on screen. Start further out, so the first thing you see is a
	 * scene rather than a pair of tiles.
	 */
	const aspect = window.innerWidth / window.innerHeight;
	if (aspect < 1.2) {
		view.zoom = view.zoomGoal = Math.max(0.7, 1.35 * (aspect / 1.2));
	}

	const qs = new URLSearchParams(location.search);
	if (qs.has('ik')) ui.ik.checked = qs.get('ik') !== '0';
	if (qs.has('skel')) ui.showSkel.checked = qs.get('skel') !== '0';
	if (qs.has('path')) ui.showPath.checked = qs.get('path') !== '0';
	if (qs.has('zoom')) view.zoom = view.zoomGoal = +qs.get('zoom');
	if (qs.has('follow')) ui.follow.checked = qs.get('follow') !== '0';
	if (qs.has('panel')) setPanelOpen(qs.get('panel') !== '0');
	applyVisibility();
}

window.lab = {
	control, player, smith, actors, work, helmet, stoop, tiles, tileAt, goTo, pickCell, tree,
	SPEED_TABLE, CRUISE, ANVIL_CELL, ANVIL_POS, ANVIL_FACE_Y, smithStats,
	groundAt, STRIKE_STANCE, blocked, SMITHY, CABIN, view, passable,
};

resize();
requestAnimationFrame(frame);
