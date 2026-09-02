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
	OrbitCamera,
	Ticker,
	type BackendPreference,
	type HexInstances,
	type Light,
	type Renderer,
	type RendererInfo,
} from '@hexdelve/engine';
import { vec3, type Vec3 } from '@hexdelve/shared';

import { OrbitControls } from './input/OrbitControls.js';
import { buildYard, type YardOptions } from './scene/yard.js';

export interface ClientOptions {
	canvas: HTMLCanvasElement;
	/** Which renderer to ask for. Defaults to `auto`, which prefers WebGPU. */
	backend?: BackendPreference;
	/** Watch the canvas and follow its size. On by default. */
	autoResize?: boolean;
	/** Start the frame loop as soon as the client is created. On by default. */
	autoStart?: boolean;
	/** Attach mouse and touch camera controls. On by default. */
	controls?: boolean;
	scene?: YardOptions;
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

	/** The sun. Mutable, because the editor hangs a control off it. */
	readonly light: Light & { direction: Vec3; ambient: Vec3; intensity: number } = {
		direction: vec3.normalize(vec3.vec3(), vec3.vec3(0.45, 0.78, 0.35)),
		intensity: 0.85,
		ambient: vec3.vec3(0.42, 0.45, 0.42),
	};

	private readonly canvas: HTMLCanvasElement;
	private readonly controls: OrbitControls | null;
	private readonly resizeObserver: ResizeObserver | null;
	private instances: HexInstances;
	private smoothedFps = 0;
	private disposed = false;

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
		this.camera = new OrbitCamera({ distance: 26, pitch: 0.62, yaw: Math.PI * 0.22 });
		this.ticker = new Ticker();

		this.instances = buildYard(options.scene ?? {});
		this.renderer.setInstances(this.instances.data, this.instances.count);

		this.ticker.onFrame = this.onFrame;

		this.controls =
			options.controls === false ? null : new OrbitControls(this.canvas, this.camera);

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
			instances: this.instances.count,
			backend: this.renderer.backend,
		};
	}

	start(): void {
		if (!this.disposed) this.ticker.start();
	}

	stop(): void {
		this.ticker.stop();
	}

	/** Rebuilds the world and re-uploads it. The editor calls this on a reseed. */
	setScene(options: YardOptions): void {
		this.instances = buildYard(options);
		this.renderer.setInstances(this.instances.data, this.instances.count);
	}

	/** Matches the drawing buffer to the canvas's laid-out size. */
	resize(): void {
		if (this.disposed) return;
		const width = this.canvas.clientWidth || this.canvas.width;
		const height = this.canvas.clientHeight || this.canvas.height;
		this.renderer.resize(width, height, window.devicePixelRatio || 1);
	}

	/** Draws one frame without running the loop — for a paused editor viewport. */
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
		this.draw();
	};

	private draw(): void {
		if (!this.renderer.alive) return;

		const width = this.canvas.width;
		const height = this.canvas.height;
		if (width === 0 || height === 0) return;

		this.renderer.render({
			viewProjection: this.camera.matrix(width / height, this.renderer.depthRange),
			light: this.light,
		});
	}
}
