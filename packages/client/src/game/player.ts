/*
 * The man, and the thing this lab exists to show.
 *
 * Labs 06-08 moved him by asking the grid: click a hexagon, A* answers with a
 * list of tiles, and he walks down it facing whichever one is next. Here there
 * is no path and nothing to click. The keys give a heading and a throttle, the
 * mouse gives a facing, and the two are not the same number.
 *
 * That last part is everything. Every character before this walked where it
 * was looking, which is why a forward cycle was all any of them needed. Once
 * the mouse owns the facing he has to travel along a line his chest is not
 * pointing down — backing away from something he is watching, or side-stepping
 * round it — and a blend tree of forward clips has nothing to say about that.
 * The answer is in stride.ts.
 */

import {
	attachmentPosition,
	bindClip,
	createPose,
	denseToSparse,
	lerpPose,
	lerpPoseMasked,
	levelBone,
	makeMask,
	samplePose,
	sampleBound,
	solveTwoBone,
	solveWorld,
	sparseToDense,
	type BoundClip,
	type DensePose,
	type SparsePose,
} from '@hexdelve/engine';
import { worldToAxial, type Axial } from '@hexdelve/shared';

import { Actor, clamp, wrapAngle } from './actor.js';
import { DUCK, GUARD, SLASH, SWING_CONTACT } from './clips.js';
import type { Item } from './items.js';
import { BONES, BONE_INDEX, SKELETON, UPPER_BODY } from './skeleton.js';
import { SWORD_TIP } from '../models/props.js';
import { stridePeriod, stridePose, strideVelocity, type Direction } from './stride.js';
import type { World } from '../scene/world.js';

const PI = Math.PI;
const TAU = PI * 2;

const SOLE = 0.12;
/** Terraces he can step up or down in one move. */
export const MAX_CLIMB = 1;

/**
 * How wide he is, for the purpose of not walking into the smithy. Off the grid
 * he is a point with a radius rather than a tile, so the tile test is made
 * half a metre ahead of him instead of underneath him.
 */
const BODY = 0.44;

/**
 * How fast he comes round to the mouse. Fast enough that pointing feels
 * immediate, slow enough that a flick of the wrist is a turn and not a cut.
 */
const TURN_RATE = 11;

/**
 * How fast the legs re-aim, which is a different thing again: the heading is
 * slewed as an angle rather than as a vector, so W to S swings the stride
 * round through a side-step instead of collapsing through zero.
 */
const HEADING_RATE = 14;

/** How close he has to pass a prop to pick it up. */
const PICKUP = 0.72;

/** A body is not a point, so the cut's arc gets a little either side of it. */
const ARC_PAD = 0.35;

/** The stoop, used for picking something up. */
const STOOP = { grab: 0.4, release: 0.56, end: 0.95, hold: 0.85 };

const GUARD_AT_RUN = 0.65;

export interface Wish {
	/** Unit direction of travel in his own frame, or zero. */
	readonly x: number;
	readonly z: number;
	readonly throttle: number;
	readonly run: boolean;
	/** Where he should be looking, in world space, or null to leave it. */
	readonly lookAt: { x: number; z: number } | null;
}

export interface PlayerStats {
	speed: number;
	slip: number;
	amp: number;
	gait: number;
	heading: number;
	pelvisDrop: number;
	state: string;
	message: string;
	cuts: number;
	hits: number;
	carrying: string[];
	cell: Axial;
	terrace: number | null;
}

/**
 * How far he can cut, measured off the clip rather than typed in.
 *
 * The blade is sampled right through the strike, not at the contact key alone,
 * because a cut sweeps: what comes back is how far it reaches and between
 * which two bearings it passes. The follow-through behind his shoulder is
 * thrown away, since a sword finishing its arc back there is not cutting
 * anything he is fighting.
 */
export const REACH = (() => {
	let distance = 0;
	let height = 0;
	let from = Infinity;
	let to = -Infinity;
	for (let t = 0.34; t <= 0.58; t += 0.02) {
		const tip = attachmentPosition(SKELETON, samplePose(SLASH, t) as SparsePose, 'handR', SWORD_TIP);
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

export interface PlayerDeps {
	world: World;
	/** Where the bat is, so he cannot walk into its hexagon. */
	batCell: () => Axial;
	batPosition: () => { x: number; y: number; z: number };
	/** Called on the frame a cut connects. */
	onHit: (x: number, y: number, z: number) => void;
	items: Item[];
}

export class Player extends Actor {
	private readonly deps: PlayerDeps;

	/** His own frame: +z is where he is facing, +x is his left. */
	private readonly travel: Direction & { x: number; z: number } = { x: 0, z: 1 };
	/** The same thing as an angle, which is what gets slewed. */
	heading = 0;
	private theta = 0; // stride phase
	amp = 0; // 0 standing, 1 full stride
	gait = 0; // 0 walking, 1 running
	speed = 0;
	slip = 0;
	private yawRate = 0;
	private bank = 0;

	private readonly strideBuf: SparsePose = {};
	private readonly basePose: DensePose;
	private readonly guardPose: DensePose;
	private readonly stancePose: DensePose;
	private readonly overlayPose: DensePose;
	private readonly playerPose: DensePose;

	private readonly duckClip: BoundClip;
	private readonly slashClip: BoundClip;
	private readonly guardClip: BoundClip;

	/*
	 * The guard masks. The shield arm holds it out whatever his legs are doing,
	 * the sword side eases off as he speeds up so a run gets some counter-swing
	 * back, and the bladed stance at the root is only for a man standing still.
	 */
	private readonly GUARD_SHIELD = makeMask(BONES, { armL: 1, forearmL: 1, handL: 1 }, 0);
	private readonly GUARD_SWORD = makeMask(
		BONES,
		{ armR: 1, forearmR: 1, handR: 1, spine: 0.45, chest: 1, neck: 1, head: 1 },
		0,
	);
	private readonly ROOT_ONLY = makeMask(BONES, { root: 1 }, 0);

	/*
	 * The cut is a whole-body clip — the hips and spine turn first and drag the
	 * arm round after them — and that is fine for a man standing still. Cutting
	 * on the move it has to give the legs back: they are carrying him
	 * somewhere. So the mask it plays through is itself blended, from every
	 * bone when he is standing to the upper body alone when he is not.
	 */
	private readonly SWING_ALL = makeMask(BONES, {}, 1);
	private readonly SWING_UPPER = makeMask(BONES, UPPER_BODY, 0);
	private readonly swingMask = new Float32Array(BONES.length);

	private guardWeight = 0;
	private readonly stoop = { clock: 0, blend: 0, done: false, item: null as Item | null };
	readonly swing = { active: false, clock: 0, blend: 0, hit: false, cuts: 0, hits: 0, missed: 0 };
	readonly control = { state: 'idle' as 'idle' | 'stoop' | 'swinging', message: 'waiting' };

	constructor(options: ConstructorParameters<typeof Actor>[0], deps: PlayerDeps) {
		super(options);
		this.deps = deps;

		this.basePose = createPose(BONES.length);
		this.guardPose = createPose(BONES.length);
		this.stancePose = createPose(BONES.length);
		this.overlayPose = createPose(BONES.length);
		this.playerPose = createPose(BONES.length);

		this.duckClip = bindClip(DUCK, BONE_INDEX);
		this.slashClip = bindClip(SLASH, BONE_INDEX);
		this.guardClip = bindClip(GUARD, BONE_INDEX);
	}

	get armed(): boolean {
		return this.deps.items.some((i) => i.label === 'sword' && i.worn);
	}

	private get shielded(): boolean {
		return this.deps.items.some((i) => i.label === 'shield' && i.worn);
	}

	/** Begin a cut, if he is holding something to cut with and is not busy. */
	strike(): void {
		if (this.control.state !== 'idle' || !this.armed) return;
		this.swing.active = true;
		this.swing.clock = 0;
		this.swing.hit = false;
		this.control.state = 'swinging';
		this.control.message = 'cutting';
	}

	/**
	 * One step, and every reason it might not happen.
	 *
	 * He is a point with a radius now, so what gets tested is a spot in front
	 * of him rather than the tile he is on — and if that spot is a wall he
	 * keeps whichever axis of the move is still free, which is what stops a
	 * wall from being flypaper.
	 */
	private moveBy(dx: number, dz: number): void {
		const from = worldToAxial(this.x, this.z);
		const len = Math.hypot(dx, dz);
		if (len < 1e-6) return;

		const px = (dx / len) * BODY;
		const pz = (dz / len) * BODY;
		if (this.standable(this.x + dx + px, this.z + dz + pz, from)) {
			this.x += dx;
			this.z += dz;
			return;
		}
		if (this.standable(this.x + dx + Math.sign(dx) * BODY, this.z, from)) this.x += dx;
		if (this.standable(this.x, this.z + dz + Math.sign(dz) * BODY, from)) this.z += dz;
	}

	private standable(x: number, z: number, from: Axial): boolean {
		const cell = worldToAxial(x, z);
		const bat = this.deps.batCell();
		if (cell.q === bat.q && cell.r === bat.r) return false;
		return this.deps.world.passable(cell, from, MAX_CLIMB);
	}

	private faceTowards(targetX: number, targetZ: number, dt: number): void {
		const want = Math.atan2(targetX - this.x, targetZ - this.z);
		const diff = wrapAngle(want - this.yaw);
		const turn = clamp(diff * TURN_RATE, -TURN_RATE, TURN_RATE);
		this.yaw += turn * dt;
		this.yawRate = turn;
	}

	private nearestItem(): Item | null {
		let best: Item | null = null;
		let bestGap = PICKUP;
		for (const item of this.deps.items) {
			if (item.worn) continue;
			const gap = Math.hypot(item.x - this.x, item.z - this.z);
			if (gap < bestGap) {
				bestGap = gap;
				best = item;
			}
		}
		return best;
	}

	/**
	 * The moment the blade arrives.
	 *
	 * Everything that decides whether it connects is here: close enough,
	 * inside the arc the clip actually sweeps, and roughly level with the
	 * thing. In lab 08 he was turned to face the bat for the whole approach;
	 * here nothing aims for you, so a cut thrown at where it *was* misses
	 * exactly as it should.
	 */
	private landSwing(): void {
		const bat = this.deps.batPosition();
		const dx = bat.x - this.x;
		const dz = bat.z - this.z;
		const gap = Math.hypot(dx, dz) || 1e-6;
		const off = wrapAngle(Math.atan2(dx, dz) - this.yaw);
		const bladeY = this.y + REACH.height;
		const bodyY = bat.y;

		const inArc = off >= REACH.from - ARC_PAD && off <= REACH.to + ARC_PAD;
		if (gap > REACH.distance + 0.35 || !inArc || Math.abs(bodyY - bladeY) > 1.0) {
			this.swing.missed++;
			return;
		}

		this.swing.hits++;
		this.deps.onHit(bat.x, bodyY, bat.z);
	}

	update(dt: number, elapsed: number, wish: Wish): void {
		const busy = this.control.state === 'stoop';

		/* ----------------------------------------------------- where he looks */
		if (wish.lookAt) {
			this.faceTowards(wish.lookAt.x, wish.lookAt.z, dt);
		} else if (this.control.state === 'stoop' && this.stoop.item) {
			this.faceTowards(this.stoop.item.x, this.stoop.item.z, dt);
		} else {
			this.yawRate = 0;
		}

		/* ------------------------------------------------------ where he goes */
		const throttle = busy ? 0 : wish.throttle;
		if (throttle > 0) {
			const want = Math.atan2(wish.x, wish.z);
			this.heading += clamp(
				wrapAngle(want - this.heading),
				-HEADING_RATE * dt,
				HEADING_RATE * dt,
			);
			this.travel.x = Math.sin(this.heading);
			this.travel.z = Math.cos(this.heading);
		}
		this.amp += (throttle - this.amp) * Math.min(1, dt * 9);
		this.gait += ((wish.run && throttle > 0.5 ? 1 : 0) - this.gait) * Math.min(1, dt * 3.5);

		/*
		 * How fast that is — asked of the pose rather than of a table. Two
		 * solves of a 17-bone rig per frame buys a speed that is right for this
		 * heading at this stride length, so the feet do not slide at any
		 * bearing or any throttle, including the fifth of a second it takes him
		 * to get going.
		 */
		const velocity = strideVelocity(this.travel, this.amp, this.gait);
		this.speed = velocity.x * this.travel.x + velocity.z * this.travel.z;
		this.slip = velocity.x * this.travel.z - velocity.z * this.travel.x;

		if (this.amp > 0.03) {
			this.theta = (this.theta + (TAU / stridePeriod(this.gait)) * dt) % TAU;
		}

		if (this.speed > 1e-4 && this.amp > 0.01) {
			const sin = Math.sin(this.yaw);
			const cos = Math.cos(this.yaw);
			// His heading, out into the world.
			const wx = this.travel.z * sin + this.travel.x * cos;
			const wz = this.travel.z * cos - this.travel.x * sin;
			this.moveBy(wx * this.speed * dt, wz * this.speed * dt);
		}

		const under = this.deps.world.groundAt(this.x, this.z);
		this.y += (under - this.y) * Math.min(1, dt * 7);

		/* --------------------------------------------------------- what he does */
		if (this.control.state === 'idle') {
			const item = this.nearestItem();
			if (item) {
				this.stoop.clock = 0;
				this.stoop.done = false;
				this.stoop.item = item;
				this.control.state = 'stoop';
				this.control.message = `picking up the ${item.label}`;
			} else {
				this.control.message =
					this.amp > 0.05
						? this.gait > 0.5
							? 'running'
							: 'walking'
						: this.armed
							? 'armed'
							: 'waiting';
			}
		} else if (this.control.state === 'stoop') {
			this.stoop.clock += dt;
			if (!this.stoop.done && this.stoop.clock >= STOOP.grab) {
				this.stoop.done = true;
				// The whole of picking it up.
				this.stoop.item?.equip();
			}
			if (this.stoop.clock >= STOOP.end) {
				this.control.state = 'idle';
				this.control.message = this.armed ? 'armed' : 'waiting';
			}
		} else if (this.control.state === 'swinging') {
			this.swing.clock += dt;
			if (!this.swing.hit && this.swing.clock >= SWING_CONTACT) {
				this.swing.hit = true;
				this.landSwing();
			}
			if (this.swing.clock >= SLASH.duration) {
				this.swing.active = false;
				this.swing.cuts++;
				this.control.state = 'idle';
				this.control.message = 'armed';
			}
		}

		this.buildPose(dt, elapsed);
	}

	private buildPose(dt: number, elapsed: number): void {
		stridePose(this.theta, this.amp, this.travel, this.gait, elapsed, this.strideBuf);

		// A lean into the turn, which is the one thing the stride cannot know:
		// it is handed a heading, not the fact that the whole man is coming
		// round.
		const wantBank = -clamp(this.yawRate * 0.05, -0.2, 0.2) * Math.min(1, this.speed / 1.2);
		this.bank += (wantBank - this.bank) * Math.min(1, dt * 6);
		this.strideBuf.root!.rot![2]! += this.bank;

		sparseToDense(BONES, this.strideBuf, this.basePose);

		const wantStoop = this.control.state === 'stoop' && this.stoop.clock < STOOP.release ? 1 : 0;
		this.stoop.blend += (wantStoop - this.stoop.blend) * Math.min(1, dt * 9);
		this.swing.blend = this.swing.active
			? Math.min(1, Math.min(this.swing.clock / 0.1, (SLASH.duration - this.swing.clock) / 0.2))
			: Math.max(0, this.swing.blend - dt * 6);

		// The guard, over the top, masked to the arms so the legs keep the gait.
		const carrying = this.armed || this.shielded;
		const wantGuard = carrying && this.control.state !== 'stoop' ? 1 : 0;
		this.guardWeight += (wantGuard - this.guardWeight) * Math.min(1, dt * 4);

		let base = this.basePose;
		if (this.guardWeight > 0.002) {
			sampleBound(this.guardClip, 0, this.guardPose);
			let src = this.basePose;
			if (this.shielded) {
				lerpPoseMasked(this.stancePose, src, this.guardPose, this.guardWeight, this.GUARD_SHIELD);
				src = this.stancePose;
			}
			if (this.armed) {
				const hold = 1 - (1 - GUARD_AT_RUN) * Math.min(1, this.speed / 2.4);
				lerpPoseMasked(this.stancePose, src, this.guardPose, this.guardWeight * hold, this.GUARD_SWORD);
				src = this.stancePose;
			}
			const settled = 1 - Math.min(1, this.speed / 1.2);
			if (settled > 0.01) {
				lerpPoseMasked(this.stancePose, src, this.guardPose, this.guardWeight * settled, this.ROOT_ONLY);
				src = this.stancePose;
			}
			base = src;
		}

		// Then the one thing his whole body is doing, if it is doing one.
		if (this.stoop.blend > 0.002) {
			sampleBound(this.duckClip, Math.min(this.stoop.clock, STOOP.hold), this.overlayPose);
			lerpPose(this.playerPose, base, this.overlayPose, this.stoop.blend);
		} else if (this.swing.blend > 0.002) {
			sampleBound(this.slashClip, Math.min(this.swing.clock, SLASH.duration), this.overlayPose);
			// Standing, it gets all of him; moving, it gets his arms and gives
			// the legs back to the stride.
			const moving = Math.min(1, this.amp * 1.4);
			for (let i = 0; i < this.swingMask.length; i++) {
				this.swingMask[i] = this.SWING_ALL[i]! + (this.SWING_UPPER[i]! - this.SWING_ALL[i]!) * moving;
			}
			lerpPoseMasked(this.playerPose, base, this.overlayPose, this.swing.blend, this.swingMask);
		} else {
			this.playerPose.rot.set(base.rot);
			this.playerPose.pos.set(base.pos);
		}

		denseToSparse(BONES, this.playerPose, this.pose);
	}

	/**
	 * Plant his feet on the terraces.
	 *
	 * Two passes on purpose. The first asks where the feet want to be and how
	 * far the hips must drop for the lower one to reach; the drop is applied to
	 * the root, and only then is the chain solved — because moving the hips
	 * moves the hips' children, and solving against the pre-drop positions
	 * would leave the leg reaching for where the ground used to be.
	 */
	applyFootIK(): void {
		const pose = this.pose;
		const world0 = solveWorld(SKELETON, pose);
		const targets: Record<string, { x: number; y: number; z: number; weight: number }> = {};
		let pelvisDrop = 0;

		for (const side of ['L', 'R'] as const) {
			const bone = `foot${side}`;
			const p = world0[bone]!.p;
			const w = this.toWorldXZ(p[0], p[2]);
			const groundY = this.deps.world.groundAt(w.x, w.z);
			const desiredY = groundY - this.y + SOLE;
			const above = p[1] - desiredY;
			// Only while it is actually near the ground, so a foot in mid-swing
			// is left to the clip.
			const weight = clamp(1 - above / 0.18, 0, 1);
			targets[bone] = { x: p[0], y: desiredY, z: p[2], weight };
			if (weight > 0.02) pelvisDrop = Math.min(pelvisDrop, (desiredY - p[1]) * weight);
		}

		this.pelvisDrop = pelvisDrop;
		if (pelvisDrop < -0.0005) {
			const root = (pose.root ??= { rot: [0, 0, 0], pos: [0, 0, 0] });
			root.pos ??= [0, 0, 0];
			root.pos[1]! += pelvisDrop;
		}

		const world2 = solveWorld(SKELETON, pose);
		for (const side of ['L', 'R'] as const) {
			const t = targets[`foot${side}`]!;
			if (t.weight <= 0.02) continue;
			solveTwoBone(
				SKELETON,
				pose,
				{ root: `hip${side}`, mid: `shin${side}`, end: `foot${side}` },
				[t.x, t.y, t.z],
				world2[`shin${side}`]!.p,
				t.weight,
				world2,
			);
			levelBone(SKELETON, pose, `foot${side}`, t.weight);
		}
	}

	/** How long a step is at the current gait, in metres. */
	get stepLength(): number {
		return (this.speed * stridePeriod(this.gait)) / 2;
	}
}
