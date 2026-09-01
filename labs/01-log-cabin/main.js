/*
 * Hexdelve — Lab 01: a log cabin built entirely from hexagonal prisms.
 *
 * The world is a flat plane of hexagon tiles (pointy-top axial grid).
 * Unlike chamfer, hexagons here are free of the Goldberg polyhedron: they can
 * be any size and any orientation. The cabin uses that freedom —
 *   walls    : horizontal hex prisms ("logs") with interlocked corner ends
 *   door     : one big hexagon, flat edge down
 *   windows  : hexagon glass in a hexagon frame
 *   roof     : flat hexagon shingles tiled over two slope planes
 *   chimney  : stacked vertical hex blocks, hex smoke puffs
 * One shared geometry (a unit hex prism), one instanced mesh, per-instance
 * matrix + colour.
 *
 * The cabin itself now comes from ../shared/cabin.js, which lab 06 also
 * builds from — this lab is where that construction was worked out.
 */

'use strict';

const { HexField, groundMaterial, hexGeometry, makeRandom, tintColor, SQRT3 } = Hexdelve.hex;

const PI = Math.PI;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GROUND_RADIUS = 11; // hex rings of ground tiles
const TILE = 1; // hex size (centre → corner) of a ground tile

const LOG_R = 0.42; // wall log cross-section radius
const CABIN_LEN = 7.4; // along x (ridge direction)
const CABIN_DEP = 5.2; // along z
const WALL_COURSES = 5;
const FOUNDATION_H = 0.45;
const LOG_OVER = 0.75; // how far log ends protrude past the corner

const HX = CABIN_LEN / 2;
const HZ = CABIN_DEP / 2;

const DOOR_X = -0.9; // door centre on the front wall
const DOOR_HALF_W = 1.05;
const DOOR_H = 2.7;

const random = makeRandom(7);
const pick = (list) => list[Math.floor(random() * list.length)];
const tint = (hex, spread) => tintColor(random, hex, spread === undefined ? 0.05 : spread);

// ---------------------------------------------------------------------------
// Renderer, scene, camera, lights
// ---------------------------------------------------------------------------

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();

const VIEW = 12.5; // half-height of the ortho frustum at zoom 1
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
const ISO_PITCH = Math.atan(1 / Math.SQRT2); // classic isometric ~35.26°
const CAM_DIST = 60;

const view = {
	azimuth: (62 * PI) / 180,
	target: new THREE.Vector3(0, 2.4, 0),
	zoom: 1,
	zoomGoal: 1,
};

function applyCamera() {
	const el = ISO_PITCH;
	camera.position.set(
		view.target.x + CAM_DIST * Math.cos(view.azimuth) * Math.cos(el),
		view.target.y + CAM_DIST * Math.sin(el),
		view.target.z + CAM_DIST * Math.sin(view.azimuth) * Math.cos(el),
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

const hemi = new THREE.HemisphereLight(0xcfe0ee, 0x6a5a44, 0.62);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff1dc, 0.95);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -18;
sun.shadow.camera.right = 18;
sun.shadow.camera.top = 18;
sun.shadow.camera.bottom = -18;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 90;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun);
scene.add(sun.target);

function placeSun(azimuthDeg) {
	const a = (azimuthDeg * PI) / 180;
	const el = (48 * PI) / 180;
	sun.position.set(30 * Math.cos(a) * Math.cos(el), 30 * Math.sin(el), 30 * Math.sin(a) * Math.cos(el));
}
placeSun(140);

// ---------------------------------------------------------------------------
// Everything static goes into one field, baked to a single instanced mesh
// ---------------------------------------------------------------------------

const field = new HexField();

const PAL = {
	grass: ['#79a256', '#71994f', '#82aa5e', '#6d944c'],
	path: ['#a3a8a3', '#98a09b', '#adb0a8'],
	stone: ['#8d8d86', '#94948c', '#858680'],
	logs: ['#8a5a34', '#7d5230', '#956441', '#734b2b'],
	sod: ['#5c7a3c', '#54763a', '#647f41'],
	spruce: ['#3f5f38', '#476b3e', '#385633'],
	flower: ['#e8788a', '#e8d06a', '#f0f0e8', '#c77ddb'],
};

// Pointy-top axial grid: neighbours sqrt(3)·TILE apart in x, rows 1.5·TILE in z.
function axialToWorld(q, r) {
	return { x: SQRT3 * TILE * (q + r / 2), z: 1.5 * TILE * r };
}

function hexDist(q, r) {
	return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
}

const groundTiles = []; // kept for scattering flowers later

function onFoundation(x, z) {
	return Math.abs(x) <= HX + 0.9 && Math.abs(z) <= HZ + 0.8;
}

function onPath(x, z) {
	if (z < HZ + 0.7 || z > 9.6) return false;
	const curve = DOOR_X + (z - HZ) * 0.15 * Math.sin((z - HZ) * 0.5);
	return Math.abs(x - curve) < 1.2;
}

function buildGround() {
	// Earth slab: one giant flat hexagon under everything.
	field.upright(0, -0.85, 0, SQRT3 * TILE * GROUND_RADIUS + 1.6, 0.86, new THREE.Color('#4a3b2c'), 90);

	for (let q = -GROUND_RADIUS; q <= GROUND_RADIUS; q++) {
		for (let r = -GROUND_RADIUS; r <= GROUND_RADIUS; r++) {
			if (hexDist(q, r) > GROUND_RADIUS) continue;
			const { x, z } = axialToWorld(q, r);
			if (onFoundation(x, z)) {
				field.upright(x, 0, z, 0.985 * TILE, FOUNDATION_H, tint(pick(PAL.stone), 0.04));
			} else if (onPath(x, z)) {
				field.upright(x, 0, z, 0.985 * TILE, 0.2, tint(pick(PAL.path), 0.04));
			} else {
				field.upright(x, 0, z, 0.985 * TILE, 0.16, tint(pick(PAL.grass), 0.06));
				groundTiles.push({ x, z });
			}
		}
	}
}

// ---------------------------------------------------------------------------
// The cabin — the shared construction, at this lab's proportions
// ---------------------------------------------------------------------------

const cabin = Hexdelve.cabin.build(field, {
	random,
	halfX: HX,
	halfZ: HZ,
	logR: LOG_R,
	courses: WALL_COURSES,
	base: FOUNDATION_H,
	over: LOG_OVER,
	pitch: 0.9,
	eaveOver: 0.9,
	shingleR: 0.5,
	shingleT: 0.09,
	footing: false, // it already stands on a stone foundation
	pane: false, // this lab gives the windows real translucent glass
	door: { x: DOOR_X, half: DOOR_HALF_W, height: DOOR_H },
	windows: [
		{ x: 2.35, y: 2.35, axis: 'z' },
		{ x: HX, y: 2.35, z: 1.0, axis: 'x' },
	],
	chimney: { x: HX + 0.62, z: -0.9, r: 0.52, h: 0.62, clear: 0.9 },
	palette: { roof: PAL.sod, wood: PAL.logs, stone: PAL.stone },
});

// Glass panes and their bars, as their own meshes so they can be translucent.
const glassMeshes = [];

function addGlass(w) {
	const glass = new THREE.Mesh(
		hexGeometry(),
		new THREE.MeshPhongMaterial({
			color: 0xaacbdd,
			emissive: 0x223844,
			flatShading: true,
			shininess: 90,
			specular: 0x99aabb,
			transparent: true,
			opacity: 0.92,
		}),
	);
	glass.position.set(w.x, w.y, w.z);
	glass.quaternion.copy(w.quat);
	glass.scale.set(w.r * 0.76, 0.7, w.r * 0.76);
	glass.castShadow = true;
	scene.add(glass);
	glassMeshes.push(glass);

	// Cross bars over the glass.
	if (w.axis === 'z') {
		field.lying('x', w.x, w.y, w.z + 0.12, 0.045, w.r * 2.7, '#4a2f18');
		field.upright(w.x, w.y - 0.55, w.z + 0.12, 0.045, 1.1, '#4a2f18');
	} else {
		field.lying('z', w.x + 0.12, w.y, w.z, 0.045, w.r * 2.7, '#4a2f18');
		field.upright(w.x + 0.12, w.y - 0.55, w.z, 0.045, 1.1, '#4a2f18');
	}
}

// ---------------------------------------------------------------------------
// Chimney smoke
// ---------------------------------------------------------------------------

const puffs = [];

function buildSmoke() {
	for (let i = 0; i < 7; i++) {
		const mat = new THREE.MeshLambertMaterial({
			color: 0xe9e9e6,
			transparent: true,
			opacity: 0,
			depthWrite: false,
		});
		const puff = new THREE.Mesh(hexGeometry(), mat);
		scene.add(puff);
		puffs.push({ mesh: puff, phase: i / 7, wobble: random() * PI * 2 });
	}
}

function animateSmoke(t) {
	const RISE = 3.4;
	const PERIOD = 7;
	const top = cabin.chimney;
	for (const p of puffs) {
		const u = (((t / PERIOD + p.phase) % 1) + 1) % 1;
		const y = top.y + 0.15 + u * RISE;
		const drift = 0.35 * u * Math.sin(p.wobble + u * 5);
		p.mesh.position.set(top.x + drift, y, top.z + 0.3 * u * Math.cos(p.wobble + u * 4));
		const s = 0.16 + u * 0.5;
		p.mesh.scale.set(s, s * 0.75, s);
		p.mesh.rotation.y = p.wobble + u * 2.2;
		p.mesh.material.opacity = 0.42 * Math.sin(PI * Math.min(u * 1.6, 1));
	}
}

// ---------------------------------------------------------------------------
// Scenery — stoop, spruces, log pile, rocks, flowers
// ---------------------------------------------------------------------------

function spruce(x, z, s) {
	const yaw = random() * 60;
	field.upright(x, 0.16, z, 0.26 * s, 1.1 * s, tint('#6b4a2c', 0.03), yaw);
	for (const tier of [
		{ r: 1.5, h: 0.62, y: 0.95 },
		{ r: 1.15, h: 0.58, y: 1.62 },
		{ r: 0.8, h: 0.54, y: 2.26 },
		{ r: 0.45, h: 0.5, y: 2.86 },
	]) {
		field.upright(x, tier.y * s, z, tier.r * s, tier.h * s, tint(pick(PAL.spruce), 0.05), yaw + random() * 30);
	}
	field.upright(x, 3.34 * s, z, 0.18 * s, 0.42 * s, tint(pick(PAL.spruce), 0.05), yaw);
}

function logPile(x, z) {
	const r = 0.3;
	const len = 2.2;
	const cy = 0.16 + (SQRT3 / 2) * r;
	field.lying('x', x, cy, z - 0.55, r, len, tint(pick(PAL.logs)));
	field.lying('x', x + 0.1, cy, z + 0.08, r, len * 0.92, tint(pick(PAL.logs)));
	field.lying('x', x - 0.05, cy + SQRT3 * r, z - 0.25, r, len * 0.85, tint(pick(PAL.logs)));
}

function buildScenery() {
	// Stoop: two flat stone hexes as steps down from the door.
	field.upright(DOOR_X, 0.16, HZ + 1.35, 0.85, 0.26, tint(pick(PAL.stone), 0.03));
	field.upright(DOOR_X + 0.5, 0.16, HZ + 2.6, 0.62, 0.14, tint(pick(PAL.path), 0.03));

	spruce(-6.6, 1.8, 1.15);
	spruce(-4.8, -5.6, 0.9);
	spruce(7.6, 6.2, 1.0);
	spruce(3.2, -7.2, 1.25);
	spruce(8.8, -3.0, 0.8);

	logPile(-3.6, HZ + 1.7);

	field.upright(5.6, 0.16, 7.4, 0.55, 0.34, tint(pick(PAL.stone)), random() * 60);
	field.upright(-7.8, 0.16, -3.2, 0.42, 0.26, tint(pick(PAL.stone)), random() * 60);
	field.upright(-8.6, 0.16, 5.4, 0.6, 0.4, tint(pick(PAL.stone)), random() * 60);

	// Flowers and grass tufts on random grass tiles.
	for (const tile of groundTiles) {
		const roll = random();
		const dx = (random() - 0.5) * 0.9;
		const dz = (random() - 0.5) * 0.9;
		if (roll < 0.055) {
			field.upright(tile.x + dx, 0.16, tile.z + dz, 0.11, 0.1 + random() * 0.1, tint(pick(PAL.flower), 0.06), random() * 60);
		} else if (roll < 0.12) {
			field.upright(tile.x + dx, 0.16, tile.z + dz, 0.09, 0.22 + random() * 0.14, tint('#5c8040', 0.06), random() * 60);
		}
	}
}

// ---------------------------------------------------------------------------
// Build everything, bake into one InstancedMesh
// ---------------------------------------------------------------------------

buildGround();
for (const w of cabin.windows) addGlass(w);
buildSmoke();
buildScenery();

const instanced = field.build(groundMaterial());
scene.add(instanced);

document.getElementById('count').textContent = (field.count + glassMeshes.length + puffs.length).toLocaleString('en');

// ---------------------------------------------------------------------------
// Controls: drag to orbit, wheel to zoom, right-drag to pan, optional spin
// ---------------------------------------------------------------------------

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
		// Move the target in the ground plane, relative to the camera.
		const scale = (2 * VIEW) / (window.innerHeight * view.zoom);
		const fwd = new THREE.Vector3(-Math.cos(view.azimuth), 0, -Math.sin(view.azimuth));
		const right = new THREE.Vector3(-Math.sin(view.azimuth), 0, Math.cos(view.azimuth));
		view.target.addScaledVector(right, -dx * scale);
		view.target.addScaledVector(fwd, (dy * scale) / Math.sin(ISO_PITCH));
		const lim = SQRT3 * TILE * GROUND_RADIUS;
		view.target.x = Math.max(-lim, Math.min(lim, view.target.x));
		view.target.z = Math.max(-lim, Math.min(lim, view.target.z));
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
		view.zoomGoal = Math.max(0.5, Math.min(3.2, view.zoomGoal * Math.exp(-e.deltaY * 0.0012)));
	},
	{ passive: false },
);

document.getElementById('sun').addEventListener('input', (e) => placeSun(+e.target.value));
const spinBox = document.getElementById('spin');

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

let last = performance.now();

function frame(now) {
	const dt = Math.min((now - last) / 1000, 0.1);
	last = now;

	if (spinBox.checked && !drag.active) {
		view.azimuth += dt * 0.18;
		applyCamera();
	}
	if (Math.abs(view.zoom - view.zoomGoal) > 1e-4) {
		view.zoom += (view.zoomGoal - view.zoom) * Math.min(1, dt * 10);
		applyCamera();
	}

	animateSmoke(now / 1000);
	renderer.render(scene, camera);
	requestAnimationFrame(frame);
}

resize();
requestAnimationFrame(frame);
