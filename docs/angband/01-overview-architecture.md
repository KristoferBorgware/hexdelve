# 1. Overview and architecture

Angband 4.2.6 is a single-player roguelike written in C (about 207,000 lines in `src/`, plus some 1.2 MB of colon-separated data files in `lib/gamedata/`). The player's character descends a 127-level dungeon under a town, must kill Sauron on level 99 to gain access to level 100, and wins by killing Morgoth there. This chapter describes how the program is put together: the three central data structures, the layering of the source, the command queue and event system that separate the game engine from its front ends, the main loop, and the file formats and random-number conventions everything else relies on.

## 1.1 Source layout

Files in `src/` are grouped by prefix. The engine proper never includes a `ui-*` or `main-*` header; the UI talks to the engine through commands and events.

| Prefix | Contents |
|---|---|
| `z-*` | The "Z layer": platform-independent utilities with no game knowledge. `z-rand` (RNG), `z-dice` (dice expressions), `z-expression` (arithmetic expressions used in data files), `z-bitflag` (packed flag arrays), `z-file`, `z-form` (string formatting), `z-quark` (string interning for inscriptions), `z-queue`, `z-textblock`, `z-color`, `z-type` (`struct loc` etc.), `z-util`, `z-virt` (memory). |
| `cave*`, `cave-map`, `cave-square`, `cave-view` | The dungeon level ("chunk"): grid predicates, map memory, field of view and lighting. |
| `gen-*`, `generate` | Level generation: cave layouts, rooms, vaults, monster/object placement, persistent-level storage. |
| `mon-*` | Monsters: data (`mon-init`), creation (`mon-make`), AI (`mon-move`), melee (`mon-attack`, `mon-blows`), spells (`mon-spell`), summoning, groups, timed effects, lore, messages, predicates. |
| `obj-*` | Objects: kinds and parsing (`obj-init`), generation (`obj-make`), random artifacts, egos, curses, gear/slots, piles, knowledge (runes), ignoring, descriptions, info screens, pricing/power. |
| `player-*` | The character: birth, derived values (`player-calcs`), timed effects, spells, melee/ranged attacks, pathing, history, quests, utilities. |
| `project*` | The projection engine (bolts, balls, breaths) and its effects on features, objects, monsters and the player. |
| `effect*` | The effect system used by spells, items, traps and monster spells. |
| `cmd-*` | Command handlers (`cmd-cave` for movement and terrain, `cmd-obj` for items, `cmd-pickup`, `cmd-wizard` for debug commands) and the command queue (`cmd-core`). |
| `game-*` | The main loop (`game-world`), events (`game-event`), input abstraction (`game-input`). |
| `store`, `trap`, `target`, `score*`, `save`, `load`, `savefile`, `init`, `datafile`, `parser`, `option`, `message`, `sound-core` | Stores, traps, targeting, high scores, save files, data-file loading, options, messages, sound. |
| `ui-*` | The text user interface: display, menus, knowledge browser, options, birth screens, stores, targeting, spell menus, pref files, visuals. |
| `main-*` | Front ends: `main.c` (entry point) plus one file per platform/toolkit (`main-gcu` curses, `main-sdl`, `main-sdl2`, `main-win`, `main-x11`, `main-cocoa.m`, `main-nds`, `main-test`, `main-stats`, `main-spoil`). |
| `list-*.h` | X-macro lists that define enumerations and their names in one place: effects, elements, object flags and modifiers, monster flags and spells, player flags and timed effects, projections, rooms and dungeon profiles, terrain, traps, options, messages, tvals, equipment slots, stats. |
| `wiz-*` | Debug/statistics tools (`wiz-stats` Monte Carlo generation, `wiz-spoil` spoiler files). |

## 1.2 The three top-level data structures

**The chunk** (`struct chunk` in `cave.h`) is one dungeon level. It holds the grid (`squares[y][x]`, each with a feature index, a bit-set of `SQUARE_*` flags, a light level, and the indices of the monster, the object pile and the trap list on that grid), plus arrays of all monsters and objects on the level, monster group information, the noise and scent flow maps used by the monster AI, the level's feeling ratings, and its depth and name. The global `cave` is the current level; `player->cave` is a second chunk holding what the player *remembers* of it (map memory, known objects, known traps). Everything in the chunk is discarded on leaving the level unless persistent levels are on. Dungeon levels are at most 66 × 198 grids, the town 22 × 66 (`constants.txt`).

**The player** (`struct player` in `player.h`) is a single global, `player`, holding everything level-independent: race, class, stats, experience, hit points, mana, the gear list, timed effects, known runes, the current shape, options, the `upkeep` block of transient flags (`update`, `redraw`, `notice`, energy used this command, resting/running state, inventory arrays), and the derived `state`. Most engine functions take a `struct player *` explicitly so they can be unit-tested.

**The static data** ("info arrays") is loaded once from `lib/gamedata/` by `init_angband()`: `r_info` (monster races), `k_info` (object kinds), `a_info` (artifacts), `e_info` (egos), `f_info` (terrain), `trap_info`, `races`, `classes`, `shapes`, `realms`, `curses`, `slays`, `brands`, `projections`, `timed_effects`, room templates, vaults, pits, stores, and the `z_info` maxima/constants structure (`struct angband_constants` filled from `constants.txt`). `player_property.txt`, `object_property.txt` and `ui_*.txt` describe flags and how to display them.

## 1.3 Startup

`main()` in `main.c` drops set-uid privileges, parses the command line, picks the first front end from its `modules[]` table that initialises successfully (or the one named with `-m`), installs signal handlers, calls `init_display()` and then `init_angband()` (`init.c`). `init_angband()` runs the `init` hook of each module in `init.c`'s `modules[]` array in order: quarks, messages, visuals, the gamedata arrays (every parser in turn: constants, terrain, object bases, slays, brands, curses, activations, objects, egos, artifacts, monster bases, monster spells, monsters, pits, vaults, room templates, player properties, timed effects, races, shapes, bodies, classes, history, flavours, hints, names, traps, world, stores, and so on), then player, level-generation, rune, object-generation, ignore, monster-generation, store, options and UI modules. Finally it seeds the RNG. `textui_init()` loads pref files and sets up the command hook, and `play_game()` (`ui-game.c`) either loads a save file (offering a newer panic save if one exists) or runs the birth process, then calls `prepare_next_level()` and `on_new_level()` and enters the loop:

```c
while (!player->is_dead && player->upkeep->playing) {
	pre_turn_refresh();
	cmd_get_hook(CTX_GAME);   /* the UI puts one or more commands on the queue */
	run_game_loop();          /* the engine runs until it needs another command */
}
close_game(true);
```

## 1.4 The command queue

`cmd-core.c` keeps a small ring buffer of `struct command` (code, context, repeat count, `background_command` flag, and up to a handful of named arguments: direction, target, item, point, choice, string, number). Front ends push commands with `cmdq_push()` and set arguments with `cmd_set_arg_*()`; handlers read them with `cmd_get_arg_*()`, which prompt the user through the `game-input.c` hooks if the argument is missing (so the same handler works for a keypress with no target and for a fully specified command from a macro or the borg). `process_command()` looks the code up in the `game_cmds[]` table, which records for each command its verb, handler, whether it may be repeated, whether it may use energy, and an automatic repeat count.

| Command | Repeatable | Uses energy | Auto-repeat |
|---|---|---|---|
| walk, run, hold | yes | yes | – |
| open, close, tunnel, disarm, alter | yes | yes | 99 |
| zap rod, use staff, aim wand, activate | yes | yes | 99 |
| use (generic) | yes | yes | – |
| go up/down, jump, explore, navigate, steal, rest, sleep, pathfind, pickup, autopickup, wield, take off, drop, eat, quaff, read, refill, fire, throw, study, cast, command monster | no | yes | – |
| inscribe, uninscribe, autoinscribe, sell, stash, buy, retrieve, retire, help, repeat, and the birth and wizard commands | no | no | – |

Auto-repeat is how digging, unlocking and disarming keep going: the command re-executes up to 99 times until `disturb()` cancels the repeat. A command that makes no state change (looking, inscribing, browsing) costs no energy and does not end the player's turn; `process_player()` keeps popping commands until one sets `energy_use`. Bloodlust hijacks the queue: a Blackguard with the timed effect has a `bloodlust`-in-200 chance per energy-using command of attacking a random adjacent monster instead. Commands issued as side effects (the autopickup after a move, the steps of a pathfind) are marked `background_command` so they are neither repeated by `n` nor counted as the player's own choice.

## 1.5 Events

`game-event.c` provides `event_add_handler()`/`event_signal*()` for 69 event types (`game-event.h`): display refreshes (`EVENT_MAP`, `EVENT_STATS`, `EVENT_HP`, `EVENT_INVENTORY`, `EVENT_MONSTERLIST`, ...), visual effects (`EVENT_BOLT`, `EVENT_EXPLOSION`, `EVENT_MISSILE`), messages and sounds, input flushing, store entry, level transitions (`EVENT_ENTER_WORLD`, `EVENT_NEW_LEVEL_DISPLAY`), birth points, and the level-generation trace events used by the debug visualiser. The engine signals; the UI subscribes. Redraw is additionally batched through `player->upkeep->redraw` (`PR_*` flags) and `update` (`PU_*` flags), consumed by `redraw_stuff()` and `update_stuff()` (see the Player Stats chapter for `PU_*`).

## 1.6 The main loop

`run_game_loop()` in `game-world.c` is entered every time the UI has supplied a command. A "game turn" is one increment of the global `turn`; creatures act when they have accumulated 100 energy (`z_info->move_energy`), and gain energy each game turn according to their speed (details in the Time chapter). The sequence is:

```text
run_game_loop():
    process_player_cleanup()           -- apply the energy cost of the command just executed,
                                          take terrain damage, clear per-turn monster flags
    process_player()                   -- keep executing queued commands until one uses energy;
                                          if the queue runs dry, return to the UI for input
    while player->energy >= 100:       -- the player may still be owed more actions
        process_monsters(player->energy + 1)   -- monsters with MORE energy than the player act first
        process_player()
    loop forever:
        notice_stuff(); handle_stuff(); EVENT_REFRESH
        if not generating a new level:
            process_monsters(0)        -- every monster gains energy; those at 100+ act
            reset_monsters()           -- clear the HANDLED flags
            if turn % 10 == 0: process_world()   -- hunger, regeneration, timeouts, recall, ...
            player->energy += turn_energy(speed)
            turn++
        if a new level was requested: on_leave_level(); prepare_next_level(); on_new_level()
        while player->energy >= 100:
            process_monsters(player->energy + 1)
            process_player()           -- returns to the UI when a command is needed
```

`process_player()` also handles the automatic things that happen "at the start of the player's turn": Dwarves' ore detection, a forced `CMD_SLEEP` when paralysed or knocked out, checking whether special rest modes are complete, and pack overflow. `process_world()` runs every ten game turns and is described in the World Loop chapter.

Level changes are requested, not performed, by game logic: `dungeon_change_level()` (`player-util.c`) sets `player->depth` and `upkeep->generate_level`, and the loop above calls `prepare_next_level()` when it is safe to do so. Stair commands additionally set `upkeep->create_up_stair`/`create_down_stair` so that connected stairs can be placed.

## 1.7 Files

**Gamedata files** are line-oriented, colon-separated records parsed by `parser.c`: each file registers a set of `parser_reg()` directives ("name str name", "flags ?str flags", ...) with a handler, and `#` lines are comments. They are only read at startup; the Gamedata Reference chapter lists every file.

**Pref files** (`lib/customize/*.prf` and per-user files) hold UI customisation: keymaps, visuals, colours, subwindow layout, inscriptions. `ui-prefs.c` processes them with `process_pref_file()`; user files override system ones.

**Save files** (`savefile.c`, `save.c`, `load.c`) begin with the 4-byte magic and 4-byte name, followed by a sequence of blocks. Each block has a 16-byte NUL-padded name, a 32-bit version and a 32-bit size, then the block data written little-endian with NUL-terminated strings. The block writers are, in order: `description`, `rng`, `options`, `messages`, `monster memory`, `object memory`, `quests`, `player`, `ignore`, `misc`, `artifacts`, `player hp`, `player spells`, `gear`, `stores`, `dungeon`, `objects`, `monsters`, `traps`, `chunks` (stored persistent levels), `history`. Loading accepts old block versions; saving always writes the current ones. Saving writes to `<name>.new`, renames the old file to `<name>.old`, and renames `.new` into place, so a crash never loses the previous save. A "panic save" is written on a fatal signal.

## 1.8 Randomness

`z-rand.c` implements `Rand_div(m)`, a uniform integer in `0..m-1` from either the WELL1024a generator (`Rand_quick = false`, the normal case) or a linear congruential generator (`Rand_quick = true`, used with a fixed seed when the game needs reproducible results, for example generating the town from `seed_town` or assigning flavours from `seed_flavor`). Rejection sampling makes the result unbiased. Everything else is built on it:

| Macro / function | Result |
|---|---|
| `randint0(M)` | 0..M-1 |
| `randint1(M)` | 1..M |
| `rand_range(A, B)` | A..B inclusive |
| `rand_spread(A, D)` | A-D..A+D |
| `one_in_(X)` | true with probability 1/X |
| `damroll(N, S)` | sum of N rolls of 1..S |
| `Rand_normal(mean, sd)` | integer normal deviate via a 256-entry cumulative table, symmetric about the mean |
| `m_bonus(max, level)` | "magic bonus": `Rand_normal(max * level / 128, max / 4)` clamped to 0..max, so the bonus drifts towards `max` as `level` approaches `MAX_RAND_DEPTH` = 128; at level 0 the mean is 0 and only the spread produces a bonus |

`m_bonus()` is what makes enchantment bonuses, lock power, rod charges and the like scale with dungeon depth.

**Dice expressions** (`z-dice.c`) are the `random_value` quadruple `{base, dice, sides, m_bonus}`, written in data files as `B+XdYMZ`, any part optional: `2d6`, `d4`, `10+2d3M4`, `1+M5`. `randcalc(v, level, aspect)` evaluates one: `base + damroll(dice, sides) + m_bonus(m_bonus, level)`, or the minimum, average or maximum when the `aspect` is `MINIMISE`, `AVERAGE`, `MAXIMISE` (used for object descriptions). Parts may be variables written `$X`, bound to expressions given on `expr:` lines (`dice:$Dd$S` with `expr:D:PLAYER_LEVEL:/ 5 + 1`), which is how spell damage scales with level; `z-expression.c` evaluates those small integer expressions over named bases such as `PLAYER_LEVEL`, `PLAYER_HP`, `SPELL_POWER`, `DUNGEON_LEVEL`, `MONSTER_PERCENT`.

## 1.9 Directions and coordinates

`struct loc {x, y}` is the universal coordinate. Directions are numeric-keypad digits 1–9 (5 = here); `ddx[]`, `ddy[]` and `ddgrid[]` map a direction to an offset, `ddd[]` lists the eight movement directions in a fixed order, and `motion_dir(from, to)` gives the direction from one grid to an adjacent one. `distance()` and `los()` are described in the Movement chapter.
