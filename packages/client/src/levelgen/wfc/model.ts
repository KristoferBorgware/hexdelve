/*
 * Wave function collapse on a hex disc — a port of mxgmn's `Model.cs`.
 *
 * The original is a square grid with four neighbours and a rectangular domain.
 * Three things change here and nothing else does:
 *
 *   1. Six directions rather than four, and `opposite(d)` is `d + 3`.
 *   2. The domain is a hex DISC held as a flat array of cells with an explicit
 *      neighbour table, rather than `i % MX` and `i / MX`. A cell off the disc
 *      is simply absent, which is what the original's non-periodic branch does
 *      by skipping — so an edge cell is unconstrained from outside rather than
 *      wrapped, and that is the same choice as `periodic = false`.
 *   3. Pattern size `N` is gone. It only ever existed for the overlapping
 *      model; the tiled model passes `N = 1` and every test on it collapses.
 *
 * Everything that makes the algorithm work is unchanged and deliberately so.
 * The supporter counts in `compatible`, the entropy heuristic with its 1e-6
 * tiebreak noise, the ban-and-propagate loop, the weighted observation — all of
 * it is the same code in a different language. In particular `compatible[i][t][d]`
 * still counts how many tiles at the neighbour ACROSS `d` still support `t`
 * here, and is still initialised to the size of the opposite direction's
 * propagator row; that counter is the whole reason propagation is linear rather
 * than a re-scan, and it is the part of WFC most rewrites get subtly wrong.
 *
 * Two deliberate departures, both documented where they happen:
 *
 *   - Contradictions are detected wherever they occur. `Model.Propagate` ends
 *     `return sumsOfOnes[0] > 0`, which only ever notices a wave emptied at
 *     node zero; on a rectangle that is a corner and mostly harmless, on a disc
 *     it is one arbitrary cell. A flag set in `ban` costs nothing and is right.
 *
 *   - The random source is this project's own mulberry32 rather than .NET's
 *     `Random`, so a seed means the same level in a browser as in a test.
 */

import { AXIAL_DIRECTIONS, axialDisc, axialKey, makeRandom, type Axial } from '@hexdelve/shared';

import type { Propagator, Tile } from './tileset.js';

export type Heuristic = 'entropy' | 'mrv' | 'scanline';

export interface WfcOptions {
	readonly radius: number;
	readonly tiles: readonly Tile[];
	readonly propagator: Propagator;
	readonly seed: number;
	readonly heuristic?: Heuristic;
	/**
	 * A tile-spec name to force on a cell before the first propagation, or null
	 * to leave it free.
	 *
	 * This is the hex answer to the original's `ground` flag, which nails the
	 * bottom row of the output to one tile so a Summer landscape has ground
	 * under it. Here it is how a level gets an EDGE: pin the outer rings to
	 * rock and the solver is obliged to close every passage that reaches them,
	 * rather than leaving corridors sheared off at the boundary.
	 */
	readonly pin?: (cell: Axial) => string | null;
}

export interface WfcResult {
	/** The cells, in the order the observation array indexes them. */
	readonly cells: readonly Axial[];
	/** Tile index per cell. Never negative: see `settle`. */
	readonly observed: Int32Array;
	/** False if the run hit a contradiction and `observed` is a salvage. */
	readonly ok: boolean;
}

export class HexWave {
	private readonly cells: Axial[];
	private readonly neighbours: Int32Array;
	private readonly tiles: readonly Tile[];
	private readonly propagator: Propagator;
	private readonly heuristic: Heuristic;
	private readonly random: () => number;
	private readonly pin: (cell: Axial) => string | null;

	private readonly n: number;
	private readonly t: number;

	private readonly wave: Uint8Array;
	private readonly compatible: Int32Array;
	private readonly sumsOfOnes: Int32Array;
	private readonly sumsOfWeights: Float64Array;
	private readonly sumsOfWeightLogWeights: Float64Array;
	private readonly entropies: Float64Array;
	private readonly observed: Int32Array;
	private readonly distribution: Float64Array;

	private readonly weightLogWeights: Float64Array;
	private readonly sumOfWeights: number;
	private readonly sumOfWeightLogWeights: number;
	private readonly startingEntropy: number;

	private readonly stack: Int32Array;
	private stackSize = 0;
	private observedSoFar = 0;
	private contradiction = false;

	constructor(options: WfcOptions) {
		this.cells = axialDisc(options.radius);
		this.tiles = options.tiles;
		this.propagator = options.propagator;
		this.heuristic = options.heuristic ?? 'entropy';
		this.random = makeRandom(options.seed | 0);
		this.pin = options.pin ?? (() => null);

		this.n = this.cells.length;
		this.t = this.tiles.length;

		// The neighbour table, built once. It is what replaces the original's
		// index arithmetic, and it is also where the disc's boundary lives:
		// -1 means there is nothing out there to constrain or be constrained by.
		const index = new Map<string, number>();
		this.cells.forEach((cell, i) => index.set(axialKey(cell.q, cell.r), i));
		this.neighbours = new Int32Array(this.n * 6).fill(-1);
		this.cells.forEach((cell, i) => {
			for (let d = 0; d < 6; d++) {
				const step = AXIAL_DIRECTIONS[d]!;
				const found = index.get(axialKey(cell.q + step.q, cell.r + step.r));
				this.neighbours[i * 6 + d] = found === undefined ? -1 : found;
			}
		});

		this.wave = new Uint8Array(this.n * this.t);
		this.compatible = new Int32Array(this.n * this.t * 6);
		this.sumsOfOnes = new Int32Array(this.n);
		this.sumsOfWeights = new Float64Array(this.n);
		this.sumsOfWeightLogWeights = new Float64Array(this.n);
		this.entropies = new Float64Array(this.n);
		this.observed = new Int32Array(this.n).fill(-1);
		this.distribution = new Float64Array(this.t);
		this.weightLogWeights = new Float64Array(this.t);

		let sumOfWeights = 0;
		let sumOfWeightLogWeights = 0;
		for (let t = 0; t < this.t; t++) {
			const weight = this.tiles[t]!.weight;
			this.weightLogWeights[t] = weight * Math.log(weight);
			sumOfWeights += weight;
			sumOfWeightLogWeights += this.weightLogWeights[t]!;
		}
		this.sumOfWeights = sumOfWeights;
		this.sumOfWeightLogWeights = sumOfWeightLogWeights;
		this.startingEntropy = Math.log(sumOfWeights) - sumOfWeightLogWeights / sumOfWeights;

		this.stack = new Int32Array(this.n * this.t * 2);
	}

	/**
	 * Collapse the whole disc, or fail trying.
	 *
	 * `limit` bounds the observations rather than the propagations, exactly as
	 * the original does — one observation always removes at least one option
	 * somewhere, so the loop cannot spin.
	 */
	run(limit = -1): WfcResult {
		this.clear();
		if (this.contradiction) return this.settle(false);

		for (let step = 0; limit < 0 || step < limit; step++) {
			const node = this.nextUnobservedNode();
			if (node < 0) return this.settle(true);

			this.observe(node);
			this.propagate();
			if (this.contradiction) return this.settle(false);
		}

		return this.settle(true);
	}

	/**
	 * What each cell ended up as.
	 *
	 * On success every cell has exactly one option and this reads it off. On a
	 * contradiction it takes the first option still standing, or rock's index
	 * where none is — so a failed run is still a drawable picture of how far it
	 * got, which is worth far more on a bench than an exception is.
	 */
	private settle(ok: boolean): WfcResult {
		const fallback = Math.max(
			0,
			this.tiles.findIndex((tile) => tile.spec.kind === 'rock'),
		);
		for (let i = 0; i < this.n; i++) {
			let chosen = -1;
			for (let t = 0; t < this.t; t++) {
				if (this.wave[i * this.t + t]) {
					chosen = t;
					break;
				}
			}
			this.observed[i] = chosen < 0 ? fallback : chosen;
		}
		return { cells: this.cells, observed: this.observed, ok };
	}

	/** Every option live, every supporter counted, then the pins applied. */
	private clear(): void {
		this.stackSize = 0;
		this.observedSoFar = 0;
		this.contradiction = false;

		for (let i = 0; i < this.n; i++) {
			for (let t = 0; t < this.t; t++) {
				this.wave[i * this.t + t] = 1;
				for (let d = 0; d < 6; d++) {
					// How many tiles across `d` currently support `t` here.
					// Which is the size of the row facing back the other way.
					this.compatible[(i * this.t + t) * 6 + d] = this.propagator[(d + 3) % 6]![t]!.length;
				}
			}
			this.sumsOfOnes[i] = this.t;
			this.sumsOfWeights[i] = this.sumOfWeights;
			this.sumsOfWeightLogWeights[i] = this.sumOfWeightLogWeights;
			this.entropies[i] = this.startingEntropy;
		}

		for (let i = 0; i < this.n; i++) {
			const wanted = this.pin(this.cells[i]!);
			if (wanted === null) continue;
			for (let t = 0; t < this.t; t++) {
				if (this.tiles[t]!.spec.name !== wanted && this.wave[i * this.t + t]) this.ban(i, t);
			}
		}

		if (this.stackSize > 0) this.propagate();
	}

	/**
	 * The next cell to collapse.
	 *
	 * Entropy is the default and the one worth having: the least uncertain cell
	 * is the one whose choice constrains the fewest others, so the wave settles
	 * from wherever it is already nearly decided outwards, and contradictions
	 * are rarer than under any order that ignores the weights. `mrv` is the same
	 * idea counting options instead of measuring them, and `scanline` is there
	 * because it is the cheapest thing that works and makes a good control.
	 */
	private nextUnobservedNode(): number {
		if (this.heuristic === 'scanline') {
			for (let i = this.observedSoFar; i < this.n; i++) {
				if (this.sumsOfOnes[i]! > 1) {
					this.observedSoFar = i + 1;
					return i;
				}
			}
			return -1;
		}

		let min = 1e4;
		let argmin = -1;
		for (let i = 0; i < this.n; i++) {
			const remaining = this.sumsOfOnes[i]!;
			if (remaining <= 1) continue;
			const entropy = this.heuristic === 'entropy' ? this.entropies[i]! : remaining;
			if (entropy > min) continue;
			// The noise is not decoration: without it every cell in a fresh
			// region has identical entropy and the scan always picks the first,
			// which turns the whole heuristic back into a scanline.
			const noise = 1e-6 * this.random();
			if (entropy + noise < min) {
				min = entropy + noise;
				argmin = i;
			}
		}
		return argmin;
	}

	/** Pick one tile for a cell, weighted, and ban the rest. */
	private observe(node: number): void {
		const base = node * this.t;
		for (let t = 0; t < this.t; t++) {
			this.distribution[t] = this.wave[base + t] ? this.tiles[t]!.weight : 0;
		}
		const chosen = weightedPick(this.distribution, this.random());
		for (let t = 0; t < this.t; t++) {
			if (!!this.wave[base + t] !== (t === chosen)) this.ban(node, t);
		}
	}

	/**
	 * Drain the ban stack, removing supporters as it goes.
	 *
	 * The cost of this loop is why the counters exist: a banned tile only ever
	 * touches its own row of the propagator in each of six directions, so the
	 * work is proportional to what actually changed rather than to the size of
	 * the wave.
	 */
	private propagate(): void {
		while (this.stackSize > 0 && !this.contradiction) {
			this.stackSize--;
			const i1 = this.stack[this.stackSize * 2]!;
			const t1 = this.stack[this.stackSize * 2 + 1]!;

			for (let d = 0; d < 6; d++) {
				const i2 = this.neighbours[i1 * 6 + d]!;
				if (i2 < 0) continue;

				const row = this.propagator[d]![t1]!;
				for (let k = 0; k < row.length; k++) {
					const t2 = row[k]!;
					const at = (i2 * this.t + t2) * 6 + d;
					const left = this.compatible[at]! - 1;
					this.compatible[at] = left;
					if (left === 0 && this.wave[i2 * this.t + t2]) this.ban(i2, t2);
				}
			}
		}
	}

	/** Rule one tile out of one cell, and note what that did to the entropy. */
	private ban(i: number, t: number): void {
		this.wave[i * this.t + t] = 0;
		for (let d = 0; d < 6; d++) this.compatible[(i * this.t + t) * 6 + d] = 0;

		this.stack[this.stackSize * 2] = i;
		this.stack[this.stackSize * 2 + 1] = t;
		this.stackSize++;

		this.sumsOfOnes[i] = this.sumsOfOnes[i]! - 1;
		this.sumsOfWeights[i] = this.sumsOfWeights[i]! - this.tiles[t]!.weight;
		this.sumsOfWeightLogWeights[i] = this.sumsOfWeightLogWeights[i]! - this.weightLogWeights[t]!;

		if (this.sumsOfOnes[i]! <= 0) {
			// The departure from the original noted at the top of the file: a
			// wave emptied anywhere is a contradiction, not only at node zero.
			this.contradiction = true;
			this.entropies[i] = 0;
			return;
		}

		const sum = this.sumsOfWeights[i]!;
		this.entropies[i] = Math.log(sum) - this.sumsOfWeightLogWeights[i]! / sum;
	}
}

/**
 * mxgmn's `Helper.Random`: walk the weights until the running total passes
 * `r` of the whole. Linear, and the array is sixty long.
 */
function weightedPick(weights: Float64Array, r: number): number {
	let sum = 0;
	for (let i = 0; i < weights.length; i++) sum += weights[i]!;
	if (sum <= 0) return 0;

	const threshold = r * sum;
	let partial = 0;
	for (let i = 0; i < weights.length; i++) {
		partial += weights[i]!;
		if (partial >= threshold) return i;
	}
	return 0;
}
