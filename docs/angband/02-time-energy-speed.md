# 2. Time, turns, energy and speed

Angband's clock is the global `turn` counter, incremented once per pass of the main loop. Every creature, the player included, has an energy reservoir; each game turn it gains an amount set by its speed, and it acts when the reservoir reaches 100. Speed is therefore a rate, not a turn order, and a +10 creature simply reaches 100 twice as often as a normal one. This chapter gives the exact table, the order in which the player and monsters are processed, the energy cost of every command, and the bookkeeping of turns, days and resting.

## 2.1 Game turns, player turns, standard turns

Three counters appear on the character sheet ("Turns used"):

| Counter | Meaning |
|---|---|
| Game | `turn`: game turns since birth (starts at 1). At normal speed the player acts once per 10 game turns. |
| Standard | `player->total_energy / 100`: the total energy the player has spent, in units of one normal-speed action. This is the "player turns at normal speed" measure used for comparing characters. |
| Resting | `player->resting_turn`: the number of player actions spent resting. |

`process_world()` runs every 10 game turns (`turn % 10 == 0`); a "day" is `10 * z_info->day_length` = 100,000 game turns, or 10,000 normal-speed player turns.

## 2.2 Speed and the energy table

`state.speed` is stored with an offset of 110: 110 is normal, 120 is "+10", 100 is "−10". It is clamped to 0..199. Each game turn a creature of speed s gains `turn_energy(s) = extract_energy[s] * move_energy / 100`, and since `move_energy` is 100 this is just `extract_energy[s]`:

| Speed (displayed) | Index | Energy per game turn | Actions per 10 game turns |
|---|---|---|---|
| −60 and slower | ≤ 50 | 1 | 0.1 |
| −50 | 60–69 | 1 | 0.1 |
| −40 | 70–79 | 2 | 0.2 |
| −30 | 80–86 / 87–89 | 2 / 3 | 0.2 / 0.3 |
| −20 | 90–94 / 95–99 | 3 / 4 | 0.3 / 0.4 |
| −10 | 100 | 5 | 0.5 |
| −9 .. −1 | 101–109 | 5, 5, 5, 6, 6, 7, 7, 8, 9 | |
| normal | 110 | 10 | 1.0 |
| +1 .. +9 | 111–119 | 11, 12, 13, 14, 15, 16, 17, 18, 19 | |
| +10 | 120 | 20 | 2.0 |
| +11 .. +19 | 121–129 | 21 .. 29 | |
| +20 | 130 | 30 | 3.0 |
| +21 .. +29 | 131–139 | 31, 32, 33, 34, 35, 36, 36, 37, 37 | |
| +30 | 140 | 38 | 3.8 |
| +31 .. +39 | 141–149 | 38, 39, 39, 40, 40, 40, 41, 41, 41 | |
| +40 | 150 | 42 | 4.2 |
| +50 | 160 | 45 | 4.5 |
| +60 | 170 | 47 | 4.7 |
| +70 | 180 | 49 | 4.9 |
| +80 and faster | 190–199 | 49 | 4.9 |

The full row for the slow end, from `game-world.c`:

```text
index  60-69: 1 each          index 100-109: 5 5 5 5 6 6 7 7 8 9
index  70-79: 2 each          index 110-119: 10 11 12 13 14 15 16 17 18 19
index  80-89: 2 2 2 2 2 2 2 3 3 3
index  90-99: 3 3 3 3 3 4 4 4 4 4
```

Between −10 and +30 the relation is close to linear (one extra energy point per point of speed, i.e. +10% per point); above +30 it flattens sharply, and below −10 it bottoms out at 1. Relative to a normal-speed creature, +10 is exactly twice as fast, +20 three times, +30 3.8 times, and the maximum (+80 or more) 4.9 times; −10 is half speed and −20 a third.

`mon-lore.c` uses the same table to describe monster speed to the player ("moves at double normal speed" is `10 * extract_energy[speed] / extract_energy[110]`).

## 2.3 Who acts when

`process_monsters(minimum_energy)` walks the monster list from the highest index down and, for each live monster with at least `minimum_energy` energy that has not yet been handled this game turn:

```c
moving = mon->energy >= move_energy;           /* decided BEFORE this turn's gain */
mflag_on(mon->mflag, MFLAG_HANDLED);
if (turn % 100 == 0) regen_monster(mon, 1);
mspeed = mon->mspeed + (FAST ? 10 : 0) - (SLOW ? 2 * slow_level : 0);
mon->energy += turn_energy(mspeed);
if (!moving) continue;
mon->energy -= move_energy;
... the monster takes its turn (monster_turn(), see the Monsters chapter) ...
```

The main loop calls `process_monsters(0)` once per game turn, so every monster gains energy exactly once per game turn and acts if it *entered* the turn with 100 or more. The `MFLAG_HANDLED` flag, cleared by `reset_monsters()` right afterwards, stops a monster from being processed twice. Before the player acts, the loop calls `process_monsters(player->energy + 1)`: monsters holding strictly more energy than the player are processed (gaining their energy for the coming turn and acting) ahead of the player, and are then skipped by the following `process_monsters(0)`. The net rule is:

- each game turn, every monster gains `turn_energy` once;
- a monster acts on the game turn after its energy reached 100;
- among creatures ready to act on the same game turn, those with more energy than the player go first, the player next, and the rest afterwards;
- the player acts *before* anything else on entering a new level, because `on_new_level()` tops the player's energy up to 100.

Monsters do not bank energy indefinitely in practice, because acting costs 100 and the fastest gain is 49 per turn; but a monster that was unable to act (asleep monsters still accumulate energy and act, they just spend their turn doing nothing) always has a full turn ready.

The player's energy is added at the end of each pass (`player->energy += turn_energy(state.speed)`), after monsters and the world. Whenever `player->energy >= 100` the player is given commands until one spends energy; the cost is subtracted in `process_player_cleanup()` and `total_energy` is incremented by it. Energy can go above 100 (nothing caps it), so a very fast player at speed +30 gains 38 per turn and after three turns has 114: one action, 14 carried over.

## 2.4 Monster speed

A monster's base speed is the `speed:` field of its race (110 = normal). At creation (`mon-make.c: place_new_monster_one()`), non-unique monsters get a small random variation:

```c
mon->mspeed = race->speed;
if (!unique) {
	i = turn_energy(race->speed) / 10;       /* 1 at normal speed, 2 at +10, 3 at +20, 4 at +30 */
	if (i) mon->mspeed += rand_spread(0, i);  /* ±i */
}
mon->energy = randint0(50);                  /* random starting energy so packs don't move in lockstep */
```

So "cave orcs" (speed 110) actually run at 109, 110 or 111, and a +20 monster at anything from +18 to +22. Uniques are always exactly their listed speed. Temporary haste adds 10; temporary slowness subtracts `2 * level` where level is the slow effect's intensity (up to 5 levels, i.e. −10).

## 2.5 The player's speed

`state.speed` starts at 110 and is modified in `calc_bonuses()` by: SPEED modifiers on equipment and shape; −1 for every 10% of the weight limit carried above half of it (see the Player Stats chapter); +10 for `TMD_FAST` or `TMD_SPRINT`; −10 for `TMD_SLOW`; −5 for `TMD_STONESKIN`; +10 for `TMD_TERROR`; and up to −10 for being gorged. The status line shows `speed - 110` as "Fast (+10)" or "Slow (−3)".

## 2.6 Energy cost of commands

`player->upkeep->energy_use` is set by each command handler; `z_info->move_energy` is 100.

| Action | Energy |
|---|---|
| Walk, jump, run one step, pathfind one step | `energy_per_move()`: 100 with no MOVES modifier; with MOVES = m > 0, `100 / (1 + m)` (50 for +1, 33 for +2, 25 for +3); with m < 0, `100 * (1 + 2|m|) / (1 + |m|)` (150 for −1) |
| Hold, stairs, open, close, tunnel, disarm, alter, steal, sleep (paralysed), rest one turn, command a monster | 100 |
| Wield or wear | 100 |
| Take off, drop, refuel a light | 50 |
| Eat, quaff, read, aim, use, zap, activate (through `use_aux()`) | 100 |
| Cast a spell | 100, or 75 with `TMD_FASTCAST` |
| Study a spell | 100 |
| Fire a missile | `100 * 10 / num_shots` (62 with 1.6 shots) |
| Throw | 100 |
| Melee | one blow at a time, `100 * 100 / num_blows` each, up to the energy available (see the Melee chapter) |
| Pick up objects with `g` | per `do_cmd_pickup()`: the cost returned by `player_pickup_item()` (100 for one item; auto-pickup on stepping is free) |
| Walking into a wall without light or while confused | 100 (deliberately not refunded) |
| Walking into a known wall, a known trap while running, or refusing a damaging-terrain prompt | 0 |
| Look, inscribe, browse, map, character sheet, knowledge, options | 0 |

Shield bashes can add 25–75% of a turn when the player stumbles (`attempt_shield_bash()`).

## 2.7 Days and nights

`is_daytime()` is true for the first half of each 100,000-game-turn day (`turn % 100000 < 50000`). The town is fully lit by day and dark by night (`cave_illuminate()` at each dawn and dusk, with the messages "The sun has risen/fallen"); the change is only noticed while the player is in the town. Every `10 * store_turns` = 10,000 game turns spent in the dungeon, `daycount` increments so that the stores can turn over their stock when the player returns (see the Town and Stores chapter). Ambient sounds play every quarter day.

## 2.8 Resting

`R` (`do_cmd_rest()`) takes a count: a positive number of turns, or one of `REST_COMPLETE` ("as needed": until HP and SP are full and no ailment remains), `REST_ALL_POINTS` (HP and SP full), `REST_SOME_POINTS` (HP *or* SP full). Each resting turn costs 100 energy, increments `resting_turn`, and re-queues `CMD_REST` with the count minus one. `player_resting_complete_special()` is checked at the start of every player turn and calls `disturb()` when the condition is met. Regeneration is boosted while resting (see the Timed Effects chapter), but only after `REST_REQUIRED_FOR_REGEN` consecutive resting turns for numeric counts; the special modes qualify immediately. Any `disturb()` (a monster coming into view, damage, a message that matters) cancels resting, running and repeated commands and flushes queued input.

## 2.9 Repeating

`n` repeats the last repeatable command; `0` followed by a count sets an explicit repeat count. `process_command()` decrements the count after each execution unless the command changed it itself, and `disturb()` zeroes it. Digging, opening locked doors and disarming set their own count of 99 the first time they run.
