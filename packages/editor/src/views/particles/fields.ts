/*
 * Every number an effect has, as a table.
 *
 * The inspector next door draws controls from this and knows nothing about
 * what any of them mean. That is the same arrangement the prop bench's stats
 * use, and it is worth having for the same reason twice over here: an effect
 * carries about thirty tunable numbers, and a panel that named each one would
 * be nine hundred lines of nearly identical JSX in which a wrong `onChange`
 * would be invisible.
 *
 * A field is a lens: it says how to READ its value off an effect and how to
 * write a NEW effect with that value changed. Effects are immutable — the
 * bench builds a fresh `ParticleSystem` whenever one changes, because every
 * number a particle holds was drawn at its birth — so a write returns a copy
 * rather than mutating in place.
 *
 * The curves are not here. A curve is a list somebody adds to and drags about,
 * not a number with a slider on it, so the panel handles those three by name.
 */

import type { ParticleEffect, Range } from '@hexdelve/engine';

export interface FieldCommon {
	/** Unique, and what React keys the control by. */
	readonly key: string;
	readonly label: string;
	readonly hint?: string;
}

export interface NumberField extends FieldCommon {
	readonly kind: 'number';
	readonly min: number;
	readonly max: number;
	readonly step: number;
	read(effect: ParticleEffect): number;
	write(effect: ParticleEffect, value: number): ParticleEffect;
}

export interface FlagField extends FieldCommon {
	readonly kind: 'flag';
	read(effect: ParticleEffect): boolean;
	write(effect: ParticleEffect, value: boolean): ParticleEffect;
}

export interface ChoiceField extends FieldCommon {
	readonly kind: 'choice';
	readonly options: readonly string[];
	read(effect: ParticleEffect): string;
	write(effect: ParticleEffect, value: string): ParticleEffect;
}

export type Field = NumberField | FlagField | ChoiceField;

export interface FieldGroup {
	readonly title: string;
	/** One line under the heading, saying what the group is about. */
	readonly hint: string;
	readonly fields: readonly Field[];
}

const PI = Math.PI;

function number(
	key: string,
	label: string,
	read: (effect: ParticleEffect) => number,
	write: (effect: ParticleEffect, value: number) => ParticleEffect,
	bounds: { min: number; max: number; step: number; hint?: string },
): NumberField {
	return {
		kind: 'number',
		key,
		label,
		read,
		write,
		min: bounds.min,
		max: bounds.max,
		step: bounds.step,
		...(bounds.hint !== undefined ? { hint: bounds.hint } : {}),
	};
}

function flag(
	key: string,
	label: string,
	read: (effect: ParticleEffect) => boolean,
	write: (effect: ParticleEffect, value: boolean) => ParticleEffect,
	hint?: string,
): FlagField {
	return { kind: 'flag', key, label, read, write, ...(hint !== undefined ? { hint } : {}) };
}

function choice(
	key: string,
	label: string,
	options: readonly string[],
	read: (effect: ParticleEffect) => string,
	write: (effect: ParticleEffect, value: string) => ParticleEffect,
	hint?: string,
): ChoiceField {
	return {
		kind: 'choice',
		key,
		label,
		options,
		read,
		write,
		...(hint !== undefined ? { hint } : {}),
	};
}

/**
 * A mean and its variance, as two sliders.
 *
 * Always two, because the pair is what a range IS and a panel that showed only
 * the mean would hide the one field that decides whether the effect reads as
 * organic or as extruded. The variance is bounded by the mean's own span
 * rather than by the mean, so a range centred on zero can still spread.
 */
function range(
	key: string,
	label: string,
	read: (effect: ParticleEffect) => Range,
	write: (effect: ParticleEffect, value: Range) => ParticleEffect,
	bounds: { min: number; max: number; step: number; hint?: string },
): Field[] {
	const spread = bounds.max - Math.min(0, bounds.min);
	return [
		number(key, label, (effect) => read(effect).mean, (effect, mean) => write(effect, { ...read(effect), mean }), bounds),
		number(
			`${key}Variance`,
			`${label} ±`,
			(effect) => read(effect).variance,
			(effect, variance) => write(effect, { ...read(effect), variance }),
			{ min: 0, max: spread, step: bounds.step, hint: `How far either side of ${label.toLowerCase()}` },
		),
	];
}

/** One component of a vector, as a slider. */
function axis(
	key: string,
	label: string,
	index: 0 | 1 | 2,
	read: (effect: ParticleEffect) => readonly [number, number, number],
	write: (effect: ParticleEffect, value: readonly [number, number, number]) => ParticleEffect,
	bounds: { min: number; max: number; step: number; hint?: string },
): NumberField {
	return number(
		key,
		label,
		(effect) => read(effect)[index],
		(effect, value) => {
			const next: [number, number, number] = [...read(effect)];
			next[index] = value;
			return write(effect, next);
		},
		bounds,
	);
}

export const EFFECT_GROUPS: readonly FieldGroup[] = [
	{
		title: 'Emitter',
		hint: 'How long it runs, and how many it may have out at once.',
		fields: [
			number(
				'capacity',
				'Capacity',
				(effect) => effect.capacity,
				(effect, capacity) => ({ ...effect, capacity: Math.max(1, Math.round(capacity)) }),
				{ min: 1, max: 1024, step: 1, hint: 'The pool, and the ceiling on particles at once' },
			),
			number(
				'duration',
				'Duration',
				(effect) => effect.duration,
				(effect, duration) => ({ ...effect, duration }),
				{ min: 0, max: 20, step: 0.01, hint: 'Seconds it emits for. Zero runs until stopped' },
			),
			flag('loop', 'Loop', (effect) => effect.loop, (effect, loop) => ({ ...effect, loop }), 'Start again when the duration is up, re-issuing the burst'),
			flag(
				'prewarm',
				'Prewarm',
				(effect) => effect.prewarm,
				(effect, prewarm) => ({ ...effect, prewarm }),
				'Run one lifetime forward before the first frame, so it starts established',
			),
			flag(
				'unlit',
				'Unlit',
				(effect) => effect.unlit,
				(effect, unlit) => ({ ...effect, unlit }),
				'Draw at the authored colour rather than shading it — fire, sparks, spells',
			),
		],
	},
	{
		title: 'Emission',
		hint: 'How many arrive, and where from.',
		fields: [
			...range(
				'emit.rate',
				'Rate',
				(effect) => effect.emit.rate,
				(effect, rate) => ({ ...effect, emit: { ...effect.emit, rate } }),
				{ min: 0, max: 200, step: 0.1, hint: 'Particles a second' },
			),
			...range(
				'emit.burst',
				'Burst',
				(effect) => effect.emit.burst,
				(effect, burst) => ({ ...effect, emit: { ...effect.emit, burst } }),
				{ min: 0, max: 200, step: 1, hint: 'Thrown the moment it starts, and on each loop' },
			),
			choice(
				'emit.shape.kind',
				'Shape',
				['point', 'sphere', 'shell', 'disc', 'box'],
				(effect) => effect.emit.shape.kind,
				(effect, kind) => ({
					...effect,
					emit: { ...effect.emit, shape: { ...effect.emit.shape, kind: kind as never } },
				}),
				'The volume a particle appears in',
			),
			number(
				'emit.shape.radius',
				'Radius',
				(effect) => effect.emit.shape.radius,
				(effect, radius) => ({
					...effect,
					emit: { ...effect.emit, shape: { ...effect.emit.shape, radius } },
				}),
				{ min: 0, max: 4, step: 0.005, hint: 'Metres. Read by sphere, shell and disc' },
			),
			...(['x', 'y', 'z'] as const).map((name, index) =>
				axis(
					`emit.shape.size.${name}`,
					`Box ${name}`,
					index as 0 | 1 | 2,
					(effect) => effect.emit.shape.size,
					(effect, size) => ({
						...effect,
						emit: { ...effect.emit, shape: { ...effect.emit.shape, size } },
					}),
					{ min: 0, max: 8, step: 0.01, hint: 'Metres, the full extent. Read by box' },
				),
			),
			number(
				'emit.shape.outward',
				'Outward',
				(effect) => effect.emit.shape.outward,
				(effect, outward) => ({
					...effect,
					emit: { ...effect.emit, shape: { ...effect.emit.shape, outward } },
				}),
				{ min: 0, max: 1, step: 0.01, hint: 'How much of the launch direction comes from where it was born' },
			),
		],
	},
	{
		title: 'Particle',
		hint: 'What each one is born with.',
		fields: [
			...range(
				'particle.life',
				'Life',
				(effect) => effect.particle.life,
				(effect, life) => ({ ...effect, particle: { ...effect.particle, life } }),
				{ min: 0.02, max: 20, step: 0.01, hint: 'Seconds' },
			),
			...range(
				'particle.speed',
				'Speed',
				(effect) => effect.particle.speed,
				(effect, speed) => ({ ...effect, particle: { ...effect.particle, speed } }),
				{ min: 0, max: 20, step: 0.05, hint: 'Metres a second along the launch direction' },
			),
			...range(
				'particle.pitch',
				'Pitch',
				(effect) => effect.particle.pitch,
				(effect, pitch) => ({ ...effect, particle: { ...effect.particle, pitch } }),
				{ min: -PI / 2, max: PI / 2, step: 0.01, hint: 'Radians. Half pi is straight up, zero is level' },
			),
			...range(
				'particle.yaw',
				'Yaw',
				(effect) => effect.particle.yaw,
				(effect, yaw) => ({ ...effect, particle: { ...effect.particle, yaw } }),
				{ min: -PI, max: PI, step: 0.01, hint: 'Radians about +Y. A variance of pi is every direction' },
			),
		],
	},
	{
		title: 'Motion',
		hint: 'What happens to one after it is thrown.',
		fields: [
			...(['x', 'y', 'z'] as const).map((name, index) =>
				axis(
					`motion.gravity.${name}`,
					`Gravity ${name}`,
					index as 0 | 1 | 2,
					(effect) => effect.motion.gravity,
					(effect, gravity) => ({ ...effect, motion: { ...effect.motion, gravity } }),
					{ min: -20, max: 20, step: 0.01, hint: 'A constant acceleration. Wind goes in the same vector' },
				),
			),
			number(
				'motion.drag',
				'Drag',
				(effect) => effect.motion.drag,
				(effect, drag) => ({ ...effect, motion: { ...effect.motion, drag } }),
				{ min: 0, max: 8, step: 0.01, hint: 'The fraction of its speed shed each second' },
			),
			choice(
				'motion.space',
				'Space',
				['world', 'local'],
				(effect) => effect.motion.space,
				(effect, space) => ({ ...effect, motion: { ...effect.motion, space: space as never } }),
				'World leaves particles behind; local carries the whole plume',
			),
		],
	},
	{
		title: 'Size',
		hint: 'The circumradius of the prism, over its life.',
		fields: [
			number(
				'size.variance',
				'Variance',
				(effect) => effect.size.variance,
				(effect, variance) => ({ ...effect, size: { ...effect.size, variance } }),
				{ min: 0, max: 1, step: 0.01, hint: 'Scales the whole curve, per particle' },
			),
			number(
				'size.aspect',
				'Aspect',
				(effect) => effect.size.aspect,
				(effect, aspect) => ({ ...effect, size: { ...effect.size, aspect } }),
				{ min: 0, max: 6, step: 0.01, hint: 'Height as a fraction of the radius' },
			),
		],
	},
	{
		title: 'Colour',
		hint: 'Where it starts and where it ends.',
		fields: [
			number(
				'color.variance',
				'Variance',
				(effect) => effect.color.variance,
				(effect, variance) => ({ ...effect, color: { ...effect.color, variance } }),
				{ min: 0, max: 1, step: 0.01, hint: 'Lightness spread per particle' },
			),
		],
	},
	{
		title: 'Alpha',
		hint: 'How solid it is, over its life.',
		fields: [
			number(
				'alpha.variance',
				'Variance',
				(effect) => effect.alpha.variance,
				(effect, variance) => ({ ...effect, alpha: { ...effect.alpha, variance } }),
				{ min: 0, max: 1, step: 0.01, hint: 'Scales the whole curve, per particle' },
			),
		],
	},
	{
		title: 'Spin',
		hint: 'How the prism is turned, and how fast that changes.',
		fields: [
			...range(
				'spin.rate',
				'Rate',
				(effect) => effect.spin.rate,
				(effect, rate) => ({ ...effect, spin: { ...effect.spin, rate } }),
				{ min: -20, max: 20, step: 0.05, hint: 'Radians a second' },
			),
			...(['x', 'y', 'z'] as const).map((name, index) =>
				axis(
					`spin.axis.${name}`,
					`Axis ${name}`,
					index as 0 | 1 | 2,
					(effect) => effect.spin.axis,
					(effect, value) => ({ ...effect, spin: { ...effect.spin, axis: value } }),
					{ min: -1, max: 1, step: 0.01, hint: 'What it turns about, in the emitter’s space' },
				),
			),
			flag(
				'spin.tumble',
				'Tumble',
				(effect) => effect.spin.tumble,
				(effect, tumble) => ({ ...effect, spin: { ...effect.spin, tumble } }),
				'Give each particle an axis and a birth rotation of its own',
			),
		],
	},
];
