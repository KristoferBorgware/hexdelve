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
export { SKELETON, BONES, TIPS, HIPS_Y, UPPER_BODY } from './game/skeleton.js';
export { BAT_SKELETON, BAT_BONES, BAT_TIPS, HOVER_Y } from './game/batrig.js';
export {
	stridePose,
	stridePeriod,
	strideVelocity,
	WALK_PERIOD,
	RUN_PERIOD,
	type Direction,
} from './game/stride.js';
export { DUCK, GUARD, SLASH, SWING_CONTACT } from './game/clips.js';

export type { BackendKind, BackendPreference, RendererInfo } from '@hexdelve/engine';

import { HexdelveClient, type ClientOptions } from './HexdelveClient.js';

/** The one call most embedders need. */
export function createClient(options: ClientOptions): Promise<HexdelveClient> {
	return HexdelveClient.create(options);
}
