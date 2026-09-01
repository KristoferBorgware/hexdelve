/*
 * labs/shared/cabin.js — a log cabin, as hexagonal prisms.
 *
 * Presentation side: it emits prisms, so it deals in colours and quaternions.
 * But it does not touch the scene — it draws into any object offering
 * `upright`, `lying` and `compose`, which is what HexField provides. That
 * keeps it placeable: build into a field, bake the field to one InstancedMesh,
 * and move or rotate that mesh to put the cabin anywhere.
 *
 * Everything is authored in the cabin's own space: origin at the centre of the
 * floor, front wall towards +Z, ground at y = 0.
 *
 * The construction is the one from lab 01. Logs lie flat-side down so courses
 * stack; the side walls sit half a course higher than the front and back so
 * the ends interlock at the corners; the front wall splits around the doorway
 * until the courses clear the lintel; the gables are closed with ever-shorter
 * logs; and the roof is hexagons tiled across two slope planes.
 *
 * Returns the measurements a caller needs to dress it further — where the
 * chimney ends up for smoke, where the windows are for glass.
 */

var Hexdelve = Hexdelve || {};

Hexdelve.cabin = (function () {
'use strict';

const { Q_AXIS_X, Q_AXIS_Z, tintColor, SQRT3 } = Hexdelve.hex;

const PALETTE = {
	wood: ['#8a5a34', '#7d5230', '#956441', '#734b2b'],
	stone: ['#8d8d86', '#94948c', '#858680'],
	roof: ['#5c7a3c', '#54763a', '#647f41'], // sod; pass shakes for a browner one
	trim: '#4a2f18',
	door: '#5a3a20',
	knob: '#d8b25a',
	pane: '#9dc0d4',
	ridge: '#4f3620',
	rafter: '#5c3f24',
};

function build(field, opts) {
	const o = opts || {};
	const random = o.random || Math.random;
	const pick = (list) => list[Math.floor(random() * list.length)];
	const pal = Object.assign({}, PALETTE, o.palette);
	const shade = (colour, spread) => tintColor(random, colour, spread === undefined ? 0.04 : spread);

	const halfX = o.halfX === undefined ? 2.2 : o.halfX;
	const halfZ = o.halfZ === undefined ? 1.6 : o.halfZ;
	const logR = o.logR === undefined ? 0.24 : o.logR;
	const courses = o.courses === undefined ? 5 : o.courses;
	const base = o.base === undefined ? 0 : o.base; // top of any foundation
	const over = o.over === undefined ? 0.5 : o.over; // log ends past the corner
	const pitch = o.pitch === undefined ? 0.62 : o.pitch;
	const eaveOver = o.eaveOver === undefined ? 0.55 : o.eaveOver;
	const shingleR = o.shingleR === undefined ? 0.4 : o.shingleR;
	const shingleT = o.shingleT === undefined ? 0.08 : o.shingleT;

	const step = SQRT3 * logR; // flat-to-flat, so courses sit on each other
	const wallTop = base + courses * step;
	const eaveZ = halfZ + eaveOver;
	// The roof plane meets the top of the wall at the wall line, so the eave
	// overhangs below it — which is what an overhang is for.
	const ridgeY = wallTop + (o.rise === undefined ? 0.28 : o.rise) + pitch * halfZ;

	const door = Object.assign({ x: -0.55, half: 0.46, height: 1.85 }, o.door);
	const doorTop = base + door.height;

	/* ------------------------------------------------------------ footing -- */

	if (o.footing !== false) {
		const r = logR * 1.08;
		field.lying('x', 0, base - r * 0.5, -halfZ, r, 2 * halfX + 0.7, shade(pick(pal.stone)));
		field.lying('x', 0, base - r * 0.5, halfZ, r, 2 * halfX + 0.7, shade(pick(pal.stone)));
		field.lying('z', -halfX, base - r * 0.5, 0, r, 2 * halfZ + 0.7, shade(pick(pal.stone)));
		field.lying('z', halfX, base - r * 0.5, 0, r, 2 * halfZ + 0.7, shade(pick(pal.stone)));
	}

	/* -------------------------------------------------------------- walls -- */

	const xLen = 2 * halfX + 2 * over;
	const zLen = 2 * halfZ + 2 * over;

	for (let k = 0; k < courses; k++) {
		const y = base + (k + 0.5) * step;
		const colour = () => shade(pal.wood[k % pal.wood.length]);

		field.lying('x', 0, y, -halfZ, logR, xLen, colour());

		if (o.door === null) {
			field.lying('x', 0, y, halfZ, logR, xLen, colour());
		} else if (y - logR < doorTop) {
			// This course crosses the doorway, so it arrives as two logs.
			const leftEnd = -halfX - over;
			const rightEnd = halfX + over;
			const gapL = door.x - door.half - 0.12;
			const gapR = door.x + door.half + 0.12;
			field.lying('x', (leftEnd + gapL) / 2, y, halfZ, logR, gapL - leftEnd, colour());
			field.lying('x', (gapR + rightEnd) / 2, y, halfZ, logR, rightEnd - gapR, colour());
		} else {
			field.lying('x', 0, y, halfZ, logR, xLen, colour());
		}

		// Half a course up: this offset is what makes the corners interlock.
		const ys = base + (k + 1) * step;
		field.lying('z', -halfX, ys, 0, logR, zLen, shade(pal.wood[(k + 2) % pal.wood.length]));
		field.lying('z', halfX, ys, 0, logR, zLen, shade(pal.wood[(k + 2) % pal.wood.length]));
	}

	/* --------------------------------------------------------------- door -- */

	if (o.door !== null) {
		const postR = logR * 0.55;
		for (const px of [door.x - door.half - postR, door.x + door.half + postR]) {
			field.upright(px, base, halfZ - 0.05, postR, door.height + 0.16, shade(pal.trim, 0.02));
		}
		field.lying('x', door.x, doorTop + postR * 1.6, halfZ - 0.05, postR * 1.15, 2 * door.half + 4 * postR, shade(pal.trim, 0.02));
		// The door itself: one hexagon with a flat edge down, stretched taller
		// than wide. An affine hexagon is still a hexagon.
		field.compose(
			[door.x, base + door.height / 2, halfZ + logR * 0.25],
			Q_AXIS_Z,
			[door.half, logR * 1.25, door.height / SQRT3],
			shade(pal.door, 0.03),
		);
		field.compose(
			[door.x + door.half * 0.55, base + door.height * 0.48, halfZ + logR * 0.8],
			Q_AXIS_Z,
			[door.half * 0.13, logR * 0.4, door.half * 0.13],
			pal.knob,
		);
	}

	/* ------------------------------------------------------------ windows -- */

	const windows = [];
	const windowSpecs = o.windows === undefined
		? [
			{ x: halfX * 0.52, y: base + 1.35, axis: 'z' },
			{ x: halfX, y: base + 1.35, z: halfZ * 0.22, axis: 'x' },
		]
		: o.windows;

	for (const spec of windowSpecs) {
		const axis = spec.axis || 'z';
		const r = spec.r === undefined ? 0.42 : spec.r;
		const quat = axis === 'z' ? Q_AXIS_Z : Q_AXIS_X;
		const x = axis === 'z' ? spec.x : (spec.x === undefined ? halfX : spec.x);
		const z = axis === 'z' ? (spec.z === undefined ? halfZ : spec.z) : spec.z || 0;
		const proud = logR * 0.3;
		const px = axis === 'x' ? x + proud : x;
		const pz = axis === 'z' ? z + proud : z;
		field.compose([px, spec.y, pz], quat, [r, logR * 1.1, r], shade(pal.trim, 0.02));
		const glassAt = [axis === 'x' ? px + proud : px, spec.y, axis === 'z' ? pz + proud : pz];
		if (o.pane !== false) {
			field.compose(glassAt, quat, [r * 0.72, logR * 0.6, r * 0.72], pal.pane);
		}
		windows.push({ x: glassAt[0], y: glassAt[1], z: glassAt[2], axis, r, quat });
	}

	/* ------------------------------------------------------------- gables -- */

	for (let j = 0; ; j++) {
		const cy = base + (courses + j + 1) * step;
		if (cy + logR > ridgeY + 0.1) break;
		const half = Math.max((ridgeY - (cy + logR * 0.8)) / pitch + 0.3, 0.6);
		for (const gx of [-halfX, halfX]) {
			field.lying('z', gx, cy, 0, logR, half * 2, shade(pal.wood[(j + 1) % pal.wood.length]));
		}
	}

	/* --------------------------------------------------------------- roof -- */

	// The ridge runs along X, so each slope is a single rotation about X and
	// the shingles tile in the slope plane exactly as they would on flat ground.
	const cosT = 1 / Math.hypot(1, pitch);
	const spanX = halfX + eaveOver * 0.9;
	for (const sign of [1, -1]) {
		const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(sign * Math.atan(pitch), 0, 0));
		let row = 0;
		for (let z = shingleR * 0.65; z < eaveZ + 0.2; z += 1.5 * shingleR * cosT, row++) {
			const offset = row % 2 ? (SQRT3 / 2) * shingleR : 0;
			for (let x = -spanX + offset; x <= spanX + 0.01; x += SQRT3 * shingleR) {
				field.compose([x, ridgeY - pitch * z, sign * z], tilt, [shingleR, shingleT, shingleR], shade(pick(pal.roof), 0.05));
			}
		}
		// Barge rafters down each gable edge, covering the step between the
		// gable logs and the roof plane.
		if (o.rafters !== false) {
			const angle = sign * Math.atan(pitch);
			const rq = new THREE.Quaternion().setFromEuler(new THREE.Euler(angle + Math.PI / 2, 0, 0));
			const slope = eaveZ / cosT;
			for (const ax of [-spanX + shingleR * 0.4, spanX - shingleR * 0.4]) {
				field.compose(
					[ax, ridgeY - pitch * eaveZ * 0.5, (sign * eaveZ) / 2],
					rq,
					[logR * 0.95, slope, logR * 0.95],
					shade(pal.rafter, 0.03),
				);
			}
		}
	}
	field.lying('x', 0, ridgeY + logR * 0.5, 0, logR * 1.35, 2 * halfX + 2 * eaveOver, shade(pal.ridge, 0.02));

	/* ------------------------------------------------------------ chimney -- */

	let chimney = null;
	if (o.chimney !== null) {
		const c = Object.assign({ side: 1, z: -halfZ * 0.4, r: 0.34, h: 0.48, clear: 0.55 }, o.chimney);
		const cx = c.x === undefined ? c.side * (halfX + c.r * 1.25) : c.x;
		const top = ridgeY + c.clear;
		const count = Math.max(1, Math.ceil((top - base) / c.h));
		for (let k = 0; k < count; k++) {
			field.upright(cx, base + k * c.h, c.z, c.r, c.h, shade(pick(pal.stone), 0.06), k % 2 ? 12 : 0);
		}
		const capY = base + count * c.h;
		field.upright(cx, capY, c.z, c.r * 1.22, c.h * 0.45, shade('#5c5c58', 0.03));
		chimney = { x: cx, y: capY + c.h * 0.45, z: c.z };
	}

	/* ----------------------------------------------------------- woodpile -- */

	if (o.woodpile) {
		const r = logR * 0.8;
		const y = base + (SQRT3 / 2) * r;
		const wx = o.woodpile.x === undefined ? -halfX * 0.75 : o.woodpile.x;
		const wz = o.woodpile.z === undefined ? halfZ + 0.85 : o.woodpile.z;
		field.lying('x', wx, y, wz, r, 1.5, shade(pick(pal.wood), 0.05));
		field.lying('x', wx + 0.08, y, wz + 0.35, r, 1.35, shade(pick(pal.wood), 0.05));
		field.lying('x', wx + 0.04, y + SQRT3 * r, wz + 0.16, r, 1.3, shade(pick(pal.wood), 0.05));
	}

	return { halfX, halfZ, base, wallTop, ridgeY, eaveZ, step, chimney, windows, door: { x: door.x, top: doorTop } };
}

return { build, PALETTE };
})();
