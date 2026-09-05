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
	type SceneAsset,
	type ScriptProvider,
	type SpawnPlacement,
} from '@hexdelve/engine';

import {
	HEX_FLAG_UNLIT,
	Attach,
	FootIK,
	MeshRenderer,
	Rig,
	entityAnimations,
	entityRig,
	HexInstances,
	instantiate,
	Particles,
	Scene,
	type GameObject,
	type InstanceRanges,
	type ParticleEffect,
	type SystemAsset,
} from '@hexdelve/engine';
import {
	axialDistance,
	makeRandom,
	rgbFromHex,
	worldToAxial,
	type Axial,
} from '@hexdelve/shared';

import { terrainOn, type TerrainQuery } from './terrain.js';
import { BLOOD_EFFECT, spawnEmitter } from './effects.js';
import { Damage } from './events.js';
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
	 * What is in this world, and where. Required: everything in it — the
	 * ground, the rigs, the bodies, the clips, the reach measured off them —
	 * comes out of files, and a simulation cannot make any of it up.
	 */
	scene: SceneAsset;
	/**
	 * The prefabs there is exactly one of, spawned before anything else.
	 *
	 * Order matters and is the whole reason they are separate: a register has
	 * to exist before the first thing that registers with it, so systems go
	 * into the world ahead of the scene rather than beside it. They are not in
	 * the scene file because they are in EVERY scene — a line each one had to
	 * remember to carry would be a line each one could forget.
	 */
	systems?: readonly SystemAsset[];
	/**
	 * The particle effects the manifest listed, by id.
	 *
	 * Optional, and an absent one is a yard with no smoke over the chimneys and
	 * no blood off a blow rather than a yard that will not start — see
	 * `effects.ts`.
	 */
	effects?: ReadonlyMap<string, ParticleEffect>;
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
	/** The ground, as its script answers for it. */
	readonly terrain: TerrainQuery;
	readonly player: Player;
	readonly bat: BatHunt;
	readonly items: Item[];
	readonly toggles: SimulationToggles;

	/** Where the camera should be looking, when it is following. */
	readonly focus = { x: 0, y: 0, z: 0 };

	/**
	 * The effects the manifest listed, by id.
	 *
	 * Held rather than resolved once at construction, because the blood is
	 * spawned when a blow lands and the file has to still be reachable then.
	 */
	private readonly effects: ReadonlyMap<string, ParticleEffect>;

	/**
	 * Every emitter in the scene, refreshed once a frame.
	 *
	 * Held rather than re-walked for the reason `actors` is: `build` runs after
	 * `update` and both want the same list. Refreshed rather than kept, because
	 * a one-shot takes itself out of the scene when it is done and a burst
	 * arrives in the middle of a fight.
	 */
	private readonly emitters: Particles[] = [];

	/**
	 * Everything that acts, refreshed at the top of each frame.
	 *
	 * Held rather than re-walked, because `build` runs after `update` and both
	 * want the same list — and a list that changed between the two would draw
	 * something that had not moved.
	 */
	private readonly actors: ActorBehaviour[] = [];
	private perch: Axial;
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
		this.effects = options.effects ?? new Map();

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

		const scene = options.scene;
		this.scene = new Scene({ name: scene.id });

		/*
		 * The script host, before anything that could carry a script is
		 * spawned. It is handed a provider rather than finding one: which
		 * classes exist is a question about the build, not about the game.
		 */
		this.scripts = new ScriptHost(options.scripts ?? noScripts, {
			spawn: (id, placement) => this.spawnFromScene(id, placement),
		});

		/*
		 * What a script may ask for by name: everything this scene places, and
		 * whatever it listed as spawnable and left unplaced.
		 */
		this.catalogue = new Map(
			[
				...scene.objects.flatMap((one) => (one.entity ? [one.entity] : [])),
				...scene.spawnable,
			].map((entity) => [entity.id, entity]),
		);

		/*
		 * The systems, ahead of everything the scene lists. A register has to
		 * exist before the first thing that registers with it, and they are not
		 * in the scene file because they are in every scene.
		 */
		this.systems = this.scene.spawn('systems');
		for (const system of options.systems ?? []) {
			instantiate(system.prefab, this.scene, components, {
				parent: this.systems,
				file: `${system.id}.system.yaml`,
				extras: { scripts: { host: this.scripts, scene: this.scene } },
			});
		}

		/*
		 * Everything the scene lists, in the order it lists them.
		 *
		 * Order is the file's, and it matters in one place: the ground has to
		 * be down before anything that stands on it, because a building sits at
		 * the height of the tile under it and until there is a tile there is no
		 * height to sit at. The scene says so by putting the terrain first,
		 * which is a thing a person can see rather than a rule in here.
		 */
		const placed = new Map<string, GameObject>();
		for (const object of scene.objects) {
			const spawned = instantiate(object.prefab, this.scene, components, {
				extras: this.scriptExtras(),
				file: `${scene.id}.scene.yaml`,
				at: object.at,
				euler: object.euler,
				...(object.name !== null ? { name: object.name } : {}),
			});
			placed.set(spawned.name, spawned);
		}

		const ground = placed.get('terrain') ?? null;
		const terrain = ground && terrainOn(ground);
		if (!terrain) {
			throw new Error(
				`the scene '${scene.id}' has no object with a Terrain script on it, so it has no ` +
					'ground; a world built without the scripts compiled cannot stand anything up',
			);
		}
		this.terrain = terrain;

		/*
		 * The gear, found in what was placed rather than listed here. An item is
		 * an entity carrying an `item` component, so what is pickupable in this
		 * world is a question about the world rather than an argument.
		 */
		this.items = [];
		for (const object of this.scene.root.walk()) {
			const item = object.getComponent(Item);
			if (item) this.items.push(item);
		}

		/*
		 * And set down where the scene put them, on the tile they are over.
		 *
		 * Snapped to the tile centre, which is a rule rather than a tidy-up:
		 * picking a thing up is a question about a hexagon — is it on mine — so
		 * a sword lying a hand's breadth over a boundary would be on a hexagon
		 * other than the one it looks like it is on.
		 */
		for (const item of this.items) {
			const { transform } = item.object;
			const cell = worldToAxial(transform.position[0]!, transform.position[2]!);
			const tile = this.terrain.tileAt(cell.q, cell.r);
			if (tile) item.ground(tile.x, tile.z, transform.yaw, tile.top);
		}

		/*
		 * The two the yard's readout and its input still name.
		 *
		 * By the name the scene calls them, because what a thing IS and what
		 * PART it plays here are different questions — a `wanderer2` is the
		 * `player` in this world and would be somebody else in another.
		 */
		const playerObject = placed.get('player');
		const batObject = placed.get('bat');
		if (!playerObject || !batObject) {
			throw new Error(
				`the scene '${scene.id}' must name an object 'player' and one 'bat'; it has ` +
					`${[...placed.keys()].join(', ')}`,
			);
		}

		const playerEntity = scene.objects.find((one) => one.name === 'player')?.entity ?? null;
		if (!playerEntity) throw new Error(`the scene '${scene.id}' places no entity as its player`);

		/* Where his eyeline is, off his own rig — a camera follows the hips. */
		this.hipHeight = entityRig(playerEntity)?.metrics.hipHeight ?? 0;

		/*
		 * And how long a game turn is, off his walk. One turn is a tenth of the
		 * time that walk takes to cross a hexagon, so the clock is measured
		 * from the clip he is drawn with rather than from a number beside it —
		 * which is what keeps his step and his place in the energy table the
		 * same fact.
		 */
		const walk = entityAnimations(playerEntity).get('walk')?.speed();
		if (!walk) {
			throw new Error(`'${playerEntity.id}' has no measurable walk to set the turn clock from`);
		}
		setWalkSpeed(walk.z);

		const swordTip = this.items
			.map((item) => item.object.getComponent(MeshRenderer)?.asset?.anchors.tip?.at)
			.find((tip) => tip !== undefined);
		if (!swordTip) throw new Error(`this scene has nothing with a 'tip' anchor to measure a reach from`);

		const at = (object: GameObject) =>
			worldToAxial(object.transform.position[0]!, object.transform.position[2]!);

		this.player = playerObject.addComponent(Player, {
			swordTip,
			cell: at(playerObject),
			yaw: playerObject.transform.yaw,
			terrain: this.terrain,
			items: this.items,
			scripts: this.scripts,
			...(options.playerSpeed !== undefined ? { speed: options.playerSpeed } : {}),
		});

		this.perch = at(batObject);
		this.bat = batObject.addComponent(BatHunt, {
			cell: this.perch,
			yaw: batObject.transform.yaw,
			terrain: this.terrain,
			random,
			scripts: this.scripts,
			...(options.batSpeed !== undefined ? { speed: options.batSpeed } : {}),
		});

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
	 * One thing, and it is the picture rather than the game: a shower of blood
	 * where a blow landed. What a blow COSTS is settled by the scripts, what a
	 * blow DID goes back to the `Melee` that threw it, and what being hit does
	 * to the thing hit is heard by that thing — `Hunter` takes the bat's next
	 * move off it, and nothing here is told about that.
	 */
	private listen(): void {
		this.scripts.on(Damage, (blow) => this.spatter(blow.at.x, blow.at.y, blow.at.z));
	}

	/**
	 * Blood where a blow landed.
	 *
	 * A one-shot emitter left standing in the air, rather than a burst on the
	 * thing that was hit: what is thrown off belongs to the air it was thrown
	 * into, and a bat that flies on should not carry its own blood with it. It
	 * destroys itself once the last fleck has gone, so a long fight does not
	 * leave a scene full of spent emitters.
	 */
	private spatter(x: number, y: number, z: number): void {
		const blood = this.effects.get(BLOOD_EFFECT);
		if (!blood) return;
		spawnEmitter(this.scene, blood, { x, y, z, name: 'blood', autoDestroy: true });
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
	private spawnFromScene(id: string, placement: SpawnPlacement): GameObject {
		const entity = this.catalogue.get(id);
		if (!entity) {
			throw new Error(
				`this scene has no '${id}'; it loaded ${[...this.catalogue.keys()].sort().join(', ')}`,
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

		// Whether feet are planted is a switch on each pair of them, because
		// every creature solves its own inside its own frame.
		for (const footIK of this.scene.root.getComponentsInChildren(FootIK)) {
			footIK.enabled = this.toggles.ik;
		}

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

		/*
		 * And every emitter, read AFTER the scene has updated rather than
		 * before it with the actors. A blow lands during that update and throws
		 * a burst of blood; a list taken beforehand would not have it, and the
		 * spray would appear a frame after the hit that caused it.
		 */
		this.emitters.length = 0;
		this.emitters.push(...this.scene.root.getComponentsInChildren(Particles));

		/*
		 * And then whatever is being carried, which has to be here and nowhere
		 * else. The actors drew themselves during `scene.update` above, each in
		 * its own order — see `ActorBehaviour.update`. A bone follow reads a
		 * pose the actors have just solved and writes a local transform the
		 * scene is about to compose, so it sits between the two — put in
		 * `update` with the other components it would read last frame's pose
		 * and every prop would lag the body holding it by a frame.
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
	 * and three spans. The buildings are a single array copy — nothing about
	 * them moves, and rebuilding two hundred prisms a frame to draw the same
	 * picture would be waste with nothing to show for it.
	 */
	build(): { data: Float32Array; ranges: InstanceRanges } {
		const { opaque, blended, overlay } = this;
		opaque.clear();
		blended.clear();
		overlay.clear();

		/*
		 * The scenery: every mesh in the scene that is neither a body nor a
		 * thing hanging off one.
		 *
		 * A body has a rig and is drawn by its actor, which knows whether it is
		 * being ghosted; a carried thing has an attach and is drawn by its item,
		 * which knows what it is worth. Everything else stands where it is and
		 * draws itself — the ground today, and whatever a scene file puts down
		 * tomorrow.
		 */
		for (const object of this.scene.root.walk()) {
			if (object.getComponent(Rig) || object.getComponent(Attach)) continue;
			object.getComponent(MeshRenderer)?.emit(opaque);
		}

		const ghost = this.toggles.skeleton;
		for (const actor of this.actors) actor.emit(opaque, blended, ghost);

		// One path, whether it is on a head or in the grass: the object's world
		// transform says where it is, and that is the whole of the difference.
		for (const item of this.items) item.emit(ghost ? blended : opaque, ghost ? 0.34 : 1);

		for (const emitter of this.emitters) emitter.emit(blended);
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
			const tile = this.terrain.tileAt(cell.q, cell.r);
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
			bites: this.bat.melee?.hits ?? 0,
			batMissed: this.bat.melee?.missed ?? 0,
			wakeRange: this.bat.hunt?.wakeRange ?? 0,
			loseRange: this.bat.hunt?.loseRange ?? 0,
			reach: this.player.reach.distance,
			lean: this.player.leanIn,
			hover: this.hover,
			hoverReachable: this.hoverReachable,
		};
	}
}
