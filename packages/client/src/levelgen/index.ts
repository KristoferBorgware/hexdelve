/*
 * The level generation catalogue.
 *
 * Three stacks, from one end of the field to the other. The CAVE carves space
 * out of a continuous function and gets caverns for free but cannot say the
 * word "room". The ROOMS stack scatters sites and grows organic blobs from
 * them. The BOXES stack builds: discrete rectangles with walls between them and
 * doors in the walls.
 *
 * A fourth lived here — a wave function collapse, first tiled and then
 * overlapping — and was removed. It worked, and what it could not do is the
 * thing that matters: a local constraint system has no way to say anything
 * about a level above the scale of a few cells, so every structure it produced
 * was structure that happened rather than structure that was decided.
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
export {
	vaultCatalogue,
	parseVault,
	VAULT_SPECS,
	type VaultSpec,
} from './vault/catalogue.js';
export {
	placeVaults,
	doorsOf,
	VAULT_WALL_TILE,
	VAULT_FLOOR_TILE,
	VAULT_DOOR_TILE,
	VAULT_WALL_COLOR,
	VAULT_FLOOR_COLOR,
	VAULT_DOOR_COLOR,
} from './vault/place.js';
export {
	terrainAt,
	vaultProblems,
	type Vault,
	type VaultTerrain,
	type VaultEntity,
	type VaultEntityKind,
	type PlacedVault,
} from './vault/types.js';
export { CAVE_STACK, caveFieldAt } from './caveStack.js';
export { ROOM_STACK } from './roomStack.js';
export { HALL_STACK } from './hallStack.js';
export { largestRectangle, area, type Rect } from './rect/largestRectangle.js';
export { linkNodes, type Node, type ProximityGraph } from './graph.js';
export { fbm, valueNoise3, hash3, fade } from './noise.js';

import { CAVE_STACK } from './caveStack.js';
import type { LevelStack } from './types.js';
import { HALL_STACK } from './hallStack.js';
import { ROOM_STACK } from './roomStack.js';

/** Every stack, in the order the bench offers them. */
export const LEVEL_STACKS: readonly LevelStack[] = [CAVE_STACK, ROOM_STACK, HALL_STACK];

export function findStack(id: string): LevelStack {
	return LEVEL_STACKS.find((stack) => stack.id === id) ?? LEVEL_STACKS[0]!;
}
