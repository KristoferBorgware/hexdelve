/*
 * One effect, running.
 *
 * The effect beside this file says what a particle is like; this holds the
 * ones that exist. It is the whole of the simulation — born, moved, drawn,
 * dead — and it knows nothing about game objects, so a bench can run one over
 * a stand with no scene anywhere near it.
 *
 * ## The pool
 *
 * One `Float32Array` of `capacity * PARTICLE_FLOATS`, allocated when the
 * system is built and never grown. The live particles are the first `live` of
 * them, and one that dies is swapped with the last live one rather than being
 * spliced out — so the live set stays contiguous, a frame allocates nothing,
 * and the cost of a death is one copy of nineteen floats.
 *
 * The article this is modelled on keeps a doubly linked pool and moves nodes
 * between two lists. The reason for a list there is the reason against one
 * here: it exists to avoid allocating, and a flat array that is never grown
 * has already avoided it, without the pointer chase.
 *
 * A request to emit past the end of the array is DROPPED rather than growing
 * it. That is what `capacity` is for — a ceiling somebody chose, so the number
 * of prisms in a frame does not depend on how long the effect has been running.
 *
 * ## Where the numbers are kept
 *
 * Interleaved rather than one array per field, which is what `HexInstances`
 * does for the same reason: every read here touches most of a particle at
 * once, so one particle in a cache line beats one field of sixteen of them.
 *
 * Seven of the nineteen are per-particle variation drawn at birth — the size
 * scale, the alpha scale, the colour shift, the spin axis and its rate. Those
 * are what a `variance` in the effect turns into, and they have to be kept
 * rather than recomputed, because a particle that redrew its own random
 * numbers each frame would shimmer.
 */

import { makeRandom, quat, vec3, type Quat, type Random, type Rgb } from '@hexdelve/shared';

import { HEX_FLAG_NONE, HEX_FLAG_UNLIT, type HexInstances } from '../scene/HexInstances.js';
import type { Point, WorldTransform } from '../scene/Transform.js';
import {
	sampleCurve,
	sampleGradient,
	type EmitShape,
	type ParticleEffect,
	type Range,
} from './effect.js';

/* Where each of a particle's numbers sits in the pool. */
const P_X = 0;
const P_Y = 1;
const P_Z = 2;
const P_VX = 3;
const P_VY = 4;
const P_VZ = 5;
const P_AGE = 6;
const P_LIFE = 7;
/** The size curve's per-particle multiplier. */
const P_SIZE = 8;
/** The alpha curve's. */
const P_ALPHA = 9;
/** The shift added to all three colour channels. */
const P_TINT = 10;
/** The rotation it was born with, already composed with anything above it. */
const P_QX = 11;
const P_QY = 12;
const P_QZ = 13;
const P_QW = 14;
/** The axis this one turns about. */
const P_AXIS_X = 15;
const P_AXIS_Y = 16;
const P_AXIS_Z = 17;
/** Radians a second about that axis. */
const P_SPIN = 18;

export const PARTICLE_FLOATS = 19;

const TAU = Math.PI * 2;

/** The identity placement, for a system nobody has told where it is. */
const ORIGIN: WorldTransform = {
	position: [0, 0, 0],
	rotation: new Float32Array([0, 0, 0, 1]) as Quat,
};

export interface ParticleSystemOptions {
	/**
	 * Where the randomness comes from.
	 *
	 * Seeded by default, so a bench showing an effect shows the same effect
	 * twice and a test can assert on a particle's position. A caller wanting
	 * two emitters of the same effect to differ hands each one its own.
	 */
	readonly random?: Random;
	/** Start emitting straight away. True unless a caller wants to arm it first. */
	readonly autoPlay?: boolean;
}

export class ParticleSystem {
	readonly effect: ParticleEffect;

	private readonly pool: Float32Array;
	private readonly random: Random;
	private live = 0;

	/** Seconds since the emitter last started. */
	private clock = 0;
	/** Whether new particles are still arriving. Live ones finish either way. */
	private emitting = false;
	/** The fraction of a particle the rate has accrued but not yet spent. */
	private pending = 0;

	/** Where the emitter is, as of the last `update`. */
	private readonly placePosition: Point = [0, 0, 0];
	private readonly placeRotation: Quat = quat.quat();

	// Scratch, so a frame allocates nothing.
	private readonly birth = new Float32Array(3);
	private readonly axis = new Float32Array(3);
	private readonly turn: Quat = quat.quat();
	private readonly composed: Quat = quat.quat();
	private readonly drawQuat: Quat = quat.quat();
	private readonly drawPoint = new Float32Array(3);
	private readonly tone: Rgb = { r: 1, g: 1, b: 1 };

	constructor(effect: ParticleEffect, options: ParticleSystemOptions = {}) {
		this.effect = effect;
		this.pool = new Float32Array(Math.max(1, effect.capacity) * PARTICLE_FLOATS);
		this.random = options.random ?? seeded(effect);
		this.moveTo(ORIGIN);
		if (options.autoPlay !== false) this.play();
	}

	/** How many particles are alive. */
	get count(): number {
		return this.live;
	}

	get capacity(): number {
		return this.pool.length / PARTICLE_FLOATS;
	}

	/** Whether the emitter is still producing. */
	get running(): boolean {
		return this.emitting;
	}

	/**
	 * True once it has stopped emitting and the last particle has gone.
	 *
	 * What a one-shot is asked before it takes itself out of the scene. A
	 * looping effect never answers true, which is the point of it looping.
	 */
	get finished(): boolean {
		return !this.emitting && this.live === 0;
	}

	/**
	 * Start from the top: the clock at zero, and the opening burst thrown.
	 *
	 * An effect asking to be prewarmed is then run forward through one full
	 * particle lifetime, in fixed steps, so a continuous one is already
	 * established on the frame it first appears. Only a continuous one: an
	 * emitter with a duration that does not loop would simply be fast-forwarded
	 * past its own end, which is not a state anybody wants to start in.
	 */
	play(): void {
		this.clock = 0;
		this.pending = 0;
		this.emitting = true;
		this.live = 0;
		this.spawnMany(draw(this.random, this.effect.emit.burst));

		const { duration, loop, prewarm, particle } = this.effect;
		if (!prewarm || (duration > 0 && !loop)) return;

		// Thirty a second: fine enough that the column is not visibly stepped,
		// coarse enough that a ten-second life is three hundred steps rather
		// than six hundred.
		const step = 1 / 30;
		const span = particle.life.mean + particle.life.variance;
		for (let elapsed = 0; elapsed < span; elapsed += step) {
			this.simulate(step);
			this.produce(step);
		}
	}

	/** Stop producing. The particles already out live their lives and fade. */
	stop(): void {
		this.emitting = false;
	}

	/** Take every live particle back, without waiting for it to die. */
	clear(): void {
		this.live = 0;
	}

	/** Throw a handful now, whatever the emitter is otherwise doing. */
	burst(count: number): void {
		this.spawnMany(count);
	}

	/**
	 * Say where the emitter is.
	 *
	 * Held rather than asked for, because the system is not the thing that
	 * knows how an emitter moves — a component reads it off a game object, a
	 * bench leaves it on the origin, and neither is this file's business. It is
	 * separate from `update` so a caller can place a system before the first
	 * frame it steps, which is what stops an opening burst appearing at the
	 * world origin.
	 */
	moveTo(at: WorldTransform): void {
		this.placePosition[0] = at.position[0];
		this.placePosition[1] = at.position[1];
		this.placePosition[2] = at.position[2];
		quat.copy(this.placeRotation, at.rotation);
	}

	/**
	 * Advance by `dt`, optionally from somewhere new.
	 *
	 * Existing particles are stepped BEFORE new ones arrive, so a burst is
	 * drawn at its source on the frame it was asked for rather than a frame's
	 * travel away from it.
	 */
	update(dt: number, at?: WorldTransform): void {
		if (at) this.moveTo(at);
		if (dt <= 0) return;
		this.simulate(dt);
		this.produce(dt);
	}

	/**
	 * Write this moment's particles into an instance list.
	 *
	 * The blended pass is where these belong: they are transparent, they must
	 * test depth so a puff behind a roof stays behind it, and they must not
	 * write it. A particle whose alpha or size has reached zero is skipped
	 * rather than pushed — an invisible prism still costs a vertex fetch.
	 */
	emit(out: HexInstances): void {
		const { effect } = this;
		const local = effect.motion.space === 'local';
		const flags = effect.unlit ? HEX_FLAG_UNLIT : HEX_FLAG_NONE;
		const pool = this.pool;

		for (let i = 0; i < this.live; i++) {
			const at = i * PARTICLE_FLOATS;
			const life = pool[at + P_LIFE]!;
			const u = life > 0 ? Math.min(1, pool[at + P_AGE]! / life) : 1;

			const radius = sampleCurve(effect.size.curve, u) * pool[at + P_SIZE]!;
			if (radius <= 0) continue;
			const alpha = sampleCurve(effect.alpha.curve, u) * pool[at + P_ALPHA]!;
			if (alpha <= 0) continue;

			this.axis[0] = pool[at + P_AXIS_X]!;
			this.axis[1] = pool[at + P_AXIS_Y]!;
			this.axis[2] = pool[at + P_AXIS_Z]!;
			quat.fromAxisAngle(this.turn, this.axis, pool[at + P_SPIN]! * pool[at + P_AGE]!);

			this.composed[0] = pool[at + P_QX]!;
			this.composed[1] = pool[at + P_QY]!;
			this.composed[2] = pool[at + P_QZ]!;
			this.composed[3] = pool[at + P_QW]!;
			quat.multiply(this.drawQuat, this.turn, this.composed);

			let x = pool[at + P_X]!;
			let y = pool[at + P_Y]!;
			let z = pool[at + P_Z]!;
			if (local) {
				// A local-space particle is authored in the emitter's frame and
				// carried out to the world here, which is what makes the whole
				// plume turn and travel with whatever holds it.
				this.drawPoint[0] = x;
				this.drawPoint[1] = y;
				this.drawPoint[2] = z;
				quat.rotateVec3(this.drawPoint, this.placeRotation, this.drawPoint);
				x = this.drawPoint[0]! + this.placePosition[0];
				y = this.drawPoint[1]! + this.placePosition[1];
				z = this.drawPoint[2]! + this.placePosition[2];
				quat.multiply(this.drawQuat, this.placeRotation, this.drawQuat);
			}

			sampleGradient(effect.color.curve, u, this.tone);
			const tint = pool[at + P_TINT]!;
			this.tone.r = clamp01(this.tone.r + tint);
			this.tone.g = clamp01(this.tone.g + tint);
			this.tone.b = clamp01(this.tone.b + tint);

			out.push(x, y, z, radius, radius * effect.size.aspect, radius, this.tone, {
				rotation: this.drawQuat,
				alpha: Math.min(1, alpha),
				flags,
			});
		}
	}

	/* ---------------------------------------------------------------- inside -- */

	/**
	 * Move everything alive, and take back whatever reached the end.
	 *
	 * Drag is a fraction of speed shed per second, applied as a factor rather
	 * than subtracted, so a long frame cannot push a velocity through zero and
	 * out the other side.
	 */
	private simulate(dt: number): void {
		const { gravity, drag } = this.effect.motion;
		const keep = drag > 0 ? Math.max(0, 1 - drag * dt) : 1;
		const pool = this.pool;

		for (let i = 0; i < this.live; ) {
			const at = i * PARTICLE_FLOATS;
			const age = pool[at + P_AGE]! + dt;
			if (age >= pool[at + P_LIFE]!) {
				this.recycle(i);
				continue;
			}
			pool[at + P_AGE] = age;

			const vx = (pool[at + P_VX]! + gravity[0] * dt) * keep;
			const vy = (pool[at + P_VY]! + gravity[1] * dt) * keep;
			const vz = (pool[at + P_VZ]! + gravity[2] * dt) * keep;
			pool[at + P_VX] = vx;
			pool[at + P_VY] = vy;
			pool[at + P_VZ] = vz;

			pool[at + P_X] = pool[at + P_X]! + vx * dt;
			pool[at + P_Y] = pool[at + P_Y]! + vy * dt;
			pool[at + P_Z] = pool[at + P_Z]! + vz * dt;
			i++;
		}
	}

	/** The dead one's slot takes the last live one, and the live count drops. */
	private recycle(index: number): void {
		const last = this.live - 1;
		if (index !== last) {
			this.pool.copyWithin(index * PARTICLE_FLOATS, last * PARTICLE_FLOATS, this.live * PARTICLE_FLOATS);
		}
		this.live = last;
	}

	/**
	 * Run the emitter's own clock, and spawn what this frame is owed.
	 *
	 * The rate accrues a fraction of a particle per frame and spends whole ones,
	 * so an effect emitting nine a second emits nine a second whether the frame
	 * took 16 ms or 40 — a count rounded per frame would make the rate a
	 * function of the frame rate.
	 */
	private produce(dt: number): void {
		if (!this.emitting) return;
		const { duration, loop, emit } = this.effect;

		this.clock += dt;
		if (duration > 0 && this.clock >= duration) {
			if (loop) {
				// One restart however many durations a long frame skipped: a
				// hitch should not fire six bursts at once.
				this.clock %= duration;
				this.spawnMany(draw(this.random, emit.burst));
			} else {
				this.clock = duration;
				this.emitting = false;
				return;
			}
		}

		this.pending += Math.max(0, draw(this.random, emit.rate)) * dt;
		const whole = Math.floor(this.pending);
		if (whole <= 0) return;
		this.pending -= whole;
		this.spawnMany(whole);
	}

	private spawnMany(count: number): void {
		for (let i = 0; i < count; i++) {
			if (this.live >= this.capacity) return;
			this.spawn();
		}
	}

	/**
	 * One particle, with every number a `variance` asked for drawn now.
	 *
	 * Drawn here and kept, rather than worked out again while drawing: a
	 * particle whose size scale was re-randomised each frame would flicker
	 * instead of varying.
	 */
	private spawn(): void {
		const { effect, random } = this;
		const at = this.live * PARTICLE_FLOATS;
		const pool = this.pool;
		const world = effect.motion.space === 'world';

		/* Where in the shape it appeared, in the emitter's own space. */
		const offset = this.birth;
		bornAt(offset, effect.emit.shape, random);

		/* And which way it is thrown: the cone, leaned towards that offset. */
		const yaw = draw(random, effect.particle.yaw);
		const pitch = draw(random, effect.particle.pitch);
		const cos = Math.cos(pitch);
		let dx = -Math.sin(yaw) * cos;
		let dy = Math.sin(pitch);
		let dz = Math.cos(yaw) * cos;

		const outward = effect.emit.shape.outward;
		if (outward > 0) {
			const spread = Math.hypot(offset[0]!, offset[1]!, offset[2]!);
			if (spread > 1e-6) {
				dx += (offset[0]! / spread - dx) * outward;
				dy += (offset[1]! / spread - dy) * outward;
				dz += (offset[2]! / spread - dz) * outward;
			}
		}

		const speed = draw(random, effect.particle.speed);
		const length = Math.hypot(dx, dy, dz) || 1;
		let vx = (dx / length) * speed;
		let vy = (dy / length) * speed;
		let vz = (dz / length) * speed;

		let px = offset[0]!;
		let py = offset[1]!;
		let pz = offset[2]!;

		/*
		 * A world-space particle is carried out to where the emitter is once,
		 * at birth, and then belongs to the world. That is the whole of what
		 * makes an emitter leave a trail rather than drag its plume behind it.
		 */
		if (world) {
			this.drawPoint[0] = px;
			this.drawPoint[1] = py;
			this.drawPoint[2] = pz;
			quat.rotateVec3(this.drawPoint, this.placeRotation, this.drawPoint);
			px = this.drawPoint[0]! + this.placePosition[0];
			py = this.drawPoint[1]! + this.placePosition[1];
			pz = this.drawPoint[2]! + this.placePosition[2];

			this.drawPoint[0] = vx;
			this.drawPoint[1] = vy;
			this.drawPoint[2] = vz;
			quat.rotateVec3(this.drawPoint, this.placeRotation, this.drawPoint);
			vx = this.drawPoint[0]!;
			vy = this.drawPoint[1]!;
			vz = this.drawPoint[2]!;
		}

		pool[at + P_X] = px;
		pool[at + P_Y] = py;
		pool[at + P_Z] = pz;
		pool[at + P_VX] = vx;
		pool[at + P_VY] = vy;
		pool[at + P_VZ] = vz;
		pool[at + P_AGE] = 0;
		pool[at + P_LIFE] = Math.max(1e-4, draw(random, effect.particle.life));
		pool[at + P_SIZE] = Math.max(0, 1 + effect.size.variance * signed(random));
		pool[at + P_ALPHA] = clamp01(1 + effect.alpha.variance * signed(random));
		pool[at + P_TINT] = (random() - 0.5) * effect.color.variance;

		/* Which way it is turned, and about what. */
		const spin = effect.spin;
		if (spin.tumble) {
			randomAxis(this.axis, random);
		} else {
			this.axis[0] = spin.axis[0];
			this.axis[1] = spin.axis[1];
			this.axis[2] = spin.axis[2];
			vec3.normalize(this.axis, this.axis);
		}
		// A roll about that axis, because six-sided prisms that all agree on
		// their facing read as a lattice rather than as a cloud.
		quat.fromAxisAngle(this.turn, this.axis, random() * TAU);
		if (world) {
			quat.rotateVec3(this.axis, this.placeRotation, this.axis);
			quat.multiply(this.turn, this.placeRotation, this.turn);
		}

		pool[at + P_QX] = this.turn[0]!;
		pool[at + P_QY] = this.turn[1]!;
		pool[at + P_QZ] = this.turn[2]!;
		pool[at + P_QW] = this.turn[3]!;
		pool[at + P_AXIS_X] = this.axis[0]!;
		pool[at + P_AXIS_Y] = this.axis[1]!;
		pool[at + P_AXIS_Z] = this.axis[2]!;
		pool[at + P_SPIN] = draw(random, spin.rate);

		this.live++;
	}
}

/* ------------------------------------------------------------------ helpers -- */

function clamp01(value: number): number {
	return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Uniform in -1..1, which is what every variance is scaled by. */
function signed(random: Random): number {
	return random() * 2 - 1;
}

/** One number out of a range. */
function draw(random: Random, range: Range): number {
	return range.variance === 0 ? range.mean : range.mean + range.variance * signed(random);
}

/**
 * A seed from the effect's id.
 *
 * So that two systems built from one file behave the same way, and a picture
 * of an effect is a picture of that effect rather than of one run of it. A
 * caller wanting two emitters to differ passes a generator of its own.
 */
function seeded(effect: ParticleEffect): Random {
	let hash = 2166136261;
	for (let i = 0; i < effect.id.length; i++) {
		hash = Math.imul(hash ^ effect.id.charCodeAt(i), 16777619);
	}
	return makeRandom(hash >>> 0);
}

/** A point on the unit sphere, evenly over its area. */
function randomAxis(out: Float32Array, random: Random): void {
	const y = signed(random);
	const ring = Math.sqrt(Math.max(0, 1 - y * y));
	const angle = random() * TAU;
	out[0] = ring * Math.cos(angle);
	out[1] = y;
	out[2] = ring * Math.sin(angle);
}

/** Where in the emitter's volume a particle appears, in its own space. */
function bornAt(out: Float32Array, shape: EmitShape, random: Random): void {
	switch (shape.kind) {
		case 'sphere': {
			randomAxis(out, random);
			// Cube root, so the points fill the volume evenly rather than
			// crowding the middle — the radius of a shell of given thickness
			// grows with the square of how far out it is.
			const r = shape.radius * Math.cbrt(random());
			out[0] = out[0]! * r;
			out[1] = out[1]! * r;
			out[2] = out[2]! * r;
			return;
		}
		case 'shell': {
			randomAxis(out, random);
			out[0] = out[0]! * shape.radius;
			out[1] = out[1]! * shape.radius;
			out[2] = out[2]! * shape.radius;
			return;
		}
		case 'disc': {
			const angle = random() * TAU;
			// Square root, for the same reason the sphere takes a cube root.
			const r = shape.radius * Math.sqrt(random());
			out[0] = Math.cos(angle) * r;
			out[1] = 0;
			out[2] = Math.sin(angle) * r;
			return;
		}
		case 'box': {
			out[0] = signed(random) * shape.size[0] * 0.5;
			out[1] = signed(random) * shape.size[1] * 0.5;
			out[2] = signed(random) * shape.size[2] * 0.5;
			return;
		}
		default: {
			out[0] = 0;
			out[1] = 0;
			out[2] = 0;
		}
	}
}
