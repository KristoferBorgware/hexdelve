/*
 * The level generation catalogue.
 *
 * Two stacks so far, deliberately from opposite ends of the field: one carves
 * space out of a continuous function and gets caves for free but cannot say the
 * word "room"; the other places tiles under local constraints and gets rooms,
 * corridors and doors but no guarantee the level is one piece. Whichever wins,
 * it will be because one of those weaknesses turned out to matter more — which
 * is what the bench is for, and why they are behind one interface rather than
 * two bespoke previews.
 *
 * `docs/levelgen.md` lists the algorithms that are NOT here yet and what each
 * would be for.
 */

export type {
	CellKind,
	Level,
	LevelCell,
	LevelParam,
	LevelSettings,
	LevelStack,
	LevelStats,
} from './types.js';
export { defaultParams, readParam, readChoice } from './types.js';

export { STITCH_TILE, STITCH_COLOR, ROCK_COLOR } from './build.js';
export { CAVE_STACK, caveFieldAt } from './caveStack.js';
export { ROOM_STACK } from './roomStack.js';
export { WFC_STACK, wfcPatterns } from './wfcStack.js';
export {
	learn,
	patternShape,
	turnAxial,
	type Pattern,
	type PatternSet,
	type Reach,
	type Symmetry,
} from './wfc/overlapping.js';
export {
	readSample,
	sampleToAxial,
	DUNGEON_SAMPLE,
	ROCK,
	FLOOR,
	type Sample,
} from './wfc/sample.js';
export {
	HexWave,
	type Heuristic,
	type Propagator,
	type WfcOptions,
	type WfcResult,
} from './wfc/model.js';
export { fbm, valueNoise3, hash3, fade } from './noise.js';

import { CAVE_STACK } from './caveStack.js';
import type { LevelStack } from './types.js';
import { ROOM_STACK } from './roomStack.js';
import { WFC_STACK } from './wfcStack.js';

/** Every stack, in the order the bench offers them. */
export const LEVEL_STACKS: readonly LevelStack[] = [CAVE_STACK, WFC_STACK, ROOM_STACK];

export function findStack(id: string): LevelStack {
	return LEVEL_STACKS.find((stack) => stack.id === id) ?? LEVEL_STACKS[0]!;
}
