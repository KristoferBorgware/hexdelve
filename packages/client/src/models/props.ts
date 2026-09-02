/*
 * Things lying about that a character can pick up.
 *
 * A prop has no bones. It is one model, and the whole of "equipping" it is
 * which transform it is drawn through: its own, or a bone's. So each of these
 * is modelled around the origin of the bone it belongs to — the helmet around
 * the head, the sword around the fist, the shield around the forearm — and
 * worn, its transform is the identity. There is no second model for the held
 * version and no offsets to keep in step, and once it is on, every clip
 * carries it for free.
 *
 * On the ground it is the same model under a different transform: lifted so it
 * rests on the grass rather than floating where a head would have been, and
 * tilted, because a sword lies flat and a helmet stands up.
 */

import { Model } from '@hexdelve/engine';

const PI = Math.PI;

/* ----------------------------------------------------------------- helmet -- */

export const HELMET_PALETTE = {
	steel: 0x4a5058,
	steelDark: 0x3a4046,
	steelLight: 0x5d646d,
	rim: 0x727a84,
	liner: 0x2a2e33,
};

/** How far to lift the model so the helmet stands on the ground. */
export const HELMET_GROUND_LIFT = 0.2;

/*
 * Everything here is laid out against the head it has to fit, which in the
 * head bone's space is a prism of radius 0.18 by 0.165 running from y -0.095
 * to 0.135, with the brows at y 0.055, the nose reaching z 0.197 and the beard
 * hanging to y -0.165. So the shell stops at y 0.08 — the brow line of that
 * face, not of an imagined one — and the eye slits sit where the eyes actually
 * are. Get this wrong and the helmet is a bucket with a nose sticking out.
 */
export function buildHelmet(): Model {
	const model = new Model();
	const C = HELMET_PALETTE;
	const at = (
		pos: [number, number, number],
		scale: [number, number, number],
		color: number,
		euler?: [number, number, number],
	): void => {
		model.add('head', pos, scale, color, euler ? { euler } : {});
	};

	// The skull: three courses, each turned and tipped further back than the
	// one below, which is what sweeps the crown back over the neck. Fewer,
	// larger pieces read as one helmet; a tall stack of thin rings reads as a
	// cake.
	const SKULL: [number, number, number, number, number, number, number, number][] = [
		[0.155, 0, 0.207, 0.195, 0.155, 0, 0, C.steel],
		[0.245, -0.03, 0.15, 0.145, 0.105, 15, -0.18, C.steelLight],
		[0.293, -0.078, 0.078, 0.083, 0.1, -10, -0.45, C.steelLight],
	];
	for (const [y, z, rx, rz, h, yawDeg, tilt, color] of SKULL) {
		at([0, y, z], [rx, h, rz], color, [tilt, (yawDeg * PI) / 180, 0]);
	}

	/*
	 * Below the brow. The back and sides are one collar pulled backwards, so
	 * its front vertex stops short of the face; a post carries the brow down
	 * outside each eye; the nose guard comes down the centre line. What is left
	 * between post, nose guard and brow is the eye slit — not cut out of
	 * anything, just the space no piece fills.
	 */
	at([0, 0.068, 0.135], [0.168, 0.05, 0.062], C.steel, [0.1, 0, 0]);
	at([0, -0.01, -0.05], [0.201, 0.19, 0.14], C.steel);
	at([0, 0.0, 0.178], [0.038, 0.16, 0.052], C.steelLight, [0.05, 0, 0]);
	at([0, -0.1, 0.168], [0.045, 0.05, 0.04], C.rim, [0.2, 0, 0]);
	for (const side of [1, -1]) {
		at([side * 0.152, 0.02, 0.105], [0.055, 0.13, 0.08], C.steel, [0, (side * -12 * PI) / 180, 0]);
	}

	/*
	 * Cheek plates: prisms laid on their side so each is a flat plate, hanging
	 * from the collar past the jaw and flared at the bottom. They stand as far
	 * forward as the shell does, because the face behind them has a beard that
	 * reaches almost that far and would otherwise come through the steel.
	 */
	for (const side of [1, -1]) {
		at([side * 0.108, -0.075, 0.172], [0.085, 0.046, 0.115], C.steel, [PI / 2 + 0.05, 0, side * 0.12]);
		at([side * 0.183, -0.07, -0.005], [0.075, 0.045, 0.085], C.steelDark, [0, 0, side * (PI / 2 + 0.08)]);
	}
	at([0, -0.035, -0.185], [0.176, 0.05, 0.09], C.steel, [PI / 2 + 0.22, 0, 0]);
	at([0, -0.105, -0.205], [0.14, 0.045, 0.065], C.steelDark, [PI / 2 + 0.42, 0, 0]);

	/*
	 * Two dark blocks well inside the shell: one behind the eye slits, one down
	 * where the jaw would be. From outside they are invisible; through the
	 * slits and the mouth they are what makes the helmet read as hollow rather
	 * than as a window straight through it.
	 */
	at([0, 0.07, -0.005], [0.172, 0.22, 0.158], C.liner);
	at([0, -0.09, 0.0], [0.15, 0.16, 0.135], C.liner);

	return model;
}

/* ------------------------------------------------------------------ sword -- */

export const SWORD_PALETTE = {
	steel: 0xb9bec7,
	edge: 0xd9dee5,
	fuller: 0x9aa1ab,
	guard: 0x8a6a3a,
	guardDark: 0x6d5129,
	grip: 0x46301f,
	wrap: 0x5a4029,
};

export const SWORD_GROUND_LIFT = 0.04;
export const SWORD_GROUND_TILT = PI / 2;

/*
 * The blade is built straight down its own axis and the whole thing is then
 * tipped out of the wrist by LEAN, so the numbers below read as "how far down
 * the blade" rather than as a pile of rotated offsets. It also means the point
 * can be derived rather than guessed: TIP is where the tip actually ends up in
 * the hand bone's space, and the reach is measured from that.
 */
const LEAN = -0.22;
const BLADE_END = -0.92;
export const SWORD_TIP: readonly [number, number, number] = [
	0,
	BLADE_END * Math.cos(LEAN),
	BLADE_END * Math.sin(LEAN),
];

export function buildSword(): Model {
	const model = new Model();
	const C = SWORD_PALETTE;

	// Everything hangs off the leaning axis rather than off the hand directly,
	// so a position below is a distance down the blade.
	const lean = (
		pos: [number, number, number],
		scale: [number, number, number],
		color: number,
		euler: [number, number, number] = [0, 0, 0],
	): void => {
		const c = Math.cos(LEAN);
		const s = Math.sin(LEAN);
		model.add(
			'handR',
			[pos[0], pos[1] * c - pos[2] * s, pos[1] * s + pos[2] * c],
			scale,
			color,
			{ euler: [euler[0] + LEAN, euler[1], euler[2]] },
		);
	};

	// Grip in the fist, its wrapping, and the pommel above it.
	lean([0, 0.04, 0], [0.032, 0.05, 0.032], C.guardDark);
	lean([0, -0.03, 0], [0.026, 0.15, 0.026], C.grip);
	lean([0, -0.06, 0], [0.03, 0.02, 0.03], C.wrap);
	lean([0, -0.005, 0], [0.03, 0.02, 0.03], C.wrap);

	// Cross guard: a bar lying along the character's X, which is most of what
	// makes the silhouette a sword rather than a stick.
	lean([0, -0.12, 0], [0.028, 0.2, 0.028], C.guard, [0, 0, PI / 2]);
	lean([0, -0.12, 0], [0.045, 0.05, 0.045], C.guard);

	/*
	 * Blade: flat in Z, so the edges are at +-X, which is where the two bright
	 * strips go. The fuller is a groove down the middle of the flat and has to
	 * stay inside the blade's thickness — proud of it, it turns the whole sword
	 * into a pale plank from any angle.
	 */
	lean([0, -0.44, 0], [0.046, 0.6, 0.021], C.steel);
	lean([0, -0.44, 0], [0.016, 0.6, 0.023], C.fuller);
	lean([0.04, -0.44, 0], [0.009, 0.6, 0.013], C.edge);
	lean([-0.04, -0.44, 0], [0.009, 0.6, 0.013], C.edge);
	lean([0, -0.79, 0], [0.03, 0.13, 0.017], C.steel);
	lean([0, -0.87, 0], [0.013, 0.06, 0.009], C.steel);

	return model;
}

/* ----------------------------------------------------------------- shield -- */

export const SHIELD_PALETTE = {
	face: 0x7d5a34,
	facePale: 0x8f6a3f,
	rim: 0x6b6f78,
	rimDark: 0x54585f,
	boss: 0x9aa0a9,
	strap: 0x43301f,
	stud: 0x8a8f98,
};

export const SHIELD_GROUND_LIFT = 0.05;
export const SHIELD_GROUND_TILT = PI / 2;
const SHIELD_RADIUS = 0.26;

/*
 * How the shield sits on the arm, which is the one thing about it that is easy
 * to get subtly, embarrassingly wrong.
 *
 * The boss and the studs are on the plate's +Y; the straps are on its -Y. The
 * mount turns that +Y into FACE (a normal in the bone's space), and then the
 * plate has to be offset along that same direction — because the arm goes
 * through the straps, so the arm is on the BACK of the shield and the shield
 * hangs on the far side of it.
 *
 * Get the offset and the facing pointing opposite ways and the geometry is
 * inside-out: the forearm lies across the boss with the straps waving at the
 * enemy. It renders as a shield right up until you look at it.
 */
export function buildShield(): Model {
	const model = new Model();
	const C = SHIELD_PALETTE;

	const MOUNT = -PI / 2;
	const FACE: [number, number, number] = [0, Math.cos(MOUNT), Math.sin(MOUNT)];
	const OUT = 0.08; // how far the plate stands off the arm

	const origin: [number, number, number] = [0.02, -0.11 + FACE[1] * OUT, FACE[2] * OUT];
	const cos = Math.cos(MOUNT);
	const sin = Math.sin(MOUNT);

	// Parts are authored in the plate's own frame and rotated onto the arm here,
	// so the numbers below read as "on the face of the shield".
	const plate = (
		pos: [number, number, number],
		scale: [number, number, number],
		color: number,
		euler: [number, number, number] = [0, 0, 0],
	): void => {
		model.add(
			'forearmL',
			[
				origin[0] + pos[0],
				origin[1] + pos[1] * cos - pos[2] * sin,
				origin[2] + pos[1] * sin + pos[2] * cos,
			],
			scale,
			color,
			{ euler: [euler[0] + MOUNT, euler[1], euler[2]] },
		);
	};

	/*
	 * Boards, banded rim, boss. Everything meant to read as a border sits
	 * BEHIND the face and wider than it — a plate in front of the face at
	 * nearly the same radius simply hides it, which is how this shield spent
	 * its first render as a grey dinner plate.
	 */
	plate([0, -0.014, 0], [SHIELD_RADIUS * 1.07, 0.032, SHIELD_RADIUS * 1.07], C.rimDark, [0, PI / 6, 0]);
	plate([0, 0, 0], [SHIELD_RADIUS, 0.045, SHIELD_RADIUS], C.face);
	plate([0, 0.026, 0], [SHIELD_RADIUS * 0.66, 0.012, SHIELD_RADIUS * 0.66], C.facePale);
	plate([0, 0.042, 0], [0.075, 0.045, 0.075], C.boss);
	plate([0, 0.066, 0], [0.035, 0.03, 0.035], C.boss);

	// Studs round the rim, one to each face of the hexagon.
	for (let i = 0; i < 6; i++) {
		const a = (i * PI) / 3 + PI / 6;
		plate(
			[Math.cos(a) * SHIELD_RADIUS * 0.86, 0.03, Math.sin(a) * SHIELD_RADIUS * 0.86],
			[0.022, 0.02, 0.022],
			C.stud,
		);
	}

	// The straps the arm goes through, on the back.
	plate([0, -0.04, -0.1], [0.03, 0.03, 0.11], C.strap, [PI / 2, 0, 0]);
	plate([0, -0.04, 0.1], [0.03, 0.03, 0.11], C.strap, [PI / 2, 0, 0]);

	return model;
}
