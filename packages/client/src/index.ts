/*
 * @hexdelve/client — the core package, and the one built for distribution.
 *
 * Everything an embedder needs is here: hand it a canvas, get a running world.
 * The editor imports this same module rather than reaching past it into the
 * engine, so the editor's viewport and someone else's <canvas> are the same
 * code path.
 */

export { HexdelveClient, type ClientOptions, type ClientStats } from './HexdelveClient.js';
export { Controls, type ControlsOptions } from './input/Controls.js';

export {
	Simulation,
	type FrameInput,
	type SimulationOptions,
	type SimulationToggles,
	type YardStats,
} from './game/simulation.js';

export { Player, REACH, MAX_CLIMB, type PlayerStats } from './game/player.js';
export { BatHunt, WAKE_RANGE, LOSE_RANGE, KEEP_APART, type HuntState } from './game/bathunt.js';
export { Actor, turnTowards, wrapAngle } from './game/actor.js';
export { Item, type ItemOptions } from './game/items.js';

export { buildWorld, type World, type Tile, type WorldOptions } from './scene/world.js';

/*
 * Level generation, exported for the same reason the rigs are: the editor's
 * level bench previews the generators the game will build its dungeons from,
 * and it should get them from the package that owns them rather than keep a
 * second copy that drifts.
 */
export {
	LEVEL_STACKS,
	findStack,
	defaultParams,
	readParam,
	readChoice,
	CAVE_STACK,
	ROOM_STACK,
	HALL_STACK,
	vaultCatalogue,
	parseVault,
	VAULT_SPECS,
	terrainAt,
	vaultProblems,
	VAULT_WALL_TILE,
	VAULT_FLOOR_TILE,
	VAULT_DOOR_TILE,
	type Vault,
	type VaultSpec,
	type VaultTerrain,
	type VaultEntity,
	type VaultEntityKind,
	type PlacedVault,
	largestRectangle,
	area,
	STITCH_TILE,
	STITCH_COLOR,
	ROCK_COLOR,
	type CellKind,
	type ExitPlacement,
	type Level,
	type LevelCell,
	type LevelParam,
	type LevelSettings,
	type LevelStack,
	type LevelStats,
	type Rect,
} from './levelgen/index.js';
export { SKELETON, BONES, TIPS, HIPS_Y, UPPER_BODY } from './game/skeleton.js';
export { BAT_SKELETON, BAT_BONES, BAT_TIPS, HOVER_Y, PERCH_Y } from './game/batrig.js';

/*
 * The characters themselves — the rig data above, wearing prisms.
 *
 * Exported because a rig and the body hung on it are one thing to anyone
 * looking at either: the editor's character bench previews a skeleton, a mesh
 * and a clip together, and it should get all three from the package that owns
 * them rather than build a second wanderer of its own.
 */
export { buildWanderer, WANDERER_PALETTE } from './models/wanderer.js';
export { buildBat, BAT_PALETTE } from './models/bat.js';

/*
 * The gear, for the same reason as the bodies above.
 *
 * A prop is a model and the two numbers that put it down in the grass — the
 * lift and the tilt — and the editor's prop bench previews all three together.
 * The palettes come with them because a part's colour is the only name it has:
 * a bench listing "steel" and "liner" is reading this table rather than
 * guessing at hex codes.
 */
export {
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
	SWORD_TIP,
} from './models/props.js';
export {
	perchPose,
	flyPose,
	lungePose,
	FLAP_PERIOD,
	LUNGE_CONTACT,
} from './game/batpose.js';
export {
	stridePose,
	stridePeriod,
	strideVelocity,
	STRIDE_CONTACTS,
	WALK_PERIOD,
	RUN_PERIOD,
	type Direction,
} from './game/stride.js';
export {
	DUCK,
	GUARD,
	SLASH,
	SWING_CONTACT,
	LEAN_LEFT,
	LEAN_RIGHT,
	UPRIGHT,
} from './game/clips.js';

export type { BackendKind, BackendPreference, RendererInfo, FrameCapture } from '@hexdelve/engine';

import { HexdelveClient, type ClientOptions } from './HexdelveClient.js';

/** The one call most embedders need. */
export function createClient(options: ClientOptions): Promise<HexdelveClient> {
	return HexdelveClient.create(options);
}
