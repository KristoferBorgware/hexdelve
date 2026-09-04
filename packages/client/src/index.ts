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
	measureReach,
	leanIn,
	type Reach,
	MAX_CLIMB,
	type PlayerActionKind,
	type PlayerOptions,
	type PlayerStats,
} from './game/player.js';
export {
	BatHunt,
	BAT_CLIMB,
	batLean,
	measureBiteReach,
	type BiteReach,
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
export { Actor, ActorBehaviour, turnTowards, wrapAngle, type Turnable } from './game/actor.js';

/*
 * The component types a prefab file may name, and the one call that spawns an
 * entity from its own. The engine can read a prefab and walk it; it has never
 * heard of an `item`, and this is where the game says what its components are.
 */
export { components, type SpawnExtras } from './game/components.js';
export { spawnEntity } from './game/spawn.js';
export {
	loadCast,
	clipOf,
	YARD_ENEMY,
	YARD_PLAYER,
	YARD_PROPS,
	type Cast,
	type CastOptions,
} from './game/cast.js';
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
/*
 * The pose functions.
 *
 * These are the half of the animation that is not a file and cannot be one:
 * the stride is a handful of harmonics of one phase angle and a direction of
 * travel, the wing beat is four bones lagging each other round a cycle. A
 * function of a heading covers the whole circle of directions where a blend
 * space over clips covers four of them, so these stay functions — and the
 * entity files name them and hand them their tuning. See
 * `src/assets/poseFunctions.ts`.
 *
 * Everything they used to sit beside — the rigs, the bodies, the gear and the
 * keyframed clips — is now `public/assets`, read through the library below.
 */
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
export { LEG_LENGTH, HUMANOID_SKELETON } from './game/humanoid.js';
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

/*
 * The pose functions the asset files name, and the library that reads them.
 *
 * `assets/` holds every rig, body, clip and tree as YAML; the engine holds the
 * readers. What the client adds is the half that cannot be a file — the stride,
 * the wing beat, the trot — and a library with those already registered, so an
 * embedder gets a working one rather than an empty one.
 */
export { poseFunctions } from './assets/poseFunctions.js';

/*
 * Reading the compiled scripts. They are not in this package's module graph —
 * `tools/build-scripts.mjs` compiles them and the client fetches the result —
 * so an embedder that wants behaviour either lets the client fetch it or loads
 * it with this and hands the provider in.
 */
export { loadScripts, SCRIPT_BUNDLE, type LoadScriptsOptions } from './game/scripts.js';

/*
 * The events the game announces and listens for.
 *
 * The scripts declare the same set — see `game/events.ts` for why they have to
 * rather than sharing one file — and the two agree because the host matches an
 * event by name. Exported so an embedder can hear what the rules decided
 * without reaching into the simulation.
 */
export { Damage, Died, Missed, Swing, type Blow, type Point } from './game/events.js';
export {
	openAssets,
	openPackedAssets,
	ASSET_BASE,
	ASSET_INDEX,
	type OpenAssetsOptions,
} from './assets/library.js';

/*
 * The desktop bridge. Exported because the editor writes SCRIPTS through the
 * same object it writes assets through, and it should name it rather than
 * reach into `window` and hope.
 */
export {
	desktopBridge,
	desktopIO,
	plainly,
	type DesktopBridge,
	type DesktopFiles,
	type DesktopScope,
} from './assets/desktop.js';

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
