/*
 * The bat, brought across from lab 08 whole — because the interesting thing is
 * how little of it had to change.
 *
 * It hunts over the hexagons, bites from whichever one it is standing on, and
 * never leaves the grid; the man it is hunting is now nowhere on that grid in
 * particular. The only line that noticed is the one that asks which cell he is
 * in, and that was never the same question as "the tile he is walking to".
 *
 *   asleep -> waking -> hunting <-> striking -> recovering
 *                          |
 *                      returning -> settling -> asleep
 */

import {
	attachmentPosition,
	mixSparse,
	type SparsePose,
} from '@hexdelve/engine';
import {
	axialDistance,
	axialNeighbours,
	findPath,
	worldToAxial,
	type Axial,
} from '@hexdelve/shared';

import { Actor, clamp, turnTowards } from './actor.js';
import { BAT_SKELETON, HOVER_Y, JAW_TIP } from './batrig.js';
import { flyPose, FLAP_PERIOD, LUNGE_CONTACT, lungePose, perchPose } from './batpose.js';
import type { World } from '../scene/world.js';

const TAU = Math.PI * 2;

/** Terraces a pair of wings clears in one step. */
export const BAT_CLIMB = 2;
/** Tiles: how close you get before it notices you. */
export const WAKE_RANGE = 3;
/** Tiles: how far you get before it stops caring. */
export const LOSE_RANGE = 6;
const BITE_COOLDOWN = 1.1;
/** How far off the jaws can be and still have caught him. */
const BITE_TOLERANCE = 0.55;
/** How far off the ground the wings hold it, once awake. */
const HOVER_LIFT = 0.62;

/**
 * No closer than this. It is not a body radius, it is geometry: hexagons here
 * are 1.73 m centre to centre, so their circumradius is exactly 1.0 m. A shade
 * beyond it and he is outside the bat's hexagon in every direction.
 */
export const KEEP_APART = 1.15;

export type HuntState =
	| 'asleep'
	| 'waking'
	| 'hunting'
	| 'striking'
	| 'recovering'
	| 'reeling'
	| 'returning'
	| 'settling';

export interface BatDeps {
	world: World;
	playerCell: () => Axial;
	playerPosition: () => { x: number; z: number };
	/** Called when the jaws actually reach him. */
	onBite: (x: number, y: number, z: number) => void;
	/** Cruising speed, set from what a run is actually worth. */
	speed: number;
	perch: Axial;
}

export class BatHunt extends Actor {
	private readonly deps: BatDeps;

	state: HuntState = 'asleep';
	message = 'asleep';
	path: Axial[] | null = null;
	private index = 0;
	speed = 0;
	private repathIn = 0;
	private reelTimer = 0;
	private lastGoal: Axial | null = null;
	/** 0 folded, 1 flying. */
	private wake = 0;
	private flap = 0;
	/** 0 to 1 across a strike. */
	private lunge = 0;
	private lungeBlend = 0;
	private bitten = false;
	private cooldown = 0;
	bites = 0;
	missed = 0;

	// Pose buffers, allocated once.
	private readonly flyBuf: SparsePose = {};
	private readonly perchBuf: SparsePose = {};
	private readonly lungeBuf: SparsePose = {};

	constructor(options: ConstructorParameters<typeof Actor>[0], deps: BatDeps) {
		super(options);
		this.deps = deps;
	}

	get cell(): Axial {
		return worldToAxial(this.x, this.z);
	}

	/** Where its body actually is, which is what the sword has to reach. */
	get bodyY(): number {
		return this.y + HOVER_Y;
	}

	tilesToPlayer(): number {
		return axialDistance(this.cell, this.deps.playerCell());
	}

	/**
	 * The same ground asked the other way: a terrace is a step to him and a
	 * flap to it, and neither may enter the cell the other is in.
	 */
	private flyable = (cell: Axial, from: Axial | null): boolean => {
		const player = this.deps.playerCell();
		if (cell.q === player.q && cell.r === player.r) return false;
		return this.deps.world.passable(cell, from, BAT_CLIMB);
	};

	/**
	 * Path to a tile beside the man, not onto him: the grid is for getting
	 * there, the last half metre is the strike's business.
	 */
	private repath(): void {
		const from = this.cell;
		const goal = this.deps.playerCell();
		let best: Axial | null = null;
		let bestScore = Infinity;
		for (const n of axialNeighbours(goal)) {
			if (!this.flyable(n, null)) continue;
			const d = axialDistance(from, n);
			if (d < bestScore) {
				bestScore = d;
				best = n;
			}
		}
		if (!best) best = goal;
		const path = findPath(from, best, { passable: this.flyable });
		if (path) {
			this.path = path;
			this.index = 1;
			this.lastGoal = best;
		}
		this.repathIn = 0.45;
	}

	private goHome(): void {
		this.path = findPath(this.cell, this.deps.perch, { passable: this.flyable });
		this.index = 1;
		this.lastGoal = this.deps.perch;
	}

	/**
	 * Hit. Whatever it was doing stops — including a lunge halfway to his
	 * throat — and it is thrown back, wings thrashing, before it comes round
	 * and starts again.
	 */
	reel(): void {
		this.state = 'reeling';
		this.message = 'hit';
		this.reelTimer = 0.55;
		this.lunge = 0;
		this.lungeBlend = 0;
		this.wake = 1;
		this.path = null;
	}

	/**
	 * Follow a path of tiles. Waypoints retire on a radius that grows with
	 * speed, because at a run a fixed one can be circled forever.
	 */
	private followPath(dt: number, cruise: number, turnRate: number): { speed: number; arrived: boolean } {
		const path = this.path;
		if (!path) return { speed: 0, arrived: false };
		const goal = path[path.length - 1]!;
		const goalTile = this.deps.world.tileAt(goal.q, goal.r);
		if (!goalTile) return { speed: 0, arrived: false };

		const advanceRadius = Math.max(0.5, this.speed * 0.6);
		const fx = Math.sin(this.yaw);
		const fz = Math.cos(this.yaw);
		while (this.index < path.length - 1) {
			const t = this.deps.world.tileAt(path[this.index]!.q, path[this.index]!.r);
			if (!t) break;
			const ddx = t.x - this.x;
			const ddz = t.z - this.z;
			const d = Math.hypot(ddx, ddz);
			if (d < advanceRadius || (ddx * fx + ddz * fz < 0 && d < 1.5)) this.index++;
			else break;
		}

		const node = path[Math.min(this.index, path.length - 1)]!;
		const tile = this.deps.world.tileAt(node.q, node.r);
		if (!tile) return { speed: 0, arrived: false };

		const toGoal = Math.hypot(goalTile.x - this.x, goalTile.z - this.z);
		const diff = wrap(Math.atan2(tile.x - this.x, tile.z - this.z) - this.yaw);
		this.yaw += clamp(diff * 4, -turnRate, turnRate) * dt;

		const arriving = Math.min(1, toGoal / 1.1);
		const cornering = 1 - Math.min(0.55, Math.abs(diff) * 0.5);
		if (toGoal < 0.3) {
			const pull = Math.min(1, dt * 4);
			this.x += (goalTile.x - this.x) * pull;
			this.z += (goalTile.z - this.z) * pull;
		}
		if (toGoal < 0.12) return { speed: 0, arrived: true };
		return { speed: cruise * arriving * cornering, arrived: false };
	}

	update(dt: number, time: number): void {
		const near = this.tilesToPlayer();
		const player = this.deps.playerPosition();
		let wantSpeed = 0;
		let flapAmp = 1;

		switch (this.state) {
			case 'asleep':
				this.message = 'asleep';
				// It hears you coming. Three tiles, measured on the grid it lives on.
				if (near <= WAKE_RANGE) {
					this.state = 'waking';
					this.wake = 0;
					this.message = 'waking';
				}
				break;

			case 'waking':
				this.wake = Math.min(1, this.wake + dt * 1.4);
				turnTowards(this, player.x, player.z, dt, 2.4);
				if (this.wake >= 1) {
					this.state = 'hunting';
					this.repath();
				}
				break;

			case 'hunting': {
				this.message = 'hunting';
				this.repathIn -= dt;
				// Re-think when he has moved a tile, or every half second anyway.
				const goal = this.deps.playerCell();
				if (this.repathIn <= 0 || !this.lastGoal || axialDistance(this.lastGoal, goal) > 1) {
					this.repath();
				}

				const followed = this.followPath(dt, this.deps.speed, 2.6);
				wantSpeed = followed.speed;
				if (followed.arrived) this.path = null;

				// It attacks from the hexagon it is on, so the condition is
				// about the grid rather than about metres: next to him, settled
				// on the cell, and off cooldown.
				const settled = followed.arrived || this.speed < 0.4;
				if (near <= 1 && settled && this.cooldown <= 0) {
					this.state = 'striking';
					this.message = 'striking';
					this.lunge = 0;
					this.bitten = false;
					this.path = null;
				} else if (near > LOSE_RANGE) {
					this.state = 'returning';
					this.message = 'losing you';
					this.goHome();
				}
				break;
			}

			case 'striking': {
				// Rooted to its cell. The only movement is turning to face him
				// and the lunge itself, which throws the body a metre forward
				// and pulls it back inside the pose.
				turnTowards(this, player.x, player.z, dt, 3.4);
				this.lunge = Math.min(1, this.lunge + dt / 0.85);
				this.lungeBlend = Math.min(1, this.lungeBlend + dt * 7);
				flapAmp = 0.5;

				if (!this.bitten && this.lunge >= LUNGE_CONTACT) {
					this.bitten = true;
					// Where the jaws actually got to, not where it aimed.
					const jaws = attachmentPosition(BAT_SKELETON, this.pose, 'jaw', JAW_TIP);
					const w = this.toWorldXZ(jaws[0], jaws[2]);
					if (Math.hypot(w.x - player.x, w.z - player.z) <= BITE_TOLERANCE) {
						this.bites++;
						this.deps.onBite(w.x, this.y + jaws[1], w.z);
					} else {
						this.missed++;
					}
				}
				if (this.lunge >= 1) {
					this.state = 'recovering';
					this.message = 'backing off';
					this.cooldown = BITE_COOLDOWN;
				}
				break;
			}

			case 'recovering':
				// It never left its cell, so there is nothing to walk back
				// from: this is only the beat between blows.
				this.lungeBlend = Math.max(0, this.lungeBlend - dt * 5);
				turnTowards(this, player.x, player.z, dt, 2.0);
				if (this.cooldown <= 0) {
					this.state = 'hunting';
					this.lunge = 0;
					this.repath();
				}
				break;

			case 'reeling': {
				this.reelTimer -= dt;
				const dx = this.x - player.x;
				const dz = this.z - player.z;
				const d = Math.hypot(dx, dz) || 1;
				const push = 2.6 * Math.max(0, this.reelTimer / 0.55);
				this.x += (dx / d) * push * dt;
				this.z += (dz / d) * push * dt;
				wantSpeed = push;
				flapAmp = 1.45; // thrashing, not cruising
				turnTowards(this, player.x, player.z, dt, 1.6);
				if (this.reelTimer <= 0) {
					this.state = 'hunting';
					this.cooldown = 0.7;
					this.repath();
				}
				break;
			}

			case 'returning': {
				this.message = 'going home';
				const followed = this.followPath(dt, this.deps.speed * 0.8, 2.2);
				wantSpeed = followed.speed;
				if (followed.arrived || !this.path) {
					this.state = 'settling';
					this.path = null;
				}
				// You came back before it got home.
				if (near <= WAKE_RANGE) {
					this.state = 'hunting';
					this.repath();
				}
				break;
			}

			case 'settling':
				this.message = 'settling';
				this.wake = Math.max(0, this.wake - dt * 1.2);
				flapAmp = 0.4;
				if (this.wake <= 0) {
					this.state = 'asleep';
					this.yaw = 2.4;
				}
				if (near <= WAKE_RANGE) this.state = 'waking';
				break;
		}

		if (this.cooldown > 0) this.cooldown -= dt;
		this.speed += (wantSpeed - this.speed) * Math.min(1, dt * 6);

		/*
		 * A* will not route it through the hexagon he is standing in, but a
		 * path is only checked at the corners — between them it flies in a
		 * straight line, and that line was taking it clean through him. So a
		 * step is only taken if it leaves them a body apart, or if it is moving
		 * away.
		 */
		if (this.state === 'hunting' || this.state === 'returning') {
			const nx = this.x + Math.sin(this.yaw) * this.speed * dt;
			const nz = this.z + Math.cos(this.yaw) * this.speed * dt;
			const now = Math.hypot(this.x - player.x, this.z - player.z);
			const next = Math.hypot(nx - player.x, nz - player.z);
			if (next > KEEP_APART || next >= now) {
				this.x = nx;
				this.z = nz;
			}
		}

		// Height: it follows the ground terrace by terrace, and rides above it
		// by however awake it is.
		const under = this.deps.world.groundAt(this.x, this.z) + HOVER_LIFT * this.wake;
		this.y += (under - this.y) * Math.min(1, dt * 6);

		/* ------------------------------------------------------------ the pose */
		// Beat rate rises with speed, and every state is a blend of at most two
		// of the three poses the creature has.
		this.flap += (TAU / FLAP_PERIOD) * (0.55 + 0.55 * Math.min(1, this.speed / this.deps.speed)) * dt;
		if (this.flap > TAU) this.flap -= TAU;
		const amp = flapAmp * Math.max(0.35, Math.min(1, 0.45 + this.speed / this.deps.speed));

		if (this.wake >= 1) {
			flyPose(this.flap, amp, time, this.pose);
		} else if (this.wake <= 0) {
			perchPose(time, this.pose);
		} else {
			const u = this.wake * this.wake * (3 - 2 * this.wake);
			mixSparse(this.pose, perchPose(time, this.perchBuf), flyPose(this.flap, amp, time, this.flyBuf), u);
		}

		// The strike is laid over whatever it was doing, and taken off again.
		if (this.lungeBlend > 0.001) {
			mixSparse(this.pose, this.pose, lungePose(this.lunge, this.lungeBuf), this.lungeBlend);
		}
	}
}

function wrap(a: number): number {
	let angle = a;
	while (angle > Math.PI) angle -= TAU;
	while (angle < -Math.PI) angle += TAU;
	return angle;
}
