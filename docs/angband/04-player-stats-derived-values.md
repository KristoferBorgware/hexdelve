# 4. Player stats and derived values

Everything the game knows about the character's capabilities at a given moment lives in `struct player_state` (`player.h`), which is rebuilt from scratch by `calc_bonuses()` in `player-calcs.c` whenever the `PU_BONUS` update flag is set. The five stats (STR, INT, WIS, DEX, CON) are converted into 38-step table indices, and a dozen lookup tables map those indices onto to-hit, to-dam, blows, carrying capacity, hit points, mana, saving throw and so on. This chapter reproduces those tables and the exact order in which `calc_bonuses()` combines race, class, equipment, shape, hunger and timed effects.

## 4.1 The state structure and when it is rebuilt

`player->state` is the true state; `player->known_state` is the same calculation restricted to properties the player has identified (used for the character sheet and for deciding what to display). `update_bonuses()` computes both, then compares old and new to decide what needs redrawing, whether HP/mana/spell counts must be recomputed (a change in any stat index sets `PU_MANA | PU_SPELLS`, a change in CON sets `PU_HP`), whether the view or the monster list must be refreshed (light radius, telepathy or see-invisible changed), and prints the "You have trouble wielding such a heavy weapon" style messages when `heavy_wield`, `heavy_shoot`, `bless_wield` or `cumber_armor` flips.

`update_stuff()` processes the update flags in a fixed order: `PU_INVEN` (re-sort the pack), `PU_BONUS`, `PU_TORCH` (light radius), `PU_HP`, `PU_MANA`, `PU_SPELLS`, then, only if a level exists and the map is visible, `PU_UPDATE_VIEW`, `PU_DISTANCE` (recompute every monster's distance and visibility), `PU_MONSTERS` (visibility only) and `PU_PANEL`. It is called from `handle_stuff()` after every command and every monster turn, so the state is never stale for more than one action.

The fields of `player_state`:

| Field | Meaning |
|---|---|
| `stat_add[5]`, `stat_top[5]`, `stat_use[5]`, `stat_ind[5]` | Equipment/shape bonus, modified maximum, modified current value, table index |
| `skills[SKILL_MAX]` | Disarm (physical), disarm (magical), device, saving throw, stealth, search, melee to-hit, bow to-hit, throw to-hit, digging |
| `speed` | Energy speed, 110 = normal (see Time chapter) |
| `num_blows`, `num_shots`, `num_moves` | Blows per turn in 1/100ths, shots per turn in 1/10ths, extra moves |
| `ammo_mult`, `ammo_tval` | Launcher multiplier and the ammunition it fires |
| `ac`, `to_a`, `to_h`, `to_d` | Base armour, armour bonus, hit and damage bonuses from everything except the wielded weapon and launcher |
| `dam_red` | Flat damage reduction (`DAM_RED` modifier, e.g. the Pukel-man shape) |
| `see_infra`, `cur_light` | Infravision radius, light radius |
| `flags[OF_SIZE]`, `pflags[PF_SIZE]` | Collected object flags (sustains, protections, telepathy, ...) and player flags |
| `el_info[ELEM_MAX]` | Resistance level per element (see the Elements chapter) |
| `heavy_wield`, `heavy_shoot`, `bless_wield`, `cumber_armor` | Encumbrance status booleans |

## 4.2 Stat values and the table index

Stats are stored internally as 3..118 (see Character Creation for the 18/xx display). For each stat i, `calc_bonuses()` computes:

```c
add = stat_add[i] + race->r_adj[i] + class->c_adj[i];
stat_top[i] = modify_stat_value(stat_max[i], add);
stat_use[i] = modify_stat_value(stat_cur[i], add);
```

and the table index from `stat_use`:

| `stat_use` | Index |
|---|---|
| ≤ 3 | 0 |
| 4..18 | value − 3 (1..15) |
| 19..237 (18/01..18/219) | 15 + (value − 18) / 10 |
| ≥ 238 (18/220+) | 37 |

So index 15 is exactly 18 through 18/09, index 16 is 18/10..18/19, and so on; the top index 37 needs an effective 18/220. `modify_stat_value()` adds one per point below 18 and ten per point above it, so a +3 STR ring on an 18/50 character gives 18/80, but on a 16 character gives 18/10 (16→17→18→18/10).

## 4.3 The adjustment tables

Each table has 38 entries, one per index. In the tables below the row header gives the index and the stat value range it covers.

### Strength

| Idx | STR | to-dam (`adj_str_td`) | to-hit (`adj_str_th`) | weight limit ×10 lb (`adj_str_wgt`) | hold lb (`adj_str_hold`) | digging (`adj_str_dig`) | blows factor (`adj_str_blow`) |
|---|---|---|---|---|---|---|---|
| 0 | 3 | -2 | -3 | 5 | 4 | 0 | 3 |
| 1 | 4 | -2 | -2 | 6 | 5 | 0 | 4 |
| 2 | 5 | -1 | -1 | 7 | 6 | 1 | 5 |
| 3 | 6 | -1 | -1 | 8 | 7 | 2 | 6 |
| 4 | 7 | 0 | 0 | 9 | 8 | 3 | 7 |
| 5 | 8 | 0 | 0 | 10 | 10 | 4 | 8 |
| 6 | 9 | 0 | 0 | 11 | 12 | 4 | 9 |
| 7 | 10 | 0 | 0 | 12 | 14 | 5 | 10 |
| 8 | 11 | 0 | 0 | 13 | 16 | 5 | 11 |
| 9 | 12 | 0 | 0 | 14 | 18 | 6 | 12 |
| 10 | 13 | 0 | 0 | 15 | 20 | 6 | 13 |
| 11 | 14 | 0 | 0 | 16 | 22 | 7 | 14 |
| 12 | 15 | 0 | 0 | 17 | 24 | 7 | 15 |
| 13 | 16 | 1 | 0 | 18 | 26 | 8 | 16 |
| 14 | 17 | 2 | 0 | 19 | 28 | 8 | 17 |
| 15 | 18/00–09 | 2 | 1 | 20 | 30 | 9 | 20 |
| 16 | 18/10–19 | 2 | 1 | 22 | 30 | 10 | 30 |
| 17 | 18/20–29 | 3 | 1 | 24 | 35 | 12 | 40 |
| 18 | 18/30–39 | 3 | 1 | 26 | 40 | 15 | 50 |
| 19 | 18/40–49 | 3 | 1 | 28 | 45 | 20 | 60 |
| 20 | 18/50–59 | 3 | 1 | 30 | 50 | 25 | 70 |
| 21 | 18/60–69 | 3 | 1 | 30 | 55 | 30 | 80 |
| 22 | 18/70–79 | 4 | 2 | 30 | 60 | 35 | 90 |
| 23 | 18/80–89 | 5 | 3 | 30 | 65 | 40 | 100 |
| 24 | 18/90–99 | 5 | 4 | 30 | 70 | 45 | 110 |
| 25 | 18/100–109 | 6 | 5 | 30 | 80 | 50 | 120 |
| 26 | 18/110–119 | 7 | 6 | 30 | 80 | 55 | 130 |
| 27 | 18/120–129 | 8 | 7 | 30 | 80 | 60 | 140 |
| 28 | 18/130–139 | 9 | 8 | 30 | 80 | 65 | 150 |
| 29 | 18/140–149 | 10 | 9 | 30 | 80 | 70 | 160 |
| 30 | 18/150–159 | 11 | 10 | 30 | 90 | 75 | 170 |
| 31 | 18/160–169 | 12 | 11 | 30 | 90 | 80 | 180 |
| 32 | 18/170–179 | 13 | 12 | 30 | 90 | 85 | 190 |
| 33 | 18/180–189 | 14 | 13 | 30 | 90 | 90 | 200 |
| 34 | 18/190–199 | 15 | 14 | 30 | 90 | 95 | 210 |
| 35 | 18/200–209 | 16 | 15 | 30 | 100 | 100 | 220 |
| 36 | 18/210–219 | 18 | 15 | 30 | 100 | 100 | 230 |
| 37 | 18/220+ | 20 | 15 | 30 | 100 | 100 | 240 |

### Dexterity

| Idx | DEX | to-AC (`adj_dex_ta`) | to-hit (`adj_dex_th`) | disarm (`adj_dex_dis`) | blows index (`adj_dex_blow`) | theft save % (`adj_dex_safe`) |
|---|---|---|---|---|---|---|
| 0 | 3 | -4 | -3 | 0 | 0 | 0 |
| 1 | 4 | -3 | -2 | 0 | 0 | 1 |
| 2 | 5 | -2 | -2 | 0 | 0 | 2 |
| 3 | 6 | -1 | -1 | 0 | 0 | 3 |
| 4 | 7 | 0 | -1 | 0 | 0 | 4 |
| 5 | 8 | 0 | 0 | 1 | 0 | 5 |
| 6 | 9 | 0 | 0 | 1 | 0 | 5 |
| 7 | 10 | 0 | 0 | 1 | 1 | 6 |
| 8 | 11 | 0 | 0 | 1 | 1 | 6 |
| 9 | 12 | 0 | 0 | 1 | 1 | 7 |
| 10 | 13 | 0 | 0 | 1 | 1 | 7 |
| 11 | 14 | 0 | 0 | 1 | 1 | 8 |
| 12 | 15 | 1 | 0 | 2 | 1 | 8 |
| 13 | 16 | 1 | 1 | 2 | 1 | 9 |
| 14 | 17 | 1 | 2 | 2 | 2 | 9 |
| 15 | 18/00–09 | 2 | 3 | 3 | 2 | 10 |
| 16 | 18/10–19 | 2 | 3 | 3 | 2 | 10 |
| 17 | 18/20–29 | 2 | 3 | 3 | 3 | 15 |
| 18 | 18/30–39 | 2 | 3 | 4 | 3 | 15 |
| 19 | 18/40–49 | 2 | 3 | 4 | 4 | 20 |
| 20 | 18/50–59 | 3 | 4 | 5 | 4 | 25 |
| 21 | 18/60–69 | 3 | 4 | 6 | 5 | 30 |
| 22 | 18/70–79 | 3 | 4 | 7 | 5 | 35 |
| 23 | 18/80–89 | 4 | 4 | 8 | 6 | 40 |
| 24 | 18/90–99 | 5 | 5 | 9 | 6 | 45 |
| 25 | 18/100–109 | 6 | 6 | 10 | 7 | 50 |
| 26 | 18/110–119 | 7 | 7 | 10 | 7 | 60 |
| 27 | 18/120–129 | 8 | 8 | 11 | 8 | 70 |
| 28 | 18/130–139 | 9 | 9 | 12 | 8 | 80 |
| 29 | 18/140–149 | 9 | 9 | 13 | 8 | 90 |
| 30 | 18/150–159 | 10 | 10 | 14 | 9 | 100 |
| 31 | 18/160–169 | 11 | 11 | 15 | 9 | 100 |
| 32 | 18/170–179 | 12 | 12 | 16 | 9 | 100 |
| 33 | 18/180–189 | 13 | 13 | 17 | 10 | 100 |
| 34 | 18/190–199 | 14 | 14 | 18 | 10 | 100 |
| 35 | 18/200–209 | 15 | 15 | 19 | 11 | 100 |
| 36 | 18/210–219 | 15 | 15 | 19 | 11 | 100 |
| 37 | 18/220+ | 15 | 15 | 19 | 11 | 100 |

### Intelligence, wisdom and constitution

`adj_int_dis` (magical disarming) is identical to `adj_dex_dis` above. `adj_con_fix` is the recovery rate multiplier for cuts, stuns and poison (they decrease by `adj_con_fix + 1` per world tick), and `adj_con_mhp` is hundredths of a hit point per level.

| Idx | Value | device (`adj_int_dev`) | save (`adj_wis_sav`) | recovery (`adj_con_fix`) | HP/level ×0.01 (`adj_con_mhp`) |
|---|---|---|---|---|---|
| 0 | 3 | 0 | 0 | 0 | -250 |
| 1 | 4 | 0 | 0 | 0 | -150 |
| 2 | 5 | 0 | 0 | 0 | -100 |
| 3 | 6 | 0 | 0 | 0 | -75 |
| 4 | 7 | 0 | 0 | 0 | -50 |
| 5 | 8 | 1 | 1 | 0 | -25 |
| 6 | 9 | 1 | 1 | 0 | -10 |
| 7 | 10 | 1 | 1 | 0 | -5 |
| 8 | 11 | 1 | 1 | 0 | 0 |
| 9 | 12 | 1 | 1 | 0 | 5 |
| 10 | 13 | 1 | 1 | 0 | 10 |
| 11 | 14 | 1 | 1 | 1 | 25 |
| 12 | 15 | 2 | 2 | 1 | 50 |
| 13 | 16 | 2 | 2 | 1 | 75 |
| 14 | 17 | 2 | 2 | 1 | 100 |
| 15 | 18/00–09 | 3 | 3 | 2 | 150 |
| 16 | 18/10–19 | 3 | 3 | 2 | 175 |
| 17 | 18/20–29 | 3 | 3 | 2 | 200 |
| 18 | 18/30–39 | 3 | 3 | 2 | 225 |
| 19 | 18/40–49 | 3 | 3 | 2 | 250 |
| 20 | 18/50–59 | 4 | 4 | 3 | 275 |
| 21 | 18/60–69 | 4 | 4 | 3 | 300 |
| 22 | 18/70–79 | 5 | 5 | 3 | 350 |
| 23 | 18/80–89 | 5 | 5 | 3 | 400 |
| 24 | 18/90–99 | 6 | 6 | 3 | 450 |
| 25 | 18/100–109 | 6 | 7 | 4 | 500 |
| 26 | 18/110–119 | 7 | 8 | 4 | 550 |
| 27 | 18/120–129 | 7 | 9 | 5 | 600 |
| 28 | 18/130–139 | 8 | 10 | 6 | 650 |
| 29 | 18/140–149 | 8 | 11 | 6 | 700 |
| 30 | 18/150–159 | 9 | 12 | 7 | 750 |
| 31 | 18/160–169 | 9 | 13 | 7 | 800 |
| 32 | 18/170–179 | 10 | 14 | 8 | 900 |
| 33 | 18/180–189 | 10 | 15 | 8 | 1000 |
| 34 | 18/190–199 | 11 | 16 | 8 | 1100 |
| 35 | 18/200–209 | 11 | 17 | 9 | 1250 |
| 36 | 18/210–219 | 12 | 18 | 9 | 1250 |
| 37 | 18/220+ | 13 | 19 | 9 | 1250 |

### Spell stat tables

These are indexed by the *average* of the casting stats of the class's realms (`average_spell_stat()`; every 4.2 class has a single realm, so it is simply INT or WIS). `adj_mag_study` is hundredths of a spell per level, `adj_mag_mana` hundredths of a mana point per level, `adj_mag_fail` the minimum failure rate, and `adj_mag_stat` the amount subtracted from every spell's base failure rate (the last two live in `player-spell.c`).

| Idx | Value | spells/level ×0.01 | mana/level ×0.01 | min fail % | fail reduction |
|---|---|---|---|---|---|
| 0 | 3 | 0 | 0 | 99 | -5 |
| 1 | 4 | 0 | 10 | 99 | -4 |
| 2 | 5 | 10 | 20 | 99 | -3 |
| 3 | 6 | 20 | 30 | 99 | -3 |
| 4 | 7 | 30 | 40 | 99 | -2 |
| 5 | 8 | 40 | 50 | 50 | -1 |
| 6 | 9 | 50 | 60 | 30 | 0 |
| 7 | 10 | 60 | 70 | 20 | 0 |
| 8 | 11 | 70 | 80 | 15 | 0 |
| 9 | 12 | 80 | 90 | 12 | 0 |
| 10 | 13 | 85 | 100 | 11 | 0 |
| 11 | 14 | 90 | 110 | 10 | 1 |
| 12 | 15 | 95 | 120 | 9 | 2 |
| 13 | 16 | 100 | 130 | 8 | 3 |
| 14 | 17 | 105 | 140 | 7 | 4 |
| 15 | 18/00–09 | 110 | 150 | 6 | 5 |
| 16 | 18/10–19 | 115 | 160 | 6 | 6 |
| 17 | 18/20–29 | 120 | 170 | 5 | 7 |
| 18 | 18/30–39 | 130 | 180 | 5 | 8 |
| 19 | 18/40–49 | 140 | 190 | 5 | 9 |
| 20 | 18/50–59 | 150 | 200 | 4 | 10 |
| 21 | 18/60–69 | 160 | 225 | 4 | 11 |
| 22 | 18/70–79 | 170 | 250 | 4 | 12 |
| 23 | 18/80–89 | 180 | 300 | 4 | 15 |
| 24 | 18/90–99 | 190 | 350 | 3 | 18 |
| 25 | 18/100–109 | 200 | 400 | 3 | 21 |
| 26 | 18/110–119 | 210 | 450 | 2 | 24 |
| 27 | 18/120–129 | 220 | 500 | 2 | 27 |
| 28 | 18/130–139 | 230 | 550 | 2 | 30 |
| 29 | 18/140–149 | 240 | 600 | 2 | 33 |
| 30 | 18/150–159 | 250 | 650 | 1 | 36 |
| 31 | 18/160–169 | 250 | 700 | 1 | 39 |
| 32 | 18/170–179 | 250 | 750 | 1 | 42 |
| 33 | 18/180–189 | 250 | 800 | 1 | 45 |
| 34 | 18/190–199 | 250 | 800 | 1 | 48 |
| 35 | 18/200–209 | 250 | 800 | 0 | 51 |
| 36 | 18/210–219 | 250 | 800 | 0 | 54 |
| 37 | 18/220+ | 250 | 800 | 0 | 57 |

## 4.4 `calc_bonuses()` step by step

1. **Reset.** `state` is zeroed; `speed = 110`, `num_blows = 100`. Infravision is the race's; each of the ten skills starts at `race skill + class base skill`; elemental resistance levels start at the race's (a racial vulnerability is remembered separately); player flags are race ∪ class; object flags start from `player_flags()` (race flags ∪ class flags, plus PROT_FEAR for BRAVERY_30 at level 30+).
2. **Equipment.** For each body slot, for the object in it and then for each *curse* on that object (curses are implemented as hidden objects that contribute their own modifiers and flags):
   - object flags are collected (all of them for the real state, only known ones for `known_state`);
   - modifiers are added: STR/INT/WIS/DEX/CON to `stat_add`, STEALTH to the stealth skill, SEARCH ×5 to the search skill, INFRA to infravision, TUNNEL ×20 (plus 20/40/60 for DIG_1/2/3 diggers) to the digging skill, SPEED to speed, DAM_RED, BLOWS, SHOTS, MIGHT and MOVES to running totals;
   - each modifier is multiplied by `p->obj_k->modifiers[...]`, which is 1 once the player knows that rune and 0 before, so an *unknown* modifier has no effect on the real state either (the player learns it the moment it matters, see the Objects chapter);
   - element resist levels take the maximum over items, vulnerabilities (−1) are noted;
   - `ac += obj->ac`, `to_a += obj->to_a`, and `to_h`/`to_d` are added for everything *except* the weapon and launcher slots (their bonuses apply only to attacks made with them).
3. **Shape.** `calc_shapechange()` adds the current shape's combat bonuses, skills, flags, stat and other modifiers and resistances (`shape.txt`, see 4.13).
4. **Vulnerabilities.** For every element noted as vulnerable, `res_level--` unless it is immune (3). A racial vulnerability plus one resistance therefore nets to 0.
5. **Light.** `calc_light()` (4.10).
6. **Class specials.** UNLIGHT gives resist dark (level 1); EVIL gives resist nether and vulnerability to holy orb (−1). Both only once the character is in the dungeon (`character_dungeon`).
7. **Stats.** Compute `stat_top`, `stat_use`, `stat_ind` as in 4.2.
8. **Hunger.** Outside the "Fed" grade (see the Timed Effects chapter): if gorged, `speed -= excess * 10 / (PY_FOOD_MAX - PY_FOOD_FULL)` (up to −10 at the very top, waived for vampire-form characters); if hungry, `lack = (PY_FOOD_HUNGRY - food) * 20 / PY_FOOD_HUNGRY` is subtracted from both to-hit and to-dam, and device skill loses 10% for lack 11–15, device −20% and both disarm skills −10% for 16–18, and device −30%, disarm −20%, save −10%, search −10% beyond 18.
9. **Timed effects.** Flags duplicated by timed effects (`oflag_dup` in `player_timed.txt`, e.g. temporary see-invisible, telepathy, protection from evil) are merged; then the numeric modifiers in the table in 4.12.
10. **Fear.** If the AFRAID flag is set (from an item or a timed effect): `to_h -= 20`, `to_a += 8`, device −20%.
11. **Burden.** `limit = adj_str_wgt[STR] * 100` (tenths of a pound); if `weight > limit / 2` then `speed -= (weight - limit/2) / (limit/10)`, i.e. −1 speed for every 10% of the limit carried above half of it. Speed is then clamped to 0..199.
12. **Stat bonuses.** `to_a += adj_dex_ta`, `to_d += adj_str_td`, `to_h += adj_dex_th + adj_str_th`.
13. **Skills.** `disarm_phys += adj_dex_dis`, `disarm_magic += adj_int_dis`, `device += adj_int_dev`, `save += adj_wis_sav`, `digging += adj_str_dig`; then every skill gets `class increment * level / 10`. Digging is at least 1; stealth is clamped to 0..30.
14. **Launcher.** `hold = adj_str_hold[STR]` (pounds). If `hold < launcher weight in lb`, `to_h += 2 * (hold - weight_lb)` and `heavy_shoot` is set. `num_shots = 10`; the ammo type comes from the launcher's kind flags (`SHOOTS_SHOTS/ARROWS/BOLTS`); `ammo_mult = launcher->pval`. Unless heavy: `num_shots += extra_shots`, `ammo_mult += extra_might`, and `num_shots += level / 3` for FAST_SHOT (Rangers). Minimum 10 (one shot).
15. **Weapon.** Same heaviness test with the weapon's weight. If not heavy: `num_blows = calc_blows()` (4.7) and `digging += weapon weight / 10` (heavy weapons dig better). BLESS_WEAPON classes get `to_d += 2` and `bless_wield` with a hafted or BLESSED weapon. With no weapon, blows are computed for weight 0 (so at the class minimum weight).
16. **Mana** via `calc_mana()` (4.9); if the result is 0, the NO_MANA player flag is set.
17. `num_moves = extra_moves`.

Note what is *not* here: there is no glove penalty for arcane casters, no priest edged-weapon penalty, and no charisma. All of those were removed before 4.2.

## 4.5 Skills

The final formula for each skill is

```text
skill = race_base + class_base + stat_adjustment + equipment + shape + class_increment * level / 10  (+ timed/hunger modifiers)
```

with the stat adjustment being `adj_dex_dis` for physical disarming, `adj_int_dis` for magical disarming, `adj_int_dev` for devices, `adj_wis_sav` for saving throws and `adj_str_dig` for digging; melee, shooting, throwing, stealth and searching have no stat term. Skills are used as follows (details in the respective chapters):

| Skill | Used by |
|---|---|
| SKILL_DISARM_PHYS | Unlocking doors (`calc_unlocking_chance()`), disarming physical traps, opening chests |
| SKILL_DISARM_MAGIC | Disarming magical traps and runes |
| SKILL_DEVICE | Wand/staff/rod/activation success |
| SKILL_SAVE | Saving throw against monster spells and many side effects (`randint0(100) < save`) |
| SKILL_STEALTH | Monster wake-up rate (0..30) |
| SKILL_SEARCH | Multiplied by 5 from the SEARCH modifier; noticing secret doors |
| SKILL_TO_HIT_MELEE / BOW / THROW | Base of the hit chance for each attack type |
| SKILL_DIGGING | Tunnelling chances (4.11) |

`adjust_skill_scale(&skill, num, den, minv)` applies a percentage change: `skill += MAX(minv, |skill|) * num / den` for positive `num`, and for negative `num` the same magnitude rounded *up* so that a −1/10 adjustment exactly cancels a +1/10 one. It is used for all the device-skill modifiers listed below.

## 4.6 Armour class, to-hit and to-dam

`ac` is the sum of the base armour values of worn items; `to_a` the sum of their magical bonuses, plus `adj_dex_ta`, plus timed effects. Displayed armour is `ac + to_a` of the *known* state. Monsters attack against `ac + to_a` of the true state.

`state.to_h` and `state.to_d` collect bonuses from rings, gloves, armour, shape, stats, hunger and timed effects, but not from the weapon or launcher in hand; at attack time the weapon's own `to_h`/`to_d` (and, for missiles, both the launcher's and the ammunition's) are added on top (see the Combat chapters). The character sheet shows `to_h`/`to_d` including the weapon.

## 4.7 Blows per turn

```c
div       = MAX(weapon weight (tenths lb), class min_weight);
str_index = MIN(adj_str_blow[STR] * class att_multiply / div, 11);
dex_index = MIN(adj_dex_blow[DEX], 11);
blow_energy = blows_table[str_index][dex_index];
blows = MIN(10000 / blow_energy, 100 * class max_attacks);
num_blows = MAX(blows + 100 * extra_blows, 100);    /* 200 with birth_percent_damage */
```

`num_blows` is in hundredths, so 166 means 1.66 blows per turn; the melee code spends `100 * move_energy / num_blows` energy per blow and lets fractional blows carry over between turns. `blows_table[P][D]` is the energy cost of one blow:

| P \ D | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11+ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| DEX ≈ | 3 | 10 | 17 | 18/20 | 18/40 | 18/60 | 18/80 | 18/100 | 18/120 | 18/150 | 18/180 | 18/200 |
| 0 | 100 | 100 | 95 | 85 | 75 | 60 | 50 | 42 | 35 | 30 | 25 | 23 |
| 1 | 100 | 95 | 85 | 75 | 60 | 50 | 42 | 35 | 30 | 25 | 23 | 21 |
| 2 | 95 | 85 | 75 | 60 | 50 | 42 | 35 | 30 | 26 | 23 | 21 | 20 |
| 3 | 85 | 75 | 60 | 50 | 42 | 36 | 32 | 28 | 25 | 22 | 20 | 19 |
| 4 | 75 | 60 | 50 | 42 | 36 | 33 | 28 | 25 | 23 | 21 | 19 | 18 |
| 5 | 60 | 50 | 42 | 36 | 33 | 30 | 27 | 24 | 22 | 21 | 19 | 17 |
| 6 | 50 | 42 | 36 | 33 | 30 | 27 | 25 | 23 | 21 | 20 | 18 | 17 |
| 7 | 42 | 36 | 33 | 30 | 28 | 26 | 24 | 22 | 20 | 19 | 18 | 17 |
| 8 | 36 | 33 | 30 | 28 | 26 | 24 | 22 | 21 | 20 | 19 | 17 | 16 |
| 9 | 35 | 32 | 29 | 26 | 24 | 22 | 21 | 20 | 19 | 18 | 17 | 16 |
| 10 | 34 | 30 | 27 | 25 | 23 | 22 | 21 | 20 | 19 | 18 | 17 | 16 |
| 11+ | 33 | 29 | 26 | 24 | 22 | 21 | 20 | 19 | 18 | 17 | 16 | 15 |

Class parameters (max blows / min weight / STR multiplier): Warrior 6/3.0 lb/5, Mage 4/4.0/2, Druid 4/3.5/3, Priest 4/3.5/3, Necromancer 4/3.5/3, Paladin 5/3.0/5, Rogue 5/2.0/4, Ranger 5/3.5/4, Blackguard 5/10.0/5. The Blackguard's 10 lb minimum weight means light weapons give it no advantage; a heavy weapon costs it nothing extra until it exceeds 10 lb.

Worked example, a level 20 Warrior with 18/50 STR (index 20, `adj_str_blow` 70) and 18/20 DEX (index 17, `adj_dex_blow` 3):

- 12 lb weapon: `div = 120`, `str_index = 70 * 5 / 120 = 2`, `blow_energy = blows_table[2][3] = 60`, `blows = min(166, 600) = 166` → 1.6 blows.
- 3 lb dagger: `div = 30` (equal to the minimum), `str_index = 350 / 30 = 11`, energy `blows_table[11][3] = 24`, `blows = 416` → 4.1 blows.
- The same Warrior at 18/100 STR (`adj_str_blow` 120) with the 12 lb weapon: `str_index = 600 / 120 = 5`, energy 36, 2.7 blows.

A `BLOWS[1]` ring adds 100 (one full blow) regardless of the table.

## 4.8 Shots, multiplier, range

`num_shots` is in tenths (10 = one shot per turn). A shot costs `move_energy * 10 / num_shots` energy, so a Ranger with `num_shots = 16` fires 1.6 times per normal turn. `ammo_mult` is the launcher's `pval` (2 for slings and short bows, 3 for long bows and light crossbows, 4 for heavy crossbows) plus MIGHT modifiers. Neither shots nor might bonuses apply while the launcher is too heavy. Range and the actual firing procedure are in the Ranged Combat chapter.

## 4.9 Hit points and mana

```c
mhp = player_hp[lev - 1] + adj_con_mhp[CON] * lev / 100;    /* at least lev + 1 */
```

`player_hp[]` is the cumulative table rolled at birth. At level 20 with 18/40 CON (250) the CON term is +50; at level 50 with 18/100 (500) it is +250, and 18/200 gives +625.

```c
levels = lev - class spell_first + 1;                 /* 0 if negative: no mana yet */
msp = 1 + adj_mag_mana[spell stat] * levels / 100;
armour_weight = sum of weights of body/cloak/shield/hat/gloves/boots   (tenths of lb)
if ((armour_weight - class spell_weight) / 10 > 0) {
    cumber_armor = true;
    msp -= (armour_weight - spell_weight) / 10;      /* 1 SP per pound over the allowance */
}
msp = MAX(msp, 0);
```

A level 25 Mage with 18/30 INT (index 18, 180): `msp = 1 + 180 * 25 / 100 = 46`. Wearing 35 lb of armour against the Mage allowance of 30 lb costs `(350 - 300) / 10 = 5` SP, leaving 41. A level 4 Rogue (spell_first 5) has `levels = 0` and no mana. Rings, amulets, lights, weapons and launchers never count as armour weight.

The number of spells a caster may know is `(adj_mag_study[stat] * levels + 50) / 100`, i.e. rounded to nearest (`calc_spells()`); a level 5 Mage with INT 17 (105) may know `(525 + 50) / 100 = 5` spells. `calc_spells()` also forgets spells (last learnt first) when the allowance drops, remembers them when it rises, and caps the allowance at the number of learnable spells of level ≤ the character's. The spell-learning rules themselves are in the Magic chapter.

## 4.10 Light

`calc_light()` sums, over all equipped items, `2` for `LIGHT_2`, `3` for `LIGHT_3`, plus the item's LIGHT modifier (which can be negative). A light source (`tval` light) that needs fuel and has `timeout == 0` gives nothing. UNLIGHT characters subtract one from any positive LIGHT modifier, so a +1 light item leaves them dark but a +2 one lights them. In town during the day the radius is 0 and the level itself is lit. The radius is what `update_view()` uses to decide which grids the player's own light reaches; `cur_light` can be negative, which is how the Necromancer's Unlight and cursed "darkness" items work (see the Vision chapter).

## 4.11 Digging and unlocking

```c
chance[RUBBLE]  = digging * 8;
chance[MAGMA]   = (digging - 10) * 4;
chance[QUARTZ]  = (digging - 20) * 2;
chance[GRANITE] = (digging - 40) * 1;
chance[DOORS]   = (digging * 4 - 119) / 3;    /* "approximately 1/1200 per skill point over 30" */
```

Each is clamped at 0; the tunnelling code succeeds when `randint0(1600) < chance` (see the Movement chapter). Digging skill is `race + adj_str_dig + 20 per TUNNEL point + 20/40/60 for shovels/picks/mattocks + weapon weight in lb`, so a Dwarf (40) with 18/50 STR (25) wielding a 12 lb weapon has 40 + 25 + 12 = 77: rubble 616/1600 per turn, magma 268, quartz 114, granite 37.

```c
unlock_chance = MAX(2, disarm_phys / (blind or unseen ? 10 : 1) / (confused or hallucinating ? 10 : 1) - 4 * lock_power);
```

is a percentage. A level 10 Rogue (45 + 20 = 65 plus a DEX bonus of, say, 3 = 68) against a lock of power 5 has 48%; a Warrior with 40 against power 7 has 12%.

## 4.12 Timed effect and hunger modifiers

Applied in `calc_bonuses()`; durations and how they are acquired are in the Timed Effects chapter.

| Timed effect | Modifier |
|---|---|
| Stun ("Stun" grade) | to-hit −5, to-dam −5, device −10%; cancels FASTCAST |
| Heavy Stun | to-hit −20, to-dam −20, device −20% |
| Invulnerability (`INVULN`) | to-AC +100 |
| Blessed | to-AC +5, to-hit +10, device +5% |
| Shield | to-AC +50 |
| Stoneskin | to-AC +40, speed −5 |
| Hero | to-hit +12, device +5% |
| Berserk (`SHERO`) | melee skill +75, to-AC −10, device −10% |
| Fast, Sprint | speed +10 |
| Slow | speed −10 |
| Terror | speed +10 (but the AFRAID flag applies) |
| Infravision (`SINFRA`) | infravision +5 |
| Temporary resistances (`OPP_*`) | element resist level +1, to a maximum of 2 |
| Confused | device −25% |
| Amnesia | device −20% |
| Poisoned | device −5% |
| Hallucinating (`IMAGE`) | device −20% |
| Bloodlust | to-dam + bloodlust/2, extra blows + bloodlust/20 |
| Stealth (`STEALTH`) | stealth +10 |
| Afraid (any source, via the AFRAID flag) | to-hit −20, to-AC +8, device −20% |

## 4.13 Shapes

Shapechange spells (Druid and Necromancer) replace `player->shape`, and `calc_shapechange()` adds the shape's `combat:to_h:to_d:to_a`, skills, object flags, player flags, stat and other modifiers and resistances to the state. While shapechanged the player cannot use most commands (items, spells) and attacks with the shape's blow verbs.

| Shape | to-hit/to-dam/to-AC | Flags | Modifiers |
|---|---|---|---|
| fox | −3/−3/+3 | FEATHER, FREE_ACT | STR −3, STEALTH +5, BLOWS +1, MOVES +1 |
| Pukel-man | 0/+5/+20, save +20 | SUST_STR, SUST_CON, PROT_STUN, REGEN, HOLD_LIFE, player flag ROCK | STR +4, CON +4, STEALTH −2, SPEED −5, immune poison, resist shards, DAM_RED 10; cures poison and stun on change |
| bear | +15/+15/+5, disarm −5/−10, melee +10 | PROT_FEAR | STR +3, INT −2, CON +2, INFRA +1, STEALTH −3, BLOWS +1 |
| eagle | +5/0/+10 | SUST_WIS, PROT_BLIND, PROT_CONF, PROT_FEAR, SEE_INVIS, FREE_ACT, TRAP_IMMUNE | MOVES +3 |
| bat | 0/−10/+10 | FEATHER, SEE_INVIS, PROT_BLIND | SPEED +3, STEALTH +3, INFRA +5; 5 damage on change |
| warg | +5/+5/0 | – | BLOWS +2; 1d(level) damage, cures fear, berserk 5+1d20 on change |
| vampire | +3/+3/−5 | SEE_INVIS, HOLD_LIFE | LIGHT −1, STEALTH +5, INFRA +5, SPEED +5; damage HP/4 and vampiric attacks 10+1d20 on change |
| werewolf | +5/+5/0 | REGEN | BLOWS +1, MOVES +1; scares everything in view, cures fear, berserk 5+1d20 on change |

ROCK players never recover from cuts by themselves and take no bleeding damage.

## 4.14 Carrying capacity

`weight_limit() = adj_str_wgt[STR] * 100` tenths of a pound (a 30 in the table is 300 lb). The speed penalty in 4.4 step 11 begins at half that. The inventory screen's "Burden ... (x lb remaining/overweight)" figure uses `weight_remaining() = 60 * adj_str_wgt - total_weight - 1`, i.e. 60% of the limit, which does *not* coincide with the point where slowing starts (50%); a character shown with a few pounds "remaining" may already be at −1 speed. Pack weight includes the quiver and all equipment.

## 4.15 Update flags

| Flag | Set when | Effect |
|---|---|---|
| `PU_BONUS` | Equipment, stats, level, timed effect, hunger grade or shape changes | `update_bonuses()` |
| `PU_HP` | CON index changed, level changed, new level entered | `calc_hitpoints()` |
| `PU_MANA` | Any stat index changed, level changed, armour changed | `calc_mana()` |
| `PU_SPELLS` | As above, for casters | `calc_spells()` |
| `PU_TORCH` | Light source changed or burnt out | `calc_light()` |
| `PU_INVEN` | Pack contents changed | `calc_inventory()` (re-sort, quiver slots) |
| `PU_UPDATE_VIEW` | Player moved, light changed, doors/walls changed | `update_view()` |
| `PU_DISTANCE` | Player moved or teleported | recompute monster distances and visibility |
| `PU_MONSTERS` | Telepathy/see-invisible/light changed | recompute monster visibility |
| `PU_PANEL` | Player moved | scroll the map panel if needed |
