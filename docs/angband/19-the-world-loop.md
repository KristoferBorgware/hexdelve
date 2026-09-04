# 19. The world loop

`process_world()` runs once every ten game turns and is where everything that happens *to* the player rather than *because of* them is handled: hunger, regeneration, poison and cuts ticking down hit points, timed effects expiring, light burning, monsters wandering in, rods recharging, curses firing, Word of Recall arriving, and the day turning over in town. Nothing in it is triggered by a command; it is the game's own clock.

This chapter walks that function in order, then covers the two housekeeping routines around it — `process_player_cleanup()` after each command and `on_new_level()`/`on_leave_level()` at each level change. The surrounding loop that calls them is in the Architecture chapter 1.6, and the energy arithmetic deciding who acts when is in the Time chapter.

## 19.1 Where it sits

```
run_game_loop():
    process_player_cleanup()      -- energy spent, terrain damage, per-turn monster flags
    process_player()              -- commands until one uses energy
    loop:
        process_monsters(0)
        if turn % 10 == 0: process_world()
        player->energy += turn_energy(speed)
        turn++
```

So `process_world()` sees one call per ten game turns regardless of the player's speed. A hasted player takes more actions between two ticks than a slow one, which is why speed shortens the *real* duration of every timed effect: the counters decrement per tick, not per action.

## 19.2 Housekeeping and time

The function opens with monster-list maintenance — `compact_monsters()` when the count approaches `level-max:monsters` (1024), and again when the list has more holes than entries — then the clock:

| Interval | Event |
|---|---|
| `(10 × day_length) / 4` = 25,000 turns | Ambient sound |
| `(10 × day_length) / 2` = 50,000 turns, **town only** | Dawn or dusk: "The sun has risen/fallen", `cave_illuminate()` |
| `10 × store_turns` = 10,000 turns, **dungeon only** | `daycount++`, deferred store turnover (Town and Stores chapter 18.2) |

A day is `10 × day_length` = 100,000 game turns, and `is_daytime()` is the first half of it. The town's lighting only changes while the player is standing in it; the shops' stock only changes when the player arrives.

Then two per-tick checks: a player with `PF_UNLIGHT` (the Necromancer) has `PU_BONUS` set every tick, because their bonuses depend on the light where they stand; and `one_in_(mon-gen:chance)` — 1 in 500 — places a new monster at least `max_sight + 5` grids away. That last line is why standing still is never safe: the level keeps producing monsters at roughly one per 5,000 game turns, out of sight, for as long as the player stays on it.

## 19.3 Damage over time

In order, each returning immediately if the player dies:

| Source | Damage per tick |
|---|---|
| Poison | 1 |
| Cut | 1, or 2 for a Severe Cut, or 3 for a Deep Gash or Mortal Wound; 0 for a `PF_ROCK` player |
| Bloodlust | `player_over_exert(PY_EXERT_HP \| PY_EXERT_CUT \| PY_EXERT_SLOW, MAX(0, 10 - bloodlust), chp/10)` |
| Timed healing (`TMD_HEAL`) | Heals 30 |
| Black Breath | Each `one_in_(2)`: drain CON, drain STR, and lose `100 + (exp/100) × life_drain_percent` experience |

Damage reduction (`DAM_RED`) is applied through `player_apply_damage_reduction()` to all of these. Poison and cuts are flat rates rather than proportions, so they are lethal early and negligible late; the Black Breath is the opposite, since its experience drain scales with the experience the player has.

## 19.4 Food and regeneration

Digestion runs on `turn % 100` — every tenth tick — and is proportional to **speed**, not to actions taken:

```c
i = turn_energy(player->state.speed);   /* energy gained per game turn at this speed */
i = (i * 100) / z_info->food_value;     /* food-value: 100 */
if (OF_REGEN)      i *= 2;
if (OF_SLOW_DIGEST) i /= 2;
i = MAX(i, 1);
player_dec_timed(player, TMD_FOOD, i, ...);
```

Being hasted therefore consumes food faster in game-turn terms, exactly offsetting the extra actions. Regeneration doubles the rate and Slow Digestion halves it. Timed healing burns `8 × food_value` per tick on top, and switches itself off if that drops the player below Hungry.

At the "Full" grade the branch inverts: `5000 / food_value` is digested per tick and `PU_BONUS` is set, since being gorged is a speed penalty (Player Stats chapter 4.12).

Below that, two grades bite. At **Faint**, `one_in_(10)` per tick paralyses the player for `1 + randint0(5)` — and it is applied with the no-resist path, so Free Action does not prevent fainting. At **Starving**, damage is `(PY_FOOD_STARVE - food) / 10` per tick, which accelerates as food falls.

Hit points and mana then regenerate through `player_regen_hp()` and `player_regen_mana()` (Timed Effects chapter 11.5). Mana regeneration is unconditional — the call is outside the `chp < mhp` test — because it also handles losing mana.

## 19.5 Timeouts, light, noise

`decrease_timeouts()` decrements every timed effect (Timed Effects chapter 11.3) and, in the same pass, walks every equipped object's curses: each curse's `timeout` counts down, fires `do_curse_effect()` at zero, and re-rolls from the curse's `time:` field (Object Generation chapter 15.7).

`player_update_light()` burns fuel. `make_noise()` and `update_scent()` rebuild the flow maps the monster AI navigates by (Movement chapter 6.10) — **skipped entirely while resting**, so a resting player leaves no fresh trail.

## 19.6 Inventory and the level

- `OF_DRAIN_EXP`: `one_in_(10)` per tick costs `(damroll(10,6) + (exp/100) × life_drain_percent) / 10` experience, and teaches the rune.
- `recharge_objects()`: activatable equipment and rods tick down, in the pack **and on the floor of the level**, with messages when a stack finishes or an exhausted stack gains its first charge.
- `equip_learn_after_time()` on `turn % 100`: the `OFID_TIMED` flags reveal themselves (Object Knowledge chapter 16.4).
- Every trap on the level with a non-zero `timeout` decrements, and re-memorises its grid when it reaches zero (Traps chapter 14.7).

The trap sweep is a full scan of the level's grids every tick, which is the only part of `process_world()` whose work grows with the level's size.

## 19.7 Involuntary movement

**Word of Recall.** `player->word_recall` counts down and, at zero, moves the player. Reading the scroll sets it to `randint0(20) + 15` — 15 to 34 ticks, so 150 to 340 game turns — and reading it again cancels it.

```c
if (player->depth) { "yanked upwards";   dungeon_change_level(player, 0); }
else               { "yanked downwards"; player_set_recall_depth(player);
                     dungeon_change_level(player, player->recall_depth); }
```

`recall_depth` is set when the scroll is read, not when it fires. In the dungeon at `max_depth` it becomes `max_depth`; read at a shallower depth it prompts "Set recall depth to current depth?", so descending again to a level the player chose is possible but deliberate. `player_set_recall_depth()` raises it to at least 1, and under `birth_force_descend` pushes it one level deeper than `max_depth`. Recall is suspended entirely on arena levels.

**Deep Descent** counts down likewise, then drops the player `(4 / stair_skip) + 1` levels below `max_depth`. If that target is not deeper than the current level — which happens when the player is already below their recall depth — it instead detonates `EF_DESTRUCTION` at radius 5 around them.

## 19.8 After each command

`process_player_cleanup()` runs after every command that used energy:

1. Subtract `energy_use` from the player's energy and add it to `total_energy`.
2. `player_take_terrain_damage()` — this is where standing in lava hurts, once per action rather than once per tick (Traps chapter 14.11).
3. Redraw the map if hallucinating, and re-light every `RF_ATTR_MULTI` monster so multi-hued monsters shimmer.
4. Clear `MFLAG_NICE` on every monster — this is what ends the grace period for monsters created asleep with `FORCE_SLEEP`, letting them cast from their next turn (Monster Spells chapter 13.2).
5. Clear `MFLAG_SHOW` on every monster, and drop `MFLAG_MARK` from any monster not shown this turn.

## 19.9 Level transitions

Level changes are requested rather than performed: `dungeon_change_level()` sets `player->depth` and `upkeep->generate_level`, and the main loop performs the change when it is safe. It also triggers the deferred store update when the new depth is 0.

`on_leave_level()` cancels `TMD_COMMAND`, disables repeat of a floor-item command, and flushes pending display work.

`on_new_level()` cancels the target and health tracker, then:

```c
if (player->max_lev < player->lev)     player->max_lev = player->lev;
if (player->max_depth < player->depth) player->max_depth = player->recall_depth = player->depth;
```

so **arriving** on a level deeper than any before both records it and moves the recall depth with it. It then announces the level feeling, runs `search()` once so adjacent secret doors and chest traps are found on arrival, and gives the player at least `move_energy` (100) — enough to act immediately — without reducing a larger value restored from a savefile mid-level.

Arena levels skip most of this: no ambient sound, no target cancellation, no feeling, no search.
