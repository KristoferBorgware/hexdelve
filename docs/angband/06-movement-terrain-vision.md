# 6. Movement, terrain and vision

The dungeon is a grid of terrain features; the player and monsters occupy one grid each and move one grid per action in any of eight directions. This chapter covers the map's geometry, every terrain type and what its flags mean, how walking, running, pathing, doors, tunnelling and stairs work, how the player's view of the level is computed (line of sight, light, map memory, monster visibility), and the noise and scent maps that monsters use to find the player.

## 6.1 Geometry

Coordinates are `struct loc {x, y}` with y growing downwards. Directions use the numeric keypad: 1 = south-west, 2 = south, 3 = south-east, 4 = west, 6 = east, 7 = north-west, 8 = north, 9 = north-east, 5 = stay. `ddx[]`/`ddy[]`/`ddgrid[]` (`cave.c`) turn a direction into an offset, and `ddd[]` = {2, 8, 6, 4, 3, 1, 9, 7, 5} lists the eight moves in the order code iterates them (orthogonals first).

Distance (`cave-view.c: distance()`) is the classic Angband approximation:

```c
d = (ay > ax) ? ay + ax / 2 : ax + ay / 2;      /* ay, ax: absolute deltas */
```

A diagonal step counts 1, so a pure diagonal of n grids is 1.5n, and the function over-estimates true distance by about one grid per fifteen. `z_info->max_sight` = 20 is the limit for seeing, and `max_range` = 20 for missiles and spells.

Line of sight (`los()`) is Joseph Hall's integer algorithm: adjacent grids always see each other; for straight lines it checks every intermediate grid for `TF_PROJECT`; otherwise it walks along the longer axis using a fixed-point slope scaled by `2 * dx * dy`, testing the grids it actually enters (grids merely "brushed" at a corner do not block). The "knight's move" case (a grid two away in one axis and one in the other) is allowed to be blocked at the diagonal neighbour and still be visible. `los()` is symmetric except for knight's moves. Note that three different notions of "can see" coexist: `los()`, the projection path used by spells and missiles (`project_path()`, see the Ranged chapter), and the player's field of view (`update_view()`, 6.7).

## 6.2 Terrain

Every grid has a feature from `terrain.txt`. The flags (`list-terrain-flags.h`) are what the code tests; the feature name is mostly cosmetic.

| Feature | Glyph | Flags | Dig class | Notes |
|---|---|---|---|---|
| unknown grid | ` ` | – | – | What unexplored map memory holds |
| open floor | `.` | LOS PROJECT PASSABLE FLOOR OBJECT EASY TRAP TORCH | – | Only floors can hold objects and traps |
| closed door | `+` | DOOR_ANY DOOR_CLOSED INTERESTING | 5 | Lock power and jamming are per-grid state, not separate features |
| open door | `'` | LOS PROJECT PASSABLE DOOR_ANY INTERESTING CLOSABLE EASY | – | |
| broken door | `'` | LOS PROJECT PASSABLE DOOR_ANY INTERESTING EASY | – | Cannot be closed |
| up staircase | `<` | LOS PROJECT PASSABLE PERMANENT INTERESTING STAIR UPSTAIR EASY TORCH | – | |
| down staircase | `>` | ... STAIR DOWNSTAIR EASY TORCH | – | |
| General Store .. Home | `1`–`8` | SHOP LOS PROJECT PASSABLE PERMANENT INTERESTING EASY | – | Eight shop entrances; stepping on one enters the shop |
| secret door | `#` | WALL ROCK DOOR_ANY GRANITE TORCH | 5 | Looks like granite until found |
| pile of rubble | `:` | ROCK NO_SCENT NO_FLOW INTERESTING TORCH | 1 | Impassable but quick to clear |
| magma vein | `%` | WALL ROCK NO_SCENT NO_FLOW MAGMA TORCH | 2 | |
| quartz vein | `%` | WALL ROCK NO_SCENT NO_FLOW QUARTZ TORCH | 3 | |
| magma / quartz vein with treasure | `*` | as above plus INTERESTING GOLD | 2 / 3 | Digging yields gold |
| granite wall | `#` | WALL ROCK GRANITE NO_SCENT NO_FLOW TORCH | 4 | The ordinary dungeon wall |
| permanent wall | `#` | WALL ROCK PERMANENT NO_SCENT NO_FLOW | – | Level boundary, vault walls; indestructible |
| lava | `#` | LOS PROJECT FIERY PASSABLE NO_SCENT BRIGHT | – | Walkable, burns (6.5); glows by itself |
| pile of passable rubble | `:` | ROCK PASSABLE INTERESTING TORCH | 1 | Can be walked through and dug |

What the flags do:

- **LOS** / **PROJECT** – the grid does not block sight / projections. Everything with LOS also has PROJECT.
- **PASSABLE** – creatures may enter (unless a monster's own flags forbid; see the Monsters chapter). Walls lack it; monsters with `PASS_WALL`/`KILL_WALL` ignore it.
- **EASY** – "easily passed through": used by the auto-pathing to prefer such grids over rubble and doors, and by `square_isinteresting()` negation for the run algorithm.
- **INTERESTING** – the look command and the run algorithm stop for it.
- **PERMANENT** – cannot be dug, destroyed by earthquakes, or turned to mud.
- **TRAP**, **OBJECT** – may hold a trap / an object pile (floors only).
- **NO_SCENT**, **NO_FLOW** – scent is not laid on it; noise does not propagate through it (all rock and rubble; lava blocks scent but carries sound).
- **TORCH** – the grid is drawn "bright" when lit by a light source (walls and floors), as opposed to lava which is BRIGHT (self-lit at intensity 2 and lights its neighbours).
- **GOLD** – treasure vein.
- **ROCK**, **GRANITE**, **MAGMA**, **QUARTZ**, **WALL** – classification for digging and generation; `WALL` is the general "solid" test.
- **DOOR_ANY**, **DOOR_CLOSED**, **DOOR_LOCKED**, **DOOR_JAMMED** – the door tests; locked/jammed are represented by the door's `power` on the grid rather than by a separate feature in the file (they are set on the grid by `square_set_door_lock()`).
- **STAIR**, **UPSTAIR**, **DOWNSTAIR**, **SHOP** – as named.
- **FIERY** – walking on it applies fire damage; **BRIGHT** – self-illuminating.
- **HIDDEN**, **CLOSABLE**, **SMOOTH** – found by searching (secret doors), can be closed, smooth boundaries for generation.

Each grid additionally carries `SQUARE_*` info flags (`list-square-flags.h`): MARK (memorised), GLOW (permanently lit), VAULT, ROOM, SEEN, VIEW, WASSEEN, FEEL (level-feeling trigger square), TRAP (known trap), INVIS (unknown trap), the generation-time WALL_INNER/OUTER/SOLID, MON_RESTRICT, NO_TELEPORT, NO_MAP, NO_ESP, PROJECT (transient marker), DTRAP (inside a trap-detected area), NO_STAIRS, CLOSE_PLAYER.

## 6.3 Walking

`do_cmd_walk()` → `move_player(dir, disarm)`. In order:

1. **Webs.** If the player's own grid is webbed, the turn is spent clearing the web instead.
2. **Confusion.** `player_confuse_dir()`: with `TMD_CONFUSED`, 75% of the time (and always for direction 5) the direction is replaced by a random one of the eight; "You are confused." A confused move always costs a full turn even if it ends up bumping a wall. Running while confused is refused outright ("You are too confused").
3. **Walk test** (`do_cmd_walk_test()`): moving into an obvious monster is allowed (it becomes an attack) unless the player is afraid ("You are too afraid to attack"); moving into an *unknown* grid is always allowed; moving into a known wall or rubble prints a message, corrects map memory if it was wrong, and costs nothing; a known closed door is allowed through (it becomes an open attempt).
4. **Energy**: `energy_per_move()` (100, or less with MOVES bonuses; see the Time chapter).
5. `move_player()` then does the first applicable of:
   - a monster is there: a camouflaged (mimic/lurker) monster is revealed and woken; otherwise `py_attack()` (Melee chapter);
   - a known disarmable trap (if `disarm` is set, which it is for walking but not for the `-` jump command or for trap-immune players) or a closed door: run `do_cmd_alter_aux()` on it with an automatic 99-repeat, i.e. the game disarms or opens for you (this is the "easy_alter" behaviour, always on in 4.2);
   - a known trap while running (not trap-safe): stop, no energy;
   - impassable: "There is a wall blocking your way" (or rubble/door), memorise the obstacle, and *keep* the energy cost ("primarily so that confused moves while blind or without light take energy");
   - otherwise step. Before stepping: if leaving a trap-detected region while running, stop; if the grid is damaging terrain (lava) and the player is not confused, compute the damage (`player_check_terrain_damage()`) and either ask the `run_msg` question when running or the `walk_msg` question when the damage would exceed a third of current HP. Then `monster_swap()` moves the player, `player_handle_post_move()` runs (enter a shop if on one, note the objects on the floor, set off or discover a trap via `hit_trap()`, `update_view()`, `search()`), and an `AUTOPICKUP` background command is queued.

`player_handle_post_move()` calls `search()` after every step: if the player is not blind, confused, hallucinating or in the dark, every adjacent secret door is converted into a closed door ("You have found a secret door.") and traps on adjacent known chests are revealed. There is no search command and no chance involved; searching is automatic and certain.

**Traps on the destination** are handled by `hit_trap()` in `trap.c` (Traps chapter). Invisible traps are revealed by `square_reveal_trap()` when a seen grid is updated, provided `SKILL_SEARCH >= trap power`, so a low-search character can walk onto a trap they never saw.

`do_cmd_jump()` (`-`) is walking with `disarm = false`: known traps are stepped on deliberately. `do_cmd_hold()` (`,` or `s`) spends a turn in place, searches, picks up objects with `do_autopickup()` for no extra energy, and enters a shop if standing on its entrance.

**Terrain damage** (`player_take_terrain_damage()`, run in `process_player_cleanup()` after every energy-using command, so standing on lava hurts every turn): fiery terrain does `100 + 1d100` fire damage adjusted for fire resistance (`adjust_dam`, see the Elements chapter), halved for Feather Falling, and damages inventory as fire does. Monsters take terrain damage after their turn in the same way.

## 6.4 Running

`do_cmd_run()` starts a run (`run_step(dir)`) which re-queues `CMD_RUN` with direction 0 after every step until `run_test()` says stop or `disturb()` intervenes. A repeat count becomes a maximum number of steps (default 9999).

`run_init()` records the direction and looks at the two grids diagonally ahead-left and ahead-right of the player and of the destination: a known wall there sets `run_break_left`/`run_break_right`. If both sides are walled the player is in a corridor (`run_open_area = false`) and the code works out whether the corridor is being entered at an angle ("diagonal corridor") or bluntly, adjusting `run_old_dir` so the follow-up logic tracks the corridor's real direction.

`run_test()` is evaluated before each subsequent step and returns "stop" when any newly adjacent grid (3 for orthogonal travel, 5 for diagonal) holds a visible monster, a visible trap (unless trap-immune), a known non-ignored object, or a memorised INTERESTING feature (doors, stairs, shops, rubble, treasure veins). Grids two steps ahead are checked for *obvious* monsters. Then:

- In an **open area** (`run_open_area`), the run continues straight until the wall on the side being followed disappears or a wall appears on the open side (`run_break_left`/`right` logic), so the player runs along room walls and stops at openings.
- In a **corridor**, passable or unknown grids among the newly adjacent ones are collected as options: none → stop (dead end); exactly one → turn into it (corridors are followed round corners); two adjacent options → treat as a corner and curve; two non-adjacent options or three options → stop (junction or room entrance).
- Finally, if the chosen direction runs into a known wall, stop.

`see_wall()` treats webs and memorised wall-like features as walls, but unknown grids as open, so running into unexplored darkness continues until something is seen.

**Pathfinding** (`do_cmd_pathfind()`, mouse click or the `_` travel command, and `do_cmd_explore()` when the `autoexplore_commands` option is on) uses `find_path()` in `player-path.c`: a Dijkstra-style search over the player's *remembered* map, where each step's cost is an expected number of turns (`convert_turn_penalty()`), with penalties for known closed doors (expected unlock attempts, `compute_unlocked_penalty()`/`compute_locked_penalty()`), rubble (`compute_rubble_penalty()`, expected digging turns) and damaging terrain, and unknown grids treated as passable. The resulting step list is followed by `run_step()`, which will automatically issue `CMD_OPEN` or `CMD_TUNNEL` for a door or rubble on the path when all its neighbours are known, stops for visible monsters and objects, and converts to an ordinary run if the path heads into a known wall (so clicking on an unexplored area explores towards it). Confusion cancels pathfinding.

## 6.5 Doors

Doors are opened (`o`), closed (`c`), locked (`D` on an unlocked closed door: `do_cmd_lock_door()`), or handled automatically by `+` (alter) and by walking into them. With `easy_open`-style behaviour built in, `do_cmd_open()` picks the only adjacent door or chest without asking for a direction.

Opening a **locked** door uses `calc_unlocking_chance()` (Player Stats chapter): `MAX(2, disarm_phys / 10-if-blind-or-dark / 10-if-confused - 4 * lock power)` percent per attempt, repeated automatically up to 99 times. There is no experience for lockpicking (removed "to avoid exploit by repeatedly locking and unlocking"). Lock power is set at generation (`m_bonus(7, depth)` for locked doors placed by the generator; see the Dungeon Generation chapter) or by the player: locking succeeds with chance `disarm_phys - m_bonus(7, depth)` percent (minimum 2) and gives the door that power; on failure the attempt repeats while `randint1(skill) > 5`.

Closing a broken door is impossible. Jammed doors (`DOOR_JAMMED`) exist as a flag but 4.2 places no spikes; monsters bash doors instead (Monsters chapter). `do_cmd_alter_aux()` on a door in an adjacent grid opens it if closed and closes it if open.

## 6.6 Tunnelling

`do_cmd_tunnel()` (`T`) or alter on a diggable grid. The best available digger is used automatically: `player_best_digger()` compares the wielded weapon with diggers in the pack, and if a pack digger is better it is swapped in for the calculation only (the message says "with your swap digger"). The per-turn success test is

```c
chance = digging_chances[feature digging class - 1];   /* see Player Stats: rubble ×8, magma (skill-10)×4, ... */
okay = chance > randint0(1600);
```

so a chance of 1600 or more is certain. On success the grid becomes floor (`twall()`), and: rubble has a 10% chance (outside town) to reveal a `place_object()` drop ("You have found something!"); a treasure vein gives `place_gold()`; in town, exposed grids are lit by the sun. A failure with positive chance repeats (99 times by default); with zero chance the message says the attempt is futile and does not repeat. Examples with digging skill 77 (a Dwarf with 18/50 STR and a 12 lb weapon): rubble 616/1600 = 38.5% per turn, magma 268/1600 = 16.8%, quartz 114/1600 = 7.1%, granite 37/1600 = 2.3%. With a Dwarven Pick (DIG_3, +60) the same character has 137: rubble certain, magma 31.8%, quartz 14.6%, granite 6.1%.

Digging into a monster attacks it. Permanent walls, shop doors and stairs cannot be dug.

## 6.7 Stairs and level changes

`<` and `>` require the matching staircase under the player (with `autoexplore_commands` they navigate to the nearest one instead of complaining). `do_cmd_go_down()` costs a turn, sets `create_up_stair` so a connected staircase appears on the new level, and calls `dungeon_change_level()` with `dungeon_get_next_level(depth, +1)`: `depth + stair_skip` (1 by default) capped at 127, but stopped at the first quest level in between. Going up is symmetrical but is refused under `birth_force_descend`. The level is actually generated by the main loop (Architecture chapter); on arrival `new_player_spot()` picks a start grid and, with `birth_connect_stairs`, places the connecting staircase under the player. Word of Recall, deep descent, teleport level and trapdoors are the other ways to change level (World Loop and Traps chapters).

## 6.8 Field of view and light

`update_view()` (`cave-view.c`) runs whenever `PU_UPDATE_VIEW` is set (every move, light change, door change). It works in three passes over the whole level:

1. `mark_wasseen()` copies SEEN to WASSEEN and clears VIEW, SEEN and CLOSE_PLAYER on every grid.
2. `calc_lighting()` computes an integer light level per grid:
   - GLOW grids (lit rooms, town by day) start at 1; walls only if a lit floor is on the player's side of them (`glow_can_light_wall()`, so the far side of a wall is not drawn lit);
   - BRIGHT terrain (lava) adds 2 to itself and 1 to each neighbour;
   - the player's light: for every grid within `radius = |cur_light| - 1` that has `los()` from the player, add `cur_light - distance` (a radius-2 torch gives +2 on the player's grid, +1 at distance 1; a radius-3 lantern +3/+2/+1). A *negative* `cur_light` (Unlight, cursed darkness) subtracts light in the same pattern;
   - every non-camouflaged monster with a `light:` value does the same from its grid (positive for fire-based monsters carrying light, negative for darkness-shrouded ones).
   A grid is "lit" when its total is greater than 0.
3. For every grid within `max_sight` (20): `update_view_one()` decides whether it is in **view** (`los()` from the player, with the special rule that a wall grid borrows LOS from the passable grid next to it in the player's direction, so both faces of a one-thick wall are not seen through but the near face is). A grid in view is marked SEEN if it is lit, or if it is *close*: `distance < cur_light` (so a radius-2 torch shows the player's own grid and the ring at distance 1). UNLIGHT characters with `cur_light <= 1` instead see everything within `2 + level / 6 - cur_light` even in the dark. A lit wall is only SEEN if the lit grid between it and the player is lit as well.
4. `update_one()` compares SEEN with WASSEEN: newly seen grids are memorised (`square_note_spot()` records the feature and any objects into `player->cave`) and redrawn, hidden traps on them get their reveal check, and the first `feeling_need` (10) newly seen FEEL squares trigger the level feeling. Blindness clears SEEN everywhere (nothing is seen, though the map memory remains), and a blind player standing in remembered "wall" forgets that grid.

`no_light()` is simply "the player's own grid is not SEEN", which is what disables searching, reading and so on.

**Map memory** is the second chunk `player->cave`: features are remembered when seen (`square_memorize()`), objects when noticed (`square_know_pile()`), traps when revealed. Detection and mapping effects write directly into it. Walking into an unknown wall memorises it by touch. The `MARK` flag denotes a memorised grid.

**Room lighting**: rooms generated lit have GLOW on every grid; `light_room()` (`cave-map.c`) lights or darkens a whole room by flood fill when a light/darkness effect is used inside it, and `cave_illuminate()` handles the town's day/night. `wiz_light()` (magic mapping's big brother) and `wiz_dark()` (amnesia) mark or forget the whole level.

## 6.9 Monster visibility

`update_mon()` (`mon-util.c`) decides for each monster whether the player can perceive it at all (`MFLAG_VISIBLE`, shown on the map and in the monster list) and whether it is in direct view (`MFLAG_VIEW`, which disturbs and allows targeting). A monster is visible if:

- it is *marked* by a detection effect (`MFLAG_MARK`, until the next player turn), or
- the player has telepathy, neither the player's nor the monster's grid is NO_ESP, the monster is within `max_sight`, and it is ESP-detectable (not EMPTY_MIND; WEIRD_MIND monsters only 1 turn in 10, see `monster_is_esp_detectable()`), or
- the monster's grid is in VIEW, the player is not blind, and either the monster is within infravision range and warm-blooded (not COLD_BLOOD), or the grid is SEEN (lit or in torch radius) and the monster is not invisible or the player has See Invisible.

A mimic that looks like an item the player ignores is not shown. When a monster becomes visible for the first time, `lore->sights` is incremented; seeing it by infravision teaches the COLD_BLOOD flag, seeing it in light teaches INVISIBLE, and telepathy teaches the mind flags. Distances (`mon->cdis`) are recalculated for all monsters on `PU_DISTANCE` using the same approximation as `distance()`.

## 6.10 Noise and scent

Two flow maps in the chunk let monsters track the player without pathfinding (Monsters chapter). They are rebuilt every world tick (10 game turns) unless the player is resting, by `make_noise()` and `update_scent()` in `game-world.c`:

- **Noise** is a breadth-first flood from the player's grid: the player's grid is 0 and each step outward adds `noise_increment` (1 normally, 4 while `TMD_COVERTRACKS`), stopping at `z_info->max_hearing` and not passing through NO_FLOW grids (all walls and rubble; closed doors are *not* NO_FLOW, so sound leaks through doors). A monster with `hearing` h can "hear" the player from any grid whose noise value is below h, and moves to the neighbouring grid with the lowest value. The source grid and increment are saved so the map can be recomputed after loading a save.
- **Scent** is a 5×5 stamp around the player (0 on the player, 1 at distance 1, 2 on the ring at distance 2), laid only on grids not marked NO_SCENT that are adjacent to a lower-valued grid (so it does not cross walls), and every existing scent value on the level ages by 1 per tick. Monsters with `smell` s follow scent that is younger than s. `TMD_COVERTRACKS` suppresses scent entirely.

The player's stealth does not enter these maps; it affects how quickly monsters wake up (Monsters chapter).
