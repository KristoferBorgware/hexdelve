/*
 * The client: a canvas in, a running world out.
 *
 * This is the package the project distributes, so its surface is deliberately
 * small — create it, start it, stop it, throw it away — and its dependency
 * list is two workspace packages and nothing else. No framework, no bundler
 * runtime, no CDN script. The editor drives it through exactly this API, which
 * is the point: whatever the editor can do to the world, an embedder can too.
 */

import {
	createRenderer,
	directionalShadowMatrix,
	ISO_PITCH,
	OrbitCamera,
	Ticker,
	type BackendPreference,
	type Light,
	type Renderer,
	type RendererInfo,
} from '@hexdelve/engine';
import { mat4, vec3, type Mat4, type Vec3 } from '@hexdelve/shared';

import { Controls } from './input/Controls.js';
import { Simulation, type SimulationToggles, type YardStats } from './game/simulation.js';

/** Half the world height the viewport spans at zoom 1, matching the labs. */
const VIEW_HEIGHT = 5.5;

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
	/** Seed for the yard's scenery, so a given seed is a given yard. */
	seed?: number;
	toggles?: Partial<SimulationToggles>;
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
	private readonly controls: Controls | null;
	private readonly resizeObserver: ResizeObserver | null;
	private instanceCount = 0;
	private smoothedFps = 0;
	private disposed = false;
	private readonly shadowMatrix: Mat4 = mat4.mat4();

	/**
	 * Creates a client. Asynchronous because asking for a GPU device is, and
	 * pretending otherwise would only move the await somewhere less obvious.
	 */
	static async create(options: ClientOptions): Promise<HexdelveClient> {
		// The client has to exist before it can stop itself, so the callback
		// reaches it through a box rather than through `this`.
		const box: { client: HexdelveClient | null } = { client: null };

		const renderer = await createRenderer({
			canvas: options.canvas,
			...(options.backend !== undefined ? { backend: options.backend } : {}),
			clearColor: [0.66, 0.76, 0.71, 1],
			onDeviceLost: (reason) => {
				box.client?.stop();
				options.onDeviceLost?.(reason);
			},
		});

		box.client = new HexdelveClient(options, renderer);
		return box.client;
	}

	private constructor(options: ClientOptions, renderer: Renderer) {
		this.canvas = options.canvas;
		this.renderer = renderer;

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

		this.simulation = new Simulation({
			...(options.seed !== undefined ? { seed: options.seed } : {}),
			...(options.toggles ? { toggles: options.toggles } : {}),
		});

		this.camera.target[0] = this.simulation.focus.x;
		this.camera.target[1] = this.simulation.focus.y;
		this.camera.target[2] = this.simulation.focus.z;

		this.ticker = new Ticker();
		this.ticker.onFrame = this.onFrame;

		this.controls =
			options.controls === false
				? null
				: new Controls(this.canvas, this.camera, {
						onStrike: () => this.simulation.strike(),
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

	/** The lab's readout: speed, bearing, foot slip, what the bat is doing. */
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

	/** Rebuilds the world from a new seed. */
	setSeed(seed: number): void {
		const toggles = { ...this.simulation.toggles };
		(this as { simulation: Simulation }).simulation = new Simulation({ seed, toggles });
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

	private advance(dt: number): void {
		const controls = this.controls;
		controls?.updateCamera(dt);

		// The aim plane sits a little above his feet, so the cursor lands where
		// his chest is rather than where the ground is behind him.
		const aim = controls?.aimOnPlane(this.simulation.player.y + 0.15) ?? null;

		this.simulation.update(dt, {
			forward: controls?.keys.forward ?? 0,
			back: controls?.keys.back ?? 0,
			left: controls?.keys.left ?? 0,
			right: controls?.keys.right ?? 0,
			run: (controls?.keys.run ?? 0) > 0,
			aim,
			stick: controls?.stick ?? null,
			cameraAzimuth: this.camera.yaw,
		});

		if (this.simulation.toggles.follow) {
			this.camera.target[0] = this.simulation.focus.x;
			this.camera.target[1] = this.simulation.focus.y;
			this.camera.target[2] = this.simulation.focus.z;
		}

		const built = this.simulation.build(controls?.stick.active ? null : aim);
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
