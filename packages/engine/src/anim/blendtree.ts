/*
 * A blend tree: continuous parameters instead of clip names.
 *
 * "Play walk" is the wrong instruction for locomotion, because a character has
 * to be continuously anywhere between standing and running and there is no clip
 * for 1.2 metres a second. A blend tree replaces the instruction with a NUMBER
 * and works the rest out: the leaves are things that can be posed, the interior
 * nodes are blend operations, and evaluating the tree gives one pose.
 *
 *   blend1d    picks the two children bracketing a parameter and weights them
 *              by where the value falls between their thresholds
 *   additive   lays a second subtree's pose ON TOP of a base subtree's, which
 *              is a sum here because every value in this system is already a
 *              delta from rest — see `addPose`
 *   layer      blends a second subtree in through a per-bone MASK, which is how
 *              this project actually carries a shield while walking: the arms
 *              hold a stance and the hips go on with the stride
 *
 * The interesting part is not the weighting. It is PHASE SYNCHRONISATION.
 *
 * Two locomotion cycles of different lengths, run on their own clocks and
 * mixed, produce a character whose legs are in two places at once — and the
 * average of a foot planting and a foot lifting is a foot skating. So the
 * synced leaves share one normalised phase, the cycle they are stretched to is
 * the weighted blend of their own lengths, and each is offset by its own
 * contact phase so the footfalls land together. `sync = false` takes that away,
 * which is the only honest way to show what it was doing.
 *
 * A note on the blend itself: poses are Euler angles, so a weighted sum is an
 * approximation of a proper rotational blend. Between clips that are already
 * phase-aligned, at these magnitudes, the error is not visible — but a rig with
 * large opposed rotations would want quaternion blending here.
 *
 * A LEAF IS NOT A CLIP. It is anything that can answer "the pose at t", which
 * in this project means a keyframed clip OR a pose function: half the animation
 * here — the whole stride — is a function of an angle and has no keys at all.
 * The lab this came from could assume clips; a package cannot.
 */

import { bindClip, sampleBound, type Clip } from './clip.js';
import {
	addPose,
	clearPose,
	createPose,
	denseToSparse,
	lerpPose,
	lerpPoseMasked,
	makeMask,
	sparseToDense,
	type DensePose,
	type SparsePose,
} from './pose.js';

/* ---------------------------------------------------------------- sources -- */

/** Anything a leaf can be: a name, a cycle length, and a pose at a time. */
export interface PoseSource {
	readonly name: string;
	/** One cycle, in seconds. */
	readonly duration: number;
	/** The pose at `t` seconds, written into `out`. */
	sample(t: number, out: DensePose): void;
}

/** A keyframed clip as a leaf, with its bone names resolved once. */
export function clipSource(clip: Clip, index: ReadonlyMap<string, number>): PoseSource {
	const bound = bindClip(clip, index);
	return {
		name: clip.name,
		duration: clip.duration,
		sample: (t, out) => sampleBound(bound, t, out),
	};
}

/**
 * A pose function as a leaf — the stride, a wing beat, anything parametric.
 *
 * The sparse pose it writes is reused between calls, so this costs nothing per
 * frame beyond the function itself and the fill into dense.
 */
export function poseSource(
	name: string,
	duration: number,
	boneNames: readonly string[],
	pose: (t: number, out: SparsePose) => SparsePose,
): PoseSource {
	const scratch: SparsePose = {};
	return {
		name,
		duration,
		sample: (t, out) => {
			sparseToDense(boneNames, pose(t, scratch), out);
		},
	};
}

/* ------------------------------------------------------------------ nodes -- */

export interface LeafNode {
	readonly kind: 'leaf';
	readonly label: string;
	readonly source: PoseSource;
	/** Take part in the shared locomotion phase. */
	readonly sync: boolean;
	/** Where in ITS OWN cycle (0..1) the first foot lands. */
	readonly contactPhase: number;
}

export interface Blend1DEntry {
	readonly node: BlendNode;
	/** The parameter value at which this child is the whole answer. */
	readonly at: number;
}

export interface Blend1DNode {
	readonly kind: 'blend1d';
	readonly label: string;
	readonly param: string;
	/** Sorted by threshold. */
	readonly entries: readonly Blend1DEntry[];
}

export interface AdditiveNode {
	readonly kind: 'additive';
	readonly label: string;
	readonly base: BlendNode;
	readonly over: BlendNode;
	/** 0..1 master gain on the layer. Absent means always full. */
	readonly gainParam: string | null;
}

export interface LayerNode {
	readonly kind: 'layer';
	readonly label: string;
	readonly base: BlendNode;
	readonly over: BlendNode;
	/** Per-bone weight; bones left out are not touched by the layer. */
	readonly mask: Record<string, number>;
	readonly weightParam: string | null;
}

export type BlendNode = LeafNode | Blend1DNode | AdditiveNode | LayerNode;

export interface LeafOptions {
	label?: string;
	sync?: boolean;
	contactPhase?: number;
}

export function leaf(source: PoseSource, options: LeafOptions = {}): LeafNode {
	return {
		kind: 'leaf',
		label: options.label ?? source.name,
		source,
		sync: options.sync ?? false,
		contactPhase: options.contactPhase ?? 0,
	};
}

export function blend1d(
	param: string,
	entries: readonly Blend1DEntry[],
	options: { label?: string } = {},
): Blend1DNode {
	return {
		kind: 'blend1d',
		label: options.label ?? param,
		param,
		entries: [...entries].sort((a, b) => a.at - b.at),
	};
}

export function additive(
	base: BlendNode,
	over: BlendNode,
	options: { label?: string; gainParam?: string } = {},
): AdditiveNode {
	return {
		kind: 'additive',
		label: options.label ?? 'additive',
		base,
		over,
		gainParam: options.gainParam ?? null,
	};
}

export function layer(
	base: BlendNode,
	over: BlendNode,
	mask: Record<string, number>,
	options: { label?: string; weightParam?: string } = {},
): LayerNode {
	return {
		kind: 'layer',
		label: options.label ?? 'layer',
		base,
		over,
		mask,
		weightParam: options.weightParam ?? null,
	};
}

/** A node's children, for anything that has to walk the tree — a panel, say. */
export function nodeChildren(node: BlendNode): readonly BlendNode[] {
	switch (node.kind) {
		case 'leaf':
			return EMPTY;
		case 'blend1d':
			return node.entries.map((entry) => entry.node);
		default:
			return [node.base, node.over];
	}
}

const EMPTY: readonly BlendNode[] = [];

/* ------------------------------------------------------------------- tree -- */

/** A leaf that is currently contributing, and by how much. */
export interface ActiveLeaf {
	readonly node: LeafNode;
	readonly weight: number;
	/** True when it is laid over the result rather than blended into it. */
	readonly additive: boolean;
}

export interface BlendTreeOptions {
	/** The cycle to fall back on when nothing synced is active. */
	fallbackDuration?: number;
}

export type Parameters = Readonly<Record<string, number>>;

export class BlendTree {
	readonly root: BlendNode;
	readonly bones: readonly string[];

	/** The shared locomotion phase, 0..1. */
	phase = 0;
	/** Seconds, for leaves that keep their own clock rather than sync. */
	elapsed = 0;
	/** Off runs every leaf on its own clock — which is what sync is for. */
	sync = true;

	private readonly buffers = new Map<BlendNode, DensePose>();
	private readonly masks = new Map<LayerNode, Float32Array>();
	private readonly pool: { node: LeafNode; weight: number; additive: boolean }[] = [];
	private activeCount = 0;
	private readonly result: DensePose;
	private readonly fallback: number;
	private params: Parameters = {};
	private cycleLength: number;

	constructor(root: BlendNode, boneNames: readonly string[], options: BlendTreeOptions = {}) {
		this.root = root;
		this.bones = boneNames;
		this.result = createPose(boneNames.length);
		this.fallback = options.fallbackDuration ?? 1;
		this.cycleLength = this.fallback;
		this.bind(root);
	}

	/**
	 * The cycle the synced leaves currently agree on.
	 *
	 * Their own lengths, weighted — which is why a blend of walk and run speeds
	 * the cadence up smoothly instead of stepping from one to the other.
	 * Meaningful only after `resolve`.
	 */
	get cycle(): number {
		return this.cycleLength;
	}

	/** Which leaves are contributing, for a panel that wants to show it. */
	get active(): readonly ActiveLeaf[] {
		return this.pool.slice(0, this.activeCount);
	}

	/** Work out the active leaves and the shared cycle at these parameters. */
	resolve(params: Parameters): void {
		this.params = params;
		this.activeCount = 0;
		this.visit(this.root, 1, false);

		let total = 0;
		let sum = 0;
		for (let i = 0; i < this.activeCount; i++) {
			const entry = this.pool[i]!;
			if (!entry.node.sync) continue;
			total += entry.weight;
			sum += entry.weight * entry.node.source.duration;
		}
		this.cycleLength = total > 1e-5 ? sum / total : this.fallback;
	}

	/** Sample every active leaf at the current phase and blend them. */
	evaluate(): DensePose {
		this.evalNode(this.root, this.result);
		return this.result;
	}

	/**
	 * Resolve, carry the clock forward, and evaluate — for a caller that has a
	 * `dt` rather than a playhead. The bench drives `phase` itself instead,
	 * because a bench has to be able to hold one.
	 */
	advance(params: Parameters, dt: number): DensePose {
		this.resolve(params);
		this.elapsed += dt;
		if (this.cycleLength > 1e-5) {
			this.phase = wrap01(this.phase + dt / this.cycleLength);
		}
		return this.evaluate();
	}

	/** The last evaluated pose, as a sparse one. `out` is reused. */
	toSparse(out: SparsePose = {}): SparsePose {
		return denseToSparse(this.bones, this.result, out);
	}

	/**
	 * How far apart the synced leaves actually are in their own cycles, as a
	 * fraction of a cycle.
	 *
	 * Sync exists to hold this at zero. With it off the leaves run on their own
	 * clocks and this drifts through the whole range — which is the same thing
	 * as the feet disagreeing about where the ground is, said as a number.
	 */
	phaseSpread(): number {
		const phases: number[] = [];
		for (let i = 0; i < this.activeCount; i++) {
			const entry = this.pool[i]!;
			if (!entry.node.sync || entry.weight < 0.02) continue;
			const duration = entry.node.source.duration;
			if (duration <= 1e-6) continue;
			phases.push(wrap01(this.leafTime(entry.node) / duration - entry.node.contactPhase));
		}
		if (phases.length < 2) return 0;

		let worst = 0;
		for (let i = 0; i < phases.length; i++) {
			for (let j = i + 1; j < phases.length; j++) {
				let d = Math.abs(phases[i]! - phases[j]!);
				if (d > 0.5) d = 1 - d; // it is a circle
				if (d > worst) worst = d;
			}
		}
		return worst;
	}

	/* ------------------------------------------------------------ internals -- */

	private bind(node: BlendNode): void {
		if (node.kind === 'leaf') return;
		// Every interior node gets a buffer of its own, so evaluating the right
		// hand side never treads on the left hand side already sitting in the
		// parent's.
		this.buffers.set(node, createPose(this.bones.length));
		if (node.kind === 'layer') this.masks.set(node, makeMask(this.bones, node.mask));
		for (const child of nodeChildren(node)) this.bind(child);
	}

	private value(param: string | null, fallback: number): number {
		if (param === null) return fallback;
		const value = this.params[param];
		return value === undefined ? fallback : value;
	}

	private pushActive(node: LeafNode, weight: number, additive: boolean): void {
		const slot = this.pool[this.activeCount];
		if (slot) {
			slot.node = node;
			slot.weight = weight;
			slot.additive = additive;
		} else {
			this.pool[this.activeCount] = { node, weight, additive };
		}
		this.activeCount++;
	}

	/** Collect the active leaves. Deliberately allocation-free: it runs per frame. */
	private visit(node: BlendNode, weight: number, additive: boolean): void {
		if (weight <= 1e-5) return;

		switch (node.kind) {
			case 'leaf':
				this.pushActive(node, weight, additive);
				return;

			case 'blend1d': {
				const entries = node.entries;
				const n = entries.length;
				if (n === 0) return;
				const value = this.value(node.param, 0);
				if (n === 1 || value <= entries[0]!.at) {
					this.visit(entries[0]!.node, weight, additive);
					return;
				}
				if (value >= entries[n - 1]!.at) {
					this.visit(entries[n - 1]!.node, weight, additive);
					return;
				}
				for (let i = 0; i < n - 1; i++) {
					const a = entries[i]!;
					const b = entries[i + 1]!;
					if (value < a.at || value > b.at) continue;
					const span = b.at - a.at;
					const u = span > 1e-9 ? (value - a.at) / span : 0;
					this.visit(a.node, weight * (1 - u), additive);
					this.visit(b.node, weight * u, additive);
					return;
				}
				return;
			}

			case 'additive':
				this.visit(node.base, weight, additive);
				this.visit(node.over, weight * this.value(node.gainParam, 1), true);
				return;

			case 'layer':
				/*
				 * The base keeps its full weight and the layer reports its own,
				 * so these need not sum to one: a mask does not take weight away
				 * from the base everywhere, it takes it away per bone. A panel
				 * showing both at once is showing the truth about each.
				 */
				this.visit(node.base, weight, additive);
				this.visit(node.over, weight * this.value(node.weightParam, 1), additive);
				return;
		}
	}

	private evalNode(node: BlendNode, out: DensePose): void {
		switch (node.kind) {
			case 'leaf':
				node.source.sample(this.leafTime(node), out);
				return;

			case 'blend1d': {
				const entries = node.entries;
				const n = entries.length;
				if (n === 0) {
					clearPose(out);
					return;
				}
				const value = this.value(node.param, 0);
				if (n === 1 || value <= entries[0]!.at) {
					this.evalNode(entries[0]!.node, out);
					return;
				}
				if (value >= entries[n - 1]!.at) {
					this.evalNode(entries[n - 1]!.node, out);
					return;
				}
				for (let i = 0; i < n - 1; i++) {
					const a = entries[i]!;
					const b = entries[i + 1]!;
					if (value < a.at || value > b.at) continue;
					const span = b.at - a.at;
					const u = span > 1e-9 ? (value - a.at) / span : 0;
					this.evalNode(a.node, out);
					if (u <= 1e-5) return;
					const scratch = this.buffers.get(node)!;
					this.evalNode(b.node, scratch);
					lerpPose(out, out, scratch, u);
					return;
				}
				return;
			}

			case 'additive': {
				this.evalNode(node.base, out);
				const gain = this.value(node.gainParam, 1);
				if (gain <= 1e-5) return;
				const scratch = this.buffers.get(node)!;
				this.evalNode(node.over, scratch);
				addPose(out, scratch, gain);
				return;
			}

			case 'layer': {
				this.evalNode(node.base, out);
				const weight = this.value(node.weightParam, 1);
				if (weight <= 1e-5) return;
				const scratch = this.buffers.get(node)!;
				this.evalNode(node.over, scratch);
				lerpPoseMasked(out, out, scratch, weight, this.masks.get(node)!);
				return;
			}
		}
	}

	/**
	 * Where to sample a leaf.
	 *
	 * A synced leaf is stretched onto the shared cycle and offset by its own
	 * contact phase, which is the line that makes the footfalls coincide.
	 * Everything else runs on the wall clock, wrapped by its own length — which
	 * is exactly what two clips on independent clocks would do, drift included.
	 */
	private leafTime(node: LeafNode): number {
		const duration = node.source.duration;
		if (duration <= 1e-6) return 0;
		if (!this.sync || !node.sync) return wrap01(this.elapsed / duration) * duration;
		return wrap01(this.phase + node.contactPhase) * duration;
	}
}

function wrap01(value: number): number {
	const v = value % 1;
	return v < 0 ? v + 1 : v;
}
