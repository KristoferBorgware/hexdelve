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

export {
	Player,
	REACH,
	LEAN_IN,
	MAX_CLIMB,
	type PlayerActionKind,
	type PlayerOptions,
	type PlayerStats,
} from './game/player.js';
export {
	BatHunt,
	BAT_CLIMB,
	BAT_LEAN,
	BAT_REACH,
	BAT_SPEED,
	WAKE_RANGE,
	LOSE_RANGE,
	type BatOptions,
	type HuntState,
} from './game/bathunt.js';

/*
 * The turn system, exported because it is the part of this package with the
 * least to do with drawing and the most to do with the game: the energy table
 * and the schedule are plain arithmetic over speeds, testable without a canvas
 * and reusable by anything that wants Angband's clock.
 */
export {
	ACTION_ENERGY,
	NORMAL_SPEED,
	Schedule,
	energyPerTurn,
	gameTurnsPerAction,
	speedFactor,
	type Action,
	type TurnMember,
	type TurnTaker,
} from './game/turns.js';
export { SECONDS_PER_GAME_TURN, actionSeconds, hexSpeed } from './game/pace.js';
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
export {
	HELLHOUND_SKELETON,
	HELLHOUND_BONES,
	HELLHOUND_TIPS,
	LEGS as HOUND_LEGS,
	HIP_Y as HOUND_HIP_Y,
	STAND_Y as HOUND_STAND_Y,
} from './game/hellhoundrig.js';

/*
 * The characters themselves — the rig data above, wearing prisms.
 *
 * Exported because a rig and the body hung on it are one thing to anyone
 * looking at either: the editor's character bench previews a skeleton, a mesh
 * and a clip together, and it should get all three from the package that owns
 * them rather than build a second wanderer of its own.
 */
export { buildWanderer, WANDERER_PALETTE } from './models/wanderer.js';
export { buildGhoul, GHOUL_PALETTE } from './models/ghoul.js';
export { buildBat, BAT_PALETTE } from './models/bat.js';
export { buildHellhound, HELLHOUND_PALETTE } from './models/hellhound.js';

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
	runPose as houndRunPose,
	bitePose as houndBitePose,
	restPose as houndRestPose,
	HOUND_STRIDE_PERIOD,
	BITE_CONTACT as HOUND_BITE_CONTACT,
} from './game/hellhoundpose.js';
export {
	stridePose,
	stridePeriod,
	strideVelocity,
	strideFor,
	STRIDE_CONTACTS,
	WALK_PERIOD,
	RUN_PERIOD,
	WALK_SPEED,
	RUN_SPEED,
	type Direction,
	type StrideSetting,
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

/*
 * The pose functions the asset files name, and the library that reads them.
 *
 * `assets/` holds every rig, body, clip and tree as YAML; the engine holds the
 * readers. What the client adds is the half that cannot be a file — the stride,
 * the wing beat, the trot — and a library with those already registered, so an
 * embedder gets a working one rather than an empty one.
 */
export { poseFunctions } from './assets/poseFunctions.js';
export { openAssets, ASSET_BASE, ASSET_INDEX, type OpenAssetsOptions } from './assets/library.js';

/*
 * The asset types, re-exported so an embedder or the editor need not import
 * @hexdelve/engine alongside this package just to name what it was handed.
 */
export type {
	AnimationAsset,
	AssetIO,
	AssetLibrary,
	BlendTreeAsset,
	ClipAsset,
	EntityAsset,
	EntityKind,
	MeshAsset,
	RigAsset,
	TreeParameter,
} from '@hexdelve/engine';
export { AssetError, AssetWriteError, fetchIO, memoryIO, readOnly } from '@hexdelve/engine';

export type { BackendKind, BackendPreference, RendererInfo, FrameCapture } from '@hexdelve/engine';

import { HexdelveClient, type ClientOptions } from './HexdelveClient.js';

/** The one call most embedders need. */
export function createClient(options: ClientOptions): Promise<HexdelveClient> {
	return HexdelveClient.create(options);
}
