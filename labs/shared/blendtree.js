/*
 * labs/shared/blendtree.js — a blend tree: continuous parameters instead of clip names.
 *
 * Engine-free, like anim.js. Nothing here knows about a renderer.
 *
 * A blend tree turns "play walk" into "speed = 1.2 m/s". The leaves are clips,
 * the interior nodes are blend operations, and every node is weighted by a
 * parameter. Evaluating the tree gives one pose.
 *
 *   Blend1D    picks the two clips bracketing a parameter value and weights
 *              them by where the value falls between their thresholds
 *   Additive   adds a second subtree's pose on top of a base subtree's
 *
 * The interesting part is not the weighting — it is PHASE SYNCHRONISATION. Two
 * locomotion clips of different lengths, played on their own clocks and mixed,
 * produce a character whose legs are in two places at once: the average of a
 * foot planting and a foot lifting is a foot skating. So the synced leaves
 * share one normalised phase (0..1), each clip is stretched to a blended cycle
 * length, and each is offset so its own foot-contact lands on the same phase.
 *
 * Note on the blend itself: poses are Euler angles, so a weighted sum is an
 * approximation of a proper rotational blend. At these magnitudes, between
 * clips that are already phase-aligned, the error is not visible — but a rig
 * with large opposed rotations would want quaternion blending here.
 */

var Hexdelve = Hexdelve || {};

Hexdelve.blendtree = (function () {
'use strict';

const { createPose, clearPose, bindClip, sampleBound, solveWorld, measureGroundSpeed } = Hexdelve.anim;

/* ------------------------------------------------------------------ nodes -- */

class ClipNode {
	/**
	 * @param {object} clip
	 * @param {object} opts
	 *   sync          take part in the shared locomotion phase
	 *   contactPhase  where in ITS OWN cycle (0..1) the left foot lands, so the
	 *                 tree can line contacts up across clips of different lengths
	 */
	constructor(clip, opts = {}) {
		this.kind = 'clip';
		this.clip = clip;
		this.label = opts.label || clip.name;
		this.sync = !!opts.sync;
		this.contactPhase = opts.contactPhase || 0;
		this.time = 0; // own clock, used when unsynced
		this.bound = null;
	}

	children() {
		return [];
	}
}

class Blend1D {
	constructor(param, children, opts = {}) {
		this.kind = 'blend1d';
		this.param = param;
		this.label = opts.label || param;
		// [{ node, at }] sorted by threshold
		this.entries = children.slice().sort((a, b) => a.at - b.at);
	}

	children() {
		return this.entries.map((e) => e.node);
	}

	// Which children are active at this parameter value, and how much of each.
	resolve(value) {
		const n = this.entries.length;
		if (n === 0) return [];
		if (value <= this.entries[0].at) return [{ node: this.entries[0].node, weight: 1 }];
		if (value >= this.entries[n - 1].at) return [{ node: this.entries[n - 1].node, weight: 1 }];
		for (let i = 0; i < n - 1; i++) {
			const a = this.entries[i];
			const b = this.entries[i + 1];
			if (value >= a.at && value <= b.at) {
				const span = b.at - a.at;
				const u = span > 1e-9 ? (value - a.at) / span : 0;
				return [
					{ node: a.node, weight: 1 - u },
					{ node: b.node, weight: u },
				];
			}
		}
		return [{ node: this.entries[n - 1].node, weight: 1 }];
	}
}

class Additive {
	constructor(base, add, opts = {}) {
		this.kind = 'additive';
		this.label = opts.label || 'additive';
		this.base = base;
		this.add = add;
		this.gainParam = opts.gainParam || null; // 0..1 master gain, optional
	}

	children() {
		return [this.base, this.add];
	}
}

/* ------------------------------------------------------------------- tree -- */

class BlendTree {
	constructor(root, boneNames, opts = {}) {
		this.root = root;
		this.bones = boneNames;
		this.index = new Map(boneNames.map((n, i) => [n, i]));
		this.phase = 0;
		this.pose = createPose(boneNames.length);
		this.scratch = createPose(boneNames.length);
		this.fallbackDuration = opts.fallbackDuration || 1;
		this.leaves = [];
		this.bind(root);
	}

	bind(node) {
		if (node.kind === 'clip') {
			node.bound = bindClip(node.clip, this.index);
			this.leaves.push(node);
			return;
		}
		for (const child of node.children()) this.bind(child);
	}

	/**
	 * Walk the tree and collect the active leaves. Base weights sum to 1;
	 * additive weights are layered on top of that sum.
	 */
	weights(params) {
		const base = [];
		const add = [];
		const visit = (node, weight, additive) => {
			if (weight <= 1e-5) return;
			if (node.kind === 'clip') {
				(additive ? add : base).push({ node, weight });
				return;
			}
			if (node.kind === 'blend1d') {
				const value = params[node.param] || 0;
				for (const child of node.resolve(value)) {
					visit(child.node, weight * child.weight, additive);
				}
				return;
			}
			if (node.kind === 'additive') {
				visit(node.base, weight, additive);
				const gain =
					node.gainParam && params[node.gainParam] !== undefined ? params[node.gainParam] : 1;
				visit(node.add, weight * gain, true);
			}
		};
		visit(this.root, 1, false);
		return { base, add };
	}

	// The cycle length the synced clips agree on: their durations, weighted.
	// This is why a blend of walk and run speeds up smoothly instead of
	// stepping from one cadence to the other.
	syncedDuration(weights) {
		let total = 0;
		let sum = 0;
		for (const leaf of weights.base) {
			if (!leaf.node.sync) continue;
			total += leaf.weight;
			sum += leaf.weight * leaf.node.clip.duration;
		}
		return total > 1e-5 ? sum / total : this.fallbackDuration;
	}

	// Where in its own clip a synced leaf should be sampled, given the shared
	// phase. The contact offset is what actually lines the footfalls up.
	leafTime(node, phase, sync) {
		if (!sync || !node.sync) return node.time;
		let p = (phase + node.contactPhase) % 1;
		if (p < 0) p += 1;
		return p * node.clip.duration;
	}

	sampleInto(weights, phase, sync, out) {
		clearPose(out);
		const accumulate = (leaf) => {
			const t = this.leafTime(leaf.node, phase, sync);
			sampleBound({ clip: leaf.node.clip, bound: leaf.node.bound }, t, this.scratch);
			const w = leaf.weight;
			for (let i = 0; i < out.rot.length; i++) {
				out.rot[i] += this.scratch.rot[i] * w;
				out.pos[i] += this.scratch.pos[i] * w;
			}
		};
		for (const leaf of weights.base) accumulate(leaf);
		for (const leaf of weights.add) accumulate(leaf);
		return out;
	}

	update(params, dt, { sync = true } = {}) {
		const weights = this.weights(params);
		const duration = this.syncedDuration(weights);
		if (duration > 1e-5) {
			this.phase = (this.phase + dt / duration) % 1;
			if (this.phase < 0) this.phase += 1;
		}
		for (const leaf of this.leaves) {
			if (sync && leaf.sync) continue;
			leaf.time = (leaf.time + dt) % leaf.clip.duration;
		}
		this.sampleInto(weights, this.phase, sync, this.pose);
		return this.pose;
	}

	/**
	 * How far apart the synced clips actually are in their own cycles, as a
	 * fraction of a cycle. Sync exists to hold this at zero; with it off the
	 * clips run on their own clocks and this drifts through the whole range,
	 * which is the same thing as the feet disagreeing about where the ground is.
	 */
	phaseSpread(weights, sync) {
		const phases = [];
		for (const leaf of weights.base) {
			if (!leaf.node.sync || leaf.weight < 0.02) continue;
			const t = this.leafTime(leaf.node, this.phase, sync);
			let p = t / leaf.node.clip.duration - leaf.node.contactPhase;
			p = ((p % 1) + 1) % 1;
			phases.push(p);
		}
		if (phases.length < 2) return 0;
		let worst = 0;
		for (let i = 0; i < phases.length; i++) {
			for (let j = i + 1; j < phases.length; j++) {
				let d = Math.abs(phases[i] - phases[j]);
				if (d > 0.5) d = 1 - d; // it is a circle
				worst = Math.max(worst, d);
			}
		}
		return worst;
	}

	// Deterministic evaluation at an arbitrary phase — used for calibration,
	// which must not disturb playback state.
	poseAtPhase(params, phase) {
		const weights = this.weights(params);
		this.sampleInto(weights, phase, true, this.scratch2 || (this.scratch2 = createPose(this.bones.length)));
		return this.scratch2;
	}

	toSparse(dense) {
		const out = {};
		for (let i = 0; i < this.bones.length; i++) {
			const o = i * 3;
			out[this.bones[i]] = {
				rot: [dense.rot[o], dense.rot[o + 1], dense.rot[o + 2]],
				pos: [dense.pos[o], dense.pos[o + 1], dense.pos[o + 2]],
			};
		}
		return out;
	}
}

/* ------------------------------------------------------------ calibration -- */

/**
 * Measure what the blend actually produces.
 *
 * Thresholds are placed at each clip's own measured speed, but the blend of
 * two clips is not the average of their speeds: the stride blends AND the
 * cycle length blends, and speed is one divided by the other. So sweep the
 * parameter, measure the blended cycle's real ground speed at each step, and
 * keep the curve. Asking it for a speed then gives the parameter that actually
 * produces that speed — which is what stops the feet sliding mid-blend.
 */
function calibrateSpeed(tree, skeleton, param, range, steps = 24, extra = {}) {
	const table = [];
	for (let i = 0; i <= steps; i++) {
		const value = range[0] + ((range[1] - range[0]) * i) / steps;
		const params = Object.assign({}, extra, { [param]: value });
		const duration = tree.syncedDuration(tree.weights(params));
		const speed = measureGroundSpeed(
			skeleton,
			(t) => tree.toSparse(tree.poseAtPhase(params, t / duration)),
			duration,
		);
		table.push({ value, speed: Math.max(0, speed) });
	}
	// Enforce monotonicity so the inverse lookup is well defined.
	for (let i = 1; i < table.length; i++) {
		if (table[i].speed < table[i - 1].speed) table[i].speed = table[i - 1].speed;
	}
	return table;
}

// Speed → parameter value (the inverse of the calibration curve).
function parameterForSpeed(table, speed) {
	if (!table.length) return 0;
	if (speed <= table[0].speed) return table[0].value;
	const last = table[table.length - 1];
	if (speed >= last.speed) return last.value;
	for (let i = 0; i < table.length - 1; i++) {
		const a = table[i];
		const b = table[i + 1];
		if (speed >= a.speed && speed <= b.speed) {
			const span = b.speed - a.speed;
			const u = span > 1e-9 ? (speed - a.speed) / span : 0;
			return a.value + (b.value - a.value) * u;
		}
	}
	return last.value;
}

// Parameter value → speed (the forward direction, for readouts).
function speedForParameter(table, value) {
	if (!table.length) return 0;
	if (value <= table[0].value) return table[0].speed;
	const last = table[table.length - 1];
	if (value >= last.value) return last.speed;
	for (let i = 0; i < table.length - 1; i++) {
		const a = table[i];
		const b = table[i + 1];
		if (value >= a.value && value <= b.value) {
			const span = b.value - a.value;
			const u = span > 1e-9 ? (value - a.value) / span : 0;
			return a.speed + (b.speed - a.speed) * u;
		}
	}
	return last.speed;
}

return {
	ClipNode,
	Blend1D,
	Additive,
	BlendTree,
	calibrateSpeed,
	parameterForSpeed,
	speedForParameter,
};
})();
