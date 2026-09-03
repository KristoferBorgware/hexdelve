/*
 * The prop bench: one piece of gear, on a stand, three ways of looking at it.
 *
 * The character bench next door exists because a running world will not hold a
 * pose still. This one exists because a running world will not show you a
 * helmet at all — there are three props in the yard, they are lying in the
 * grass at the far end of it, and the only way to see one closely today is to
 * walk a man over and stand on it. A catalogue is the fix, and a catalogue is
 * also where the numbers a prop does not have yet will eventually be authored.
 *
 * It owns no prop data. The models, the bone each hangs from and the two
 * numbers that put it down in the grass all come out of `@hexdelve/client`
 * through `props.ts` — so what is on the stand is the thing the game draws.
 *
 * The three views are the three transforms a prop is ever drawn through, and
 * that is why there are exactly three:
 *
 *   stand    the model as authored, centred on the pad. How it is modelled.
 *   ground   its own lift and tilt, on zero. How it lies in the grass.
 *   worn     through its bone, on the wanderer. How it is carried.
 *
 * The third is the one that catches mistakes. A prop is modelled around the
 * origin of the bone it belongs to, so "equipping" it is a change of parent
 * and nothing else — and the only way to know the modelling is right is to see
 * the thing on the man it was measured against.
 */

import {
	createRenderer,
	directionalShadowMatrix,
	HEX_FLAG_UNLIT,
	HexInstances,
	OrbitCamera,
	solveWorld,
	Ticker,
	type BackendPreference,
	type Light,
	type Model,
	type Renderer,
	type RendererInfo,
	type SparsePose,
	type WorldPose,
} from '@hexdelve/engine';
import { mat4, quat, vec3, type Mat4, type Quat, type Vec3 } from '@hexdelve/shared';

import { BenchControls } from './BenchControls.js';
import { BENCH_PROPS, measure, type BenchProp, type PropBox } from './props.js';
import { findRig, type BenchAnimation } from './rigs.js';
import { emitStand, SHADOW_FIT } from './stand.js';

/**
 * Who wears the gear.
 *
 * The wanderer's rig out of the character bench's own catalogue, animations
 * and all — not a second copy of him assembled here. Every prop in the game is
 * measured against this body, so it is the only body worth checking one on.
 */
export const WEARER = findRig('wanderer');

/** How the prop is placed. See the note at the top of the file. */
export type PropDisplay = 'stand' | 'ground' | 'worn';

export interface PropShow {
	/** The pad, and the shadow it catches. */
	pad: boolean;
	/** Turn the stand slowly, so a silhouette is seen from every side. */
	spin: boolean;
	/** The measured box, drawn as twelve edges. Meaningless on a wearer. */
	bounds: boolean;
	/** Ghost the wearer, so the prop reads against him rather than into him. */
	ghost: boolean;
}

export interface PropBenchStats {
	fps: number;
	instances: number;
	parts: number;
}

export interface PropBenchOptions {
	canvas: HTMLCanvasElement;
	backend?: BackendPreference;
	/** Which prop to put on the stand. Defaults to the first in the catalogue. */
	prop?: BenchProp;
	autoResize?: boolean;
	autoStart?: boolean;
	controls?: boolean;
	onDeviceLost?: (reason: string) => void;
}

/** Rotations taking the prism's own +Y axis onto X, Y and Z, for box edges. */
const AXIS_TURN: readonly Quat[] = [
	quat.fromEulerXYZ(quat.quat(), 0, 0, -Math.PI / 2),
	quat.quat(),
	quat.fromEulerXYZ(quat.quat(), Math.PI / 2, 0, 0),
];
const BOUNDS_COLOR = 0xc8a44a;
const BOUNDS_THICKNESS = 0.006;
const MARKER_COLOR = 0xffc94a;

export class PropBench {
	readonly renderer: Renderer;
	readonly camera: OrbitCamera;
	readonly ticker: Ticker;

	/** The same sun both benches use — across the subject rather than down it. */
	readonly light: Light & { direction: Vec3; ambient: Vec3; intensity: number } = {
		direction: vec3.normalize(vec3.vec3(), vec3.vec3(-0.514, 0.745, 0.432)),
		intensity: 1,
		ambient: vec3.vec3(0.4, 0.44, 0.47),
	};

	readonly show: PropShow = { pad: true, spin: false, bounds: false, ghost: true };

	/** Where in the wearer's animation we are, in seconds. Idle otherwise. */
	time = 0;
	playing = true;
	/** How far the stand has turned, in radians. */
	turntable = 0;

	private onStand: BenchProp;
	private model: Model;
	private mode: PropDisplay = 'stand';
	private wearerAnimation: BenchAnimation = WEARER.animations[0]!;

	/** The placement the current mode works out to, and the box it lands in. */
	private readonly baseRotation: Quat = quat.quat();
	private readonly offset: [number, number, number] = [0, 0, 0];
	private box: PropBox;

	private readonly pose: SparsePose = {};
	private world: WorldPose = {};
	private highlighted: number | null = null;

	private readonly opaque = new HexInstances(2048);
	private readonly blended = new HexInstances(1024);
	private readonly overlay = new HexInstances(64);
	private readonly frame = new HexInstances(3072);

	private readonly canvas: HTMLCanvasElement;
	private readonly controls: BenchControls | null;
	private readonly resizeObserver: ResizeObserver | null;
	private readonly shadowMatrix: Mat4 = mat4.mat4();

	// Scratch, so a frame allocates nothing.
	private readonly spin: Quat = quat.quat();
	private readonly drawRotation: Quat = quat.quat();
	private readonly drawOrigin: [number, number, number] = [0, 0, 0];
	private readonly scratch: [number, number, number] = [0, 0, 0];

	private instanceCount = 0;
	private smoothedFps = 0;
	private disposed = false;

	/** Asynchronous for the same reason the client is: asking for a GPU is. */
	static async create(options: PropBenchOptions): Promise<PropBench> {
		const box: { bench: PropBench | null } = { bench: null };

		const renderer = await createRenderer({
			canvas: options.canvas,
			...(options.backend !== undefined ? { backend: options.backend } : {}),
			clearColor: [0.106, 0.125, 0.11, 1],
			onDeviceLost: (reason) => {
				box.bench?.stop();
				options.onDeviceLost?.(reason);
			},
		});

		box.bench = new PropBench(options, renderer);
		return box.bench;
	}

	private constructor(options: PropBenchOptions, renderer: Renderer) {
		this.canvas = options.canvas;
		this.renderer = renderer;

		this.onStand = options.prop ?? BENCH_PROPS[0]!;
		this.model = this.onStand.model();
		this.box = measure(this.model);
		this.layout();

		this.ticker = new Ticker();
		this.ticker.onFrame = this.onFrame;

		/*
		 * Perspective, and closer in than the character bench: a sword is a
		 * metre long and a helmet is a handspan, so the near plane and the
		 * minimum dolly both have to let somebody put their nose on it.
		 */
		this.camera = new OrbitCamera({
			projection: 'perspective',
			target: vec3.vec3(0, 0.3, 0),
			distance: 1.6,
			yaw: 0.6,
			pitch: 0.28,
			fovY: 0.62,
			near: 0.02,
			far: 60,
		});
		this.camera.minDistance = 0.25;
		this.camera.maxDistance = 14;
		this.frameSubject();

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

	get prop(): BenchProp {
		return this.onStand;
	}

	get display(): PropDisplay {
		return this.mode;
	}

	get animation(): BenchAnimation {
		return this.wearerAnimation;
	}

	/** The box the prop occupies in the frame it is being drawn in. */
	get bounds(): PropBox {
		return this.box;
	}

	get stats(): PropBenchStats {
		return {
			fps: this.smoothedFps,
			instances: this.instanceCount,
			parts: this.model.parts.length,
		};
	}

	/** Which part the outline has picked, marked in the overlay. */
	get selectedPart(): number | null {
		return this.highlighted;
	}

	set selectedPart(index: number | null) {
		this.highlighted = index !== null && index >= 0 && index < this.model.parts.length ? index : null;
	}

	/** Put a different prop on the stand. */
	setProp(prop: BenchProp): void {
		if (prop === this.onStand) return;
		this.onStand = prop;
		this.model = prop.model();
		this.highlighted = null;
		this.layout();
		this.frameSubject();
	}

	setDisplay(display: PropDisplay): void {
		if (display === this.mode) return;
		this.mode = display;
		this.layout();
		this.frameSubject();
	}

	/** Which clip the wearer plays. Only seen in the `worn` view. */
	setAnimation(animation: BenchAnimation): void {
		if (animation === this.wearerAnimation) return;
		this.wearerAnimation = animation;
		this.time = 0;
		this.layout();
		if (!this.running) this.renderOnce();
	}

	/**
	 * Point the camera back at whatever is on the stand.
	 *
	 * Off the measurement rather than a table of per-prop numbers, which is
	 * what keeps a fourth prop from needing a camera entry of its own.
	 */
	frameSubject(): void {
		this.camera.yaw = 0.6;
		this.camera.pitch = 0.28;
		this.turntable = 0;

		if (this.mode === 'worn') {
			/*
			 * The wearer's own framing, out of the same rig the character bench
			 * uses. Worn is the view that asks how the gear sits on HIM, and a
			 * camera close enough to fill the frame with a helmet has cropped
			 * away the only thing there is to judge it against.
			 */
			this.camera.target[0] = 0;
			this.camera.target[1] = WEARER.focusY;
			this.camera.target[2] = 0;
			this.camera.distance = WEARER.frameDistance;
		} else {
			// A thing three times its own radius away fills the frame, and that
			// is as true of a helmet as of a sword.
			this.camera.target[0] = this.box.center[0]!;
			this.camera.target[1] = this.box.center[1]!;
			this.camera.target[2] = this.box.center[2]!;
			this.camera.distance = Math.max(0.6, this.box.radius * 3.4);
		}

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
		if (this.show.spin) this.turntable += dt * 0.4;
		if (this.playing) {
			const duration = this.wearerAnimation.duration;
			this.time += dt;
			// Everything loops here, one-shots included. A bench for gear wants
			// the swing to come round again; holding the last frame of a slash
			// is the character bench's job, not this one's.
			if (duration > 0) this.time -= Math.floor(this.time / duration) * duration;
		}
		this.build();
		this.draw();
	};

	/**
	 * Work out where the prop sits, for the mode it is being shown in.
	 *
	 * `stand` centres the measured box over the pad and rests it on zero, which
	 * is the only placement that works for a model authored around a bone's
	 * origin — a helmet's origin is the middle of a head, and left alone it
	 * would sink to its brow in the plinth. `ground` deliberately does NOT do
	 * that: it uses the prop's own lift, because whether that lift is right is
	 * the question the view is there to answer. `worn` uses neither: the
	 * placement is the bone's, and all this works out is where that leaves it.
	 *
	 * The box that falls out is measured square-on, with the stand at rest, and
	 * on a wearer it is a snapshot of one frame of the clip. Both are what a
	 * readout wants — a dimension that changed as the turntable went round, or
	 * as an arm swung, would be unreadable.
	 */
	private layout(): void {
		const prop = this.onStand;

		if (this.mode === 'ground') {
			quat.fromEulerXYZ(this.baseRotation, prop.groundTilt, 0, 0);
			this.offset[0] = 0;
			this.offset[1] = prop.groundLift;
			this.offset[2] = 0;
		} else if (this.mode === 'worn') {
			/*
			 * Posed here rather than at the first frame, because the camera has
			 * to be pointed at something before there is a frame to point it
			 * with — and where a worn prop is, is where its bone is.
			 */
			this.wearerAnimation.sample(this.time, this.pose);
			this.world = solveWorld(WEARER.skeleton, this.pose, this.world);

			const bone = this.world[prop.bone];
			quat.copy(this.baseRotation, bone ? bone.q : quat.IDENTITY);
			this.offset[0] = bone ? bone.p[0]! : 0;
			this.offset[1] = bone ? bone.p[1]! : 0;
			this.offset[2] = bone ? bone.p[2]! : 0;
		} else {
			quat.identity(this.baseRotation);
			this.offset[0] = 0;
			this.offset[1] = 0;
			this.offset[2] = 0;
		}

		const raw = measure(this.model, this.baseRotation);

		if (this.mode === 'stand') {
			this.offset[0] = -raw.center[0]!;
			this.offset[1] = -raw.min[1]!;
			this.offset[2] = -raw.center[2]!;
		}

		this.box = shift(raw, this.offset);
	}

	/** Everything on screen, rebuilt into the three passes. */
	private build(): void {
		const { opaque, blended, overlay, frame } = this;
		opaque.clear();
		blended.clear();
		overlay.clear();

		if (this.show.pad) emitStand(opaque);

		quat.fromYaw(this.spin, this.turntable);

		if (this.mode === 'worn') {
			this.wearerAnimation.sample(this.time, this.pose);
			this.world = solveWorld(WEARER.skeleton, this.pose, this.world);

			/*
			 * The wearer goes in the blended pass at a low alpha and the prop
			 * in the opaque one, which is the same arrangement the character
			 * bench uses to ghost a body over a rig — here so the gear reads
			 * as being ON him rather than lost among his own prisms.
			 */
			if (this.show.ghost) {
				WEARER.model().emit(blended, this.world, 0, 0, 0, this.turntable, { alpha: 0.26 });
			} else {
				WEARER.model().emit(opaque, this.world, 0, 0, 0, this.turntable);
			}
			this.model.emit(opaque, this.world, 0, 0, 0, this.turntable);
		} else {
			quat.multiply(this.drawRotation, this.spin, this.baseRotation);
			quat.rotateVec3(this.drawOrigin, this.spin, this.offset);
			this.model.emitDetached(
				opaque,
				this.drawOrigin[0],
				this.drawOrigin[1],
				this.drawOrigin[2],
				this.drawRotation,
			);
			if (this.show.bounds) this.emitBounds(overlay);
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
	 * The measured box, as twelve thin prisms.
	 *
	 * Unlit, so it stays the same colour whichever way the stand has turned —
	 * a ruler that changes shade as it rotates is a poor ruler.
	 */
	private emitBounds(out: HexInstances): void {
		const { min, max, size, center } = this.box;
		const T = BOUNDS_THICKNESS;

		for (let axis = 0; axis < 3; axis++) {
			const length = size[axis]!;
			if (length <= 0) continue;
			const [u, v] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];

			for (const uEnd of [min[u]!, max[u]!]) {
				for (const vEnd of [min[v]!, max[v]!]) {
					this.scratch[axis] = center[axis]!;
					this.scratch[u] = uEnd;
					this.scratch[v] = vEnd;
					quat.rotateVec3(this.drawOrigin, this.spin, this.scratch);
					quat.multiply(this.drawRotation, this.spin, AXIS_TURN[axis]!);
					out.push(
						this.drawOrigin[0],
						this.drawOrigin[1],
						this.drawOrigin[2],
						T,
						length,
						T,
						BOUNDS_COLOR,
						{ rotation: this.drawRotation, alpha: 0.85, flags: HEX_FLAG_UNLIT },
					);
				}
			}
		}
	}

	/** A marker on the selected part, drawn unlit so it is findable. */
	private emitSelection(out: HexInstances): void {
		if (this.highlighted === null) return;
		const part = this.model.parts[this.highlighted];
		if (!part) return;

		if (this.mode === 'worn') {
			const bone = this.world[part.bone];
			if (!bone) return;
			quat.rotateVec3(this.scratch, bone.q, part.position);
			this.scratch[0] += bone.p[0]!;
			this.scratch[1] += bone.p[1]!;
			this.scratch[2] += bone.p[2]!;
			quat.rotateVec3(this.drawOrigin, this.spin, this.scratch);
		} else {
			quat.multiply(this.drawRotation, this.spin, this.baseRotation);
			quat.rotateVec3(this.scratch, this.drawRotation, part.position);
			quat.rotateVec3(this.drawOrigin, this.spin, this.offset);
			this.drawOrigin[0] += this.scratch[0];
			this.drawOrigin[1] += this.scratch[1];
			this.drawOrigin[2] += this.scratch[2];
		}

		out.push(
			this.drawOrigin[0],
			this.drawOrigin[1],
			this.drawOrigin[2],
			0.016,
			0.024,
			0.016,
			MARKER_COLOR,
			{ alpha: 0.95, flags: HEX_FLAG_UNLIT },
		);
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

/** The same box, moved. Used to fold the placement offset into a measurement. */
function shift(box: PropBox, by: readonly [number, number, number]): PropBox {
	const move = (point: readonly [number, number, number]): [number, number, number] => [
		point[0] + by[0],
		point[1] + by[1],
		point[2] + by[2],
	];
	return {
		min: move(box.min),
		max: move(box.max),
		size: box.size,
		center: move(box.center),
		radius: box.radius,
		parts: box.parts,
	};
}
