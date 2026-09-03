/*
 * What a generated level IS, independent of what generated it.
 *
 * Every stack in this folder produces one of these and nothing else, which is
 * the whole reason the bench can compare them: the viewport draws a `Level`,
 * the readout counts a `Level`, and neither has ever heard of noise bands or
 * wave functions. Adding a fourth algorithm is adding a `LevelStack` — no new
 * drawing code, no new panel, no new anything.
 *
 * The grid is a map keyed by `axialKey`, not an array, because a level is a hex
 * DISC and a rectangular array of it is a third empty. Lookup is by key
 * throughout for the same reason.
 *
 * A hexagon is the atom. Two floor cells side by side are joined, and a wall
 * is a rock cell — there is no such thing here as half a tile, and nothing
 * lives on an edge.
 */

import type { Axial } from '@hexdelve/shared';

/** Rock is the negative space; floor is everything a body can stand on. */
export type CellKind = 'rock' | 'floor';

export interface LevelCell {
	readonly q: number;
	readonly r: number;
	readonly kind: CellKind;
	/** The tile that produced it, for a readout. Empty where a stack has no tiles. */
	readonly tile: string;
	/** Connected component of the floor graph, or -1 for rock. */
	region: number;
	/**
	 * Rock the carve declared inviolable — the rim that gives the level an
	 * edge. Exposed rather than kept private because it is a real property of
	 * the place: anything that later wants to dig, place stairs or drop a vault
	 * needs to know which rock is structural.
	 */
	readonly sealed: boolean;
	/** 0xRRGGBB, chosen by the stack that made it. */
	readonly color: number;
}

export interface LevelStats {
	readonly cells: number;
	readonly floor: number;
	readonly rock: number;
	/**
	 * Walkable components the CARVE produced, before anything downstream
	 * joined or filled them in. This is the algorithm's own honest output and
	 * the number a tileset gets tuned against.
	 */
	readonly regions: number;
	/** And how many the finished level came out in. One is the good answer. */
	readonly pieces: number;
	/** Floor cells in the largest of them. */
	readonly largest: number;
	/** Tunnels the stitcher dug to join the pieces up. */
	readonly joins: number;
	/** Cells those tunnels cost. */
	readonly tunnelled: number;
	/** Steps from entry to exit, or 0 if there is no route. */
	readonly route: number;
	/** How many seeds the stack burned before one produced a level. */
	readonly attempts: number;
	readonly ms: number;
}

export interface Level {
	readonly stack: string;
	readonly seed: number;
	readonly radius: number;
	readonly cells: ReadonlyMap<string, LevelCell>;
	/** Where a party comes in, and where the stairs down are. Null if unwalkable. */
	readonly entry: Axial | null;
	readonly exit: Axial | null;
	/** Entry to exit, inclusive of both ends. */
	readonly route: readonly Axial[];
	readonly stats: LevelStats;
	/** A line per pipeline step, shown beside the level so the stack is legible. */
	readonly steps: readonly string[];
}

/**
 * One knob on a stack.
 *
 * Declared as data rather than as a typed options object so the inspector can
 * build its own sliders. A stack that grows a parameter grows a slider, and the
 * editor is not touched.
 */
export interface LevelParam {
	readonly key: string;
	readonly label: string;
	readonly hint: string;
	readonly min: number;
	readonly max: number;
	readonly step: number;
	readonly value: number;
	/** Show it as a whole number, and round before the stack sees it. */
	readonly integer?: boolean;
	/**
	 * Named settings rather than a range. When present the value is an index
	 * into this list, and the inspector draws chips instead of a slider — which
	 * is what a choice like the solver's heuristic actually is.
	 */
	readonly choices?: readonly string[];
}

export interface LevelSettings {
	readonly seed: number;
	readonly radius: number;
	/** Keyed by `LevelParam.key`, already defaulted by `settingsFor`. */
	readonly params: Readonly<Record<string, number>>;
	/** Dig tunnels between the pieces, so the level comes out walkable end to end. */
	readonly stitch: boolean;
	/** Throw away everything the stitch could not reach. */
	readonly prune: boolean;
}

/**
 * A named pipeline: a carve, then the shared finish.
 *
 * `steps` is the pipeline written out, and it is here rather than in a comment
 * because the bench shows it. Two stacks that differ only in their first step
 * should look like it on screen — that is the comparison the bench exists for.
 */
export interface LevelStack {
	readonly id: string;
	readonly label: string;
	readonly blurb: string;
	/** Where the algorithm came from, credited in the panel. */
	readonly source: string;
	readonly steps: readonly string[];
	readonly params: readonly LevelParam[];
	generate(settings: LevelSettings): Level;
}

/** A stack's defaults, so the editor can start without knowing any of them. */
export function defaultParams(stack: LevelStack): Record<string, number> {
	const out: Record<string, number> = {};
	for (const param of stack.params) out[param.key] = param.value;
	return out;
}

/** One parameter, defaulted and rounded the way its declaration asks. */
export function readParam(stack: LevelStack, params: Readonly<Record<string, number>>, key: string): number {
	const spec = stack.params.find((candidate) => candidate.key === key);
	if (!spec) throw new Error(`${stack.id} has no parameter ${key}`);
	const raw = params[key] ?? spec.value;
	const clamped = Math.max(spec.min, Math.min(spec.max, raw));
	return spec.integer || spec.choices ? Math.round(clamped) : clamped;
}

/** The chosen name of a `choices` parameter, for a stack that wants the word. */
export function readChoice(
	stack: LevelStack,
	params: Readonly<Record<string, number>>,
	key: string,
): string {
	const spec = stack.params.find((candidate) => candidate.key === key);
	if (!spec?.choices) throw new Error(`${stack.id} has no choice parameter ${key}`);
	return spec.choices[readParam(stack, params, key)] ?? spec.choices[0]!;
}
