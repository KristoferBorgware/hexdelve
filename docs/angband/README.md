# The Angband Bible

A mechanics reference for **Angband 4.2.6**, written from the source code
(git `00c9414`, <https://github.com/angband/angband>) and the gamedata
files in `lib/gamedata/`. Every chapter cites the C function or data
file it was derived from, gives the exact formula, and works an example.
Where the code does something surprising (the flat 24 % monster spell
failure rate, the `MIN`/`MAX` quirk behind it, the absence of jammed
doors at generation) the bible documents what the code *does*, not what
the comments or older versions said.

## Chapters

| # | Chapter | What it covers |
|---|---|---|
| 1 | [Overview and architecture](01-overview-architecture.md) | source layout, the three core structures, startup, command queue, main loop, files, the RNG and `m_bonus`, directions |
| 2 | [Time, turns, energy and speed](02-time-energy-speed.md) | game vs player turns, the speed→energy table, who acts when, energy costs, days, resting, repeating |
| 3 | [Character creation](03-character-creation.md) | the birth sequence, races, classes, stat representation (18/xx), point-buy, rolling, hit dice, history, money, birth options |
| 4 | [Player stats and derived values](04-player-stats-derived-values.md) | `calc_bonuses`, the 38-row adjustment tables, skills, AC, blows per turn, shots, hp and mana, light, digging, unlocking, hunger and timed modifiers, shapes, carrying capacity |
| 5 | [Experience and levelling](05-experience-levelling.md) | the experience table, `mexp × level / plev`, fractional experience, learning XP, drain and restoration |
| 6 | [Movement, terrain and vision](06-movement-terrain-vision.md) | geometry and distance, terrain flags, walking, running, doors, tunnelling, stairs, field of view, light, monster visibility, noise and scent maps |
| 7 | [Melee combat](07-melee-combat.md) | the hit test, the attack round, slays and brands, critical hits, shield bashes, monster blows against the player, damage to monsters and pain messages, taking damage |
| 8 | [Ranged combat, throwing and projection](08-ranged-combat-projection.md) | launchers and ammo, missile flight, hit and damage, throwing, the projection engine (bolts, beams, balls, arcs), projection types, terrain and object effects, targeting |
| 9 | [Magic, effects and devices](09-magic-effects-devices.md) | realms and books, casting and failure, the effect system, every class spell table, devices and consumables, class mechanics |
| 10 | [Elements, resistances and damage](10-elements-resistances-damage.md) | resistance levels, `adjust_dam` fractions, side effects per element, blocking status effects, inventory damage, protective flags |
| 11 | [Timed effects, food and recovery](11-timed-effects-food-recovery.md) | counters, grades and messages, every timed effect, the world tick, food and digestion, regeneration, over-exertion, light fuel |
| 12 | [Monsters I: data, generation and AI](12-monsters-data-generation-ai.md) | `monster.txt`, race and instance flags, allocation and out-of-depth rolls, placement (hp, speed, sleep), escorts and groups, waking vs stealth, the monster turn, doors, pathing by noise and scent, fleeing and surrounding, regeneration, fear from damage, pits and nests |
| 13 | [Monsters II: spells, summoning, lore and drops](13-monsters-spells-summoning-lore-drops.md) | spells as effects, damage table, casting chance, spell filtering, the 24 % failure rate, hit rolls and saves, breath geometry, summoning types and the level budget, lore thresholds, what monsters learn, drop counts and levels, Morgoth's drop, mimics |
| 14 | [Objects](14-objects.md) | the object model, random values, properties and their power, allocation tables, `make_object` and `apply_magic`, enchantment, egos, artifacts, gold, curses and their removal, value and power, rune-based knowledge, ignoring |
| 15 | [Equipment, inventory, quiver and the floor](15-equipment-inventory.md) | the gear list and its three views, pack slot accounting, quiver layout, stacking rules, carrying and pickup, wield/take off/drop, breakage, weight and burden, the floor, inventory damage |
| 16 | [Dungeon generation](16-dungeon-generation.md) | constants, profile choice, room rarity rolls, classic and modified builders, tunnels, streamers, stairs and population, vaults and their symbols, pits and nests, doors, caverns, labyrinths, moria, lair, gauntlet, hard centre, persistent levels, level feelings |
| 17 | [Traps, doors, rubble, digging and chests](17-traps-doors-chests.md) | trap data and the trap list, where traps come from, finding and triggering, disarming, doors and locks, digging chances per terrain, chest traps, opening, disarming and contents |
| 18 | [Stores and the town](18-stores-town.md) | town layout, day and night, `store.txt`, prices, buying, selling, stock maintenance and the black market, the home |
| 19 | [The world loop, level changes, quests, death and scoring](19-world-quests-death-scoring.md) | `process_world` step by step, levels and stairs, recall and deep descent, the Sauron and Morgoth quests, death and retirement, the score formula, character history, savefile format, birth options |
| 20 | [Gamedata file reference](20-gamedata-reference.md) | every file in `lib/gamedata/`: what it defines, its fields, and which chapter explains it |
| 21 | [Commands, keys and options](21-commands-options.md) | how commands run, the full key list in both keysets with energy costs, repeat counts, every option and its default, keymaps |

## Formula cheat-sheet

Constants are from `constants.txt` unless noted; `plev` = character
level, `depth` = dungeon level.

| What | Formula | Chapter |
|---|---|---|
| Energy per game turn | `turn_energy(speed)` table: 10 at +0, 20 at +10, 30 at +20, 38 at +30, capped 49 | 2.2 |
| Player turn | acts when energy ≥ 100 (`move-energy`) | 2.3 |
| Stat index | value 3–18 → 0–15; 18/xx → 16 + xx/10, max 37 | 4.2 |
| Blows per turn | `blows_table[weight index][dex index]`, capped by class `max-attacks`, +extra blows | 4.7 |
| Experience needed | `player_exp[lev−2] × expfact / 100` | 5.1 |
| Kill experience | `mexp × mlevel / plev` (+ fractional carry) | 5.3 |
| Melee hit chance | `0.12 + 0.83 × max(0, chance − 2·AC/3) / chance`, chance = skill + (to_h)·3 | 7.1 |
| Critical (melee) | power = weight + (to_h + debuff)·5 + skill·1 − 60, roll 5000; 2×/3×/4× tiers at 400/700/900/1300 | 7.5 |
| Missile damage | `(dice + to_d) × multiplier`, crits from weight and skill | 8.3 |
| Spell failure | `base − 3 × (plev − slevel)` adjusted by stat, min per class, ×2 stunned, encumbrance | 9.2 |
| Device failure | `380 − 370·x/(5+|x|)` per 1000 with x = skill − 2·level | 9.5 |
| Resisted damage | `dam × numerator / denominator` from `projection.txt` (1/3 for basics, 1/9 doubled) | 10.2 |
| Breath damage | `monster current hp / divisor`, capped per element (1600 fire…) | 10.2, 13.3.4 |
| Digestion | every 100 game turns: `turn_energy(speed) × 100 / 100`, ×2 REGEN, ÷2 SLOW_DIGEST | 11.4 |
| HP regeneration | `player_regen_hp`: percent of max by food grade and rest, `PY_REGEN_*` | 11.5 |
| Monster alloc weight | `(100 / rarity) × (1 + level/10)`; 1-in-25 boost `+min(level/4+2, 10)`; 60 % re-pick deeper, 10 % third pick | 12.2 |
| Monster hp | `Rand_normal(avg, (avg×10/8 + 5)/10)`; uniques exact | 12.3 |
| Monster sleep | `2 × sleep + 1d(10 × sleep)` | 12.3 |
| Wake step chance | `cbrt(2^(30−stealth)) / 1024` per monster turn | 12.4 |
| Escort count | `dice × (depth − friend level + 5) / 10` when < 10 | 12.3.1 |
| Fear from damage | at ≤ 10 % hp (`1d10 ≥ %`) or a hit ≥ remaining hp (80 %) → `1d10 + 20` or `+ (11 − %)×5` | 12.8 |
| Monster spell chance | `spell-freq` % per turn, ×2 at best range, ÷2 taunted | 13.2 |
| Monster spell failure | 24 % (+20 afraid, +50 confused); innate never fails | 13.3.2 |
| Monster spell hit | `test_hit(level × 3 + hit, AC)` | 13.3.3 |
| Summon level | `get_mon_num((depth + summoner level)/2 + 5)`; budget `depth × rlev` in level² | 13.4 |
| Drop count | DROP_20/40/60 chances, DROP_1 +1, DROP_2 1–3, DROP_3 2–4, DROP_4 2–6; level `max((mlevel + depth)/2, mlevel)`, uniques `+15` | 13.6 |
| Object level boost | 1 in 20: `1 + level × 100 / randint1(100)` | 14.2 |
| Good / great | `33 + level` % good, then 30 % great; artifact rolls 1/2/+2 | 14.3.1 |
| Enchantment | `to_h/to_d += 1d5 + m_bonus(5, lev)` (+`m_bonus(10)` at great); `to_a` likewise | 14.3.2 |
| Ego eligibility | `level ≤ max` and (`level ≥ min` or `1 in max(2, (min − level)/3)`) | 14.4.2 |
| Artifact chance | `1 in 2(min − depth)` above min depth, then `alloc_prob` % | 14.5.2 |
| Gold pile | `rand_spread(16·lev/10 + 16, lev + 10)`, ×10 while 1-in-100, ×5 no-selling | 14.6 |
| Curse power | `1d9 + 10 × m_bonus(9, lev)`; removal needs strength ≥ power; power ≥ 100 permanent | 14.7 |
| Object value | `power × (power + 5)`; ammo and torches ÷ 20 | 14.8.2 |
| Pack slots | stacks + ⌈quiver ammo / 40⌉ (throwing weapons count 5 each), max 23 | 15.1.1 |
| Burden | `limit = adj_str_wgt × 100`; speed −1 per `limit/10` above `limit/2` | 15.6 |
| Breakage | `break %` on hit, `break² / 100` on miss; artifacts 0 | 15.5 |
| Level size | `randint1(10) + depth/24` → 75 … 100 % | 16.3.1 |
| Room rarity | `randint0(unusual) < 50 + depth/2` per step, up to `max rarity` | 16.2.2 |
| Greater vault | first room only, `(2/3)^((90 − depth)/10)` | 16.4 |
| Level monsters | `14 + 1d8 + max(min(depth/3, 10), 2)` | 16.3.5 |
| Danger feeling | `mon_rating / depth` bands 7000/4500/2500/1500/800/400/150/50 | 16.9 |
| Treasure feeling | `obj_rating / depth` bands 160000/40000/10000/2500/640/160/40/10 | 16.9 |
| Trap disarm | `max(2, skill − depth/5)` %; second roll harmless; else triggers | 17.5 |
| Lock picking | `max(2, DISARM_PHYS − 4 × lock power)` % | 17.6 |
| Digging | chance/1600: rubble `8·D`, magma `4(D−10)`, quartz `2(D−20)`, granite `D−40`, doors `(4D−119)/3` | 17.7 |
| Chest contents | wooden 1, iron 2, steel 3 items, *good*, level `origin + 5`, *great* if Large | 17.8.4 |
| Store sell price | `real value` (×3 black market); buy price `min(real, known) × 2/3` (÷2 black market), purse cap | 18.3 |
| Store item level | `rand_range(1, 5 + max(max_depth − 20, 0))`; black market `max_depth + 5 … + 20` | 18.6 |
| Wandering monster | 1 in 500 per world tick, beyond 25 grids | 19.1 |
| Word of Recall | `15 + randint0(20)` turns | 19.2 |
| Deep Descent | `3 + 1d4` turns, to `max_depth + 5` (quest-limited) | 19.2 |
| Score | `max_exp + 100 × max_depth` | 19.5 |

## Glossary

| Term | Meaning |
|---|---|
| **AC** | armour class; the player's total is base `ac` + `to_a` of all equipment plus stat and shape bonuses |
| **alloc** | allocation: the commonness and depth range of a monster, object, ego, artifact, vault or profile |
| **blow** | one melee attack; players get several per turn, monsters have up to four per turn each with its own method and effect |
| **brand / slay** | damage multipliers against monsters lacking an immunity / having a race flag |
| **chunk** | one level (`struct chunk`), stored and restored when levels persist |
| **depth** | the dungeon level number; also the object/monster "level" used for generation |
| **dice** | `XdY` damage rolls; `randcalc` evaluates `base+XdY+Mz` expressions |
| **effect** | the unit of magic: spells, devices, traps, monster spells and curses are chains of effects |
| **energy** | accumulated per game turn by speed; 100 buys one action |
| **flavour** | the random appearance of potions, scrolls, wands, staves, rods, rings, amulets, mushrooms |
| **game turn** | the smallest time unit; 10 per player turn at normal speed |
| **lore** | what the player has learned about a monster race |
| **m_bonus(z, level)** | a depth-scaled random bonus in 0…z, mean `z × level / 128` |
| **pval** | an object's "value" field: charges for wands/staves, food value, launcher multiplier, chest state, gold amount |
| **rune** | one learnable property of objects; knowledge is per rune, not per item |
| **spell power** | the level used in monster spell dice, defaulting to the monster's level |
| **tval / sval** | type value (sword, potion…) and sub-value (Long Sword, Cure Light Wounds) of an object kind |
| **unique** | a monster race with `max_num` 1 that never returns once killed |
| **world tick** | one execution of `process_world`, every 10 game turns |

## Provenance

The source tree was read at commit `00c9414` (2026-09-01) of the
`angband/angband` repository. Function names are given as
`file.c: function()` so that each claim can be checked against the
code; data values are from `lib/gamedata/` at the same commit.
