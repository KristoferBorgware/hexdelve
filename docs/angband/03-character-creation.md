# 3. Character creation

A character is a race, a class, five stats, a hit-point table rolled once at birth, a history string, an age/height/weight triple, a starting kit and 600 gold. Everything in this chapter is set up by `player-birth.c`; the interactive menus live in `ui-birth.c` but only push commands (`CMD_CHOOSE_RACE`, `CMD_BUY_STAT`, `CMD_ROLL_STATS`, `CMD_ACCEPT_CHARACTER`, ...) onto the ordinary command queue. The data comes from `p_race.txt`, `class.txt`, `history.txt`, `body.txt` and `names.txt`.

## 3.1 The birth sequence

`do_cmd_birth_init()` runs first. If a previous character exists in the save file (detected by `player->ht_birth != 0`), its race, class, stats, history, age, height, weight and name are stashed as a *quickstart* template, and a Roman-numeral suffix on the name is incremented (`find_roman_suffix_start()`, `int_to_roman()`: "Bilbo II" becomes "Bilbo III"). Otherwise the first race and class in the data files (Human Warrior) are used as defaults.

The player then goes through, in order:

1. `CMD_BIRTH_RESET` – `player_init()` wipes the player struct (keeping options), resets artifact created/seen flags, object awareness, monster `cur_num`/`max_num` (uniques get `max_num = 1`, everything else 100), lore kill counts, sets `turn = 1`, and puts the player in the "normal" shape.
2. `CMD_CHOOSE_RACE` / `CMD_CHOOSE_CLASS` – each calls `player_generate()` and then re-runs the point-buy autopicker (`generate_stats()`).
3. Stat assignment – either point-based (`CMD_BUY_STAT`, `CMD_SELL_STAT`, `CMD_RESET_STATS`) or rolled (`CMD_ROLL_STATS`, with `CMD_PREV_STATS` to return to the previous roll).
4. `CMD_NAME_CHOICE`, `CMD_HISTORY_CHOICE` (the history text can be edited by hand).
5. `CMD_ACCEPT_CHARACTER` – finalises everything (see 3.9).

`player_generate()` is the function that fleshes out a player from a race and class:

```c
p->max_lev = p->lev = 1;
p->expfact = p->race->r_exp + p->class->c_exp;   /* class c_exp is 0 for every class in 4.2 */
p->hitdie  = p->race->r_mhp + p->class->c_mhp;
p->player_hp[0] = p->hitdie;
p->mhp = p->player_hp[p->lev - 1];
get_ahw(p);                                       /* age, height, weight */
p->timed[TMD_FOOD] = PY_FOOD_FULL - 1;            /* start just under "Full" */
if (!old_history) p->history = get_history(p->race->history);
```

Note that the hit-point table is deliberately *not* rolled here, so the player cannot re-roll it by bouncing around the birth menus; it is rolled once, in `do_cmd_accept_character()`.

## 3.2 Races

All eleven races use the single "Humanoid" body from `body.txt` (12 slots: weapon, shooting, two rings, amulet, light, body, back, arm, head, hands, feet). There are no race/class restrictions: any race may be any class.

### Stat modifiers, hit die, experience, infravision

| Race | STR | INT | WIS | DEX | CON | Hit die | Exp % | Infra | Innate properties |
|---|---|---|---|---|---|---|---|---|---|
| Human | 0 | 0 | 0 | 0 | 0 | 10 | 100 | 0 | – |
| Half-Elf | 0 | +1 | -1 | +1 | -1 | 10 | 120 | 2 | SUST_DEX |
| Elf | -1 | +2 | -1 | +1 | -1 | 9 | 120 | 3 | SUST_DEX, resist light |
| Hobbit | -2 | +2 | +1 | +3 | +2 | 7 | 120 | 4 | HOLD_LIFE, KNOW_MUSHROOM |
| Gnome | -1 | +2 | 0 | +2 | +1 | 8 | 120 | 4 | FREE_ACT, KNOW_ZAPPER |
| Dwarf | +2 | -3 | +2 | -2 | +2 | 11 | 120 | 5 | PROT_BLIND, SEE_ORE |
| Half-Orc | +2 | -1 | 0 | 0 | +1 | 10 | 120 | 3 | resist dark |
| Half-Troll | +4 | -4 | -2 | -4 | +3 | 12 | 120 | 3 | SUST_STR, REGEN |
| Dunadan | +1 | +2 | +2 | +2 | +3 | 10 | 120 | 0 | SUST_CON |
| High-Elf | +1 | +3 | -1 | +3 | +1 | 10 | 145 | 4 | SEE_INVIS, resist light |
| Kobold | -1 | -1 | 0 | +2 | +2 | 8 | 120 | 5 | resist poison |

Infravision is in units of 10 feet, i.e. grids: a Dwarf sees warm-blooded monsters 5 grids away in the dark. "Resist X" is `values:RES_X[1]` in the data file, a permanent resistance level of 1 (see the Elements chapter). All racial properties are present from level 1; no race gains anything at a later level (the only level-gated flag in the game is the Warrior/Paladin fear immunity at 30, which is a class flag).

KNOW_MUSHROOM and KNOW_ZAPPER make the race automatically aware of all mushroom flavours, and all wand/staff/rod flavours respectively. SEE_ORE lets Dwarves see mineral veins with treasure on the map.

### Racial skill bonuses

These are added once, at birth, to the class base skills (there is no per-level racial component).

| Race | Disarm (phys) | Disarm (magic) | Device | Save | Stealth | Search | Melee | Shoot | Throw | Dig |
|---|---|---|---|---|---|---|---|---|---|---|
| Human | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Half-Elf | 2 | 2 | 3 | 3 | 1 | 3 | -1 | 5 | 5 | 0 |
| Elf | 5 | 5 | 6 | 6 | 2 | 6 | -5 | 15 | 15 | 0 |
| Hobbit | 15 | 15 | 18 | 18 | 4 | 6 | -10 | 20 | 20 | 0 |
| Gnome | 10 | 10 | 22 | 12 | 3 | 4 | -8 | 12 | 12 | 0 |
| Dwarf | 2 | 2 | 9 | 9 | -1 | 2 | 15 | 0 | 0 | 40 |
| Half-Orc | -3 | -3 | -3 | -3 | -1 | -3 | 12 | -5 | -5 | 0 |
| Half-Troll | -5 | -5 | -8 | -8 | -2 | -9 | 20 | -10 | -10 | 0 |
| Dunadan | 4 | 4 | 5 | 5 | 1 | 3 | 15 | 10 | 10 | 0 |
| High-Elf | 4 | 4 | 20 | 20 | 2 | 10 | 10 | 25 | 25 | 0 |
| Kobold | 10 | 10 | 5 | 0 | 3 | 10 | -5 | 10 | 10 | 0 |

### Age, height and weight

`get_ahw()`:

```c
p->age = race->b_age + randint1(race->m_age);
p->ht  = Rand_normal(race->base_hgt, race->mod_hgt);   /* normal distribution, mean and sd */
p->wt  = Rand_normal(race->base_wgt, race->mod_wgt);
```

| Race | Age | Height (in, mean ± sd) | Weight (lb, mean ± sd) |
|---|---|---|---|
| Human | 14 + 1d6 | 69 ± 10 | 165 ± 35 |
| Half-Elf | 24 + 1d16 | 71 ± 8 | 115 ± 25 |
| Elf | 75 + 1d75 | 73 ± 7 | 90 ± 10 |
| Hobbit | 21 + 1d12 | 34 ± 4 | 55 ± 5 |
| Gnome | 50 + 1d40 | 40 ± 5 | 80 ± 5 |
| Dwarf | 35 + 1d15 | 47 ± 4 | 135 ± 20 |
| Half-Orc | 11 + 1d4 | 64 ± 2 | 135 ± 15 |
| Half-Troll | 20 + 1d10 | 90 ± 16 | 240 ± 60 |
| Dunadan | 50 + 1d20 | 80 ± 6 | 190 ± 20 |
| High-Elf | 100 + 1d30 | 77 ± 6 | 190 ± 20 |
| Kobold | 15 + 1d10 | 37 ± 4 | 65 ± 5 |

Height and weight are cosmetic; the player's body weight has no effect on carrying capacity or anything else.

## 3.3 Classes

The class file gives each class stat modifiers, base skills plus a per-ten-levels increment, a hit die contribution, blows parameters, ten titles, a starting kit, flags and (for casters) a magic definition. `exp:` (a class experience surcharge) exists in the format but is not used by any 4.2 class, so the experience factor is purely racial.

### Stats, hit die and blows parameters

| Class | STR | INT | WIS | DEX | CON | Hit die | Max blows | Min weight (lb) | STR multiplier | Flags |
|---|---|---|---|---|---|---|---|---|---|---|
| Warrior | +3 | -2 | -2 | +2 | +2 | 9 | 6 | 3.0 | 5 | BRAVERY_30, NO_MANA, SHIELD_BASH |
| Mage | -3 | +3 | 0 | 0 | -2 | 0 | 4 | 4.0 | 2 | ZERO_FAIL, BEAM, CHOOSE_SPELLS |
| Druid | -2 | 0 | +3 | -2 | 0 | 2 | 4 | 3.5 | 3 | ZERO_FAIL, CHOOSE_SPELLS, CHARM |
| Priest | -1 | -3 | +3 | -1 | +1 | 2 | 4 | 3.5 | 3 | BLESS_WEAPON, ZERO_FAIL |
| Necromancer | -3 | +3 | 0 | 0 | -2 | 2 | 4 | 3.5 | 3 | ZERO_FAIL, CHOOSE_SPELLS, UNLIGHT, EVIL |
| Paladin | +1 | -3 | +1 | -1 | +2 | 6 | 5 | 3.0 | 5 | BLESS_WEAPON, SHIELD_BASH |
| Rogue | 0 | +1 | -3 | +3 | -1 | 4 | 5 | 2.0 | 4 | CHOOSE_SPELLS, STEAL |
| Ranger | 0 | 0 | +2 | +1 | -1 | 5 | 5 | 3.5 | 4 | FAST_SHOT, CHOOSE_SPELLS |
| Blackguard | +2 | 0 | -3 | 0 | +2 | 8 | 5 | 10.0 | 5 | CHOOSE_SPELLS, SHIELD_BASH, COMBAT_REGEN; object flag IMPAIR_HP |

The hit die the character actually rolls is race + class: a Half-Troll Warrior rolls d21 per level, a Hobbit Mage d7. Max blows, minimum weight and the strength multiplier feed the blows calculation described in the Player Stats chapter. The class flags are described in `player_property.txt`:

- BRAVERY_30: immune to fear from level 30 (`player_flags()` in `player.c` turns on PROT_FEAR).
- NO_MANA: cannot cast spells (it is also set at runtime on any character whose max SP is 0).
- SHIELD_BASH: may bash with a shield in melee.
- ZERO_FAIL: spell failure rate can reach 0% (others bottom out at 5%).
- BEAM: bolt spells frequently become beams.
- CHOOSE_SPELLS: the player picks which spell to learn (Priests and Paladins are given prayers in book order).
- CHARM: extra persuasive to monsters (used by some nature effects).
- BLESS_WEAPON: +2 to-dam and "attuned" status with hafted or BLESSED weapons.
- UNLIGHT: stealth in, sight in, and resistance to darkness; can use +1 light gear without giving up unlight.
- EVIL: resist nether, vulnerable to holy attacks.
- STEAL: the `s` steal command.
- FAST_SHOT: extra shots, +1/10 shot per 3 levels.
- COMBAT_REGEN: the Blackguard's inverted mana model (gain SP when hurt or attacking, SP bleed heals HP).

### Skills (base : increment per 10 levels)

A skill at level L is `race + base + increment * L / 10` (integer division, plus stat adjustments; see the Player Stats chapter).

| Class | Disarm phys | Disarm magic | Device | Save | Stealth | Search | Melee | Shoot | Throw |
|---|---|---|---|---|---|---|---|---|---|
| Warrior | 25:15 | 20:10 | 18:7 | 18:10 | 0:0 | 10:12 | 70:45 | 55:45 | 55:45 |
| Mage | 30:10 | 35:12 | 36:13 | 30:9 | 2:0 | 10:12 | 35:15 | 20:15 | 20:15 |
| Druid | 30:10 | 30:10 | 24:10 | 30:10 | 3:0 | 12:12 | 45:20 | 40:30 | 40:30 |
| Priest | 25:12 | 25:12 | 30:10 | 32:12 | 2:0 | 10:14 | 45:20 | 35:20 | 35:20 |
| Necromancer | 30:10 | 35:12 | 36:13 | 30:9 | 2:0 | 10:12 | 35:25 | 20:15 | 20:15 |
| Paladin | 20:15 | 20:10 | 24:10 | 25:11 | 0:0 | 10:12 | 65:40 | 50:30 | 50:30 |
| Rogue | 45:20 | 45:20 | 32:10 | 28:10 | 3:1 | 20:16 | 35:45 | 66:30 | 72:45 |
| Ranger | 40:15 | 30:10 | 28:10 | 32:10 | 3:0 | 15:15 | 60:40 | 72:45 | 66:30 |
| Blackguard | 20:15 | 20:10 | 24:10 | 18:10 | -1:-1 | 8:10 | 65:40 | 35:15 | 40:30 |

Digging is 0:0 for every class. The Rogue is the only class whose stealth improves with level (+1 per 10 levels); the Blackguard is the only one whose stealth gets worse.

### Titles

The title shown on the character sheet is `class->title[(lev - 1) / 5]` (`ui-player.c`), so titles change at levels 6, 11, 16, ... 46.

| Class | Titles (levels 1–5, 6–10, ..., 46–50) |
|---|---|
| Warrior | Rookie, Soldier, Swordsman, Swashbuckler, Veteran, Myrmidon, Commando, Champion, Hero, Lord |
| Mage | Novice, Apprentice, Trickster, Illusionist, Spellbinder, Evoker, Conjurer, Warlock, Sorcerer, Arch-Mage |
| Druid | Wanderer, Tamer, Nurturer, Gardener, Forester, Creator, Earth Warder, Windrider, Stormwielder, High Mystic |
| Priest | Believer, Acolyte, Devotee, Adept, Evangelist, Priest, Elder, Prophet, Patriarch, High Priest |
| Necromancer | Acolyte, Curser, Dark Student, Initiate, Slavemaster, Summoner, Controller, Commander, Dark Master, Night Lord |
| Paladin | Gallant, Keeper, Protector, Defender, Warder, Knight, Guardian, Chevalier, Paladin, Paladin Lord |
| Rogue | Vagabond, Cutpurse, Footpad, Robber, Burglar, Filcher, Sharper, Rogue, Thief, Master Thief |
| Ranger | Runner, Strider, Scout, Courser, Tracker, Guide, Explorer, Pathfinder, Ranger, Ranger Lord |
| Blackguard | Rat, Bully, Thug, Ruffian, Brigand, Raider, Tormentor, Marauder, Destroyer, Tyrant |

### Magic definitions

The `magic:first:weight:books` line gives the level at which the first spell becomes available, the armour weight allowance in tenths of a pound before spell points are lost, and the number of books. Each `book:` line names the book's tval, whether it is sold in town or found only in the dungeon, its spell count and its realm. Realms (`realm.txt`) fix the casting stat and vocabulary:

| Realm | Stat | Verb | Spell noun | Book noun |
|---|---|---|---|---|
| arcane | INT | cast | spell | magic book |
| divine | WIS | recite | prayer | prayer book |
| nature | WIS | chant | verse | nature book |
| shadow | INT | perform | ritual | shadow book |

| Class | First level | Armour allowance | Books (town/dungeon, spells) | Total spells |
|---|---|---|---|---|
| Mage | 1 | 30 lb | First Spells (T,7), Attacks and Knowledge (T,6), Magical Defences (T,6), Arcane Control (D,6), Wizard's Tome of Power (D,5) | 30 |
| Druid | 1 | 35 lb | Lesser Charms (T,6), Gifts of Nature (T,6), Creature Dominion (D,5), Nature Craft (D,5), Wild Forces (D,5) | 27 |
| Priest | 1 | 35 lb | Novice's Handbook (T,6), Cleansing Power (T,6), Healing and Sanctuary (D,6), Battle Blessings (D,5), Wrath of the Valar (D,5) | 28 |
| Necromancer | 1 | 30 lb | Into the Shadows (T,5), Dark Rituals (T,5), Fear and Torment (T,5), Deadly Powers (D,6), Corruption of Spirit (D,5) | 26 |
| Paladin | 1 | 40 lb | Novice's Handbook (T,6), Healing and Sanctuary (D,5), Battle Blessings (D,5) | 16 |
| Rogue | 5 | 35 lb | First Spells (T,7), Arcane Control (D,4) | 11 |
| Ranger | 3 | 40 lb | Lesser Charms (T,6), Nature Craft (D,5) | 11 |
| Blackguard | 1 | 60 lb | Into the Shadows (T,6), Fear and Torment (T,5), Deadly Powers (D,4) | 15 |

A hybrid class has its own spell list for a shared book (a Paladin's Healing and Sanctuary holds 5 prayers where the Priest's holds 6, a Rogue's Arcane Control 4 spells where the Mage's holds 6); the spells themselves are listed in the Magic chapter.

### Starting kit

`equip:tval:sval:min:max:eopts` gives a quantity range `rand_range(min, max)` and an option condition. The parser (`init.c: parse_class_equip()`) accepts `none`, a birth option name (the item is *omitted* when that option is on) or `NOT-option` (omitted when it is off). In 4.2.6 the only condition used is `birth_no_recall` on the Scroll of Word of Recall.

| Class | Kit |
|---|---|
| Warrior | 1–3 Rations, 1–3 Wooden Torches, Potion of Berserk Strength, Dagger, Soft Leather Armour, Scroll of Word of Recall |
| Mage | 1–3 Rations, 1–3 Torches, Rapier, Word of Recall, [First Spells] |
| Druid | 1–3 Rations, Whip, 1–3 Torches, Word of Recall, [Lesser Charms] |
| Priest | 1–3 Rations, 1–3 Torches, Mace, 2 Potions of Cure Serious Wounds, Word of Recall, [Novice's Handbook] |
| Necromancer | 1–3 Rations, Main Gauche, Word of Recall, [Into the Shadows] (no torch: Necromancers fight in the dark) |
| Paladin | 1–3 Rations, 1–3 Torches, Main Gauche, Scroll of Protection from Evil, Word of Recall, [Novice's Handbook] |
| Rogue | 1–3 Rations, 1–3 Torches, Dagger, Soft Leather Armour, Word of Recall, [First Spells] |
| Ranger | 1–3 Rations, 1–3 Torches, Main Gauche, Short Bow, 15–20 Arrows, Word of Recall, [Lesser Charms] |
| Blackguard | [Into the Shadows], 1–3 Rations, 1–3 Torches, Tulwar, Leather Shield, Word of Recall, Potion of Cure Light Wounds |

`player_outfit()` creates each item with `object_prep(obj, kind, 0, MINIMISE)` (level 0, no magic), marks it fully known and its flavour aware, deducts `object_value_real()` of the stack from the starting gold, and carries it. Then `wield_all()` wields everything that fits an empty slot (splitting one item off a stack of, say, torches). If `birth_start_kit` is off, only one food item and one light source are given and nothing else, so the player keeps almost all of the 600 gold to shop with. Gold can never go negative (`if (p->au < 0) p->au = 0`).

The player also starts knowing the "obvious" object runes: dice, armour value and the to-hit/to-dam/to-AC combat runes, plus all flags of the light, digging, throwing and curse-only types (`player_outfit()` and `do_cmd_accept_character()`), and the runes for the player's own innate flags (`player_learn_innate()`).

## 3.4 Stats: representation and limits

Internally a stat is an integer from 3 to 118. Values 3–18 are printed as is; a value v above 18 is printed as `18/` followed by `v - 18` padded to two digits (so 28 prints as `18/10`, 118 as `18/100`). The *displayed* maximum is 18/100 (internal 118), and that is the ceiling of `player_stat_inc()`. The tables in `player-calcs.c` are indexed in 38 steps (3, 4, ..., 18, then 18/00–18/09, 18/10–18/19, ..., 18/210–18/219, 18/220+), so equipment bonuses can push the *effective* stat past 18/100 up to 18/220, but the intrinsic value never exceeds 18/100.

Each stat has several values on the player:

| Field | Meaning |
|---|---|
| `stat_birth[i]` | Value chosen at birth (before race/class modifiers). |
| `stat_max[i]` | Current intrinsic maximum (raised by potions of stat gain, lowered by permanent drain). |
| `stat_cur[i]` | Current intrinsic value (lowered by temporary drain, restored by restoration or on level gain). |
| `stat_map[i]` | Which stat this one is displayed as (used by the Scramble effect of nexus). |
| `state.stat_top[i]` | `stat_max` plus race, class, equipment and shape modifiers. |
| `state.stat_use[i]` | `stat_cur` plus the same modifiers; this is what every calculation uses. |
| `state.stat_ind[i]` | The 0–37 table index derived from `stat_use`. |

Applying a modifier (`modify_stat_value()` in `player-util.c`) moves one point at a time below 18 and ten points at a time above it, so +1 to a stat of 17 gives 18, but +1 to 18 gives 18/10. Going down: values of 18/10 or more lose 10 per point, anything between 18 and 18/10 collapses to 18, and below 18 one point is lost per step, never below 3.

## 3.5 Point-based stats

Every stat starts at 10 and there are `MAX_BIRTH_POINTS = 20` points to spend. The cost of raising a stat *to* value v is `birth_stat_costs[v]`:

| To | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 |
|---|---|---|---|---|---|---|---|---|
| Cost | 1 | 1 | 1 | 1 | 1 | 1 | 2 | 4 |

So 10→17 costs 8 points and 10→18 costs 12; a base stat cannot be bought above 18 or sold below 10. The 20-point budget was chosen because "it was feasible to get base 17 in 3 stats with the autoroller" (3 × 8 = 24, but 3 × (1+1+1+1+1+1+2) = 20 for three 17s, per the comment).

Whenever the race or class changes, `generate_stats()` spends the points automatically, following a scheme discussed on the forums:

0. Buy STR up to 17. (A "pure caster", defined as `max_attacks < 5`, i.e. Mage/Druid/Priest/Necromancer, skips straight to step 3.)
1. Buy DEX up to 17, recording the DEX value at which the last extra blow appeared (`player->state.num_blows / 10` is compared after each purchase).
2. Sell DEX back down to that break point.
3. Spend up to half the remaining points on the spell stat (INT or WIS from the first book's realm) and up to half on CON, each stopping at base 16 unless the class is a pure caster (spell stat may go to 18) or a warrior (`max_attacks > 5`, i.e. Warrior only, who puts all remaining points into CON up to 16).
4. Anything left goes into DEX, then INT, then WIS (skipping the spell stat).

The player is free to redistribute afterwards. Unspent points are, in 4.2.6, worth nothing: `recalculate_stats()` computes `au_birth = 600 + 50 * points_left`, but `get_money()` in `do_cmd_accept_character()` overwrites both `au` and `au_birth` with `z_info->start_gold` (600), and `au_birth` is only ever written to the save file. This looks like a leftover from older versions where unspent points bought gold.

## 3.6 Rolled stats

`CMD_ROLL_STATS` (`get_stats()`) rolls 15 dice: for each stat, 1d3, 1d4 and 1d5. The 15 dice are rerolled until their total `j` satisfies `35 < j < 45` (i.e. 36 to 44). Each stat is then `5 + d3 + d4 + d5`, giving a range of 8 to 17 per stat and a total across the five stats of 61 to 69. Race and class modifiers are applied on top. Rolled stats lock out buying and selling (`rolled_stats = true`); `CMD_PREV_STATS` swaps back to the previous roll (one level of undo). Rolling also re-rolls age, height, weight and history "because it's tradition".

## 3.7 Hit points

The hit die is `race hitdie + class hitdie`. `player_hp[]` is a cumulative table of maximum HP per level, rolled once in `roll_hp()` when the character is accepted:

```c
min_value = (PY_MAX_LEVEL * (hitdie - 1) * 3) / 8 + PY_MAX_LEVEL;
max_value = (PY_MAX_LEVEL * (hitdie - 1) * 5) / 8 + PY_MAX_LEVEL;
do {
    player_hp[0] = hitdie;                       /* set earlier in player_generate() */
    for (i = 1; i < 50; i++)
        player_hp[i] = player_hp[i-1] + randint1(hitdie);
} while (player_hp[49] < min_value || player_hp[49] > max_value);
```

The level-50 total is thus forced to lie between 37.5% and 62.5% of the maximum possible gain plus 50 (roughly ±1 standard deviation of the expected value, since the mean of `randint1(h)` is `(h+1)/2`). For a Half-Troll Warrior (hit die 21): min = 50·20·3/8 + 50 = 425, max = 675, expected ≈ 21 + 49·11 = 560. For a Hobbit Mage (hit die 7): min = 162, max = 237.

Actual maximum HP at a given level is `player_hp[lev-1] + adj_con_mhp[CON] * lev / 100` with a floor of `lev + 1` (`calc_hitpoints()`, see the Player Stats chapter for the CON table).

## 3.8 History, name and money

`get_history()` walks the chart chain for the race in `history.txt`: at each chart it rolls 1d100 and takes the first phrase whose cutoff is ≥ the roll, appends its text, and moves to that phrase's successor chart until a chart of 0. The chart chains are documented in the data file header (Human/Dunadan: 1→2→3→50→51→52→53, Elf: 5→6→9→54→55→56, and so on). There is no social class or starting-gold effect from history in 4.2; it is flavour text only, and can be replaced by hand.

Names may be typed or generated. `names.txt` holds word lists per race; the generator builds a first-order Markov chain of letter transitions from the list and walks it from a weighted random starting letter until it hits a word end (explained in the file's own header).

Money is fixed: `get_money()` sets `au = 600` (`player:start-gold` in `constants.txt`), from which the starting kit's value is subtracted.

## 3.9 Accepting the character

`do_cmd_accept_character()` does, in order: initialise cheat options; `roll_hp()`; initialise the ignore settings; clear the message history and add the "Began the quest to destroy Morgoth." entry; `player_embody()` (copy the Humanoid body); `get_money()`; `player_spells_init()`; learn all runes if `birth_know_runes`; mark the to-hit/to-dam/to-AC runes known; `store_reset()` (stock the town) and reset the persistent-level list; `player_learn_innate()`; reparse `artifact.txt` and, if `birth_randarts`, generate a random artifact set from a fresh `seed_randart`; pick a fresh `seed_flavor` and assign flavours; make all flavours aware if `birth_know_flavors`; `player_outfit()`; set `is_dead = false`, `character_generated = true`; disable command repeat; signal `EVENT_LEAVE_BIRTH`. The player then appears in the town at depth 0.

## 3.10 Birth options

Birth options (`list-options.h`, type `OP_BIRTH`) can only be changed during birth and are stored with the character. Each one's effect, as implemented:

| Option | Default | Effect in code |
|---|---|---|
| `birth_randarts` | off | At accept, `do_randart()` replaces the standard artifact set with a randomly generated one of equivalent power (see *Objects* 14.5.4). Spoilers and knowledge screens use the randart names. |
| `birth_connect_stairs` | on | `new_player_spot()` places a staircase of the type just used under the player on arrival (`create_down_stair`/`create_up_stair` set by the stair commands). |
| `birth_force_descend` | off | `do_cmd_go_up()` prints "Nothing happens!"; deep descent and recall always take the player to `max_depth + 1` (`player_set_recall_depth()`, `effect_handler_RECALL/DEEP_DESCENT`); recall from a quest level does nothing; teleport level never goes up; the player is warned before descending onto a quest level. |
| `birth_no_recall` | off | `effect_handler_RECALL()` does nothing (unless the player has already won); the Word of Recall scroll is removed from starting kits. |
| `birth_no_artifacts` | off | `make_artifact()` and `make_artifact_special()` return nothing; no artifacts are ever generated. |
| `birth_stacking` | on | Off: `floor_carry()` refuses to put a second object on a floor grid (`!birth_stacking && n`), so drops scatter to neighbouring grids, and the floor listing shows one item. |
| `birth_lose_arts` | off | Artifacts left on a level when the player leaves are marked created (lost forever) even if never seen; the level feeling for a level containing an artifact becomes the special "10" value. |
| `birth_feelings` | on | Off: no level feeling messages or status-line indicator. |
| `birth_no_selling` | on | Stores pay 0 gold for items (the player "gives" them, still learning their flavour); in compensation `make_gold()` multiplies dungeon gold drops by 5 (`value *= 5` when `player->depth > 0`). |
| `birth_start_kit` | on | Off: only one food and one light source are given. |
| `birth_ai_learn` | on | Monsters remember which resistances the player has shown (`update_smart_learn()` in `mon-util.c`) and avoid casting spells they know are resisted (`mon-attack.c`). |
| `birth_know_runes` | off | All runes known at birth: every property of every item is identified on sight. |
| `birth_know_flavors` | off | All potion/scroll/wand/staff/rod/ring/amulet/mushroom flavours known at birth. |
| `birth_levels_persist` | off | Experimental: levels are stored when left and restored when revisited (`gen-chunk.c`); recall lets the player choose a depth; traps remember state. |
| `birth_percent_damage` | off | Experimental "O-combat": to-dam bonuses become percentage multipliers of the dice, criticals add dice instead of multiplying, minimum blows is 2 (see the Melee chapter). |

The cheat options (`cheat_hear`, `cheat_room`, `cheat_xtra`, `cheat_live`) are not birth options but are initialised at accept time; turning any on marks the character as unscorable (`noscore`), as does entering wizard/debug mode.
