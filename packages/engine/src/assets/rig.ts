/*
 * A rig, read out of a file instead of typed into a module.
 *
 * `skeleton.ts` already made the argument this rests on: a bone is a name, a
 * parent and an offset, and everything downstream — the prisms, the visible
 * skeleton, the clips, the IK — is built from that list. Nothing in the engine
 * ever asked what shape the animal was, which is why the bat and then the
 * hellhound cost nothing to add.
 *
 * What they did cost was a TypeScript module each, and a matching export line,
 * and an entry in the editor's bench. Three rigs is where that stops being
 * free: the data was never code, it was only *stored* as code, and this is the
 * same list of bones in the file it should have been in all along.
 *
 * Beyond the bones a rig carries the four other things that are true of the
 * skeleton rather than of any one body wearing it:
 *
 *   tips      where a chain ends and there is no child bone to draw towards
 *   groups    named runs of bones — one wing outboard, one leg hip to paw
 *   masks     per-bone blend weights, so `upperBody` has one definition
 *   metrics   numbers about the rig, `measures` being the ones READ OFF the
 *             bones rather than typed beside them
 *
 * `metrics` are in scope for every expression later in the file, so a hip
 * height is written once and the root bone's offset refers to it.
 */

import { boneIndex, boneNames, type Bone, type BoneTip, type Skeleton } from '../anim/skeleton.js';
import { Node, type Vec3 } from './document.js';

/** A named point in a bone's own space — a set of jaws, a blade's tip. */
export interface RigAnchor {
	readonly bone: string;
	readonly at: Vec3;
}

export interface RigAsset {
	readonly id: string;
	readonly name: string;
	readonly skeleton: Skeleton;
	readonly bones: readonly string[];
	readonly index: ReadonlyMap<string, number>;
	readonly tips: readonly BoneTip[];
	/** Named runs of bones: one wing outboard, one leg hip to paw. */
	readonly groups: Readonly<Record<string, readonly string[]>>;
	/** Per-bone blend weights, by name. Bones left out weigh nothing. */
	readonly masks: Readonly<Record<string, Readonly<Record<string, number>>>>;
	/** Named points in a bone's space, for anything that reaches or bites. */
	readonly anchors: Readonly<Record<string, RigAnchor>>;
	/** Numbers about the rig, typed or measured. */
	readonly metrics: Readonly<Record<string, number>>;
	/** The two feet that alternate, when this rig walks. */
	readonly feet: readonly [string, string] | null;
	/** Roughly the middle of the creature, and how far back to stand. */
	readonly view: RigView;
}

export interface RigView {
	readonly focusY: number;
	readonly frameDistance: number;
}

const RIG_KEYS = [
	'id',
	'name',
	'notes',
	'metrics',
	'bones',
	'tips',
	'groups',
	'masks',
	'anchors',
	'measures',
	'feet',
	'view',
] as const;

export function loadRig(source: string, file: string): RigAsset {
	const root = Node.parse(source, file).only(...RIG_KEYS);

	const id = root.need('id').text();
	const name = root.get('name').textOr(id);

	/*
	 * Metrics come first because the bones may refer to them: a hip height is
	 * a fact about the rig, and writing it once means the root bone's offset
	 * and the camera's focus cannot disagree about it. Each is in scope for
	 * the ones after it, so a metric may be derived from another.
	 */
	const metrics: Record<string, number> = {};
	for (const [key, child] of root.get('metrics').entriesOrEmpty()) {
		metrics[key] = child.withScope({ ...metrics }).number();
	}

	const skeleton = readBones(root.need('bones').withScope(metrics));
	const bones = boneNames(skeleton);
	const known = new Set(bones);
	const scoped = root.withScope(metrics);

	const boneName = (node: Node): string => {
		const value = node.text();
		if (!known.has(value)) node.fail(`no bone called '${value}' in rig '${id}'`);
		return value;
	};

	const tips: BoneTip[] = scoped
		.get('tips')
		.listOrEmpty()
		.map((tip) => {
			tip.only('bone', 'to');
			return { bone: boneName(tip.need('bone')), to: tip.need('to').vec3() };
		});

	const groups: Record<string, readonly string[]> = {};
	for (const [key, child] of scoped.get('groups').entriesOrEmpty()) {
		groups[key] = child.list().map(boneName);
	}

	const masks: Record<string, Record<string, number>> = {};
	for (const [key, child] of scoped.get('masks').entriesOrEmpty()) {
		const mask: Record<string, number> = {};
		for (const [name, weight] of child.entries()) {
			if (!known.has(name)) weight.fail(`no bone called '${name}' in rig '${id}'`);
			mask[name] = weight.number();
		}
		masks[key] = mask;
	}

	const anchors: Record<string, RigAnchor> = {};
	for (const [key, child] of scoped.get('anchors').entriesOrEmpty()) {
		child.only('bone', 'at');
		anchors[key] = { bone: boneName(child.need('bone')), at: child.need('at').vec3() };
	}

	/*
	 * Measures are the metrics that are READ OFF the bones, which is why they
	 * come after them: the humanoid's leg length is hip to ankle, and typing
	 * it beside the two offsets that already say it is how the two drift.
	 */
	for (const [key, child] of scoped.get('measures').entriesOrEmpty()) {
		if (key in metrics) child.fail(`'${key}' is already a metric`);
		metrics[key] = measure(child, skeleton, boneName);
	}

	const feetNode = scoped.get('feet');
	let feet: readonly [string, string] | null = null;
	if (feetNode.present) {
		const listed = feetNode.list();
		if (listed.length !== 2) feetNode.fail('expected exactly two feet, which alternate');
		feet = [boneName(listed[0]!), boneName(listed[1]!)];
	} else if (groups.feet !== undefined) {
		const pair = groups.feet;
		if (pair.length === 2) feet = [pair[0]!, pair[1]!];
	}

	const view = scoped.get('view');
	view.only('focusY', 'frameDistance');

	return {
		id,
		name,
		skeleton,
		bones,
		index: boneIndex(skeleton),
		tips,
		groups,
		masks,
		anchors,
		metrics,
		feet,
		view: {
			focusY: view.get('focusY').numberOr(skeleton[0]?.offset[1] ?? 0),
			frameDistance: view.get('frameDistance').numberOr(4),
		},
	};
}

/**
 * The bones, in order.
 *
 * Parents must precede their children, because one forward pass resolves the
 * whole hierarchy and that is the property that makes it one pass. A file that
 * gets the order wrong is refused here rather than producing a character whose
 * arm is attached to last frame's chest.
 */
function readBones(node: Node): Skeleton {
	const out: Bone[] = [];
	const seen = new Set<string>();

	for (const entry of node.list()) {
		entry.only('name', 'parent', 'offset');
		const nameNode = entry.need('name');
		const name = nameNode.text();
		if (seen.has(name)) nameNode.fail(`two bones called '${name}'`);

		const parentNode = entry.get('parent');
		let parent: string | null = null;
		if (parentNode.present) {
			parent = parentNode.text();
			if (!seen.has(parent)) {
				parentNode.fail(
					`parent '${parent}' is not defined above '${name}'; ` +
						'parents must precede their children so one pass resolves the rig',
				);
			}
		} else if (out.length > 0) {
			nameNode.fail(`'${name}' has no parent, and '${out[0]!.name}' is already the root`);
		}

		seen.add(name);
		out.push({ name, parent, offset: entry.need('offset').vec3() });
	}

	if (out.length === 0) node.fail('a rig needs at least one bone');
	return out;
}

/** A number read off the skeleton rather than typed beside it. */
function measure(node: Node, skeleton: Skeleton, boneName: (node: Node) => string): number {
	node.only('chain');
	const chain = node.need('chain');
	const listed = chain.list();
	if (listed.length !== 2) chain.fail('expected [from, to]');
	const from = boneName(listed[0]!);
	const to = boneName(listed[1]!);

	/*
	 * The distance travelled by the offsets between the two, walking up from
	 * `to` until `from` is reached — so the humanoid's `[hipL, footL]` is the
	 * shin plus the foot, which is hip to ankle.
	 */
	let total = 0;
	let at: string | null = to;
	while (at !== null && at !== from) {
		const name: string = at;
		const bone = skeleton.find((candidate) => candidate.name === name);
		if (bone === undefined) return chain.fail(`no bone called '${name}'`);
		total += length(bone.offset);
		at = bone.parent;
	}
	if (at === null) chain.fail(`'${from}' is not an ancestor of '${to}'`);
	return total;
}

function length(offset: Vec3): number {
	return Math.hypot(offset[0], offset[1], offset[2]);
}
