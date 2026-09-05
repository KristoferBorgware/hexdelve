/*
 * A particle effect, read from a file and written back to one.
 *
 * The shape it reads into is `particles/effect.ts`; this is the document. What
 * the file adds over the shape is a DEFAULT for every field, because an effect
 * has thirty-odd numbers in it and a file that had to state all of them would
 * be a file nobody would write by hand:
 *
 *     id: sparks
 *     emit: { rate: 40 }
 *     particle: { speed: 3, speedVariance: 1.5 }
 *     color: { curve: [{ at: 0, value: 0xffd27a }] }
 *
 * is a working effect, and everything it did not say is `defaultEffect`'s.
 *
 * ## Mean and variance are two keys
 *
 * `speed` and `speedVariance`, rather than `speed: [3, 1.5]`. The pair reads
 * as what it is — a number, and how much it wobbles — and it means a file that
 * wants an exact value simply omits the second key rather than writing a zero
 * into a tuple.
 *
 * ## Colours stay hexadecimal
 *
 * A colour is `0xd8d4cc` in every file in this tree and in every line of the
 * code that draws one, and `14210252` is the same colour written so nobody can
 * read it. So a gradient stop is read as a number and written back through
 * `hexLiteral` — see emit.ts.
 */

import { hexFromRgb, rgbFromHex } from '@hexdelve/shared';

import {
	defaultEffect,
	type AlphaSpec,
	type ColorSpec,
	type ColorStop,
	type EmitShape,
	type EmitShapeKind,
	type ParticleEffect,
	type Range,
	type SizeSpec,
	type SpinSpec,
	type Stop,
} from '../particles/effect.js';
import { Node } from './document.js';
import { emitYaml, hexLiteral, type Emittable } from './emit.js';

const EFFECT_KEYS = [
	'id',
	'name',
	'notes',
	'capacity',
	'duration',
	'loop',
	'prewarm',
	'emit',
	'particle',
	'motion',
	'size',
	'color',
	'alpha',
	'spin',
	'unlit',
] as const;

const EMIT_KEYS = ['rate', 'rateVariance', 'burst', 'burstVariance', 'shape'] as const;
const SHAPE_KEYS = ['kind', 'radius', 'size', 'outward'] as const;
const PARTICLE_KEYS = [
	'life',
	'lifeVariance',
	'speed',
	'speedVariance',
	'pitch',
	'pitchVariance',
	'yaw',
	'yawVariance',
] as const;
const MOTION_KEYS = ['gravity', 'drag', 'space'] as const;
const SIZE_KEYS = ['curve', 'variance', 'aspect'] as const;
const CURVE_KEYS = ['curve', 'variance'] as const;
const SPIN_KEYS = ['rate', 'rateVariance', 'axis', 'tumble'] as const;
const STOP_KEYS = ['at', 'value'] as const;

const SHAPE_KINDS: readonly EmitShapeKind[] = ['point', 'sphere', 'shell', 'disc', 'box'];
const SPACES = ['world', 'local'] as const;

/** Read one effect file. */
export function readParticleEffect(source: string, file: string): ParticleEffect {
	return parseParticleEffect(Node.parse(source, file));
}

/**
 * The same, from a document already parsed.
 *
 * What the bench uses: it holds the text somebody is typing and wants to know
 * whether it means anything yet, which is a parse it already has in hand.
 */
export function parseParticleEffect(root: Node): ParticleEffect {
	root.only(...EFFECT_KEYS);

	const id = root.need('id').text();
	const fallback = defaultEffect(id);

	const emit = root.get('emit').only(...EMIT_KEYS);
	const particle = root.get('particle').only(...PARTICLE_KEYS);
	const motion = root.get('motion').only(...MOTION_KEYS);

	return {
		id,
		name: root.get('name').textOr(id),
		capacity: Math.max(1, Math.floor(root.get('capacity').numberOr(fallback.capacity))),
		duration: Math.max(0, root.get('duration').numberOr(fallback.duration)),
		loop: root.get('loop').flag(fallback.loop),
		prewarm: root.get('prewarm').flag(fallback.prewarm),
		emit: {
			rate: readRange(emit, 'rate', fallback.emit.rate),
			burst: readRange(emit, 'burst', fallback.emit.burst),
			shape: readShape(emit.get('shape'), fallback.emit.shape),
		},
		particle: {
			life: readRange(particle, 'life', fallback.particle.life),
			speed: readRange(particle, 'speed', fallback.particle.speed),
			pitch: readRange(particle, 'pitch', fallback.particle.pitch),
			yaw: readRange(particle, 'yaw', fallback.particle.yaw),
		},
		motion: {
			gravity: motion.get('gravity').vec3Or(fallback.motion.gravity),
			drag: Math.max(0, motion.get('drag').numberOr(fallback.motion.drag)),
			space: motion.get('space').present ? motion.need('space').choice(SPACES) : fallback.motion.space,
		},
		size: readSize(root.get('size'), fallback.size),
		color: readColor(root.get('color'), fallback.color),
		alpha: readAlpha(root.get('alpha'), fallback.alpha),
		spin: readSpin(root.get('spin'), fallback.spin),
		unlit: root.get('unlit').flag(fallback.unlit),
	};
}

/**
 * A mean and its variance, from `<key>` and `<key>Variance`.
 *
 * The variance is taken as a magnitude, because it is a distance either side of
 * the mean and a negative one would describe the same spread while reading as
 * though it did something.
 */
function readRange(fields: Node, key: string, fallback: Range): Range {
	return {
		mean: fields.get(key).numberOr(fallback.mean),
		variance: Math.abs(fields.get(`${key}Variance`).numberOr(fallback.variance)),
	};
}

function readShape(node: Node, fallback: EmitShape): EmitShape {
	node.only(...SHAPE_KEYS);
	return {
		kind: node.get('kind').present ? node.need('kind').choice(SHAPE_KINDS) : fallback.kind,
		radius: Math.max(0, node.get('radius').numberOr(fallback.radius)),
		size: node.get('size').vec3Or(fallback.size),
		outward: clamp01(node.get('outward').numberOr(fallback.outward)),
	};
}

function readSize(node: Node, fallback: SizeSpec): SizeSpec {
	node.only(...SIZE_KEYS);
	return {
		curve: readCurve(node.get('curve'), fallback.curve),
		variance: Math.abs(node.get('variance').numberOr(fallback.variance)),
		aspect: Math.max(0, node.get('aspect').numberOr(fallback.aspect)),
	};
}

function readAlpha(node: Node, fallback: AlphaSpec): AlphaSpec {
	node.only(...CURVE_KEYS);
	return {
		curve: readCurve(node.get('curve'), fallback.curve),
		variance: Math.abs(node.get('variance').numberOr(fallback.variance)),
	};
}

function readColor(node: Node, fallback: ColorSpec): ColorSpec {
	node.only(...CURVE_KEYS);
	const curve = node.get('curve');
	return {
		curve: curve.present
			? sorted(
					curve.list().map((entry) => {
						entry.only(...STOP_KEYS);
						return { at: readAt(entry), color: rgbFromHex(entry.need('value').number()) };
					}),
					curve,
				)
			: fallback.curve,
		variance: Math.abs(node.get('variance').numberOr(fallback.variance)),
	};
}

function readSpin(node: Node, fallback: SpinSpec): SpinSpec {
	node.only(...SPIN_KEYS);
	return {
		rate: readRange(node, 'rate', fallback.rate),
		axis: node.get('axis').vec3Or(fallback.axis),
		tumble: node.get('tumble').flag(fallback.tumble),
	};
}

function readCurve(node: Node, fallback: readonly Stop[]): readonly Stop[] {
	if (!node.present) return fallback;
	const stops = node.list().map((entry) => {
		entry.only(...STOP_KEYS);
		return { at: readAt(entry), value: entry.need('value').number() };
	});
	return sorted(stops, node);
}

/**
 * Where in a life a stop sits.
 *
 * Refused outside 0 to 1, because that is the whole range a curve is read over
 * and a stop at 5 is somebody who meant 0.5 — sorting it quietly to the end
 * would leave the curve looking almost right and behaving wrongly.
 */
function readAt(entry: Node): number {
	const at = entry.get('at').numberOr(0);
	if (at < 0 || at > 1) {
		entry.need('at').fail(`a stop sits between 0 and 1 of a particle's life, and this is ${at}`);
	}
	return at;
}

/**
 * Stops in the order they are read at.
 *
 * Sorted rather than refused: which line a stop is written on is not part of
 * what a curve means, and an author moving one earlier should not have to move
 * the text too. `at` is already checked, so a stop that sorts surprisingly is a
 * stop somebody put there.
 */
function sorted<T extends { at: number }>(stops: T[], node: Node): readonly T[] {
	if (stops.length === 0) node.fail('a curve needs at least one stop');
	return [...stops].sort((a, b) => a.at - b.at);
}

function clamp01(value: number): number {
	return value < 0 ? 0 : value > 1 ? 1 : value;
}

/* ------------------------------------------------------------------ writing -- */

/**
 * An effect, back to the document it was read from.
 *
 * Everything is written, defaults included. A writer that dropped what matched
 * a default would produce a file whose meaning changed the next time a default
 * did — and the bench's whole job is to say what an effect IS, on the page,
 * where somebody can read it.
 */
export function writeParticleEffect(effect: ParticleEffect): string {
	return emitYaml(particleEffectDocument(effect));
}

/** The same, as the value — for a caller assembling a larger document. */
export function particleEffectDocument(effect: ParticleEffect): Emittable {
	return {
		id: effect.id,
		name: effect.name,
		capacity: effect.capacity,
		duration: effect.duration,
		loop: effect.loop,
		prewarm: effect.prewarm,
		emit: {
			...writeRange('rate', effect.emit.rate),
			...writeRange('burst', effect.emit.burst),
			shape: {
				kind: effect.emit.shape.kind,
				radius: effect.emit.shape.radius,
				size: [...effect.emit.shape.size],
				outward: effect.emit.shape.outward,
			},
		},
		particle: {
			...writeRange('life', effect.particle.life),
			...writeRange('speed', effect.particle.speed),
			...writeRange('pitch', effect.particle.pitch),
			...writeRange('yaw', effect.particle.yaw),
		},
		motion: {
			gravity: [...effect.motion.gravity],
			drag: effect.motion.drag,
			space: effect.motion.space,
		},
		size: {
			curve: effect.size.curve.map((stop) => ({ at: stop.at, value: stop.value })),
			variance: effect.size.variance,
			aspect: effect.size.aspect,
		},
		color: {
			curve: effect.color.curve.map(writeColorStop),
			variance: effect.color.variance,
		},
		alpha: {
			curve: effect.alpha.curve.map((stop) => ({ at: stop.at, value: stop.value })),
			variance: effect.alpha.variance,
		},
		spin: {
			...writeRange('rate', effect.spin.rate),
			axis: [...effect.spin.axis],
			tumble: effect.spin.tumble,
		},
		unlit: effect.unlit,
	};
}

function writeRange(key: string, range: Range): Record<string, number> {
	return { [key]: range.mean, [`${key}Variance`]: range.variance };
}

function writeColorStop(stop: ColorStop): Emittable {
	return { at: stop.at, value: hexLiteral(hexFromRgb(stop.color)) };
}
