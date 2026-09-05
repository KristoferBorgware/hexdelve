/*
 * The level bench: one generated dungeon, lit, from above.
 *
 * Its sibling next door holds a character still so a pose can be judged. This
 * one holds a LEVEL still for the same reason and against a different problem:
 * a generator is a function from a seed to a shape, and the only way to know
 * whether the shape is any good is to look at a lot of them quickly, side by
 * side, with the knobs in reach. So the bench owns a renderer, a camera and a
 * level — and no clock at all beyond the one that draws frames, because nothing
 * here moves. Regenerating is a keystroke, not a tick.
 *
 * It knows nothing about how a level is made. `@hexdelve/client` exports the
 * stacks; this draws a `Level`. Adding a third algorithm adds nothing to this
 * file, which is the property that makes the comparison worth trusting: two
 * stacks cannot look different because one of them got nicer drawing code.
 *
 * The camera is the game's, not the character bench's — orthographic at the
 * isometric pitch, because a dungeon is read as a MAP and convergence makes the
 * far side of a room a different size from the near side. That is exactly the
 * distortion you must not have while judging whether a corridor is one tile
 * wide.
 *
 * There is nothing here that draws a wall on an edge, and there never will be
 * again: a hexagon is the atom of this game, so a wall is a rock cell and is
 * drawn as one. The slabs this used to put on the boundaries between floor
 * tiles existed for a tileset that has since been replaced for the same reason.
 */

import {
	createRenderer,
	directionalShadowMatrix,
	HEX_FLAG_UNLIT,
	HexInstances,
	ISO_PITCH,
	OrbitCamera,
	type BackendPreference,
	type Light,
	type Renderer,
	type RendererInfo,
} from '@hexdelve/engine';
import { STITCH_TILE, type Level, type LevelCell } from '@hexdelve/client';
import { axialToWorld, mat4, SQRT3, vec3, type Mat4, type Vec3 } from '@hexdelve/shared';

import { BenchControls } from '../../bench/BenchControls.js';

/** Tile footprint. Just under 1, so a seam of shadow separates neighbours. */
const TILE_RADIUS = 0.985;
/** How thick the floor slab is, and therefore where everything stands. */
const FLOOR_DEPTH = 0.14;
/**
 * How tall solid rock is above that floor.
 *
 * Lower than it wants to be, and the room stack is why. A corridor there is one
 * tile wide with rock on both sides, and at the isometric pitch a trench that
 * deep is a black slot: the level reads as rooms with nothing joining them,
 * which is the opposite of what the picture is for. Tall enough to read as a
 * wall, short enough to see the floor of a passage between two of them.
 */
const ROCK_HEIGHT = 0.62;
const ENTRY_COLOR = 0x4fd47a;
const EXIT_COLOR = 0xe8763a;
const ROUTE_COLOR = 0x7fc4ff;

/**
 * Colours for the region overlay.
 *
 * Not a gradient and not a hash into HSL: neighbouring components must be
 * TELLABLE APART, and adjacent hues are not. Six well-separated ones, cycled,
 * is what makes "how many pieces did this come out in" answerable at a glance —
 * which is the single most useful thing to know about a wave function's output.
 */
const REGION_COLORS = [0x6f9ad4, 0xd48f5a, 0x77b573, 0xb56fa8, 0xc7bb62, 0x63b4b0];

/** What a dug tunnel goes when the stitching overlay is on. */
const STITCH_HIGHLIGHT = 0x4ec9d6;

/** One per vault entity kind. Distinct rather than pretty: they are a readout. */
const ENTITY_COLORS: Record<string, number> = {
	monster: 0xe05252,
	loot: 0xf0c64a,
	trap: 0xb060d0,
	light: 0xfff0b0,
	marker: 0x7ea6ff,
};

export interface LevelBenchOptions {
	canvas: HTMLCanvasElement;
	backend?: BackendPreference;
	autoResize?: boolean;
	controls?: boolean;
	onDeviceLost?: (reason: string) => void;
}

export interface LevelShow {
	/** The solid rock. Off leaves the walkable floor hanging in the dark. */
	rock: boolean;
	/** The entry, the exit, and the way between them. */
	route: boolean;
	/** Colour the floor by connected component instead of by tile. */
	regions: boolean;
	/** Pick out the tunnels the stitcher dug, so its work can be judged. */
	stitching: boolean;
	/** The monsters, loot and traps the vaults put in their rooms. */
	entities: boolean;
}

export interface LevelBenchStats {
	instances: number;
	/** How long the last draw took, in milliseconds. */
	drawMs: number;
}

export class LevelBench {
	readonly renderer: Renderer;
	readonly camera: OrbitCamera;

	/** The yard's sun, so a level here is lit the way the game would light it. */
	readonly light: Light & { direction: Vec3; ambient: Vec3; intensity: number } = {
		direction: vec3.normalize(vec3.vec3(), vec3.vec3(-0.514, 0.745, 0.432)),
		intensity: 1,
		ambient: vec3.vec3(0.36, 0.38, 0.42),
	};

	readonly show: LevelShow = {
		rock: true,
		route: true,
		regions: false,
		stitching: false,
		entities: true,
	};

	private level: Level | null = null;

	private readonly opaque = new HexInstances(8192);
	private readonly overlay = new HexInstances(2048);
	private readonly frame = new HexInstances(10240);

	private readonly canvas: HTMLCanvasElement;
	private readonly controls: BenchControls | null;
	private readonly resizeObserver: ResizeObserver | null;
	private readonly shadowMatrix: Mat4 = mat4.mat4();
	private shadowRadius = 12;
	private instanceCount = 0;
	private drawMs = 0;
	private disposed = false;

	static async create(options: LevelBenchOptions): Promise<LevelBench> {
		const box: { bench: LevelBench | null } = { bench: null };

		const renderer = await createRenderer({
			canvas: options.canvas,
			...(options.backend !== undefined ? { backend: options.backend } : {}),
			// Near black rather than the character bench's studio grey. A level
			// is judged by its silhouette against the void it is cut out of, and
			// a light backdrop makes the rock read as the subject.
			clearColor: [0.055, 0.06, 0.07, 1],
			onDeviceLost: (reason) => options.onDeviceLost?.(reason),
		});

		box.bench = new LevelBench(options, renderer);
		return box.bench;
	}

	private constructor(options: LevelBenchOptions, renderer: Renderer) {
		this.canvas = options.canvas;
		this.renderer = renderer;

		this.camera = new OrbitCamera({
			projection: 'orthographic',
			target: vec3.vec3(0, 0, 0),
			// A quarter turn puts a flat side of the hex towards the viewer, so
			// the grid reads as rows rather than as a field of points.
			yaw: Math.PI * 0.25,
			pitch: ISO_PITCH,
			viewHeight: 18,
			// Set per level in `frameLevel`: an orthographic frustum has to hold
			// the whole disc along the view direction, and a disc of three
			// hundred rings is a thousand units across. Fixed planes clipped
			// away most of it.
			near: -200,
			far: 200,
		});
		this.camera.minZoom = 0.25;
		this.camera.maxZoom = 6;

		this.controls =
			options.controls === false
				? null
				: new BenchControls(this.canvas, this.camera, { onChange: () => this.draw() });

		if (options.autoResize === false) {
			this.resizeObserver = null;
			this.resize();
		} else {
			this.resizeObserver = new ResizeObserver(() => this.resize());
			this.resizeObserver.observe(this.canvas);
			this.resize();
		}
	}

	get info(): RendererInfo {
		return this.renderer.info;
	}

	get stats(): LevelBenchStats {
		return { instances: this.instanceCount, drawMs: this.drawMs };
	}

	get current(): Level | null {
		return this.level;
	}

	/**
	 * Put a level on the bench.
	 *
	 * The camera is left alone unless the level changed SIZE. Sweeping a
	 * threshold slider is comparing one shape against the one before it, and a
	 * view that re-framed itself on every value would make that impossible.
	 */
	setLevel(level: Level): void {
		const reframe = this.level === null || this.level.radius !== level.radius;
		this.level = level;
		this.shadowRadius = SQRT3 * level.radius + 3;
		if (reframe) this.frameLevel();
		this.build();
		this.draw();
	}

	/** Look at the whole disc from the front, at the pitch the game uses. */
	frameLevel(): void {
		const radius = this.level?.radius ?? 10;
		this.camera.target[0] = 0;
		this.camera.target[1] = 0;
		this.camera.target[2] = 0;
		this.camera.yaw = Math.PI * 0.25;
		this.camera.pitch = ISO_PITCH;
		this.camera.zoom = 1;
		// The disc spans 1.5 * radius in z and sqrt(3) * radius in x; at this
		// pitch the taller of the two is what the frustum has to hold, plus a
		// tile of margin so the rim is not flush with the edge of the viewport.
		this.camera.viewHeight = SQRT3 * radius * 0.82 + 2;
		// Generous, and symmetric about the target: the camera sits at the
		// middle of an orthographic box rather than at its near face, so half
		// the depth has to be behind it.
		const span = SQRT3 * radius + 20;
		this.camera.near = -span * 2;
		this.camera.far = span * 2;
		this.draw();
	}

	/** Rebuild and redraw — for a `show` toggle, which changes no level. */
	refresh(): void {
		if (this.disposed) return;
		this.build();
		this.draw();
	}

	resize(): void {
		if (this.disposed) return;
		const width = this.canvas.clientWidth || this.canvas.width;
		const height = this.canvas.clientHeight || this.canvas.height;
		this.renderer.resize(width, height, window.devicePixelRatio || 1);
		this.draw();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.controls?.dispose();
		this.resizeObserver?.disconnect();
		this.renderer.dispose();
	}

	/** Everything on screen, from the level and the toggles. */
	private build(): void {
		const { opaque, overlay, frame } = this;
		opaque.clear();
		overlay.clear();

		const level = this.level;
		if (level) {
			for (const cell of level.cells.values()) this.emitCell(opaque, cell);
			if (this.show.route) this.emitRoute(overlay, level);
			if (this.show.entities) this.emitEntities(overlay, level);
		}

		frame.clear();
		frame.pushAll(opaque);
		frame.pushAll(overlay);

		this.instanceCount = opaque.count + overlay.count;
		this.renderer.setInstances(frame.data, {
			opaque: opaque.count,
			blended: 0,
			overlay: overlay.count,
		});
	}

	private emitCell(out: HexInstances, cell: LevelCell): void {
		const { x, z } = axialToWorld(cell.q, cell.r);

		if (cell.kind === 'rock') {
			if (!this.show.rock) return;
			// Shaded per cell, or a hundred tiles of one colour read as a single
			// flat sheet with a hexagonal pattern drawn on it rather than as
			// stone. Deterministic from the coordinates, so the variation is a
			// property of the place and does not crawl when the level redraws.
			out.pushUpright(x, 0, z, TILE_RADIUS, FLOOR_DEPTH + ROCK_HEIGHT, shade(cell.color, cell.q, cell.r));
			return;
		}

		// Stitching wins over regions on purpose: with the stitch on there is
		// only one region to colour by, so the question the two toggles answer
		// together is "was it one piece already, and if not what joined it".
		const color = this.show.stitching && cell.tile === STITCH_TILE
			? STITCH_HIGHLIGHT
			: this.show.regions && cell.region >= 0
				? REGION_COLORS[cell.region % REGION_COLORS.length]!
				: cell.color;
		out.pushUpright(x, 0, z, TILE_RADIUS, FLOOR_DEPTH, color);
	}

	/**
	 * The entry, the exit and the way between them, drawn unlit.
	 *
	 * Unlit because these are a readout rather than scenery: a marker that goes
	 * dark on the shaded side of the level is a marker you cannot find, and
	 * finding them is the entire job. They go in the overlay pass for the same
	 * reason the character bench's bone marker does — a wall in front of the
	 * stairs must not be able to hide where the stairs are.
	 */
	private emitRoute(out: HexInstances, level: Level): void {
		for (const cell of level.route) {
			const { x, z } = axialToWorld(cell.q, cell.r);
			out.pushRadial(x, FLOOR_DEPTH + 0.03, z, 0.2, 0.06, ROUTE_COLOR, {
				alpha: 0.85,
				flags: HEX_FLAG_UNLIT,
			});
		}

		if (level.entry) this.emitMarker(out, level.entry.q, level.entry.r, ENTRY_COLOR);
		if (level.exit) this.emitMarker(out, level.exit.q, level.exit.r, EXIT_COLOR);
	}

	/**
	 * What the vaults put in their rooms, as a pip per entity.
	 *
	 * Unlit and in the overlay, like the route markers and for the same reason:
	 * these are a readout of a decision somebody made while drawing the vault,
	 * and a readout that goes dark on the shaded side of the level is one you
	 * cannot use. Small, because there can be a dozen in one room and the shape
	 * of the room is still the thing being judged.
	 */
	private emitEntities(out: HexInstances, level: Level): void {
		for (const placed of level.vaults) {
			for (const entity of placed.entities) {
				const q = entity.col - ((entity.row - (entity.row & 1)) >> 1);
				const { x, z } = axialToWorld(q, entity.row);
				out.pushRadial(x, FLOOR_DEPTH + 0.16, z, 0.26, 0.22, ENTITY_COLORS[entity.kind], {
					flags: HEX_FLAG_UNLIT,
				});
			}
		}
	}

	private emitMarker(out: HexInstances, q: number, r: number, color: number): void {
		const { x, z } = axialToWorld(q, r);
		// A plate on the tile, so it is findable from directly above, and a post
		// over it, so it is findable when a wall is in the way.
		out.pushRadial(x, FLOOR_DEPTH + 0.04, z, 0.78, 0.08, color, { flags: HEX_FLAG_UNLIT });
		out.pushUpright(x, FLOOR_DEPTH, z, 0.2, 1.35, color, { flags: HEX_FLAG_UNLIT });
	}

	private draw(): void {
		if (this.disposed || !this.renderer.alive) return;

		const width = this.canvas.width;
		const height = this.canvas.height;
		if (width === 0 || height === 0) return;

		const startedAt = performance.now();

		directionalShadowMatrix(
			this.shadowMatrix,
			this.light.direction,
			{ center: vec3.vec3(0, 0.5, 0), radius: this.shadowRadius },
			this.renderer.depthRange,
		);

		this.renderer.render({
			viewProjection: this.camera.matrix(width / height, this.renderer.depthRange),
			light: this.light,
			// The bias scales with what the map has to cover: one shadow map
			// over a disc of three hundred rings has texels a metre wide, and a
			// bias tuned for a small level is acne at that size.
			shadow: {
				viewProjection: this.shadowMatrix,
				bias: 0.002 * Math.max(1, this.shadowRadius / 25),
			},
		});

		this.drawMs = performance.now() - startedAt;
	}
}

/**
 * A colour nudged by a few percent, from the cell's own coordinates.
 *
 * The yard does this with `jitter` and a seeded random, which is right for a
 * world built once. A bench redraws the same level whenever a checkbox moves,
 * so the nudge has to be a function of the position rather than of the order
 * the cells happened to be visited in.
 */
function shade(color: number, q: number, r: number): number {
	let h = (Math.imul(q | 0, 374761393) + Math.imul(r | 0, 668265263)) >>> 0;
	h = (h ^ (h >>> 13)) >>> 0;
	h = Math.imul(h, 1274126177) >>> 0;

	const delta = (((h >>> 16) & 0xff) / 255 - 0.5) * 24;
	const clamp = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));
	return (
		(clamp(((color >> 16) & 0xff) + delta) << 16) |
		(clamp(((color >> 8) & 0xff) + delta) << 8) |
		clamp((color & 0xff) + delta)
	);
}
