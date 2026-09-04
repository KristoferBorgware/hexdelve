/*
 * The client: a canvas in, a running world out.
 *
 * This is the package the project distributes, so its surface is deliberately
 * small — create it, start it, stop it, throw it away — and its dependency
 * list is two workspace packages and nothing else. No framework, no bundler
 * runtime, no CDN script. The editor drives it through exactly this API, which
 * is the point: whatever the editor can do to the world, an embedder can too.
 */

import type { AssetLibrary, SystemAsset } from '@hexdelve/engine';
import {
	createRenderer,
	directionalShadowMatrix,
	ISO_PITCH,
	OrbitCamera,
	Ticker,
	type BackendPreference,
	type FrameCapture,
	type Light,
	type Renderer,
	type RendererInfo,
} from '@hexdelve/engine';
import { mat4, vec3, type Mat4, type Vec3 } from '@hexdelve/shared';

import { noScripts, type ScriptProvider } from '@hexdelve/engine';

import { openAssets, type OpenAssetsOptions } from './assets/library.js';
import { loadScripts } from './game/scripts.js';
import { loadCast, type Cast, type CastOptions } from './game/cast.js';
import { Controls } from './input/Controls.js';
import {
	Simulation,
	type SimulationOptions,
	type SimulationToggles,
	type YardStats,
} from './game/simulation.js';

/** Half the world height the viewport spans at zoom 1, matching the labs. */
const VIEW_HEIGHT = 5.5;

/** The one-of-a-kind objects, spawned before anything that registers with them. */
const SYSTEM_PREFAB = 'systems/game.system.yaml';

/**
 * What `options.scripts` means, resolved to a provider.
 *
 * Three spellings for one thing, and each has a caller: the default fetches,
 * a string fetches from somewhere else, a provider is handed straight through
 * (the editor's, which recompiles on every save), and `false` is a world with
 * no behaviour on it.
 */
function loadProvider(
	choice: ScriptProvider | string | false | undefined,
): Promise<ScriptProvider> {
	if (choice === false) return Promise.resolve(noScripts);
	if (choice === undefined) return loadScripts();
	if (typeof choice === 'string') return loadScripts({ url: choice });
	return Promise.resolve(choice);
}

/**
 * The sphere the shadow map covers: the whole yard, plus enough height for the
 * smithy's chimney, which is the tallest thing that casts.
 */
const SHADOW_FIT = { center: vec3.vec3(0, 1.5, 0), radius: 17 };

export interface ClientOptions {
	canvas: HTMLCanvasElement;
	/** Which renderer to ask for. Defaults to `auto`, which prefers WebGPU. */
	backend?: BackendPreference;
	/** Watch the canvas and follow its size. On by default. */
	autoResize?: boolean;
	/** Start the frame loop as soon as the client is created. On by default. */
	autoStart?: boolean;
	/** Attach keyboard, mouse and touch controls. On by default. */
	controls?: boolean;
	/**
	 * 4x multisampling, on by default. Worth turning off for a comparison
	 * between two renderers or against a stored picture: resolving a
	 * multisampled buffer is where two rasterisers most visibly disagree, and
	 * an edge one pixel softer is not a difference worth failing over.
	 */
	msaa?: boolean;
	/** Seed for the yard's scenery, so a given seed is a given yard. */
	seed?: number;
	toggles?: Partial<SimulationToggles>;
	/**
	 * The man's place in the energy table, 110 being normal. At 120 he has to
	 * cross a hexagon in half the time, so the stride solver puts him into a
	 * run — which is what a row of that table looks like.
	 */
	playerSpeed?: number;
	/** The bat's. +10 by default, which is exactly twice normal. */
	batSpeed?: number;
	/**
	 * How to reach the asset files, if the defaults are not right.
	 *
	 * Left alone this opens the tree at `assets/`, relative to the page, and
	 * works unchanged in a browser tab, on a Vite dev server and inside the
	 * desktop shell — which serves the build through a real `app://` origin
	 * for exactly this reason. Writable on the dev server and nowhere else.
	 */
	assets?: OpenAssetsOptions;
	/**
	 * Who is in the yard, by entity id. Defaults to the wanderer, the bat and
	 * the three things lying in the grass.
	 */
	cast?: CastOptions;
	/** The system prefab to spawn once. Defaults to the game's own. */
	systemPrefab?: string;
	/**
	 * Where the compiled scripts come from.
	 *
	 * Left alone, the bundle is fetched from `scripts.js` beside the page,
	 * which is what a shipped client does. Pass a provider to supply the
	 * classes directly, or `false` for a world with no behaviour on it — which
	 * is what the EDITOR passes, because it compiles the script directory in
	 * the page and reloads the host with the result. Fetching a bundle there
	 * would mean running somebody else's compile of the same files for a
	 * second, and in a built editor a compile from a different project
	 * altogether.
	 */
	scripts?: ScriptProvider | string | false;
	/**
	 * Called if the GPU takes the renderer's device away. The client stops its
	 * loop when this happens; recovering means disposing it and creating a new
	 * one on a fresh canvas.
	 */
	onDeviceLost?: (reason: string) => void;
}

export interface ClientStats {
	/** Smoothed frames per second. */
	fps: number;
	instances: number;
	backend: string;
}

export class HexdelveClient {
	readonly renderer: Renderer;
	/**
	 * The asset library, opened for whatever host this is.
	 *
	 * Created eagerly and read lazily: opening it costs nothing, and an
	 * embedder that wants an entity should not have to construct a second
	 * library and get the pose functions right by hand.
	 */
	readonly assets: AssetLibrary;
	readonly camera: OrbitCamera;
	readonly ticker: Ticker;
	readonly simulation: Simulation;

	/**
	 * The sun, at the labs' own bearing: 140 degrees round and 48 up, which is
	 * what puts the light across the terraces rather than down them and makes a
	 * step read as a step. Mutable, because the editor hangs a control off it.
	 */
	readonly light: Light & { direction: Vec3; ambient: Vec3; intensity: number } = {
		direction: vec3.normalize(vec3.vec3(), vec3.vec3(-0.514, 0.745, 0.432)),
		intensity: 0.95,
		// The sky's own colour, standing in for the labs' hemisphere light.
		ambient: vec3.vec3(0.42, 0.46, 0.49),
	};

	private readonly canvas: HTMLCanvasElement;
	private readonly simulationOptions: SimulationOptions;
	private readonly controls: Controls | null;
	private readonly resizeObserver: ResizeObserver | null;
	private instanceCount = 0;
	private smoothedFps = 0;
	private disposed = false;
	private readonly shadowMatrix: Mat4 = mat4.mat4();

	/**
	 * Creates a client.
	 *
	 * Asynchronous because asking for a GPU device is, and pretending
	 * otherwise would only move the await somewhere less obvious. It now has a
	 * second reason: the rigs, the bodies and the clips are files, and reading
	 * a file is asynchronous however it arrives.
	 *
	 * The two are started together rather than in turn. Neither needs the
	 * other — the assets are text and the device is a device — so waiting for
	 * the GPU before asking for the manifest would add a round trip to every
	 * start for no reason.
	 */
	static async create(options: ClientOptions): Promise<HexdelveClient> {
		// The client has to exist before it can stop itself, so the callback
		// reaches it through a box rather than through `this`.
		const box: { client: HexdelveClient | null } = { client: null };

		const assets = openAssets(options.assets ?? {});
		const casting = loadCast(assets, options.cast ?? {});
		/*
		 * The systems, read beside the cast. Both are files and neither needs
		 * the other, so neither waits: `Promise.all` below is one round trip
		 * rather than two.
		 */
		const systems = assets.system(options.systemPrefab ?? SYSTEM_PREFAB);
		/*
		 * The scripts, read beside them. Compiled apart from this package and
		 * fetched like an asset — see `game/scripts.ts` for why they are not
		 * simply imported.
		 */
		const behaviour = loadProvider(options.scripts);

		const renderer = await createRenderer({
			canvas: options.canvas,
			...(options.backend !== undefined ? { backend: options.backend } : {}),
			...(options.msaa !== undefined ? { msaa: options.msaa } : {}),
			clearColor: [0.66, 0.76, 0.71, 1],
			onDeviceLost: (reason) => {
				box.client?.stop();
				options.onDeviceLost?.(reason);
			},
		});

		const [cast, system, scripts] = await Promise.all([casting, systems, behaviour]);
		box.client = new HexdelveClient(options, renderer, assets, cast, [system], scripts);
		return box.client;
	}

	private constructor(
		options: ClientOptions,
		renderer: Renderer,
		assets: AssetLibrary,
		cast: Cast,
		systems: readonly SystemAsset[],
		scripts: ScriptProvider,
	) {
		this.canvas = options.canvas;
		this.renderer = renderer;
		this.assets = assets;

		/*
		 * The labs' camera exactly: orthographic at the isometric pitch, so a
		 * hexagon is the same hexagon wherever it sits on the screen and the
		 * terraces read as steps rather than as perspective.
		 */
		this.camera = new OrbitCamera({
			projection: 'orthographic',
			viewHeight: VIEW_HEIGHT,
			zoom: 1.35,
			pitch: ISO_PITCH,
			yaw: (62 * Math.PI) / 180,
			distance: 60,
			near: 0.1,
			far: 200,
		});

		this.simulationOptions = {
			cast,
			systems,
			scripts,
			...(options.seed !== undefined ? { seed: options.seed } : {}),
			...(options.toggles ? { toggles: options.toggles } : {}),
			...(options.playerSpeed !== undefined ? { playerSpeed: options.playerSpeed } : {}),
			...(options.batSpeed !== undefined ? { batSpeed: options.batSpeed } : {}),
		};
		this.simulation = new Simulation(this.simulationOptions);

		this.camera.target[0] = this.simulation.focus.x;
		this.camera.target[1] = this.simulation.focus.y;
		this.camera.target[2] = this.simulation.focus.z;

		this.ticker = new Ticker();
		this.ticker.onFrame = this.onFrame;

		this.controls =
			options.controls === false
				? null
				: new Controls(this.canvas, this.camera, {
						onPick: () => this.order(),
						onHold: () => this.simulation.hold(),
						onCancel: () => this.simulation.cancel(),
					});

		if (options.autoResize === false) {
			this.resizeObserver = null;
			this.resize();
		} else {
			this.resizeObserver = new ResizeObserver(() => this.resize());
			this.resizeObserver.observe(this.canvas);
			this.resize();
		}

		if (options.autoStart !== false) this.start();
	}

	get info(): RendererInfo {
		return this.renderer.info;
	}

	get running(): boolean {
		return this.ticker.running;
	}

	get stats(): ClientStats {
		return {
			fps: this.smoothedFps,
			instances: this.instanceCount,
			backend: this.renderer.backend,
		};
	}

	/** The readout: the clock, whose turn it is, and what the bat is doing. */
	get state(): YardStats {
		return this.simulation.stats;
	}

	get toggles(): SimulationToggles {
		return this.simulation.toggles;
	}

	start(): void {
		if (!this.disposed) this.ticker.start();
	}

	stop(): void {
		this.ticker.stop();
	}

	/**
	 * Rebuilds the world from a new seed.
	 *
	 * The simulation's own options come along, so a client opened with a hasted
	 * man or an evenly-matched bat is still that after a reseed — dropping them
	 * here would make the editor's seed box quietly undo the query string.
	 */
	setSeed(seed: number): void {
		const toggles = { ...this.simulation.toggles };
		(this as { simulation: Simulation }).simulation = new Simulation({
			...this.simulationOptions,
			seed,
			toggles,
		});
	}

	/** Matches the drawing buffer to the canvas's laid-out size. */
	resize(): void {
		if (this.disposed) return;
		const width = this.canvas.clientWidth || this.canvas.width;
		const height = this.canvas.clientHeight || this.canvas.height;
		this.renderer.resize(width, height, window.devicePixelRatio || 1);
	}

	/** Advances and draws one frame without running the loop. */
	step(dt: number): void {
		if (this.disposed) return;
		this.advance(dt);
		this.draw();
	}

	/** Draws the current state without advancing — for a paused viewport. */
	renderOnce(): void {
		if (this.disposed) return;
		this.draw();
	}

	/**
	 * The pixels of the next frame, read off the GPU.
	 *
	 * For comparing the two backends against each other: they are meant to draw
	 * the same picture out of two shaders written twice, and this is what lets
	 * something check rather than assume.
	 */
	captureFrame(): Promise<FrameCapture> {
		return this.renderer.captureFrame();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.ticker.stop();
		this.controls?.dispose();
		this.resizeObserver?.disconnect();
		this.renderer.dispose();
	}

	private readonly onFrame = (dt: number): void => {
		// An exponential average, so the readout is legible rather than exact.
		if (dt > 0) this.smoothedFps += (1 / dt - this.smoothedFps) * 0.1;
		this.advance(dt);
		this.draw();
	};

	/**
	 * Turn wherever the pointer is into an order for the man.
	 *
	 * Public because it is the whole of the game's input, and an embedder with
	 * its own buttons — or a test driving the yard without a mouse — should be
	 * able to give an order without synthesising a pointer event. Returns false
	 * if there is no way to the hexagon under the cursor.
	 */
	order(): boolean {
		const point = this.controls?.aimOnPlane(this.hoverPlane) ?? null;
		return point ? this.simulation.pick(point) : false;
	}

	/**
	 * The plane the cursor is intersected with: just above the terrace he is
	 * standing on, so the hexagon under the pointer is the one it looks like.
	 */
	private get hoverPlane(): number {
		return this.simulation.player.y + 0.02;
	}

	private advance(dt: number): void {
		const hover = this.controls?.aimOnPlane(this.hoverPlane) ?? null;

		this.simulation.update(dt, { hover });

		if (this.simulation.toggles.follow) {
			this.camera.target[0] = this.simulation.focus.x;
			this.camera.target[1] = this.simulation.focus.y;
			this.camera.target[2] = this.simulation.focus.z;
		}

		const built = this.simulation.build();
		this.instanceCount = built.ranges.opaque + built.ranges.blended + built.ranges.overlay;
		this.renderer.setInstances(built.data, built.ranges);
	}

	private draw(): void {
		if (!this.renderer.alive) return;

		const width = this.canvas.width;
		const height = this.canvas.height;
		if (width === 0 || height === 0) return;

		// Rebuilt each frame rather than cached, because the sun is a control the
		// editor can move and two matrices that disagree about where it is
		// would light the scene from one place and shadow it from another.
		directionalShadowMatrix(
			this.shadowMatrix,
			this.light.direction,
			SHADOW_FIT,
			this.renderer.depthRange,
		);

		this.renderer.render({
			viewProjection: this.camera.matrix(width / height, this.renderer.depthRange),
			light: this.light,
			shadow: { viewProjection: this.shadowMatrix, bias: 0.0022 },
		});
	}
}
