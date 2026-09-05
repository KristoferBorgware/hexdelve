/*
 * The particle bench: one effect, running, on the same stand as the others.
 *
 * The character and prop benches exist because a running world will not hold a
 * pose still, or will not show you a helmet at all. This one exists for the
 * opposite reason: an effect is nothing BUT motion, and the yard shows it at
 * the isometric pitch, forty prisms across, behind a roof. Judging whether a
 * puff is the right size or fades at the right moment needs it a metre from
 * your eye and running on its own.
 *
 * ## What it does not do
 *
 * It does not spin the subject. The other two benches turn the stand so a
 * silhouette is seen from every side, and that works because a helmet has one.
 * A world-space plume does not turn with its emitter — a particle belongs to
 * the air it was born in — so the turntable here moves the CAMERA instead, and
 * the picture is the same picture from a different seat.
 *
 * ## The ruler
 *
 * A post beside the pad, banded every half metre to a wanderer's height. Every
 * number on the inspector is in metres and metres a second, and the one
 * question the panel cannot answer is whether 0.6 m is the right size for
 * smoke coming out of a chimney. Something a person's height, next to it, can.
 */

import {
	createRenderer,
	directionalShadowMatrix,
	HEX_FLAG_UNLIT,
	HexInstances,
	OrbitCamera,
	ParticleSystem,
	Ticker,
	type BackendPreference,
	type Light,
	type ParticleEffect,
	type Renderer,
	type RendererInfo,
	type WorldTransform,
} from '@hexdelve/engine';
import { mat4, quat, vec3, type Mat4, type Vec3 } from '@hexdelve/shared';

import { BenchControls } from '../../bench/BenchControls.js';
import { emitStand, SHADOW_FIT } from '../../bench/stand.js';

/** Where the camera sits when nobody has moved it. See the constructor. */
const VIEW_DISTANCE = 7;
const VIEW_HEIGHT = 1.45;
const VIEW_YAW = 0.6;
const VIEW_PITCH = 0.2;

/** How tall the ruler is, and how often it is banded. */
const RULER_HEIGHT = 1.8;
const RULER_BAND = 0.5;
const RULER_COLOR = 0xd8e86a;
const RULER_DARK = 0x5f7053;

export interface ParticleShow {
	/** The pad, and the shadow it catches. */
	pad: boolean;
	/** A person-height post beside it, banded every half metre. */
	ruler: boolean;
	/** Walk the camera round, so a plume is seen from every side. */
	spin: boolean;
}

export interface ParticleBenchStats {
	fps: number;
	/** Prisms in the frame, the stand included. */
	instances: number;
	/** Particles alive right now. */
	particles: number;
	/** The pool the effect asked for. */
	capacity: number;
}

export interface ParticleBenchOptions {
	canvas: HTMLCanvasElement;
	backend?: BackendPreference;
	/** The effect to run. */
	effect: ParticleEffect;
	autoResize?: boolean;
	autoStart?: boolean;
	controls?: boolean;
	onDeviceLost?: (reason: string) => void;
}

export class ParticleBench {
	readonly renderer: Renderer;
	readonly camera: OrbitCamera;
	readonly ticker: Ticker;

	/** The same sun the other benches use — across the subject rather than down it. */
	readonly light: Light & { direction: Vec3; ambient: Vec3; intensity: number } = {
		direction: vec3.normalize(vec3.vec3(), vec3.vec3(-0.514, 0.745, 0.432)),
		intensity: 1,
		ambient: vec3.vec3(0.4, 0.44, 0.47),
	};

	readonly show: ParticleShow = { pad: true, ruler: true, spin: false };

	/**
	 * How high above the pad the emitter sits.
	 *
	 * A slider rather than a constant, because where an effect is emitted from
	 * is half of how it reads: blood comes off a bat at chest height and smoke
	 * leaves a chimney above a roof, and an effect authored at ground level
	 * will be judged wrongly by exactly that distance.
	 */
	height = 0;

	/** How fast the clock runs, so a fast burst can be watched slowly. */
	rate = 1;

	private system: ParticleSystem;
	/** Where the emitter is: on the pad's axis, at whatever `height` says. */
	private readonly place: WorldTransform = { position: [0, 0, 0], rotation: quat.quat() };

	private readonly opaque = new HexInstances(512);
	private readonly blended = new HexInstances(2048);
	private readonly frame = new HexInstances(2560);

	private readonly canvas: HTMLCanvasElement;
	private readonly controls: BenchControls | null;
	private readonly resizeObserver: ResizeObserver | null;
	private readonly shadowMatrix: Mat4 = mat4.mat4();

	private instanceCount = 0;
	private smoothedFps = 0;
	private disposed = false;

	/** Asynchronous for the same reason the client is: asking for a GPU is. */
	static async create(options: ParticleBenchOptions): Promise<ParticleBench> {
		const box: { bench: ParticleBench | null } = { bench: null };

		const renderer = await createRenderer({
			canvas: options.canvas,
			...(options.backend !== undefined ? { backend: options.backend } : {}),
			clearColor: [0.106, 0.125, 0.11, 1],
			onDeviceLost: (reason) => {
				box.bench?.stop();
				options.onDeviceLost?.(reason);
			},
		});

		box.bench = new ParticleBench(options, renderer);
		return box.bench;
	}

	private constructor(options: ParticleBenchOptions, renderer: Renderer) {
		this.canvas = options.canvas;
		this.renderer = renderer;
		this.system = new ParticleSystem(options.effect);

		this.ticker = new Ticker();
		this.ticker.onFrame = this.onFrame;

		/*
		 * Perspective, and the SAME framing for every effect.
		 *
		 * The other benches point their camera at the middle of whatever is on
		 * the stand, and a particle effect has no middle until it has been
		 * running for a second. It also has a ruler beside it, and a ruler is
		 * only a ruler while the camera holds still — a view that reframed
		 * itself per effect would leave the post a different size in every
		 * picture, which is the one thing it is there not to be. So this is a
		 * room at a person's scale, and the dolly is the operator's.
		 */
		this.camera = new OrbitCamera({
			projection: 'perspective',
			target: vec3.vec3(0, VIEW_HEIGHT, 0),
			distance: VIEW_DISTANCE,
			yaw: VIEW_YAW,
			pitch: VIEW_PITCH,
			fovY: 0.62,
			near: 0.02,
			far: 60,
		});
		this.camera.minDistance = 0.4;
		this.camera.maxDistance = 24;

		this.controls =
			options.controls === false
				? null
				: new BenchControls(this.canvas, this.camera, {
						onChange: () => {
							if (!this.running) this.draw();
						},
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

	get effect(): ParticleEffect {
		return this.system.effect;
	}

	get stats(): ParticleBenchStats {
		return {
			fps: this.smoothedFps,
			instances: this.instanceCount,
			particles: this.system.count,
			capacity: this.system.capacity,
		};
	}

	/**
	 * Run a different effect, from the top.
	 *
	 * A new system rather than a mutated one: every number an effect holds is
	 * drawn at birth, so particles already out were built to the OLD file and
	 * would go on being wrong for as long as they lived. Starting over is both
	 * simpler and what somebody who just changed a number wants to see.
	 */
	setEffect(effect: ParticleEffect): void {
		if (effect === this.system.effect) return;
		this.system = new ParticleSystem(effect);
		if (!this.running) this.renderOnce();
	}

	/** Play it again — what a one-shot needs, since it is over in half a second. */
	restart(): void {
		this.system.play();
		if (!this.running) this.renderOnce();
	}

	/** Put the camera back where it started. */
	frameSubject(): void {
		this.camera.yaw = VIEW_YAW;
		this.camera.pitch = VIEW_PITCH;
		this.camera.distance = VIEW_DISTANCE;
		this.camera.target[0] = 0;
		this.camera.target[1] = VIEW_HEIGHT;
		this.camera.target[2] = 0;
		if (!this.running) this.renderOnce();
	}

	start(): void {
		if (!this.disposed) this.ticker.start();
	}

	stop(): void {
		this.ticker.stop();
	}

	/** Redraw the current frame — for a paused viewport whose settings changed. */
	renderOnce(): void {
		if (this.disposed) return;
		this.build();
		this.draw();
	}

	resize(): void {
		if (this.disposed) return;
		const width = this.canvas.clientWidth || this.canvas.width;
		const height = this.canvas.clientHeight || this.canvas.height;
		this.renderer.resize(width, height, window.devicePixelRatio || 1);
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
		if (dt > 0) this.smoothedFps += (1 / dt - this.smoothedFps) * 0.1;
		if (this.show.spin) this.camera.yaw += dt * 0.4;

		this.place.position[1] = this.height;
		this.system.update(dt * this.rate, this.place);

		/*
		 * A one-shot would otherwise be over before anybody looked at it. The
		 * bench is where an effect is judged, and judging a burst means seeing
		 * it more than once, so it starts again as soon as it has finished.
		 */
		if (this.system.finished) this.system.play();

		this.build();
		this.draw();
	};

	private build(): void {
		const { opaque, blended, frame } = this;
		opaque.clear();
		blended.clear();

		if (this.show.pad) emitStand(opaque);
		if (this.show.ruler) emitRuler(opaque);

		this.system.emit(blended);

		frame.clear();
		frame.pushAll(opaque);
		frame.pushAll(blended);

		this.instanceCount = opaque.count + blended.count;
		this.renderer.setInstances(frame.data, {
			opaque: opaque.count,
			blended: blended.count,
			overlay: 0,
		});
	}

	private draw(): void {
		if (!this.renderer.alive) return;

		const width = this.canvas.width;
		const height = this.canvas.height;
		if (width === 0 || height === 0) return;

		directionalShadowMatrix(
			this.shadowMatrix,
			this.light.direction,
			SHADOW_FIT,
			this.renderer.depthRange,
		);

		this.renderer.render({
			viewProjection: this.camera.matrix(width / height, this.renderer.depthRange),
			light: this.light,
			shadow: { viewProjection: this.shadowMatrix, bias: 0.0015 },
		});
	}
}

/**
 * A post beside the pad, to a person's height.
 *
 * Unlit, so a band stays the same shade whichever way the camera has walked
 * round it — a ruler that changes colour with the light is a poor ruler.
 */
function emitRuler(out: HexInstances): void {
	const x = 1.15;
	const z = 0;
	const bands = Math.round(RULER_HEIGHT / RULER_BAND);
	for (let i = 0; i < bands; i++) {
		const bottom = i * RULER_BAND;
		out.pushUpright(x, bottom, z, 0.035, RULER_BAND, i % 2 === 0 ? RULER_DARK : RULER_COLOR, {
			alpha: 0.9,
			flags: HEX_FLAG_UNLIT,
		});
	}
}
