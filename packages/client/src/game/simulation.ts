/*
 * The yard, taking turns.
 *
 * Owns the world, the two actors, the three props and the readouts drawn on
 * the ground, and turns one frame's input into one frame's instances. It knows
 * nothing about a canvas, a renderer or a browser event — the client hands it
 * a description of what the player is asking for, and it hands back prisms.
 *
 * What changed with the clock is the shape of `update`. In lab 09 it handed
 * every actor a slice of the frame and each moved by its speed times that
 * slice. Here a frame does two separate things:
 *
 *   resolveTurns   hands out turns while nobody is mid-action, which is what
 *                  advances game time — and does nothing at all while the man
 *                  has asked for nothing, which is what makes the world wait
 *   the actors     draw whatever their current action looks like at this
 *                  instant, on the wall clock
 *
 * The first is the game; the second is the picture of it. Keeping them apart
 * is what lets the rules be tested without a GPU and the animation be
 * retimed without touching a rule.
 *
 * One consequence to know: exactly one creature is ever mid-action. That is
 * not a limitation dressed up — it is what makes a turn a turn, and it is why
 * this file has no keep-apart radius, no interruption handling and no
 * collision response. Nothing can walk into anything, because nothing moves
 * while anything else is moving.
 */

import {
	buildSkeletonView,
	HEX_FLAG_UNLIT,
	HexInstances,
	type InstanceRanges,
} from '@hexdelve/engine';
import {
	axialDistance,
	makeRandom,
	rgbFromHex,
	worldToAxial,
	type Axial,
	type Random,
} from '@hexdelve/shared';

import { buildWorld, type World } from '../scene/world.js';
import { clipOf, type Cast } from './cast.js';
import { BatHunt, LOSE_RANGE, WAKE_RANGE } from './bathunt.js';
import { Item } from './items.js';
import { SECONDS_PER_GAME_TURN } from './pace.js';
import { Player, type PlayerStats } from './player.js';
import { Schedule, speedFactor, type TurnTaker } from './turns.js';

const PI = Math.PI;
const TAU = PI * 2;

/**
 * How many turns one frame may resolve before giving up and trying again next
 * frame.
 *
 * There is a real reason for a cap rather than a `while (true)`: a turn that
 * takes no time on screen — a sleeping bat, a man hemmed in — does not stop
 * the loop, so a state where nobody can ever do anything visible would spin
 * here. The cap turns that from a hung tab into a slow frame, and the fact
 * that the number is never approached in practice is worth more than the
 * cleverness of proving it cannot be.
 */
const TURNS_PER_FRAME = 64;

/** What the client observed this frame, in terms the game understands. */
export interface FrameInput {
	/** Where the cursor is on the ground, or null if it is off the canvas. */
	hover: { x: number; z: number } | null;
}

export interface SimulationToggles {
	/** Plant his feet on the terraces. */
	ik: boolean;
	/** The route he is walking, the bat's path, its hexagon and its perch. */
	routes: boolean;
	/** Ghost the bodies and show the rigs inside them. */
	skeleton: boolean;
	/** The camera tracks him. */
	follow: boolean;
}

export interface SimulationOptions {
	/**
	 * Who is in the yard. Required, because everything in it — the rigs, the
	 * bodies, the clips, the reach measured off them — comes out of files now,
	 * and a simulation cannot make any of it up.
	 */
	cast: Cast;
	seed?: number;
	toggles?: Partial<SimulationToggles>;
	/** The man's place in the energy table. Normal unless you want to see haste. */
	playerSpeed?: number;
	/** The bat's. +10 by default, which is exactly twice normal. */
	batSpeed?: number;
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
const HOVER_COLOR = rgbFromHex(0xf4f7f2);
const BLOCKED_COLOR = rgbFromHex(0xd05040);
const ROUTE_COLOR = rgbFromHex(0x5f9b3e);
const GOAL_COLOR = rgbFromHex(0xd8e86a);
const BAT_CELL_COLOR = rgbFromHex(0xd2603a);
const PERCH_COLOR = rgbFromHex(0x8d6bb0);
const BAT_PATH_COLOR = rgbFromHex(0xb0553f);

/** Everything the readout shows, in one shape the editor can render. */
export interface YardStats extends PlayerStats {
	/* ---------------------------------------------------------- the clock -- */
	/** Game turns since the world started. Ten of them is one normal action. */
	gameTurn: number;
	/** Actions taken by anybody. */
	actions: number;
	/** Who moved last and what they did. */
	lastAction: string;
	/** Whether the clock is turning, or waiting for you. */
	waitingForYou: boolean;
	/** Seconds one game turn is drawn over. */
	secondsPerGameTurn: number;

	/* ------------------------------------------------------------ the bat -- */
	batMessage: string;
	batState: string;
	batRange: number;
	batEnergy: number;
	batSpeedRating: number;
	/** How many times a normal creature's rate that is. */
	batSpeedFactor: number;
	bites: number;
	batMissed: number;
	wakeRange: number;
	loseRange: number;

	/* ----------------------------------------------------------- the fight -- */
	/** The sword's measured reach, in metres. */
	reach: number;
	/** What the grid asks of it that it has not got, closed by leaning in. */
	lean: number;
	/** The hexagon under the cursor, and whether he can get to it. */
	hover: Axial | null;
	hoverReachable: boolean;
}

export class Simulation {
	readonly world: World;
	readonly player: Player;
	readonly bat: BatHunt;
	readonly items: Item[];
	readonly toggles: SimulationToggles;
	readonly schedule: Schedule<TurnTaker>;

	/** Where the camera should be looking, when it is following. */
	readonly focus = { x: 0, y: 0, z: 0 };

	private readonly motes: Motes;
	private readonly perch: Axial;
	private elapsed = 0;
	private actions = 0;
	private lastAction = 'nobody has moved';
	private hover: Axial | null = null;
	private hoverReachable = false;
	/** The action count the hover answer was worked out at. */
	private hoverAsked = -1;

	/** Hip height at rest, which is also where the camera looks. */
	private readonly hipHeight: number;

	private readonly opaque = new HexInstances(4096);
	private readonly blended = new HexInstances(512);
	private readonly overlay = new HexInstances(64);
	private readonly frame = new HexInstances(8192);

	constructor(options: SimulationOptions) {
		const random = makeRandom(options.seed ?? 37);
		this.world = buildWorld({ random, groundRadius: 8, baseY: 0.16, stepH: 0.19 });
		this.motes = new Motes(14, random);

		this.toggles = {
			ik: true,
			routes: true,
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

		/*
		 * The gear, straight off its entity files. A prop carries the bone it
		 * hangs from and the two numbers that put it down in the grass, so
		 * there is nothing to look up here and nothing to keep in step: what
		 * the prop bench shows is what the yard drops.
		 */
		const { cast } = options;
		this.items = cast.props.map(
			(prop) =>
				new Item({
					label: prop.id,
					bone: prop.attach?.bone ?? 'root',
					model: prop.mesh.model(),
					lift: prop.ground?.lift ?? 0,
					tilt: prop.ground?.tilt ?? 0,
				}),
		);

		/*
		 * Spread across his way in, and not in a line: collecting all three
		 * should be a walk that turns.
		 *
		 * They sit on tile centres rather than scattered in the grass, and that
		 * is a rule change rather than a tidy-up. Picking a thing up is now a
		 * question about a hexagon — is it on mine — so a sword lying a
		 * hand's breadth over a tile boundary would be on a hexagon other than
		 * the one it looks like it is on.
		 */
		const spots: [Item, number, number, number][] = [
			[this.items[0]!, -2.4, -3.1, -0.7],
			[this.items[1]!, 1.9, -3.4, 1.1],
			[this.items[2]!, -3.4, 0.4, 2.3],
		];
		for (const [item, x, z, yaw] of spots) {
			const cell = worldToAxial(x, z);
			const tile = this.world.tileAt(cell.q, cell.r)!;
			item.ground(tile.x, tile.z, yaw, tile.top);
		}

		/* Where his eyeline is, off his own rig — a camera follows the hips. */
		this.hipHeight = cast.player.rig!.metrics.hipHeight ?? 0;

		const sword = cast.props.find((prop) => prop.id === 'sword');
		const swordTip = sword?.mesh.anchors.tip?.at;
		if (!swordTip) throw new Error(`the yard's sword has no 'tip' anchor to measure a reach from`);

		this.player = new Player(
			{
				rig: cast.player.rig!,
				skeleton: cast.player.rig!.skeleton,
				model: cast.player.mesh.model(),
				skeletonView: buildSkeletonView(cast.player.rig!.skeleton, cast.player.rig!.tips),
				clips: {
					duck: clipOf(cast.player, 'duck'),
					slash: clipOf(cast.player, 'slash'),
					guard: clipOf(cast.player, 'guard'),
				},
				swordTip,
				cell: worldToAxial(0, -5.4),
				yaw: 0,
				...(options.playerSpeed !== undefined ? { speed: options.playerSpeed } : {}),
			},
			{
				world: this.world,
				enemyCell: () => this.bat.cell,
				enemyPosition: () => ({ x: this.bat.x, y: this.bat.bodyY, z: this.bat.z }),
				onHit: (x, y, z) => {
					this.motes.spawn(x, y, z, 9, 1.6, 1.9);
					this.bat.reel();
				},
				items: this.items,
			},
		);

		this.bat = new BatHunt(
			{
				rig: cast.enemy.rig!,
				skeleton: cast.enemy.rig!.skeleton,
				model: cast.enemy.mesh.model(),
				skeletonView: buildSkeletonView(cast.enemy.rig!.skeleton, cast.enemy.rig!.tips),
				cell: this.perch,
				yaw: 2.4,
				...(options.batSpeed !== undefined ? { speed: options.batSpeed } : {}),
			},
			{
				world: this.world,
				playerCell: () => this.player.cell,
				playerPosition: () => ({ x: this.player.x, y: this.player.y + this.hipHeight, z: this.player.z }),
				onBite: (x, y, z) => this.motes.spawn(x, y, z, 7, 1.3, 1.6),
				perch: this.perch,
				random,
			},
		);

		/*
		 * The man is first in the list, which is Angband's tie-break: among
		 * creatures ready to act on the same turn, the ones with strictly more
		 * energy than him go first, then him, then the rest.
		 */
		this.schedule = new Schedule<TurnTaker>([this.player, this.bat]);

		this.focus.x = this.player.x;
		this.focus.z = this.player.z;
		this.focus.y = this.player.y + this.hipHeight + 0.1;
	}

	/* --------------------------------------------------------------- orders -- */

	/**
	 * A click on the ground.
	 *
	 * One call for every meaning a click has, because the hexagon under it is
	 * what decides: walk there, walk to the thing lying there and stoop, walk
	 * up to the bat and cut it, or — clicking where he stands — wait a turn.
	 * Returns false when there is no way to it, so the caller can say so.
	 */
	pick(point: { x: number; z: number }): boolean {
		return this.pickCell(worldToAxial(point.x, point.z));
	}

	pickCell(cell: Axial): boolean {
		return this.player.orderTo(cell);
	}

	/** Spend a turn standing still. */
	hold(): void {
		this.player.hold();
	}

	/** Go and cut the bat, wherever it is. */
	attack(): boolean {
		return this.player.orderTo(this.bat.cell);
	}

	/** Forget where he was going. */
	cancel(): void {
		this.player.cancel();
	}

	/* ---------------------------------------------------------------- frames -- */

	/**
	 * Hand out turns while there is nobody mid-action and the man has asked for
	 * something.
	 *
	 * Those two conditions are the whole of the turn system. The first makes
	 * actions sequential, so only ever one creature is moving. The second is
	 * what a turn-based world *is*: with no orders standing, this returns
	 * without touching the clock, so nothing gains energy, the bat does not
	 * move, and the yard holds still with its wings out until you decide.
	 */
	private resolveTurns(): void {
		for (let guard = 0; guard < TURNS_PER_FRAME; guard++) {
			if (this.player.busy || this.bat.busy) return;
			if (!this.player.hasOrders) return;
			const who = this.schedule.next();
			if (!who) return;
			const action = who.beginTurn();
			this.schedule.spend(who, action.cost);
			this.actions++;
			this.lastAction = `${who.name} · ${action.kind}`;
		}
	}

	update(dt: number, input: FrameInput): void {
		this.elapsed += dt;

		/*
		 * Whether the hovered hexagon can be reached is an A* query, and the
		 * cursor is over the same hexagon for most of the frames it is over
		 * any of them — so it is asked when the answer can have changed: a new
		 * cell under the cursor, or somebody having moved since.
		 */
		const hover = input.hover ? worldToAxial(input.hover.x, input.hover.z) : null;
		const moved = this.hoverAsked !== this.actions;
		const elsewhere =
			hover === null ||
			this.hover === null ||
			hover.q !== this.hover.q ||
			hover.r !== this.hover.r;
		this.hover = hover;
		if (hover && (moved || elsewhere)) {
			this.hoverReachable = this.player.reachable(hover);
			this.hoverAsked = this.actions;
		} else if (!hover) {
			this.hoverReachable = false;
		}

		this.motes.update(dt);
		this.resolveTurns();

		this.player.update(dt, this.elapsed);
		if (this.toggles.ik) this.player.applyFootIK();
		this.player.solve();

		this.bat.update(dt, this.elapsed);
		this.bat.solve();

		if (this.toggles.follow) {
			const pull = Math.min(1, dt * 2.4);
			this.focus.x += (this.player.x - this.focus.x) * pull;
			this.focus.z += (this.player.z - this.focus.z) * pull;
			this.focus.y += (this.player.y + this.hipHeight + 0.1 - this.focus.y) * pull;
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
	build(): { data: Float32Array; ranges: InstanceRanges } {
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
		this.emitMarkers(blended, overlay);

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

	/**
	 * The hexagons worth seeing.
	 *
	 * All of it is the grid, which it was not in lab 09 — there the overlay was
	 * two arrows on the ground, because the thing worth watching was the angle
	 * between where he faced and where he went. On a grid that angle is always
	 * zero, and what is worth watching instead is which cells are which: the
	 * one under the cursor, whether he can get to it, the route he will take,
	 * and the cell the bat is in, which is as solid as a wall to him.
	 */
	private emitMarkers(blended: HexInstances, overlay: HexInstances): void {
		const ring = (
			out: HexInstances,
			cell: Axial,
			radius: number,
			lift: number,
			color: ReturnType<typeof rgbFromHex>,
			alpha: number,
		): void => {
			const tile = this.world.tileAt(cell.q, cell.r);
			if (!tile) return;
			out.pushRadial(tile.x, tile.top + lift, tile.z, radius, 0.02, color, {
				alpha,
				flags: HEX_FLAG_UNLIT,
			});
		};

		// The hexagon the bat is standing on: as solid as a wall as far as he is
		// concerned, so it is worth being able to see.
		ring(blended, this.bat.cell, 0.93, 0.03, BAT_CELL_COLOR, 0.34);

		if (this.toggles.routes) {
			if (this.bat.state === 'asleep') ring(blended, this.perch, 0.75, 0.015, PERCH_COLOR, 0.3);

			const batPath = this.bat.path;
			if (batPath) {
				for (let i = 0; i < batPath.length && i < 24; i++) {
					ring(blended, batPath[i]!, 0.19, 0.02, BAT_PATH_COLOR, 0.75);
				}
			}

			// His own route, which lab 06 had and labs 07-09 did not need.
			const route = this.player.path;
			for (let i = 0; i < route.length && i < 40; i++) {
				ring(blended, route[i]!, 0.22, 0.02, ROUTE_COLOR, 0.7);
			}
			const goal = this.player.goal;
			if (goal) ring(overlay, goal, 0.8, 0.035, GOAL_COLOR, 0.42);
		}

		// The cursor. Drawn in the overlay pass, which does not test depth: it
		// is a readout, not a thing in the yard, and a terrace half a metre away
		// would otherwise bury it.
		const hover = this.hover;
		if (hover) {
			ring(
				overlay,
				hover,
				0.88,
				0.04,
				this.hoverReachable ? HOVER_COLOR : BLOCKED_COLOR,
				this.hoverReachable ? 0.34 : 0.4,
			);
		}
	}

	get stats(): YardStats {
		return {
			...this.player.stats,
			gameTurn: this.schedule.gameTurn,
			actions: this.actions,
			lastAction: this.lastAction,
			waitingForYou: !this.player.hasOrders && !this.player.busy && !this.bat.busy,
			secondsPerGameTurn: SECONDS_PER_GAME_TURN,
			batMessage: this.bat.message,
			batState: this.bat.state,
			batRange: axialDistance(this.player.cell, this.bat.cell),
			batEnergy: this.bat.energy,
			batSpeedRating: this.bat.speed,
			batSpeedFactor: speedFactor(this.bat.speed),
			bites: this.bat.bites,
			batMissed: this.bat.missed,
			wakeRange: WAKE_RANGE,
			loseRange: LOSE_RANGE,
			reach: this.player.reach.distance,
			lean: this.player.leanIn,
			hover: this.hover,
			hoverReachable: this.hoverReachable,
		};
	}
}
