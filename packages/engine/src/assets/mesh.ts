/*
 * A body, read out of a file instead of built by a function.
 *
 * Every drawable in this project is the same unit hexagonal prism under a
 * different scale and rotation, bound to a bone. A body is therefore a LIST of
 * those, and `buildWanderer` was never doing anything a list could not — it
 * was a list with a `for (const side of ['L', 'R'])` loop through the middle.
 *
 * Which is exactly what nearly stopped this being a file. Flattening those
 * loops would turn sixty readable parts into a hundred and twenty unreadable
 * ones, and the two halves of a symmetric body would then be free to drift
 * apart. So four things came across from the code along with the data, because
 * each of them was carrying meaning and not merely characters:
 *
 *   sides     a group emitted once per side, `*` in a bone name standing for
 *             the side letter — the loop itself
 *   mirror    and on the far side, x negated and the y and z of a rotation
 *             with it: the `const s = side === 'L' ? 1 : -1` that goes with it
 *   frames    an authoring frame, so the sword's numbers read as "how far down
 *             the blade" and the shield's as "on the face of the shield"
 *             rather than as a pile of pre-rotated offsets
 *   anchors   a named point in such a frame, so the sword's tip stays derived
 *             from where the blade actually ends rather than typed twice
 *
 * Groups are what carry the sides rather than single parts, because the order
 * the prisms go in should be the order the loop put them in — all of the left
 * wing and then all of the right, not spar-left, spar-right, membrane-left.
 * That costs nothing to keep and makes a file checkable against the function
 * it replaced.
 *
 * A vector may also be `{ bone: foreL }`, meaning that bone's rest offset —
 * which is how a wing spar spans its own bone exactly, and goes on doing so
 * when the bone is re-tuned. Numbers may be arithmetic (see expression.ts),
 * which is what keeps `pi / 2 + 0.05` from becoming 1.6207963267948965.
 */

import { quat } from '@hexdelve/shared';

import { HEX_FLAG_NONE, HEX_FLAG_UNLIT } from '../scene/HexInstances.js';
import { Model } from '../scene/Model.js';
import { Node, type Vec3 } from './document.js';
import type { RigAsset } from './rig.js';

export interface Anchor {
	readonly bone: string;
	/** In that bone's own space. */
	readonly at: Vec3;
}

export interface MeshAsset {
	readonly id: string;
	readonly name: string;
	/** Part colours, by the only name a part has. */
	readonly palette: Readonly<Record<string, number>>;
	/** Named points in a bone's space — a blade's tip, a set of jaws. */
	readonly anchors: Readonly<Record<string, Anchor>>;
	/** The prisms. Built once, on first use — they never change. */
	model(): Model;
}

const MESH_KEYS = [
	'id',
	'name',
	'notes',
	'rig',
	'constants',
	'palette',
	'frames',
	'parts',
	'anchors',
] as const;

const PRISM_KEYS = [
	'bone',
	'frame',
	'at',
	'size',
	'euler',
	'color',
	'alpha',
	'unlit',
	'mirror',
] as const;

const STRUT_KEYS = [
	'bone',
	'from',
	'to',
	'along',
	'length',
	'radius',
	'color',
	'alpha',
	'unlit',
	'mirror',
] as const;

const GROUP_KEYS = ['sides', 'mirror', 'frame', 'parts'] as const;

/** A bone plus an offset and a rotation: the frame a part's numbers are in. */
interface Frame {
	readonly bone: string | null;
	readonly at: Vec3;
	/** Float64, so composing it costs no precision the renderer would keep. */
	readonly rotation: readonly [number, number, number, number];
	readonly identity: boolean;
}

const NO_FRAME: Frame = { bone: null, at: [0, 0, 0], rotation: [0, 0, 0, 1], identity: true };

/** Where in a sided group we are, and what that means for the numbers. */
interface Emit {
	/** The letter `*` stands for, or null outside a sided group. */
	readonly side: string | null;
	/** True on every side after the first — the one that gets mirrored. */
	readonly flipped: boolean;
	/** Whether parts here mirror when flipped. Inherited from the group. */
	readonly mirror: boolean;
	readonly frame: Frame;
}

const ROOT: Emit = { side: null, flipped: false, mirror: false, frame: NO_FRAME };

/**
 * @param rig the rig this mesh's bone names belong to. A prop has no rig of
 *            its own and borrows the one it is worn on, which is why this is
 *            an argument rather than something the file resolves for itself.
 */
export function loadMesh(source: string, file: string, rig: RigAsset): MeshAsset {
	const root = Node.parse(source, file).only(...MESH_KEYS);
	const id = root.need('id').text();

	const constants: Record<string, number> = {};
	for (const [key, child] of root.get('constants').entriesOrEmpty()) {
		constants[key] = child.withScope({ ...constants }).number();
	}

	const scoped = root.withScope(constants);
	const palette: Record<string, number> = {};
	for (const [key, child] of scoped.get('palette').entriesOrEmpty()) {
		palette[key] = child.number();
	}

	const reader = new MeshReader(rig, palette);
	const frames = reader.frames(scoped);
	const parts = scoped.get('parts');

	// Read once, so a broken file fails at load rather than on first draw.
	const anchors = reader.anchors(scoped, frames);

	let built: Model | null = null;

	return {
		id,
		name: root.get('name').textOr(id),
		palette,
		anchors,
		model: () => {
			if (built === null) {
				built = new Model();
				reader.emit(built, parts.listOrEmpty(), ROOT, frames);
			}
			return built;
		},
	};
}

class MeshReader {
	private readonly bones: Set<string>;

	constructor(
		private readonly rig: RigAsset,
		private readonly palette: Readonly<Record<string, number>>,
	) {
		this.bones = new Set(rig.bones);
	}

	frames(root: Node): Record<string, Frame> {
		const out: Record<string, Frame> = {};
		for (const [key, child] of root.get('frames').entriesOrEmpty()) {
			child.only('bone', 'at', 'euler');
			const at = child.get('at').vec3Or([0, 0, 0]);
			const euler = child.get('euler').vec3Or([0, 0, 0]);
			const still = euler.every((angle) => angle === 0) && at.every((value) => value === 0);
			out[key] = {
				bone: this.boneName(child.need('bone'), null),
				at,
				rotation: eulerXYZ(euler[0], euler[1], euler[2]),
				identity: still,
			};
		}
		return out;
	}

	anchors(root: Node, frames: Record<string, Frame>): Record<string, Anchor> {
		const out: Record<string, Anchor> = {};
		for (const [key, child] of root.get('anchors').entriesOrEmpty()) {
			child.only('bone', 'frame', 'at');
			const frame = this.frameOf(child, frames, NO_FRAME);
			const bone = child.get('bone').present
				? this.boneName(child.need('bone'), null)
				: frame.bone;
			if (bone === null) return child.fail('an anchor needs a bone, or a frame that has one');
			out[key] = { bone, at: place(frame, this.vector(child.need('at'), null, false)) };
		}
		return out;
	}

	/** Walk the parts list, emitting prisms and struts as it goes. */
	emit(model: Model, entries: readonly Node[], context: Emit, frames: Record<string, Frame>): void {
		for (const entry of entries) {
			if (entry.get('parts').present || entry.get('sides').present) {
				this.group(model, entry, context, frames);
			} else if (entry.get('radius').present) {
				this.strut(model, entry, context, frames);
			} else {
				this.prism(model, entry, context, frames);
			}
		}
	}

	private group(model: Model, entry: Node, context: Emit, frames: Record<string, Frame>): void {
		entry.only(...GROUP_KEYS);
		const parts = entry.need('parts').list();
		const frame = this.frameOf(entry, frames, context.frame);
		const mirror = entry.get('mirror').flag(context.mirror);

		const sidesNode = entry.get('sides');
		if (!sidesNode.present) {
			this.emit(model, parts, { ...context, mirror, frame }, frames);
			return;
		}

		const sides = sidesNode.list().map((side) => side.text());
		if (sides.length === 0) sidesNode.fail('a sided group needs at least one side');
		for (let i = 0; i < sides.length; i++) {
			// The first side is as authored; every side after it is the mirror,
			// which is the `s = side === 'L' ? 1 : -1` this replaces.
			this.emit(model, parts, { side: sides[i]!, flipped: i > 0, mirror, frame }, frames);
		}
	}

	private prism(model: Model, entry: Node, context: Emit, frames: Record<string, Frame>): void {
		entry.only(...PRISM_KEYS);
		const frame = this.frameOf(entry, frames, context.frame);
		const mirror = context.flipped && entry.get('mirror').flag(context.mirror);

		const boneNode = entry.get('bone');
		const bone = boneNode.present ? this.boneName(boneNode, context.side) : frame.bone;
		if (bone === null) return entry.fail('a part needs a bone, or a frame that has one');

		const at = this.vector(entry.need('at'), context.side, mirror);
		const size = entry.need('size').vec3();
		const euler = entry.get('euler').vec3Or([0, 0, 0]);
		// Mirroring a rotation about the y-z plane flips the y and z turns and
		// leaves the x turn alone, which is why a raked ear or a tilted cheek
		// plate needs one number rather than two.
		const spun: Vec3 = mirror ? [euler[0], -euler[1], -euler[2]] : euler;

		model.add(bone, place(frame, at), [size[0], size[1], size[2]], this.color(entry), {
			...(frame.identity
				? { euler: [spun[0], spun[1], spun[2]] as [number, number, number] }
				: { rotation: multiply(frame.rotation, eulerXYZ(spun[0], spun[1], spun[2])) }),
			alpha: entry.get('alpha').numberOr(1),
			flags: entry.get('unlit').flag(false) ? HEX_FLAG_UNLIT : HEX_FLAG_NONE,
		});
	}

	/**
	 * A thin prism spanning two points — every limb spar, wing bone, claw and
	 * mane spike in the project is one of these.
	 *
	 * `along` and `length` are the other way of saying `to`: a claw is a
	 * direction out of a knuckle and a distance, and the direction need not be
	 * unit, which is what lets a fan of three claws be uneven rather than
	 * combed.
	 */
	private strut(model: Model, entry: Node, context: Emit, frames: Record<string, Frame>): void {
		entry.only(...STRUT_KEYS);
		if (!this.frameOf(entry, frames, context.frame).identity) {
			entry.fail(
				'a strut cannot sit in a frame: its rotation comes from its own two ends, so a ' +
					'frame would have to invent a roll for it. Give it a bone and plain endpoints.',
			);
		}

		const mirror = context.flipped && entry.get('mirror').flag(context.mirror);
		const bone = this.boneName(entry.need('bone'), context.side);
		const from = this.vector(entry.need('from'), context.side, mirror);

		const toNode = entry.get('to');
		let to: Vec3;
		if (toNode.present) {
			to = this.vector(toNode, context.side, mirror);
		} else {
			const along = this.vector(entry.need('along'), context.side, mirror);
			const distance = entry.need('length').number();
			to = [
				from[0] + along[0] * distance,
				from[1] + along[1] * distance,
				from[2] + along[2] * distance,
			];
		}

		model.strut(bone, from, to, entry.need('radius').number(), this.color(entry), {
			alpha: entry.get('alpha').numberOr(1),
			flags: entry.get('unlit').flag(false) ? HEX_FLAG_UNLIT : HEX_FLAG_NONE,
		});
	}

	/* --------------------------------------------------------------- pieces -- */

	private frameOf(entry: Node, frames: Record<string, Frame>, fallback: Frame): Frame {
		const node = entry.get('frame');
		if (!node.present) return fallback;
		const name = node.text();
		const frame = frames[name];
		if (frame === undefined) {
			const known = Object.keys(frames).join(', ');
			node.fail(`no frame called '${name}'; this file declares ${known || 'none'}`);
		}
		return frame;
	}

	/** A bone name, with `*` standing for the current side. */
	private boneName(node: Node, side: string | null): string {
		const raw = node.text();
		const name = side === null ? raw : raw.replaceAll('*', side);
		if (!this.bones.has(name)) node.fail(`no bone called '${name}' in rig '${this.rig.id}'`);
		return name;
	}

	/**
	 * Three numbers, or a bone whose rest offset they are.
	 *
	 * A bone-resolved vector is never mirrored: it resolves against the
	 * mirrored bone's own name, so `{ bone: fore* }` on the right wing already
	 * points the right way and negating it would send the spar back through
	 * the animal.
	 */
	private vector(node: Node, side: string | null, mirror: boolean): Vec3 {
		if (node.isMap) {
			node.only('bone');
			const name = this.boneName(node.need('bone'), side);
			return this.rig.skeleton.find((bone) => bone.name === name)!.offset as Vec3;
		}
		const vector = node.vec3();
		return mirror ? [-vector[0], vector[1], vector[2]] : vector;
	}

	private color(entry: Node): number {
		const node = entry.need('color');
		if (typeof node.value !== 'string') return node.number();
		const named = this.palette[node.value];
		if (named === undefined) {
			const known = Object.keys(this.palette).sort().join(', ');
			node.fail(`no colour called '${node.value}'; this palette has ${known || 'nothing'}`);
		}
		return named;
	}
}

/* -------------------------------------------------------------- transforms -- */

/** A part's position, once its frame has been applied. */
function place(frame: Frame, at: Vec3): Vec3 {
	if (frame.identity) return at;
	const rotated = quat.rotateVec3([0, 0, 0], frame.rotation, at);
	return [frame.at[0] + rotated[0]!, frame.at[1] + rotated[1]!, frame.at[2] + rotated[2]!];
}

/**
 * Euler XYZ to a quaternion, in float64.
 *
 * `quat.fromEulerXYZ` writes into a Float32Array, which is right for a part's
 * stored rotation and wrong for an intermediate a frame is about to be
 * composed into — that would round twice on the way to one answer.
 */
function eulerXYZ(x: number, y: number, z: number): [number, number, number, number] {
	const c1 = Math.cos(x / 2);
	const c2 = Math.cos(y / 2);
	const c3 = Math.cos(z / 2);
	const s1 = Math.sin(x / 2);
	const s2 = Math.sin(y / 2);
	const s3 = Math.sin(z / 2);
	return [
		s1 * c2 * c3 + c1 * s2 * s3,
		c1 * s2 * c3 - s1 * c2 * s3,
		c1 * c2 * s3 + s1 * s2 * c3,
		c1 * c2 * c3 - s1 * s2 * s3,
	];
}

function multiply(
	a: readonly [number, number, number, number],
	b: readonly [number, number, number, number],
): [number, number, number, number] {
	return [
		a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
		a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
		a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
		a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
	];
}
