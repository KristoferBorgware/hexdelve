/*
 * What the prop bench can put on the stand.
 *
 * A prop, unlike a rig, is one model and no bones: the whole of "wearing" it
 * is which transform it is drawn through — its own, or a bone's. So an entry
 * here is the model, the bone it belongs to, and the two numbers that put it
 * down in the grass. All four come out of `@hexdelve/client`, for the same
 * reason the character bench takes its skeletons from there: a helmet that
 * sits well on the bench is the helmet the game draws, because it is the same
 * model placed the same way.
 *
 * Nothing here has stats. Props in this project are meshes and nothing else so
 * far, and that is exactly why the bench exists now — a catalogue you can look
 * through is where the numbers will be authored once there are numbers. What
 * the inspector shows is a mock, and says so; what THIS file exposes is only
 * what is really true of a prop today, plus `measure`, which reads the mesh.
 */

import type { ColorInput, Model } from '@hexdelve/engine';
import {
	buildHelmet,
	buildShield,
	buildSword,
	HELMET_GROUND_LIFT,
	HELMET_PALETTE,
	SHIELD_GROUND_LIFT,
	SHIELD_GROUND_TILT,
	SHIELD_PALETTE,
	SWORD_GROUND_LIFT,
	SWORD_GROUND_TILT,
	SWORD_PALETTE,
} from '@hexdelve/client';
import { quat, type QuatLike } from '@hexdelve/shared';

/** Which family a prop belongs to, and therefore which numbers it wants. */
export type PropKind = 'weapon' | 'armour' | 'shield';

export interface BenchProp {
	readonly id: string;
	readonly label: string;
	readonly kind: PropKind;
	/** The bone it hangs from when worn. Worn, its transform is the identity. */
	readonly bone: string;
	/** How far to raise it so it rests on the grass rather than in it. */
	readonly groundLift: number;
	/** Rotation about X on the ground: 0 stands it up, pi/2 lays it flat. */
	readonly groundTilt: number;
	/** One line for the catalogue row — what the thing actually is. */
	readonly blurb: string;
	/** The mesh. Built once, on first use — the prisms never change. */
	model(): Model;
}

/**
 * A prop's parts, by the only name they have: their colour.
 *
 * The palettes are named tables in the client, so a part drawn in `0x4a5058`
 * is a `steel` part and can be listed as one. It is a weak identity — two
 * parts the same shade are indistinguishable — but it is a true one, and it
 * beats numbering thirty rows and calling them "part 17".
 */
const COLOR_NAMES = new Map<number, string>();
for (const palette of [HELMET_PALETTE, SWORD_PALETTE, SHIELD_PALETTE]) {
	for (const [name, hex] of Object.entries(palette)) {
		if (!COLOR_NAMES.has(hex)) COLOR_NAMES.set(hex, name);
	}
}

function hexOf(color: ColorInput): number {
	if (typeof color === 'number') return color;
	const channel = (value: number): number => Math.round(Math.max(0, Math.min(1, value)) * 255);
	return (channel(color.r) << 16) | (channel(color.g) << 8) | channel(color.b);
}

/** `steelDark` reads better in a list as `steel dark`. */
function colorName(color: number): string {
	const name = COLOR_NAMES.get(color);
	if (!name) return `#${color.toString(16).padStart(6, '0')}`;
	return name.replace(/([A-Z])/g, (letter) => ` ${letter.toLowerCase()}`);
}

export interface PropPartRow {
	readonly index: number;
	readonly label: string;
	/** A CSS colour, so the list can show the shade rather than name it twice. */
	readonly swatch: string;
	/** Width x height x depth, in metres, as authored. */
	readonly size: string;
}

/** The parts of a prop, as the outline lists them. */
export function partRows(model: Model): PropPartRow[] {
	return model.parts.map((part, index) => {
		const hex = hexOf(part.color);
		return {
			index,
			label: colorName(hex),
			swatch: `#${hex.toString(16).padStart(6, '0')}`,
			size: part.scale.map((value) => value.toFixed(3)).join(' x '),
		};
	});
}

/** A catalogue entry, before the model behind it is memoised onto it. */
type PropSpec = Omit<BenchProp, 'model'> & { build(): Model };

function prop({ build, ...spec }: PropSpec): BenchProp {
	let built: Model | null = null;
	return { ...spec, model: () => (built ??= build()) };
}

/** Everything the bench knows how to show, in the order the catalogue lists it. */
export const BENCH_PROPS: readonly BenchProp[] = [
	prop({
		id: 'helmet',
		label: 'Helmet',
		kind: 'armour',
		bone: 'head',
		groundLift: HELMET_GROUND_LIFT,
		groundTilt: 0,
		blurb: 'Nasal helm, cheek plates',
		build: buildHelmet,
	}),
	prop({
		id: 'sword',
		label: 'Sword',
		kind: 'weapon',
		bone: 'handR',
		groundLift: SWORD_GROUND_LIFT,
		groundTilt: SWORD_GROUND_TILT,
		blurb: 'Straight blade, cross guard',
		build: buildSword,
	}),
	prop({
		id: 'shield',
		label: 'Shield',
		kind: 'shield',
		bone: 'forearmL',
		groundLift: SHIELD_GROUND_LIFT,
		groundTilt: SHIELD_GROUND_TILT,
		blurb: 'Round boards, iron boss',
		build: buildShield,
	}),
];

export function findProp(id: string): BenchProp {
	return BENCH_PROPS.find((candidate) => candidate.id === id) ?? BENCH_PROPS[0]!;
}

/* ---------------------------------------------------------------- measure -- */

export interface PropBox {
	readonly min: readonly [number, number, number];
	readonly max: readonly [number, number, number];
	readonly size: readonly [number, number, number];
	readonly center: readonly [number, number, number];
	/** Half the diagonal — what a camera has to stand back far enough to see. */
	readonly radius: number;
	readonly parts: number;
}

const cornerQuat = quat.quat();
const cornerVec: [number, number, number] = [0, 0, 0];
const sourceVec: [number, number, number] = [0, 0, 0];
const anchorVec: [number, number, number] = [0, 0, 0];

/**
 * The box a prop actually occupies, measured off the mesh.
 *
 * Every corner of every prism, rotated into the frame the prop is being drawn
 * in — not the cheap thing of taking each part's position plus its scale,
 * which is wrong the moment a part is turned, and almost every part of a
 * helmet is turned.
 *
 * The corners are the hexagon's own six vertices rather than a square's four,
 * because the prism has a vertex on +Z and a flat at +-X: measuring a square
 * around it would report a blade 13% wider than it is, and the one number a
 * bench exists to give you honestly is a dimension.
 */
export function measure(model: Model, rotation?: QuatLike): PropBox {
	const min: [number, number, number] = [Infinity, Infinity, Infinity];
	const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

	for (const part of model.parts) {
		const spin = rotation ? quat.multiply(cornerQuat, rotation, part.rotation) : part.rotation;
		const anchor = rotation
			? quat.rotateVec3(anchorVec, rotation, part.position)
			: part.position;

		const halfHeight = part.scale[1] / 2;
		for (let i = 0; i < 6; i++) {
			const angle = (i * Math.PI) / 3;
			const x = Math.sin(angle) * part.scale[0];
			const z = Math.cos(angle) * part.scale[2];
			for (const y of [-halfHeight, halfHeight]) {
				sourceVec[0] = x;
				sourceVec[1] = y;
				sourceVec[2] = z;
				quat.rotateVec3(cornerVec, spin, sourceVec);
				for (let axis = 0; axis < 3; axis++) {
					const value = anchor[axis]! + cornerVec[axis]!;
					if (value < min[axis]!) min[axis] = value;
					if (value > max[axis]!) max[axis] = value;
				}
			}
		}
	}

	// An empty model would leave the sweep at infinity; a zero box is the one
	// answer that will not make a camera fly off to the edge of the world.
	if (!Number.isFinite(min[0])) {
		min[0] = min[1] = min[2] = 0;
		max[0] = max[1] = max[2] = 0;
	}

	const size: [number, number, number] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
	return {
		min,
		max,
		size,
		center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
		radius: Math.hypot(size[0], size[1], size[2]) / 2,
		parts: model.parts.length,
	};
}
