/*
 * The character bench: one creature, on a stand, with a clock.
 *
 * This is the editor's first view that is not the game. The viewport next door
 * is `createClient` in a box and deliberately has no scene of its own; a bench
 * cannot be that, because the thing it exists to show — a rig, alone, held
 * still at a frame you choose — is precisely what a running world will not do.
 * So it owns a renderer, a camera and a clock, and nothing else: no terrain, no
 * simulation, no input beyond turning the stand.
 *
 * What it does NOT own is any character data. The skeleton, the body and the
 * clips all come from `@hexdelve/client` through `rigs.ts`, which is the whole
 * point of the exercise — a pose that reads well here is the pose the game
 * will play, because it is the same function sampled the same way.
 *
 * The drawing is the game's own trick, unchanged: every part of a character is
 * the unit hex prism under a bone's transform, so a posed rig is a span of one
 * instance buffer and the whole bench is three draw calls.
 */

import {
	buildSkeletonView,
	createRenderer,
	directionalShadowMatrix,
	HEX_FLAG_UNLIT,
	HexInstances,
	OrbitCamera,
	solveWorld,
	Ticker,
	type BackendPreference,
	type Model,
	type Light,
	type Renderer,
	type RendererInfo,
	type SparsePose,
	type WorldPose,
} from '@hexdelve/engine';
import { axialDisc, axialToWorld, mat4, vec3, type Mat4, type Vec3 } from '@hexdelve/shared';

import { BenchControls } from './BenchControls.js';
import { BENCH_RIGS, type BenchAnimation, type BenchRig } from './rigs.js';

/*
 * The stand: a hex disc of this radius in tiles, on a plinth.
 *
 * Three shades rather than two, because a hex grid cannot be two-coloured —
 * every cell has six neighbours in a ring of odd parity. `(q - r) mod 3` is
 * the three-colouring, and it is what makes the turntable read as turning.
 */
const PAD_RADIUS = 1;
const PAD_DEPTH = 0.3;
const PAD_SHADES = [0x5f7053, 0x6d7f60, 0x4e5c45];
const PAD_EDGE = 0x3c4636;
/** Circumradius of the plinth, chosen to sit just outside the disc. */
const PLINTH_RADIUS = 3.05;

/** What the shadow map has to cover: the pad, and a creature standing on it. */
const SHADOW_FIT = { center: vec3.vec3(0, 0.8, 0), radius: 3.4 };

export interface BenchOptions {
	canvas: HTMLCanvasElement;
	backend?: BackendPreference;
	/** Which rig to put on the stand. Defaults to the first in the catalogue. */
	rig?: BenchRig;
	autoResize?: boolean;
	autoStart?: boolean;
	/** Drag to orbit, wheel to dolly. On by default. */
	controls?: boolean;
	onDeviceLost?: (reason: string) => void;
}

export interface BenchShow {
	/** The body. Off leaves the rig on its own, which is how a bone is checked. */
	mesh: boolean;
	/** The rig, drawn from the bone list rather than modelled. */
	skeleton: boolean;
	/** The stand, and the shadow it catches. */
	ground: boolean;
	/** Turn the stand slowly, so a pose is seen from every side without asking. */
	spin: boolean;
}

export interface BenchStats {
	fps: number;
	instances: number;
	bones: number;
}

export class CharacterBench {
	readonly renderer: Renderer;
	readonly camera: OrbitCamera;
	readonly ticker: Ticker;

	/**
	 * The same sun the yard uses — across the subject rather than down it, so a
	 * limb in front of the chest reads as being in front of it. Mutable, since
	 * checking a silhouette means being able to move the light.
	 */
	readonly light: Light & { direction: Vec3; ambient: Vec3; intensity: number } = {
		direction: vec3.normalize(vec3.vec3(), vec3.vec3(-0.514, 0.745, 0.432)),
		intensity: 1,
		ambient: vec3.vec3(0.4, 0.44, 0.47),
	};

	readonly show: BenchShow = { mesh: true, skeleton: false, ground: true, spin: false };

	/** Where in the current animation we are, in seconds. */
	time = 0;
	/** Playback rate. Slowing a swing down is most of what a bench is for. */
	speed = 1;
	playing = true;
	/**
	 * Repeat at the end of the cycle, rather than hold the last frame.
	 *
	 * On by default and independent of whether the animation was AUTHORED to
	 * loop, because those are two different questions. A slash holds in the
	 * game — that is what the clip means — and on a bench you want to watch it
	 * twenty times without reaching for the rewind. The wrap will pop, since a
	 * clip that holds was never authored to close onto its own first key, and
	 * seeing that pop is the other half of what the toggle is for.
	 */
	loop = true;
	/** How far the stand has turned, in radians. */
	turntable = 0;

	private rigOnStand: BenchRig;
	private animation: BenchAnimation;
	private model: Model;
	private skeletonView: Model;
	private readonly pose: SparsePose = {};
	private world: WorldPose = {};
	private highlighted: string | null = null;

	private readonly opaque = new HexInstances(2048);
	private readonly blended = new HexInstances(1024);
	private readonly overlay = new HexInstances(64);
	private readonly frame = new HexInstances(3072);

	private readonly canvas: HTMLCanvasElement;
	private readonly controls: BenchControls | null;
	private readonly resizeObserver: ResizeObserver | null;
	private readonly shadowMatrix: Mat4 = mat4.mat4();
	private instanceCount = 0;
	private smoothedFps = 0;
	private disposed = false;
	private lastDuration = 0;

	/** Asynchronous for the same reason the client is: asking for a GPU is. */
	static async create(options: BenchOptions): Promise<CharacterBench> {
		const box: { bench: CharacterBench | null } = { bench: null };

		const renderer = await createRenderer({
			canvas: options.canvas,
			...(options.backend !== undefined ? { backend: options.backend } : {}),
			// A neutral studio grey rather than the yard's sky: a bench is for
			// judging a silhouette, and a coloured backdrop tints the judgement.
			clearColor: [0.106, 0.125, 0.11, 1],
			onDeviceLost: (reason) => {
				box.bench?.stop();
				options.onDeviceLost?.(reason);
			},
		});

		box.bench = new CharacterBench(options, renderer);
		return box.bench;
	}

	private constructor(options: BenchOptions, renderer: Renderer) {
		this.canvas = options.canvas;
		this.renderer = renderer;

		this.rigOnStand = options.rig ?? BENCH_RIGS[0]!;
		this.animation = this.rigOnStand.animations[0]!;
		this.model = this.rigOnStand.model();
		this.skeletonView = buildSkeletonView(this.rigOnStand.skeleton, this.rigOnStand.tips);

		/*
		 * Perspective, unlike the game's camera, and on purpose. The yard is
		 * drawn orthographically so a hexagon is the same hexagon wherever it
		 * sits; a bench is somebody leaning in to look at one thing, and a
		 * little convergence is what tells a shoulder in front of a chest from
		 * a shoulder beside it.
		 */
		this.camera = new OrbitCamera({
			projection: 'perspective',
			target: vec3.vec3(0, this.rigOnStand.focusY, 0),
			distance: this.rigOnStand.frameDistance,
			yaw: 0.6,
			pitch: 0.3,
			fovY: 0.62,
			near: 0.05,
			far: 60,
		});
		this.camera.minDistance = 0.9;
		this.camera.maxDistance = 18;

		this.ticker = new Ticker();
		this.ticker.onFrame = this.onFrame;

		this.controls =
			options.controls === false
				? null
				: new BenchControls(this.canvas, this.camera, {
						// A paused bench still has to follow the mouse, or the
						// one thing a bench is for — turning a held frame round
						// — would need the clock running to work.
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

	get rig(): BenchRig {
		return this.rigOnStand;
	}

	get clip(): BenchAnimation {
		return this.animation;
	}

	get stats(): BenchStats {
		return {
			fps: this.smoothedFps,
			instances: this.instanceCount,
			bones: this.rigOnStand.skeleton.length,
		};
	}

	/** The bone transforms behind the picture on screen, for a readout. */
	get bones(): WorldPose {
		return this.world;
	}

	/** Which bone the outline has selected, drawn as a marker in the overlay. */
	get selectedBone(): string | null {
		return this.highlighted;
	}

	set selectedBone(name: string | null) {
		this.highlighted = name;
	}

	/**
	 * Put a different creature on the stand.
	 *
	 * The pose map is emptied rather than kept, because it is keyed by bone name
	 * and two rigs share several of those: a bat wearing a leftover `spine`
	 * entry would be posed by a bone it does not have.
	 */
	setRig(rig: BenchRig): void {
		if (rig === this.rigOnStand) return;
		this.rigOnStand = rig;
		this.model = rig.model();
		this.skeletonView = buildSkeletonView(rig.skeleton, rig.tips);
		this.world = {};
		for (const bone of Object.keys(this.pose)) delete this.pose[bone];
		this.highlighted = null;
		this.setAnimation(rig.animations[0]!);
		this.frameSubject();
	}

	setAnimation(animation: BenchAnimation): void {
		this.animation = animation;
		this.time = 0;
		// A different animation is a different cycle, and its length is not a
		// change in this one's — so there is nothing to rescale against.
		this.lastDuration = 0;
		this.playing = true;
		if (!this.running) this.renderOnce();
	}

	/** Point the camera back at the middle of whatever is on the stand. */
	frameSubject(): void {
		this.camera.target[0] = 0;
		this.camera.target[1] = this.rigOnStand.focusY;
		this.camera.target[2] = 0;
		this.camera.distance = this.rigOnStand.frameDistance;
		this.camera.yaw = 0.6;
		this.camera.pitch = 0.3;
		this.turntable = 0;
		if (!this.running) this.renderOnce();
	}

	start(): void {
		if (!this.disposed) this.ticker.start();
	}

	stop(): void {
		this.ticker.stop();
	}

	/** Jump the playhead, for a scrub bar. Redraws even while paused. */
	seek(t: number): void {
		const duration = this.animation.duration;
		this.time = duration > 0 ? Math.max(0, Math.min(duration, t)) : 0;
		if (!this.running) this.renderOnce();
	}

	/** One frame's worth of time, without running the loop. */
	step(dt: number): void {
		if (this.disposed) return;
		this.advance(dt);
		this.draw();
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
		this.advance(dt);
		this.draw();
	};

	private advance(dt: number): void {
		if (this.show.spin) this.turntable += dt * 0.4;

		if (this.playing) {
			const duration = this.animation.duration;
			this.time += dt * this.speed;
			if (duration > 0) {
				if (this.loop) {
					this.time -= Math.floor(this.time / duration) * duration;
				} else if (this.time >= duration) {
					// Without the loop it holds on its last frame, the way the
					// game plays a one-shot — stopping the clock rather than
					// snapping back to the start.
					this.time = duration;
					this.playing = false;
				}
			}
		}

		this.build();
	}

	/**
	 * Keep the playhead meaning the same thing when the cycle changes length.
	 *
	 * A clip's duration is a constant, but a blend tree's is not: blend a walk
	 * towards a run and the cadence speeds up under you. Left alone, a playhead
	 * measured in seconds would then sit at a different point in the cycle than
	 * it did a frame ago — the footfall would jump. Rescaling it holds the
	 * PHASE, which is the quantity that actually matters, and is the same thing
	 * as integrating the phase directly.
	 */
	private syncCycle(): void {
		const duration = this.animation.duration;
		if (this.lastDuration > 1e-6 && duration > 1e-6 && duration !== this.lastDuration) {
			this.time *= duration / this.lastDuration;
		}
		this.lastDuration = duration;
	}

	/** Everything on screen, rebuilt into the three passes. */
	private build(): void {
		this.syncCycle();
		const { opaque, blended, overlay, frame } = this;
		opaque.clear();
		blended.clear();
		overlay.clear();

		if (this.show.ground) this.emitStand(opaque);

		this.animation.sample(this.time, this.pose);
		this.world = solveWorld(this.rigOnStand.skeleton, this.pose, this.world);

		/*
		 * Ghosting is the game's own arrangement: the rig goes in the opaque
		 * pass and the body over it at a third alpha in the blended one, so the
		 * bones read through the body instead of being buried by it.
		 */
		if (this.show.skeleton && this.show.mesh) {
			this.model.emit(blended, this.world, 0, 0, 0, this.turntable, { alpha: 0.3 });
			this.skeletonView.emit(opaque, this.world, 0, 0, 0, this.turntable);
		} else if (this.show.skeleton) {
			this.skeletonView.emit(opaque, this.world, 0, 0, 0, this.turntable);
		} else if (this.show.mesh) {
			this.model.emit(opaque, this.world, 0, 0, 0, this.turntable);
		}

		this.emitSelection(overlay);

		frame.clear();
		frame.pushAll(opaque);
		frame.pushAll(blended);
		frame.pushAll(overlay);

		this.instanceCount = opaque.count + blended.count + overlay.count;
		this.renderer.setInstances(frame.data, {
			opaque: opaque.count,
			blended: blended.count,
			overlay: overlay.count,
		});
	}

	/**
	 * The stand: a hex pad, checkered, on a plinth.
	 *
	 * Checkered because a turntable with no texture on it does not read as
	 * turning, and the whole value of spinning the stand is seeing that it did.
	 */
	private emitStand(out: HexInstances): void {
		out.push(0, -PAD_DEPTH - 0.09, 0, PLINTH_RADIUS, 0.18, PLINTH_RADIUS, PAD_EDGE);
		for (const cell of axialDisc(PAD_RADIUS)) {
			const { x, z } = axialToWorld(cell.q, cell.r);
			const shade = PAD_SHADES[(((cell.q - cell.r) % 3) + 3) % 3]!;
			out.push(x, -PAD_DEPTH / 2, z, 0.985, PAD_DEPTH, 0.985, shade);
		}
	}

	/** A marker on the selected bone, drawn without a depth test so it is findable. */
	private emitSelection(out: HexInstances): void {
		if (!this.highlighted) return;
		const bone = this.world[this.highlighted];
		if (!bone) return;

		const sin = Math.sin(this.turntable);
		const cos = Math.cos(this.turntable);
		const x = bone.p[0] * cos + bone.p[2] * sin;
		const z = -bone.p[0] * sin + bone.p[2] * cos;

		out.push(x, bone.p[1], z, 0.075, 0.11, 0.075, 0xffc94a, {
			alpha: 0.9,
			flags: HEX_FLAG_UNLIT,
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
