/*
 * A blend tree, read out of a file.
 *
 * The tree the editor's bench shows was fifty lines of TypeScript building
 * four nodes, and the arrangement was the only interesting thing in it — which
 * is another way of saying it was data wearing a function's clothes. Here the
 * arrangement is the file:
 *
 *   root:
 *     layer:                      the shield arm holds a stance through the
 *       mask: upperBody           upper body while the hips go on with the
 *       base: { additive: ... }   stride
 *       over: { leaf: guard }
 *
 * One thing did not come across as a plain number, and it is the reason this
 * file is longer than it looks like it should be. The thresholds on the speed
 * axis are metres per second, and in the code they were MEASURED — `strideVelocity`
 * asks the stride where its planted foot is at the two contact keys, so idle,
 * walk and run sit at their own true speeds rather than at three numbers
 * somebody guessed. Writing 1.53 into a file would throw that away and would be
 * wrong the first time anyone re-tuned the stride. So a threshold may instead be
 *
 *   at: { speedOf: walk }
 *
 * which measures the named animation exactly as the code did. `initial` and
 * `max` on a parameter take the same form, for the same reason.
 *
 * What is deliberately NOT here is the calibration. A blend halfway between a
 * walk and a run does not travel at the average of their speeds — the stride
 * and the cadence blend separately and speed is one over the other — so an
 * axis in true metres per second has to bend before it reaches the tree.
 * `calibrateSpeed` does that by sweeping the built tree, which needs the tree
 * to exist first; a file cannot hold the answer, only the request. So a
 * parameter carries `calibrated: true` and the consumer sweeps it. See
 * `calibrate.ts`.
 */

import {
	additive,
	blend1d,
	BlendTree,
	layer,
	leaf,
	type Blend1DEntry,
	type BlendNode,
} from '../anim/blendtree.js';
import type { AnimationAsset } from './animation.js';
import { Node } from './document.js';
import type { RigAsset } from './rig.js';

export interface TreeParameter {
	readonly name: string;
	readonly label: string;
	readonly min: number;
	readonly max: number;
	readonly step: number;
	readonly initial: number;
	readonly unit: string | null;
	readonly hint: string | null;
	/**
	 * Whether this axis means what it says only after a calibration sweep.
	 * The file asks; the consumer does the sweeping.
	 */
	readonly calibrated: boolean;
}

export interface BlendTreeAsset {
	readonly id: string;
	readonly label: string;
	readonly parameters: readonly TreeParameter[];
	/**
	 * A tree. Fresh each call on purpose: a tree owns a playhead and a set of
	 * scratch buffers, so two subjects sharing one would fight over both the
	 * moment either was being looked at.
	 */
	tree(): BlendTree;
}

const TREE_KEYS = ['id', 'label', 'notes', 'rig', 'constants', 'fallbackCycle', 'parameters', 'root'] as const;
const PARAMETER_KEYS = ['name', 'label', 'min', 'max', 'step', 'initial', 'unit', 'hint', 'calibrated'] as const;

export function loadBlendTree(
	source: string,
	file: string,
	rig: RigAsset,
	animations: ReadonlyMap<string, AnimationAsset>,
): BlendTreeAsset {
	const root = Node.parse(source, file).only(...TREE_KEYS);
	const id = root.need('id').text();

	const constants: Record<string, number> = {};
	for (const [key, child] of root.get('constants').entriesOrEmpty()) {
		constants[key] = child.withScope({ ...constants }).number();
	}
	const scoped = root.withScope(constants);

	const reader = new TreeReader(rig, animations);
	const parameters = reader.parameters(scoped.get('parameters'));

	const fallbackNode = scoped.get('fallbackCycle');
	const fallbackDuration = fallbackNode.present
		? reader.animation(fallbackNode).duration
		: undefined;

	// Read once so a bad file fails at load, then again per `tree()` so each
	// tree gets leaf sources of its own.
	const rootNode = scoped.need('root');
	reader.node(rootNode);

	return {
		id,
		label: scoped.get('label').textOr(id),
		parameters,
		tree: () =>
			new BlendTree(reader.node(rootNode), rig.bones, {
				...(fallbackDuration !== undefined ? { fallbackDuration } : {}),
			}),
	};
}

class TreeReader {
	constructor(
		private readonly rig: RigAsset,
		private readonly animations: ReadonlyMap<string, AnimationAsset>,
	) {}

	parameters(node: Node): TreeParameter[] {
		return node.listOrEmpty().map((entry) => {
			entry.only(...PARAMETER_KEYS);
			const name = entry.need('name').text();
			const unit = entry.get('unit');
			const hint = entry.get('hint');
			return {
				name,
				label: entry.get('label').textOr(name),
				min: this.value(entry.get('min'), 0),
				max: this.value(entry.get('max'), 1),
				step: entry.get('step').numberOr(0.01),
				initial: this.value(entry.get('initial'), 0),
				unit: unit.present ? unit.text() : null,
				hint: hint.present ? hint.text() : null,
				calibrated: entry.get('calibrated').flag(false),
			};
		});
	}

	/** One node: a single-key mapping naming which of the four it is. */
	node(entry: Node): BlendNode {
		const keys = entry.keys();
		if (keys.length !== 1) {
			entry.fail(
				`a node is one of leaf, blend1d, additive or layer; found ${keys.join(', ') || 'nothing'}`,
			);
		}
		const kind = keys[0]!;
		const body = entry.need(kind);

		switch (kind) {
			case 'leaf':
				return this.leaf(body);
			case 'blend1d':
				return this.blend1d(body);
			case 'additive':
				return this.additive(body);
			case 'layer':
				return this.layer(body);
			default:
				return body.fail('expected leaf, blend1d, additive or layer');
		}
	}

	/**
	 * A leaf.
	 *
	 * `sync` and `contactPhase` default to what the ANIMATION says about
	 * itself, so a file only states them where a leaf wants something other
	 * than the truth about the cycle it is playing — which is what the sync
	 * toggle on the bench is for and nothing else.
	 */
	private leaf(body: Node): BlendNode {
		// `leaf: walk` is the common case and worth not making anyone spell out.
		if (!body.isMap) {
			const animation = this.animation(body);
			return leaf(animation.source(), {
				label: animation.label,
				sync: animation.sync,
				contactPhase: animation.contacts[0] ?? 0,
			});
		}

		body.only('animation', 'label', 'sync', 'contactPhase');
		const animation = this.animation(body.need('animation'));
		const sync = body.get('sync').flag(animation.sync);
		return leaf(animation.source(), {
			label: body.get('label').textOr(animation.label),
			sync,
			contactPhase: body.get('contactPhase').numberOr(sync ? (animation.contacts[0] ?? 0) : 0),
		});
	}

	private blend1d(body: Node): BlendNode {
		body.only('param', 'label', 'entries');
		const param = body.need('param').text();
		const entries: Blend1DEntry[] = body
			.need('entries')
			.list()
			.map((entry) => {
				entry.only('at', 'node');
				return { at: this.value(entry.need('at'), 0), node: this.node(entry.need('node')) };
			});
		if (entries.length === 0) body.need('entries').fail('a blend1d needs at least one entry');
		return blend1d(param, entries, { label: body.get('label').textOr(param) });
	}

	private additive(body: Node): BlendNode {
		body.only('base', 'over', 'gain', 'label');
		const gain = body.get('gain');
		return additive(this.node(body.need('base')), this.node(body.need('over')), {
			label: body.get('label').textOr('additive'),
			...(gain.present ? { gainParam: gain.text() } : {}),
		});
	}

	private layer(body: Node): BlendNode {
		body.only('base', 'over', 'mask', 'weight', 'label');
		const weight = body.get('weight');
		return layer(
			this.node(body.need('base')),
			this.node(body.need('over')),
			this.mask(body.need('mask')),
			{
				label: body.get('label').textOr('layer'),
				...(weight.present ? { weightParam: weight.text() } : {}),
			},
		);
	}

	/** A mask by name from the rig, or written out in place. */
	private mask(node: Node): Record<string, number> {
		if (node.isMap) {
			const known = new Set(this.rig.bones);
			const out: Record<string, number> = {};
			for (const [name, weight] of node.entries()) {
				if (!known.has(name)) weight.fail(`no bone called '${name}' in rig '${this.rig.id}'`);
				out[name] = weight.number();
			}
			return out;
		}

		const name = node.text();
		const mask = this.rig.masks[name];
		if (mask === undefined) {
			const known = Object.keys(this.rig.masks).sort().join(', ');
			node.fail(`rig '${this.rig.id}' has no mask called '${name}'; it has ${known || 'none'}`);
		}
		return { ...mask };
	}

	animation(node: Node): AnimationAsset {
		const name = node.text();
		const animation = this.animations.get(name);
		if (animation === undefined) {
			const known = [...this.animations.keys()].sort().join(', ');
			node.fail(`no animation called '${name}' on this entity; it has ${known || 'none'}`);
		}
		return animation;
	}

	/**
	 * A number, or a speed measured off an animation.
	 *
	 * `{ speedOf: walk }` is what keeps a blend axis honest: the walk's
	 * threshold is whatever the walk's own feet carry it at, so re-tuning the
	 * stride moves the threshold with it instead of leaving the tree claiming
	 * a speed it no longer delivers.
	 */
	private value(node: Node, fallback: number): number {
		if (!node.present) return fallback;
		if (!node.isMap) return node.number();

		node.only('speedOf');
		const target = node.need('speedOf');
		const animation = this.animation(target);
		const speed = animation.speed();
		if (speed !== null) return speed.z;
		return target.fail(
			`'${animation.name}' has no measurable ground speed: its rig needs two feet and ` +
				'the animation needs a contact schedule to read them at',
		);
	}
}
