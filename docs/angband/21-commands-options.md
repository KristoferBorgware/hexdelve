# Chapter 21 — Commands, Keys and Options

*Derived from Angband 4.2.6 (`cmd-core.c`, `ui-game.c`, `ui-input.c`,
`list-options.h`, `docs/command.rst`, `docs/option.rst`).*

---

## 21.1 How a command runs

Every action is a `struct command` with a `CMD_*` code and typed
arguments (`item`, `direction`, `target`, `quantity`, `choice`, `point`,
`number`). The user interface pushes commands onto a queue
(`cmdq_push`); `process_player` pops one, looks up its handler in
`game_cmds[]` (`cmd-core.c`) and runs it. The handler sets
`player->upkeep->energy_use` — 0 for free actions, `move_energy` (100)
for a full turn, fractions for half-turn actions — and the energy
system in *Chapter 2* decides when you act again.

Arguments the handler needs but the command lacks are requested through
`cmd_get_*` helpers, which prompt the player ("Which item?", "Direction?")
and store the answer in the command so that `n` (repeat) can replay
it. Commands can auto-repeat (`cmd_set_repeat(99)` for tunnelling,
disarming, picking locks) until `disturb()` stops them.

Item prompts accept inventory letters, `-` for the floor, `|` for the
quiver, and `@`-inscription shortcuts: an object inscribed `@m1` is
chosen by `m1`, `@r2` by `r2`; `!*`/`!r`/`!q` etc. ask "Really …?"
before that command (`check_for_inscrip` in `cmd_get_item`).

---

## 21.2 The command list

Key in the original keyset first, roguelike key second where different
(`rogue_like_commands` option). Energy: F = full turn, ½ = half, 0 =
free, * = variable.

### Movement

| Command | Keys | Energy | Notes |
|---|---|---|---|
| Walk | arrow / numpad / `;`dir | * `energy_per_move` | attacks a monster in the way; auto-disarms a known trap; opens a door with `easy_alter` behaviour built in |
| Walk into a trap / jump | `W` / `-` | * | moves without disarming |
| Run | `.`dir or Shift+dir / `,`dir | * per step | stops at corridor junctions, doors, visible monsters, items |
| Explore | `p` | | pathfind to the nearest unknown grid (with `autoexplore_commands`) |
| Stay still (with pickup) | `,` / `.` | F | `CMD_HOLD`: stands still and runs auto-pickup |
| Rest | `R` | F per turn | `R&` as needed, `R*` hp/sp or disturb, `R<n>` turns |
| Go up / down | `<` / `>` | F | see *Chapter 19* 19.2 |
| Pathfind (mouse) | click | * | walks to the clicked grid |

### Interacting with the dungeon

| Command | Keys | Energy | Notes |
|---|---|---|---|
| Open door/chest | `o` | F (repeats) | lock picking, *Chapter 17* |
| Close door | `c` | F | |
| Tunnel | `T` / `^T` | F (repeats) | digging |
| Disarm trap/chest, lock door | `D` | F (repeats) | |
| Alter | `+` | F | does the appropriate thing in a direction (attack/tunnel/open/disarm/close) |
| Steal | `s` | F | Rogues with `PF_STEAL` (Blackguard/Rogue) take an object from a monster |
| Look | `l` / `x` | 0 | |
| Target | `*`, `'` (closest) | 0 | `use_old_target` reuses the last target |
| Full map | `M` | 0 | |
| Locate | `L` / `W` | 0 | |
| Level feeling | `^F` | 0 | |

### Items

| Command | Keys | Energy |
|---|---|---|
| Inventory / Equipment / Quiver | `i` / `e` / `\|` | 0 |
| Inspect item | `I` | 0 |
| Pick up | `g` | 1/10 per object, max F |
| Drop | `d` | ½ |
| Wear/wield | `w` | F |
| Take off | `t` / `T` | ½ |
| Ignore item / toggle ignore | `k` or `^D` / `K` or `O` | 0 |
| Inscribe / uninscribe | `{` / `}` | 0 |
| Refuel light | `F` | ½ |
| Eat | `E` | F |
| Quaff | `q` | F |
| Read scroll | `r` | F |
| Aim wand | `a` / `z` | F |
| Use staff | `u` / `Z` | F |
| Zap rod | `z` / `a` | F |
| Activate | `A` | F |
| Use (any of the above) | `U` | F |
| Fire | `f` / `t` | F ÷ shots (see *Ranged Combat* 8.1) |
| Fire at nearest | `h` / `Tab` | as fire |
| Throw | `v` | F (thrown-weapon rules) |

### Magic

| Command | Keys | Energy |
|---|---|---|
| Browse | `b` / `P` | 0 |
| Study (gain spell) | `G` | F |
| Cast | `m` (both keysets) | F |

### Information and system

| Command | Keys |
|---|---|
| Character sheet | `C` |
| Knowledge menus | `~` |
| Visible monsters / items | `[` / `]` |
| Messages | `^P` (all), `^O` (last) |
| Identify symbol | `/` |
| Help | `?` |
| Options | `=` |
| Take notes | `:` |
| Version | `V` |
| Save | `^S`; save and quit `^X` |
| Retire | `Q` |
| Redraw | `^R`; screen dump `)` |
| Repeat last command | `n` (or `^V`) |
| Keymap escape | `\` before a key bypasses keymaps |
| Load a pref line | `"` |
| Toggle wizard mode | `^W` (marks the character `NOSCORE_WIZARD`) |
| Debug commands | `^A` (`NOSCORE_DEBUG`) |
| Borg | `^Z` |

Debug (`^A`) sub-menus cover object creation and tweaking, player
editing, teleport, effects, summoning, spoiler files, statistics
(`WIZ_COLLECT_*`), and level dumps; they are listed in `game_cmds[]` as
`CMD_WIZ_*`.

---

## 21.3 Repeating and counts

`0` followed by a number sets a repeat count for the next command
(`0 15 T` tunnels up to 15 times). Commands that naturally repeat
(open, tunnel, disarm, rest) set their own count. `n` repeats the last
command with the same arguments.

---

## 21.4 Options (`=`)

### User interface options (saved per savefile, changeable any time)

| Option | Default | Effect |
|---|---|---|
| `rogue_like_commands` | off | roguelike keyset (`hjklyubn` movement) |
| `autoexplore_commands` | off | `p` explores; `<`/`>` navigate to stairs when not on one |
| `use_sound` | off | sound effects |
| `show_damage` | off | print damage numbers when you hit monsters |
| `use_old_target` | off | fire/cast at the last target without prompting |
| `pickup_always` | off | auto-pickup everything (*Chapter 15* 15.3.3) |
| `pickup_inven` | on | auto-pickup items matching a pack stack |
| `show_flavors` | off | "Potion of Cure Light Wounds (Blue)" |
| `show_target` | on | highlight the target |
| `highlight_player` | off | cursor on the player between turns |
| `disturb_near` | on | stop running/resting/repeating when a visible monster moves |
| `solid_walls`, `hybrid_walls` | off | wall rendering |
| `view_yellow_light` | off | torchlit grids in yellow |
| `animate_flicker` | off | shimmering multi-hued monsters |
| `center_player` | off | keep the map centred |
| `purple_uniques` | off | uniques in purple |
| `auto_more` | off | never wait at `-more-` (dangerous) |
| `hp_changes_color` | on | `@` colour by hit-point fraction |
| `mouse_movement` | on | click to move |
| `notify_recharge` | off | message when a rod recharges |
| `effective_speed` | off | show speed as a multiplier (×1.5) instead of +5 |

Also on the options screen: **delay factor** (animation speed),
**hitpoint warning** (tenths of max hp for the low-hp bell),
**movement delay**, **sidebar mode**, keymaps, colours, subwindows,
and the **ignore** menus (quality ignoring, *Chapter 14* 14.10).

### Birth options (`birth_*`)

Chosen at character creation and fixed thereafter — listed with their
defaults and their effect in code in *Character Creation* 3.10.

### Cheat options

| Option | Effect (and the permanent `score_*` mark) |
|---|---|
| `cheat_hear` | announce monster creation |
| `cheat_room` | announce dungeon generation details and failures |
| `cheat_xtra` | announce store updates and similar internals |
| `cheat_live` | offer "Die?" and let you refuse |

Turning any of these on sets the matching `score_*` option, which is
never cleared; `enter_score` then refuses to record the character
(*Chapter 19* 19.5).

---

## 21.5 Keymaps and pref files

`lib/customize/*.prf` and the user's own pref files define keymaps
(`keymap-act` / `keymap-input`), visual overrides and message colours.
The `=` menu can create keymaps interactively: a keymap maps a trigger
key to a string of keypresses in the *underlying* keyset, so
`keymap-act:m1a` casts spell 1 from book `a` at one keystroke. Keymaps
are saved with `Append keymaps to a file`. `\` before a key bypasses
keymaps; `^` prefixes a control key when the terminal cannot send it.

---

## 21.6 Where the rest of the rules are

| Topic | Chapter |
|---|---|
| Energy costs and speed | 2 |
| Movement, running, terrain | 6 |
| Melee, blows, criticals | 7 |
| Shooting, throwing, projections | 8 |
| Spells, devices, activations | 9 |
| Damage and resistances | 10 |
| Timed effects, food, rest | 11 |
| Monster behaviour | 12, 13 |
| Objects, egos, artifacts, curses, ID | 14 |
| Inventory, quiver, weight | 15 |
| Level generation, feelings | 16 |
| Traps, doors, digging, chests | 17 |
| Shops | 18 |
| World loop, quests, death, score, savefiles | 19 |
| Data files | 20 |
