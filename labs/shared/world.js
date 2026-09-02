/*
 * labs/shared/world.js — the yard: terrain, anvil, smithy, log house, smoke.
 *
 * Labs 06, 07 and 08 are three different things happening in one place, and
 * the place was being rebuilt line for line in each of them. It is scenery, not
 * subject matter: what those labs are actually about is navigation, a second
 * character, and an enemy — so the yard moves here and they get on with it.
 *
 * What comes back is everything a lab needs to reason about the ground:
 *
 *   tileAt / groundAt   the hex grid and its height, for pathing and footfall
 *   passable            walkable, with the climb limit as the caller's business
 *                       — a bat clears a step a man cannot
 *   blocked             tiles a building stands on, and anything a lab adds
 *   anvil               the one prop with a position other code cares about
 *   animateSmoke        the chimneys, which are the only thing here that moves
 *
 * Nothing in it knows what a character is.
 */

var Hexdelve = Hexdelve || {};

Hexdelve.world = (function () {
'use strict';

const { HexField, groundMaterial, hexGeometry, tintColor, SQRT3, Q_AXIS_X } = Hexdelve.hex;
const { axialToWorld, worldToAxial, keyOf } = Hexdelve.hexgrid;

const PI = Math.PI;
const TAU = PI * 2;

/**
 * Build the yard into `scene`.
 *
 * @param {THREE.Scene} scene
 * @param {object} options
 *   random        the lab's seeded generator, so a lab's scenery is its own
 *   groundRadius  hexes from the centre
 *   baseY         top of the lowest terrace
 *   stepH         height of one terrace
 */
function build(scene, options) {
	const o = options || {};
	const random = o.random;
	const pick = function (list) { return list[Math.floor(random() * list.length)]; };
	const GROUND_RADIUS = o.groundRadius === undefined ? 8 : o.groundRadius;
	const BASE_Y = o.baseY === undefined ? 0.16 : o.baseY;
	const STEP_H = o.stepH === undefined ? 0.19 : o.stepH;

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

	/*
	 * A tile is walkable if it exists, is not the anvil's or a building's, and
	 * the step from where you came is climbable.
	 *
	 * How big a step counts as climbable is the caller's business, not the
	 * ground's: it is the difference between a man, who must walk up a terrace,
	 * and a bat, which beats its wings and clears two. So `maxClimb` comes in
	 * with the question and the same terrain answers both.
	 */
	function passable(cell, from, maxClimb) {
		const limit = maxClimb === undefined ? 1 : maxClimb;
		const tile = tileAt(cell.q, cell.r);
		if (!tile || isAnvil(cell)) return false;
		if (blocked.has(keyOf(cell.q, cell.r))) return false;
		if (!from) return true;
		const prev = tileAt(from.q, from.r);
		return !prev || Math.abs(tile.level - prev.level) <= limit;
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

	return {
		GROUND_RADIUS: GROUND_RADIUS,
		BASE_Y: BASE_Y,
		STEP_H: STEP_H,
		tiles: tiles,
		tileAt: tileAt,
		groundAt: groundAt,
		levelAt: levelAt,
		groundMesh: groundMesh,
		smithyMesh: smithyMesh,
		cabinMesh: cabinMesh,
		buildings: [smithyMesh, cabinMesh],
		blocked: blocked,
		blockFootprint: blockFootprint,
		passable: passable,
		isAnvil: isAnvil,
		anvil: { cell: ANVIL_CELL, pos: ANVIL_POS, faceY: ANVIL_FACE_Y },
		smithy: SMITHY,
		cabin: CABIN,
		animateSmoke: animateSmoke,
	};
}

return { build: build };
})();
