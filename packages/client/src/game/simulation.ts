/*
 * The yard: a world, a frame of instances, and what a click means.
 *
 * It knows nothing about a canvas, a renderer or a browser event — the client
 * hands it a description of what the player is asking for, and it hands back
 * prisms. What is left in it after the game moved out is deliberately all of
 * one kind: the terrain, the instance buffers, the markers drawn on the ground,
 * where the camera looks, and the readout.
 *
 * ## What is not here any more, and where it went
 *
 *   whose turn it is    `Turns`, a system script. It reads everything that
 *                       acts out of the scene, so a third creature is an
 *                       entity file and no line here
 *   what a click means  `PlayerInput`, on the man
 *   whether it has
 *   heard you           `Hunter`, on the bat
 *   what a blow does    `Combat`, and `Character` takes the hit points off
 *
 * So this drives a frame rather than a game. It refreshes the list of things
 * that act, lets the scene update, and then asks each of them to draw whatever
 * its current action looks like at this instant — on the wall clock, which is
 * the one clock the game itself does not use.
 *
 * Keeping those apart is what lets the rules be tested without a GPU and the
 * animation be retimed without touching a rule.
 *
 * ## One consequence to know
 *
 * Exactly one creature is ever mid-action. That is not a limitation dressed up
 * — it is what makes a turn a turn, and it is why this file has no keep-apart
 * radius, no interruption handling and no collision response. Nothing can walk
 * into anything, because nothing moves while anything else is moving.
 *
 * ## The two it still names
 *
 * `player` and `bat` remain, and only the readout and the input use them. A
 * status line showing what you are carrying needs to know which one is you, and
 * a demo with a man and a bat in it is entitled to say so. Nothing in the frame
 * loop names either: the actors are read out of the scene, in the order the
 * scene holds them.
 */

import {
	noScripts,
	ScriptHost,
	type EntityAsset,
	type ScriptProvider,
	type SpawnPlacement,
} from '@hexdelve/engine';

import {
	HEX_FLAG_UNLIT,
	Attach,
	entityAnimations,
	entityMesh,
	entityRig,
	HexInstances,
	instantiate,
	Scene,
	type GameObject,
	type InstanceRanges,
	type SystemAsset,
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
import { Damage, Missed } from './events.js';
import type { Cast } from './cast.js';
import { components, type SpawnExtras } from './components.js';
import { spawnEntity } from './spawn.js';
import { BatHunt } from './bathunt.js';
import { Item } from './items.js';
import { secondsPerGameTurn, setWalkSpeed } from './pace.js';
import { playerOrders, type PlayerOrders } from './orders.js';
import { ActorBehaviour } from './actor.js';
import { EMPTY_SCHEDULE, turnOrder, type TurnOrder } from './turnorder.js';
import { Player, type PlayerStats } from './player.js';
import { Schedule, speedFactor, type TurnTaker } from './turns.js';

const PI = Math.PI;
const TAU = PI * 2;

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
	/**
	 * The prefabs there is exactly one of, spawned before anything else.
	 *
	 * Order matters and is the whole reason they are separate: a register has
	 * to exist before the first thing that registers with it, so systems go
	 * into the scene ahead of the cast rather than beside it.
	 */
	systems?: readonly SystemAsset[];
	/**
	 * Where the scripts come from.
	 *
	 * Nothing, by default. The scripts are not in this package's module graph —
	 * they are compiled apart from it and fetched, which is what `HexdelveClient`
	 * does before it builds one of these. A caller that has not loaded them gets
	 * a world with no behaviour on it rather than a failure, for the same reason
	 * the host tolerates a script whose class is missing: one absent script must
	 * not take out a scene.
	 */
	scripts?: ScriptProvider;
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

	/** Where the camera should be looking, when it is following. */
	readonly focus = { x: 0, y: 0, z: 0 };

	private readonly motes: Motes;

	/**
	 * Everything that acts, refreshed at the top of each frame.
	 *
	 * Held rather than re-walked, because `build` runs after `update` and both
	 * want the same list — and a list that changed between the two would draw
	 * something that had not moved.
	 */
	private readonly actors: ActorBehaviour[] = [];
	private readonly perch: Axial;
	private elapsed = 0;
	private hover: Axial | null = null;
	private hoverReachable = false;
	/** The action count the hover answer was worked out at. */
	private hoverAsked = -1;

	/**
	 * Everything that stands somewhere, as objects with their behaviour on
	 * them.
	 *
	 * It is not paying for itself yet: this file still names each of them and
	 * drives them in a fixed order, because the order IS the game — the turns
	 * are resolved and then the actors draw whatever that left them doing. It
	 * pays when prefabs arrive and the naming goes away, and again when the
	 * behaviour moves into scripts and the fixed order becomes a system.
	 */
	readonly scene: Scene;

	/**
	 * Where the one-of-a-kind things live, spawned before the cast.
	 *
	 * Empty until there are scripts to put on them, and here now because the
	 * order it establishes is the part that would be awkward to add later.
	 */
	readonly systems: GameObject;

	/** What runs the behaviour that lives in `scripts/`. */
	readonly scripts: ScriptHost;

	/** Every entity the cast loaded, by id, for a script that spawns one. */
	private readonly catalogue: ReadonlyMap<string, EntityAsset>;

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
		this.scene = new Scene({ name: 'yard' });

		/*
		 * The script host, before anything that could carry a script is
		 * spawned. It is handed a provider rather than finding one: which
		 * classes exist is a question about the build, not about the game.
		 */
		this.scripts = new ScriptHost(options.scripts ?? noScripts, {
			spawn: (id, placement) => this.spawnFromCast(id, placement),
		});

		/*
		 * What a script may ask for by name. Everything the cast loaded: the two
		 * characters, the gear in the grass, and whatever was listed as
		 * spawnable and left unplaced.
		 */
		this.catalogue = new Map(
			[cast.player, cast.enemy, ...cast.props, ...cast.spawnable].map((entity) => [
				entity.id,
				entity,
			]),
		);

		this.systems = this.scene.spawn('systems');
		for (const system of options.systems ?? []) {
			instantiate(system.prefab, this.scene, components, {
				parent: this.systems,
				file: `${system.id}.system.yaml`,
				extras: { scripts: { host: this.scripts, scene: this.scene } },
			});
		}

		/*
		 * The gear, spawned from its own prefabs. Nothing here says what a
		 * helmet is made of or how it lies: the entity file does, its `object:`
		 * section says an item hangs on it, and the factory reads both. What
		 * the prop bench shows is what the yard drops, for the stronger reason
		 * that they now come out of the same file the same way.
		 */
		this.items = cast.props.map((prop) => {
			const object = spawnEntity(prop, this.scene, { extras: this.scriptExtras() });
			const item = object.getComponent(Item);
			if (!item) throw new Error(`'${prop.id}' has no item component to lie in the grass`);
			return item;
		});

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
		this.hipHeight = entityRig(cast.player)?.metrics.hipHeight ?? 0;

		/*
		 * And how long a game turn is, off his walk. One turn is a tenth of the
		 * time that walk takes to cross a hexagon, so the clock is measured
		 * from the clip he is drawn with rather than from a number beside it —
		 * which is what keeps his step and his place in the energy table the
		 * same fact.
		 */
		const walk = entityAnimations(cast.player).get('walk')?.speed();
		if (!walk) throw new Error(`'${cast.player.id}' has no measurable walk to set the turn clock from`);
		setWalkSpeed(walk.z);

		const sword = cast.props.find((prop) => prop.id === 'sword');
		const swordTip = entityMesh(sword!)?.anchors.tip?.at;
		if (!swordTip) throw new Error(`the yard's sword has no 'tip' anchor to measure a reach from`);

		this.player = spawnEntity(cast.player, this.scene, { name: 'player', extras: this.scriptExtras() }).addComponent(
			Player,
			{
				swordTip,
				cell: worldToAxial(0, -5.4),
				yaw: 0,
				world: this.world,
				items: this.items,
				scripts: this.scripts,
				...(options.playerSpeed !== undefined ? { speed: options.playerSpeed } : {}),
			},
		);

		this.bat = spawnEntity(cast.enemy, this.scene, { name: 'bat', extras: this.scriptExtras() }).addComponent(
			BatHunt,
			{
				cell: this.perch,
				yaw: 2.4,
				world: this.world,
				random,
				scripts: this.scripts,
				...(options.batSpeed !== undefined ? { speed: options.batSpeed } : {}),
			},
		);

		/*
		 * Each of them learns about the other, now that both exist. This is
		 * what a bag of callbacks was standing in for: one has to be built
		 * first, so neither can be handed the other in its options.
		 */
		this.player.opponent = this.bat;
		this.bat.opponent = this.player;

		this.listen();

		/*
		 * Compose the world transforms once before anybody asks for one.
		 *
		 * Everything above has written LOCAL transforms — the gear where it
		 * lies, the two creatures where they start — and a world transform is
		 * what those become when the scene composes them. Without this, an item
		 * asked where it is before the first frame answers with the origin,
		 * which is the sort of thing that looks like a pathing bug.
		 */
		this.scene.solve();

		this.focus.x = this.player.x;
		this.focus.z = this.player.z;
		this.focus.y = this.player.y + this.hipHeight + 0.1;
	}

	/* --------------------------------------------------------------- orders -- */

	/**
	 * Whose turn it is — a script on the systems object.
	 *
	 * Looked up each time rather than kept, for the reason his orders are: a
	 * hot reload replaces the instance, and a reference taken once would name
	 * the version it replaced.
	 */
	private get turns(): TurnOrder | null {
		return turnOrder(this.scene);
	}

	/** Who is still taking turns. Empty where nothing is handing them out. */
	get schedule(): Schedule<TurnTaker> {
		return this.turns?.schedule ?? EMPTY_SCHEDULE;
	}

	/**
	 * What the man has been asked to do — a script on his object.
	 *
	 * Null when nothing loaded one, which a bench and a test without the script
	 * bundle both are. Every use here reads that as "he has been asked for
	 * nothing", so the yard stands still rather than failing.
	 */
	private get orders(): PlayerOrders | null {
		return playerOrders(this.player.object);
	}

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
		return this.orders?.orderTo(cell) ?? false;
	}

	/** Spend a turn standing still. */
	hold(): void {
		this.orders?.hold();
	}

	/** Go and cut the bat, wherever it is. */
	attack(): boolean {
		return this.orders?.orderTo(this.bat.cell) ?? false;
	}

	/** Forget where he was going. */
	cancel(): void {
		this.orders?.cancel();
	}

	/* ---------------------------------------------------------------- frames -- */

	/**
	 * Hear what the rules decided, and put it on the screen.
	 *
	 * Two things only, and both are the picture rather than the game: a shower
	 * of motes where a blow landed, and the swinger's tally of what came of it.
	 * What a blow COSTS is settled by the scripts, and what being hit does to
	 * the thing hit is heard by that thing — `Hunter` takes the bat's next move
	 * off it, and nothing here is told about that.
	 *
	 * The tallies go back to whoever threw the blow rather than being kept
	 * here, because a hit is his hit.
	 */
	private listen(): void {
		this.scripts.on(Damage, (blow) => {
			this.motes.spawn(blow.at.x, blow.at.y, blow.at.z, 9, 1.6, 1.9);
			if (blow.from === 'player') this.player.reportBlow(true, 'hit it');
			else this.bat.reportBite(true, 'bit you');
		});

		this.scripts.on(Missed, (miss) => {
			if (miss.by === 'player') this.player.reportBlow(false, miss.why);
			else this.bat.reportBite(false, miss.why === 'cut air' ? 'bit at nothing' : miss.why);
		});
	}

	/** What a spawn needs in order to be able to build a script component. */
	private scriptExtras(): Pick<SpawnExtras, 'scripts'> {
		return { scripts: { host: this.scripts, scene: this.scene } };
	}

	/**
	 * Build one entity from the cast, where a script asked for it.
	 *
	 * What `ScriptHost.spawn` calls. The host knows an id and a place; turning
	 * the first into a prefab and reading it against the component factories is
	 * the game's knowledge, and this is where the game keeps it.
	 *
	 * The extras travel with it, so an object carrying scripts of its own loads
	 * them the way one spawned at startup does.
	 */
	private spawnFromCast(id: string, placement: SpawnPlacement): GameObject {
		const entity = this.catalogue.get(id);
		if (!entity) {
			throw new Error(
				`the cast has no '${id}'; it loaded ${[...this.catalogue.keys()].sort().join(', ')}`,
			);
		}

		const object = spawnEntity(entity, this.scene, {
			extras: this.scriptExtras(),
			...(placement.name !== undefined ? { name: placement.name } : {}),
			...(placement.parent ? { parent: placement.parent } : {}),
		});

		const at = placement.at;
		if (at) object.transform.setPosition(at.x, at.y, at.z);
		if (placement.yaw !== undefined) object.transform.yaw = placement.yaw;
		return object;
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
		const actions = this.turns?.actions ?? 0;
		const moved = this.hoverAsked !== actions;
		const elsewhere =
			hover === null ||
			this.hover === null ||
			hover.q !== this.hover.q ||
			hover.r !== this.hover.r;
		this.hover = hover;
		if (hover && (moved || elsewhere)) {
			this.hoverReachable = this.orders?.reachable(hover) ?? false;
			this.hoverAsked = actions;
		} else if (!hover) {
			this.hoverReachable = false;
		}

		this.motes.update(dt);

		/*
		 * Everything in the scene that acts, in the order the scene holds them.
		 *
		 * Read rather than listed: this file used to name the two of them and
		 * drive each by hand, which meant a third creature was a line here as
		 * well as an entity file. The order is the spawn order, which is what
		 * the turn schedule's tie-break is built on — the man goes in first, so
		 * among creatures ready on the same game turn he acts after the faster
		 * ones and before the rest.
		 */
		this.actors.length = 0;
		this.actors.push(...this.scene.root.getComponentsInChildren(ActorBehaviour));


		/*
		 * Every component on the scene, which today means every script.
		 *
		 * It runs after the turns are resolved and before the actors draw
		 * themselves, which is the order the rest of this method already
		 * follows: what a script decides this frame is part of the game, and
		 * what the actors do with it is the picture. The bodies' own step is
		 * `advance` rather than `update` for exactly this reason — it needs the
		 * elapsed clock and it belongs below, not here.
		 */
		this.scene.update(dt);

		for (const actor of this.actors) {
			actor.advance(dt, this.elapsed);
			if (this.toggles.ik) actor.applyFootIK();
			actor.solve();
		}

		/*
		 * And then whatever is being carried, which has to be here and nowhere
		 * else. A bone follow reads a pose the actors have just solved and
		 * writes a local transform the scene is about to compose, so it sits
		 * between the two — put in `update` with the other components it would
		 * read last frame's pose and every prop would lag the body holding it
		 * by a frame.
		 *
		 * The second solve is the cost of that, and it is a handful of objects
		 * rather than a scene graph.
		 */
		for (const item of this.items) item.object.getComponent(Attach)?.follow();
		this.scene.solve();

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
		for (const actor of this.actors) actor.emit(opaque, blended, ghost);

		// One path, whether it is on a head or in the grass: the object's world
		// transform says where it is, and that is the whole of the difference.
		for (const item of this.items) item.emit(ghost ? blended : opaque, ghost ? 0.34 : 1);

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
			// Its own perch rather than this file's copy of it: where it sleeps
			// is where it was put, and the hunt is what learned that.
			const perch = this.bat.hunt?.home ?? this.perch;
			if (this.bat.state === 'asleep') ring(blended, perch, 0.75, 0.015, PERCH_COLOR, 0.3);

			const batPath = this.bat.path;
			if (batPath) {
				for (let i = 0; i < batPath.length && i < 24; i++) {
					ring(blended, batPath[i]!, 0.19, 0.02, BAT_PATH_COLOR, 0.75);
				}
			}

			// His own route, which lab 06 had and labs 07-09 did not need.
			const route = this.orders?.path ?? [];
			for (let i = 0; i < route.length && i < 40; i++) {
				ring(blended, route[i]!, 0.22, 0.02, ROUTE_COLOR, 0.7);
			}
			const goal = this.orders?.goal ?? null;
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
			actions: this.turns?.actions ?? 0,
			lastAction: this.turns?.last ?? 'nobody has moved',
			waitingForYou: !(this.orders?.hasOrders ?? false) && !this.player.busy && !this.bat.busy,
			secondsPerGameTurn: secondsPerGameTurn(),
			batMessage: this.bat.message,
			batState: this.bat.state,
			batRange: axialDistance(this.player.cell, this.bat.cell),
			batEnergy: this.bat.energy,
			batSpeedRating: this.bat.speed,
			batSpeedFactor: speedFactor(this.bat.speed),
			bites: this.bat.bites,
			batMissed: this.bat.missed,
			wakeRange: this.bat.hunt?.wakeRange ?? 0,
			loseRange: this.bat.hunt?.loseRange ?? 0,
			reach: this.player.reach.distance,
			lean: this.player.leanIn,
			hover: this.hover,
			hoverReachable: this.hoverReachable,
		};
	}
}
