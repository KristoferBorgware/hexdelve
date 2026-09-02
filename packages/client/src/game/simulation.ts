/*
 * The yard, running.
 *
 * Owns the world, the two actors, the three props and the readouts drawn on
 * the ground, and turns one frame's input into one frame's instances. It knows
 * nothing about a canvas, a renderer or a browser event — the client hands it
 * a description of what the player is asking for, and it hands back prisms.
 *
 * That split is what lets the editor drive it: the editor's viewport and an
 * embedder's canvas run this same object through this same interface.
 */

import {
	buildSkeletonView,
	HEX_FLAG_UNLIT,
	HexInstances,
	type InstanceRanges,
} from '@hexdelve/engine';
import {
	axialToWorld,
	makeRandom,
	rgbFromHex,
	worldToAxial,
	type Axial,
	type Random,
} from '@hexdelve/shared';

import { buildBat } from '../models/bat.js';
import {
	buildHelmet,
	buildShield,
	buildSword,
	HELMET_GROUND_LIFT,
	SHIELD_GROUND_LIFT,
	SHIELD_GROUND_TILT,
	SWORD_GROUND_LIFT,
	SWORD_GROUND_TILT,
} from '../models/props.js';
import { buildWanderer } from '../models/wanderer.js';
import { buildWorld, type World } from '../scene/world.js';
import { clamp, wrapAngle } from './actor.js';
import { BAT_SKELETON, BAT_TIPS } from './batrig.js';
import { BatHunt, KEEP_APART, WAKE_RANGE } from './bathunt.js';
import { Item } from './items.js';
import { Player, type PlayerStats, type Wish } from './player.js';
import { HIPS_Y, SKELETON, TIPS } from './skeleton.js';
import { strideVelocity } from './stride.js';

const PI = Math.PI;
const TAU = PI * 2;

/** What the client observed this frame, in terms the game understands. */
export interface FrameInput {
	forward: number;
	back: number;
	left: number;
	right: number;
	run: boolean;
	/** Where the cursor is on the ground, or null if it is off the canvas. */
	aim: { x: number; z: number } | null;
	/** A touch thumbstick, in world directions. */
	stick: { active: boolean; x: number; z: number; throttle: number } | null;
	/** The camera's azimuth, which is what makes A and D mean screen-left. */
	cameraAzimuth: number;
}

export interface SimulationToggles {
	/** Plant his feet on the terraces. */
	ik: boolean;
	/** The two ground arrows: where he faces against where he is going. */
	vectors: boolean;
	/** The bat's path, its hexagon and its perch. */
	paths: boolean;
	/** A and D on the screen's axes rather than on his hips. */
	screenStrafe: boolean;
	/** Ghost the bodies and show the rigs inside them. */
	skeleton: boolean;
	/** The camera tracks him. */
	follow: boolean;
}

export interface SimulationOptions {
	seed?: number;
	toggles?: Partial<SimulationToggles>;
}

/**
 * A dozen dark flecks thrown off a blow, on the one frame it lands.
 *
 * A fixed pool rather than an allocation per hit: they are the only thing in
 * the scene that comes and goes, and a ring buffer means the count of prisms
 * in a frame never depends on how the fight has been going.
 */
class Motes {
	private readonly items: {
		t: number;
		max: number;
		x: number;
		y: number;
		z: number;
		vx: number;
		vy: number;
		vz: number;
		spin: number;
	}[] = [];
	private next = 0;

	constructor(
		count: number,
		private readonly random: Random,
		private readonly gravity = -5.5,
		private readonly life = 0.5,
		private readonly size = 0.05,
	) {
		for (let i = 0; i < count; i++) {
			this.items.push({ t: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spin: 0 });
		}
	}

	spawn(x: number, y: number, z: number, n: number, spread: number, up: number): void {
		for (let i = 0; i < n; i++) {
			const bit = this.items[this.next]!;
			this.next = (this.next + 1) % this.items.length;
			bit.t = this.life * (0.7 + this.random() * 0.3);
			bit.max = bit.t;
			bit.x = x;
			bit.y = y;
			bit.z = z;
			const a = this.random() * TAU;
			const r = spread * (0.3 + this.random());
			bit.vx = Math.cos(a) * r;
			bit.vz = Math.sin(a) * r;
			bit.vy = up * (0.5 + this.random());
			bit.spin = (this.random() - 0.5) * 14;
		}
	}

	update(dt: number): void {
		for (const bit of this.items) {
			if (bit.t <= 0) continue;
			bit.t -= dt;
			if (bit.t <= 0) continue;
			bit.vy += this.gravity * dt;
			bit.x += bit.vx * dt;
			bit.y += bit.vy * dt;
			bit.z += bit.vz * dt;
		}
	}

	emit(out: HexInstances, time: number): void {
		for (const bit of this.items) {
			if (bit.t <= 0) continue;
			const u = bit.t / bit.max;
			const s = this.size * (0.4 + 0.6 * u);
			out.pushRadial(bit.x, bit.y, bit.z, s, s * 0.8, MOTE_COLOR, {
				yaw: bit.spin * time,
				alpha: Math.min(1, u * 1.6) * 0.85,
			});
		}
	}
}

const MOTE_COLOR = rgbFromHex(0x4a3a3c);
const AIM_COLOR = rgbFromHex(0xffffff);
const FACING_COLOR = rgbFromHex(0xf4f7f2);
const TRAVEL_COLOR = rgbFromHex(0x5f9b3e);
const BAT_CELL_COLOR = rgbFromHex(0xd2603a);
const PERCH_COLOR = rgbFromHex(0x8d6bb0);
const BAT_PATH_COLOR = rgbFromHex(0xb0553f);

/** Everything the readout shows, in one shape the editor can render. */
export interface YardStats extends PlayerStats {
	batMessage: string;
	batSpeed: number;
	batRange: number;
	bites: number;
	batMissed: number;
	wakeRange: number;
	reach: number;
}

export class Simulation {
	readonly world: World;
	readonly player: Player;
	readonly bat: BatHunt;
	readonly items: Item[];
	readonly toggles: SimulationToggles;

	/** Where the camera should be looking, when it is following. */
	readonly focus = { x: 0, y: 0, z: 0 };

	private readonly motes: Motes;
	private readonly perch: Axial;
	private elapsed = 0;

	private readonly opaque = new HexInstances(4096);
	private readonly blended = new HexInstances(512);
	private readonly overlay = new HexInstances(64);
	private readonly frame = new HexInstances(8192);

	/** What a full run is worth, measured off the pose rather than typed in. */
	readonly runSpeed: number;

	constructor(options: SimulationOptions = {}) {
		const random = makeRandom(options.seed ?? 37);
		this.world = buildWorld({ random, groundRadius: 8, baseY: 0.16, stepH: 0.19 });
		this.motes = new Motes(14, random);

		this.toggles = {
			ik: true,
			vectors: true,
			paths: true,
			screenStrafe: true,
			skeleton: false,
			follow: true,
			...options.toggles,
		};

		/*
		 * It sleeps out in the open east of the anvil, far enough from where he
		 * starts that he can collect the gear before it hears him — but not
		 * much further.
		 */
		this.perch = worldToAxial(3.9, 1.2);
		const perchTile = this.world.tileAt(this.perch.q, this.perch.r)!;

		this.items = [
			new Item({
				label: 'helmet',
				bone: 'head',
				model: buildHelmet(),
				lift: HELMET_GROUND_LIFT,
				tilt: 0,
			}),
			new Item({
				label: 'sword',
				bone: 'handR',
				model: buildSword(),
				lift: SWORD_GROUND_LIFT,
				tilt: SWORD_GROUND_TILT,
			}),
			new Item({
				label: 'shield',
				bone: 'forearmL',
				model: buildShield(),
				lift: SHIELD_GROUND_LIFT,
				tilt: SHIELD_GROUND_TILT,
			}),
		];

		// Spread across his way in, and not in a line: collecting all three
		// should be a walk that turns.
		const spots: [Item, number, number, number][] = [
			[this.items[0]!, -2.4, -3.1, -0.7],
			[this.items[1]!, 1.9, -3.4, 1.1],
			[this.items[2]!, -3.4, 0.4, 2.3],
		];
		for (const [item, x, z, yaw] of spots) {
			const cell = worldToAxial(x, z);
			const tile = this.world.tileAt(cell.q, cell.r)!;
			item.ground(tile.x + 0.3, tile.z + 0.2, yaw, tile.top);
		}

		// Deliberately under a sprint: it should run you down while you dawdle
		// and lose you while you run, so the range numbers mean something.
		this.runSpeed = strideVelocity({ x: 0, z: 1 }, 1, 1).z;

		this.player = new Player(
			{
				skeleton: SKELETON,
				model: buildWanderer(),
				skeletonView: buildSkeletonView(SKELETON, TIPS),
				x: 0,
				z: -5.4,
				y: this.world.groundAt(0, -5.4),
				yaw: 0,
			},
			{
				world: this.world,
				batCell: () => this.bat.cell,
				batPosition: () => ({ x: this.bat.x, y: this.bat.bodyY, z: this.bat.z }),
				onHit: (x, y, z) => {
					this.motes.spawn(x, y, z, 9, 1.6, 1.9);
					this.bat.reel();
				},
				items: this.items,
			},
		);

		this.bat = new BatHunt(
			{
				skeleton: BAT_SKELETON,
				model: buildBat(),
				skeletonView: buildSkeletonView(BAT_SKELETON, BAT_TIPS),
				x: perchTile.x,
				z: perchTile.z,
				y: perchTile.top,
				yaw: 2.4,
			},
			{
				world: this.world,
				playerCell: () => worldToAxial(this.player.x, this.player.z),
				playerPosition: () => ({ x: this.player.x, z: this.player.z }),
				onBite: (x, y, z) => this.motes.spawn(x, y, z, 7, 1.3, 1.6),
				speed: this.runSpeed * 0.72,
				perch: this.perch,
			},
		);

		this.focus.x = this.player.x;
		this.focus.z = this.player.z;
		this.focus.y = this.player.y + HIPS_Y + 0.1;
	}

	/** Begin a cut. */
	strike(): void {
		this.player.strike();
	}

	/**
	 * What the keys mean, which turns out not to be one question.
	 *
	 * W and S are his: forward is wherever the mouse has him pointing, so they
	 * read straight off as a heading in his own frame. A and D are the
	 * screen's: left means left on your monitor, whatever he happens to be
	 * facing, because that is what a hand expects of a key that never turns. So
	 * the camera's left axis is brought into his frame and added there, and the
	 * two halves of the stick are read in two different frames on purpose.
	 *
	 * It has one consequence worth knowing rather than hiding: point him along
	 * the screen's own left-right axis and W and A are then pulling on the same
	 * line in opposite directions, so holding both stands him still. That is
	 * what mixing frames costs, and turning screen strafe off puts A and D back
	 * on his hips, where W is forward, A is his left, and nothing can cancel.
	 *
	 * A thumb has neither problem: the stick gives a direction in the world and
	 * he faces down it, so travel and facing are the same line again.
	 */
	private wishFrom(input: FrameInput): Wish {
		if (input.stick?.active && input.stick.throttle > 0) {
			return {
				x: 0,
				z: 1,
				throttle: input.stick.throttle,
				run: input.stick.throttle > 0.92,
				lookAt: { x: this.player.x + input.stick.x, z: this.player.z + input.stick.z },
			};
		}

		const strafe = input.left - input.right;
		let x = 0;
		let z = input.forward - input.back;

		if (strafe && this.toggles.screenStrafe) {
			// Screen-left as a direction in the world, and then in his own
			// frame. The camera's own X axis is (sin, -cos) of the azimuth —
			// worth checking by projecting it rather than deriving it, which is
			// how this got written backwards the first time.
			const lx = -Math.sin(input.cameraAzimuth);
			const lz = Math.cos(input.cameraAzimuth);
			const sy = Math.sin(this.player.yaw);
			const cy = Math.cos(this.player.yaw);
			x += strafe * (lx * cy - lz * sy);
			z += strafe * (lx * sy + lz * cy);
		} else {
			x += strafe;
		}

		const lookAt = input.aim ? { x: input.aim.x, z: input.aim.z } : null;
		const len = Math.hypot(x, z);
		if (len < 1e-6) return { x: 0, z: 0, throttle: 0, run: false, lookAt };
		return { x: x / len, z: z / len, throttle: 1, run: input.run, lookAt };
	}

	update(dt: number, input: FrameInput): void {
		this.elapsed += dt;

		this.motes.update(dt);
		this.player.update(dt, this.elapsed, this.wishFrom(input));

		/*
		 * Nobody stands inside anybody. Of the two it is the man who gives way,
		 * because he is the one moving freely — the bat is locked to its
		 * hexagon and shoving it out of the way would be shoving it off the
		 * grid.
		 */
		{
			const dx = this.player.x - this.bat.x;
			const dz = this.player.z - this.bat.z;
			const d = Math.hypot(dx, dz);
			if (d < KEEP_APART && d > 1e-4) {
				this.player.x = this.bat.x + (dx / d) * KEEP_APART;
				this.player.z = this.bat.z + (dz / d) * KEEP_APART;
			}
		}

		if (this.toggles.ik) this.player.applyFootIK();
		this.player.solve();

		this.bat.update(dt, this.elapsed);
		this.bat.solve();

		if (this.toggles.follow) {
			const pull = Math.min(1, dt * 2.4);
			this.focus.x += (this.player.x - this.focus.x) * pull;
			this.focus.z += (this.player.z - this.focus.z) * pull;
			this.focus.y += (this.player.y + HIPS_Y + 0.1 - this.focus.y) * pull;
		}
	}

	/**
	 * Build this frame's instances.
	 *
	 * Three lists, concatenated in pass order, so the renderer gets one buffer
	 * and three spans. The static half of the world is a single array copy —
	 * the terrain and the buildings never change, and rebuilding four thousand
	 * prisms a frame to draw the same picture would be the most expensive thing
	 * here by a wide margin.
	 */
	build(aim: { x: number; z: number } | null): { data: Float32Array; ranges: InstanceRanges } {
		const { opaque, blended, overlay } = this;
		opaque.clear();
		blended.clear();
		overlay.clear();

		opaque.pushAll(this.world.statics);

		const ghost = this.toggles.skeleton;
		this.player.emit(opaque, blended, ghost);
		this.bat.emit(opaque, blended, ghost);

		for (const item of this.items) {
			item.emit(
				ghost ? blended : opaque,
				this.player.world,
				this.player.x,
				this.player.y,
				this.player.z,
				this.player.yaw,
				ghost ? 0.34 : 1,
			);
		}

		this.world.emitSmoke(blended, this.elapsed);
		this.motes.emit(blended, this.elapsed);
		this.emitMarkers(blended, overlay, aim);

		const frame = this.frame;
		frame.clear();
		frame.pushAll(opaque);
		frame.pushAll(blended);
		frame.pushAll(overlay);

		return {
			data: frame.data,
			ranges: { opaque: opaque.count, blended: blended.count, overlay: overlay.count },
		};
	}

	private emitMarkers(
		blended: HexInstances,
		overlay: HexInstances,
		aim: { x: number; z: number } | null,
	): void {
		// The hexagon the bat is standing on. It is as solid as a wall as far
		// as he is concerned, so it is worth being able to see.
		const cell = this.bat.cell;
		const tile = this.world.tileAt(cell.q, cell.r);
		if (tile) {
			blended.pushRadial(tile.x, tile.top + 0.03, tile.z, 0.93, 0.02, BAT_CELL_COLOR, {
				alpha: 0.34,
				flags: HEX_FLAG_UNLIT,
			});
		}

		if (this.toggles.paths) {
			if (this.bat.state === 'asleep') {
				const perchTile = this.world.tileAt(this.perch.q, this.perch.r);
				if (perchTile) {
					blended.pushRadial(perchTile.x, perchTile.top + 0.015, perchTile.z, 0.75, 0.02, PERCH_COLOR, {
						alpha: 0.3,
						flags: HEX_FLAG_UNLIT,
					});
				}
			}
			const path = this.bat.path;
			if (path) {
				for (let i = 0; i < path.length && i < 24; i++) {
					const step = this.world.tileAt(path[i]!.q, path[i]!.r);
					if (!step) continue;
					blended.pushRadial(step.x, step.top + 0.02, step.z, 0.19, 0.02, BAT_PATH_COLOR, {
						alpha: 0.75,
						flags: HEX_FLAG_UNLIT,
					});
				}
			}
		}

		if (aim) {
			blended.pushRadial(aim.x, this.world.groundAt(aim.x, aim.z) + 0.02, aim.z, 0.34, 0.02, AIM_COLOR, {
				alpha: 0.4,
				flags: HEX_FLAG_UNLIT,
			});
		}

		/*
		 * The two vectors, drawn on the ground where they can be compared:
		 * white is where he is facing, green is where he is going. In every lab
		 * before this one they were the same arrow.
		 */
		if (this.toggles.vectors) {
			const y = this.player.y + 0.03;
			arrow(overlay, this.player.x, y, this.player.z, this.player.yaw, 1.5, FACING_COLOR);
			if (this.player.amp > 0.05) {
				arrow(
					overlay,
					this.player.x,
					y + 0.01,
					this.player.z,
					this.player.yaw + this.player.heading,
					0.8 + this.player.speed * 0.5,
					TRAVEL_COLOR,
				);
			}
		}
	}

	get stats(): YardStats {
		const cell = worldToAxial(this.player.x, this.player.z);
		const tile = this.world.tileAt(cell.q, cell.r);
		return {
			speed: this.player.speed,
			slip: this.player.slip,
			amp: this.player.amp,
			gait: this.player.gait,
			heading: wrapAngle(this.player.heading),
			pelvisDrop: this.player.pelvisDrop,
			state: this.player.control.state,
			message: this.player.control.message,
			cuts: this.player.swing.cuts,
			hits: this.player.swing.hits,
			carrying: this.items.filter((i) => i.worn).map((i) => i.label),
			cell,
			terrace: tile?.level ?? null,
			batMessage: this.bat.message,
			batSpeed: this.bat.speed,
			batRange: this.bat.tilesToPlayer(),
			bites: this.bat.bites,
			batMissed: this.bat.missed,
			wakeRange: WAKE_RANGE,
			reach: this.player.armed ? this.player.stepLength : 0,
		};
	}
}

/**
 * An arrow on the ground, as three prisms: a shaft and a two-part head.
 *
 * Drawn in the overlay pass, which does not test depth — it is a readout, not
 * a thing in the yard, and a terrace half a metre away would otherwise bury it.
 */
function arrow(
	out: HexInstances,
	x: number,
	y: number,
	z: number,
	bearing: number,
	length: number,
	color: ReturnType<typeof rgbFromHex>,
): void {
	const sin = Math.sin(bearing);
	const cos = Math.cos(bearing);
	const shaft = Math.max(0.001, length - 0.26);

	const at = (forward: number, width: number, depth: number): void => {
		out.push(x + sin * forward, y, z + cos * forward, width, 0.02, depth, color, {
			yaw: bearing,
			alpha: 0.7,
			flags: HEX_FLAG_UNLIT,
		});
	};

	at(shaft / 2, 0.042, shaft / 2);
	at(shaft + 0.09, 0.12, 0.13);
	at(shaft + 0.19, 0.05, 0.07);
}

export { clamp, axialToWorld };
