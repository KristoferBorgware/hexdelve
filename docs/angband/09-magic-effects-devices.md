# 9. Magic, effects and devices

Every spell, potion, scroll, wand, staff, rod, activation, trap and monster spell in Angband is a chain of *effects*: small named operations (`BOLT`, `HEAL_HP`, `TIMED_INC`, `TELEPORT`, ...) with a dice expression and a few parameters, defined in the data files and executed by `effect_do()`. The class spell system on top of it (`player-spell.c`, `class.txt`) adds books, levels, mana, failure rates and learning; the device system (`cmd-obj.c`, `obj-util.c`) adds charges, recharge timeouts and a skill-based failure roll. This chapter covers all three.

## 9.1 Realms, books and learning spells

A caster class has a `magic:` line (first spell level, armour weight allowance, book count) and a list of books; each book has a realm (`realm.txt`: arcane/INT "cast a spell", divine/WIS "recite a prayer", nature/WIS "chant a verse", shadow/INT "perform a ritual") and its spells (`spell:name:level:mana:fail:exp`). The class tables are in the Character Creation chapter; the per-spell details are in 9.6.

How many spells a character may know at once is `calc_spells()` (Player Stats chapter): `(adj_mag_study[stat] × (level − first + 1) + 50) / 100`. `player->spell_order[]` records the order in which spells were learnt; if the allowance drops (stat drain, level loss) the most recently learnt spells are *forgotten* first and are *remembered* automatically when the allowance returns. Spells cannot be learnt above the character's level.

Learning (`do_cmd_study`, `S`) costs a turn and requires being able to cast (9.2) and a positive `new_spells` count:

- Classes with `CHOOSE_SPELLS` (Mage, Druid, Necromancer, Rogue, Ranger, Blackguard) pick a specific spell from a book (`do_cmd_study_spell()`).
- Priests and Paladins name a book and receive a *random* learnable spell from it (`do_cmd_study_book()`: reservoir sampling, each eligible spell equally likely).

Browsing a book (`b`) shows every spell with its level, mana, failure chance and an info string derived from the effect's dice (`get_spell_info()`), e.g. "dam 3d4" or "range 10".

## 9.2 Casting

`do_cmd_cast()` (`m`, or `p` — the same command) requires `player_can_cast()`: the class must have spells, the player must not be blind, in the dark (`no_light()`, i.e. own grid not seen) or confused. Amnesia does not stop casting (it only makes it much harder). If the spell costs more mana than the player has, "Attempt it anyway?" is asked. Casting takes 100 energy (75 with `TMD_FASTCAST`) whether or not it succeeds.

### Failure rate

```c
chance  = spell base fail;
chance -= 3 * (player level - spell level);
chance -= adj_mag_stat[casting stat];               /* Player Stats chapter: -5 .. +57 */
chance += 5 * (mana cost - current mana)  if short of mana;
minfail = adj_mag_fail[casting stat];               /* 99 .. 0 */
if (!ZERO_FAIL && minfail < 5) minfail = 5;
if (UNLIGHT class on a lit grid) chance += 25;
if (afraid) chance += 20;
chance = CLAMP(chance, minfail, 50);
if (stun > 50) chance += 25; else if (stun) chance += 15;
if (amnesia) chance = 50 + chance / 2;
chance = MIN(chance, 95);
```

So level and casting stat push the rate down to the stat's minimum (5% for non-ZERO_FAIL classes, i.e. Rogue, Ranger, Paladin, Blackguard; down to 0% for Mage, Druid, Priest, Necromancer with a stat of 18/200+), and stun and amnesia are added *after* the clamp so they can never be trained away.

Worked examples:

- Level 5 Mage, INT 17 (index 14: fail reduction 4, minimum 7): Magic Missile (level 1, base 22): 22 − 12 − 4 = 6 → clamped up to the minimum, 7%.
- Level 30 Priest, WIS 18/50 (index 20: reduction 10, minimum 4): Healing (level 30, base 80): 80 − 0 − 10 = 70 → clamped to 50%. At level 40 the same prayer is 80 − 30 − 10 = 40%; at level 50, 10%.
- The same Priest while stunned and afraid: 50 (clamp) + 15 = 65%.

### What happens on a cast

```c
if (randint0(100) < chance) "You failed to concentrate hard enough!"   /* mana is still spent */
else {
	effect_do(spell->effect, source_player(), NULL, &ident, true, dir, beam_chance(), 0, cmd);
	Blackguards: convert_mana_to_hp(mana cost)     /* COMBAT_REGEN */
	first successful cast: exp += spell exp * spell level, PY_SPELL_WORKED set
}
mana -= cost; if that goes below zero:
	csp = 0
	player_over_exert(FAINT, chance 100, 5 * shortfall + 1)  -> paralysed 1d(5*shortfall+1), bypasses Free Action
	player_over_exert(CON, chance 50)                        -> CON drained, permanently with probability 25%
```

`beam_chance()` is the character level for `BEAM` classes (Mage) and half the level otherwise; a `BOLT_OR_BEAM` effect becomes a beam with probability `beam + effect other` percent (Magic Missile's `other` is −10, so a level 30 Mage's missiles beam 20% of the time and a level 30 Rogue's Phase Door has nothing to beam).

Casting while shapechanged is impossible; the command offers to resume normal shape first (`player_get_resume_normal_shape()`), which the Druid and Necromancer forms need before they can cast, read or use items again.

## 9.3 The effect system

An `effect` (`effects.h`) has an index from `list-effects.h`, a dice expression, a `subtype` (an element, a timed effect, a stat, a summon type, ... depending on the effect), `radius`, `other`, `y`/`x`, a message, and a `next` pointer; data files give these as `effect:NAME:subtype:radius:other`, `dice:`, `expr:`, `effect-yx:`, `effect-msg:`. `effect_do()` walks the chain and calls each handler with a context (origin, object, direction, beam chance, device boost, the rolled dice value).

**Values.** `effect_calculate_value(context, use_boost)` returns `base + XdY` of the rolled dice (the `M` part is used separately by some handlers, e.g. as a percentage), multiplied by `(100 + boost) / 100` when the effect is a damage effect used from a device (9.5). `SET_VALUE` stores a value that every following effect in the chain uses instead of its own dice until `CLEAR_VALUE` (this is how Resistance gives the same duration to four timed effects). Dice variables (`$B`, `$D`, `$S`, `$M`) are bound to expressions over `PLAYER_LEVEL`, `PLAYER_HP`, `DUNGEON_LEVEL`, `MAX_SIGHT`, `WEAPON_DAMAGE`, `SPELL_POWER` (monster spells) and `MONSTER_PERCENT_HP_GONE`; an `expr:D:PLAYER_LEVEL:- 1 / 5 + 3` line means `D = ((level − 1) / 5) + 3`, evaluated left to right with integer arithmetic.

**Branches.** `RANDOM` with dice N picks one of the next N effects at random; `SELECT` lets the player choose (monsters and unaware uses fall back to random).

**Identification.** Each handler sets `context->ident` when the effect was noticeable; that is what makes an unknown potion, scroll, wand or rod "aware" after use (see 9.5), and what `PROJECT_AWARE` and the `_AWARE` effect variants suppress for effects the player would not perceive.

**Aiming.** Effects flagged `aim` in `list-effects.h` (bolts, balls, breaths, arcs, `TELEPORT_TO`, `COMMAND`, `MOVE_ATTACK`, ...) ask for a direction or target; unknown wands and rods that need aiming fire in a random direction if the player does not yet know the effect.

### Effect reference

Every effect in `list-effects.h`, with what its handler does (`effect-handler-general.c` unless noted; attack shapes are detailed in the Ranged chapter).

| Effect | Mechanism |
|---|---|
| RANDOM / SELECT | Branch to one of the next N sub-effects (random / player's choice). |
| DAMAGE | The player takes `value` damage (reduced by damage reduction), "killed by" the effect's message. |
| HEAL_HP | Heals `max(base + XdY, missing HP × M / 100)`; messages by amount (<5 "a little better", <15 "better", <35 "much better", else "very good"). Potions: Cure Light Wounds 20, Cure Serious 40, Cure Critical 60, Healing `300+m35` (300 or 35% of what is missing, whichever is more), *Healing* 1200; Rod of Healing 500; Priest Minor Healing `level + 10` or `level/4` percent. |
| MON_HEAL_HP / MON_HEAL_KIN | Monster spell: heal self / an injured kin (Monsters chapter). |
| NOURISH | Subtype INC_BY (0) adds `value × 100` food, DEC_BY (1) subtracts, SET_TO (2) sets ("You vomit!" if lower), INC_TO (3) raises to at least `value × 100 + 1`. Values are percent of the food scale. |
| CRUNCH | Message only ("crunches"). |
| CURE | Clears the named timed effect. |
| TIMED_SET / TIMED_INC / TIMED_INC_NO_RES / TIMED_DEC | Set / add / add ignoring resistances / subtract `value` turns of the timed effect. TIMED_INC with a non-zero `other` adds only `other` turns when the effect is already running (Haste Self: `+d20+level`, but only +5 while already hasted). TIMED_DEC with `other` removes `current / other`. Against a commanded monster target the increase is translated to the monster equivalent (confused → MON_TMD_CONF, paralysed → HOLD, blind → STUN, afraid → FEAR, amnesia → SLEEP). |
| MON_TIMED_INC | Monster spell: the caster's own timed effect (haste). |
| GLYPH | Places a glyph of warding (`WARDING`) or a decoy (`DECOY`, one at a time) on the player's clear floor grid, pushing objects aside. |
| WEB | Monster effect: webs in radius 1 (2 if spell power > 40, 3 if > 80). |
| RESTORE_STAT / DRAIN_STAT / LOSE_RANDOM_STAT / GAIN_STAT | See the Player Stats chapter. DRAIN_STAT also does `value` damage; LOSE_RANDOM_STAT drains permanently a stat other than the subtype. |
| RESTORE_EXP / GAIN_EXP | Experience chapter. |
| DRAIN_LIGHT | Drains `value` turns of fuel from the wielded light (to a minimum of 1). |
| DRAIN_MANA | Drains `value` SP; a monster caster heals 6 × the SP drained. |
| RESTORE_MANA | Restores `value` SP, or all if no value. |
| REMOVE_CURSE | Pick a cursed item and a curse of it; if `strength >= curse power` the curse is removed; a power of 100+ is permanent; otherwise the item becomes FRAGILE, and a fragile item is destroyed with 1 in 4 chance (5d5 damage to the player). |
| RECALL / DEEP_DESCENT / ALTER_REALITY | Set the recall timer to 15 + 1d20 turns; set `deep_descent` to 3 + 1d4 turns, after which the player drops to `max_depth + 5` (stopping at a quest level); regenerate the current level. World Loop chapter. |
| MAP_AREA | Memorises all non-wall grids and their adjacent walls in a rectangle of ±y/±x (from `effect-yx` or the dice: Sense Surroundings maps 22×44 grids, or 44×88 at level 30+), except NO_MAP grids (vaults). |
| READ_MINDS | MAP_AREA around every monster currently detected. |
| DETECT_TRAPS / DOORS / STAIRS / ORE / GOLD / OBJECTS | Reveal the things in the ±y/±x rectangle (typically 22 × 40); traps also mark the rectangle DTRAP (the "trap-detected" border). SENSE_GOLD / SENSE_OBJECTS show that *something* is there without identifying it. |
| DETECT_LIVING / VISIBLE / INVISIBLE / FEARFUL / EVIL / SOUL MONSTERS | Mark matching monsters in the rectangle (`MFLAG_MARK`, shown until the player's next turn). |
| IDENTIFY | Learn one unknown rune on a chosen item. |
| CREATE_STAIRS | A staircase under the player (not with persistent levels). |
| DISENCHANT | Pick a random armour or weapon slot (rings, amulets, lights excluded); artifacts resist 60%; −1 to-hit and to-dam (weapons/launchers) or −1 to-AC, with a further −1 20% of the time if above +5. |
| ENCHANT | For each point of `value`, try `enchant_score()` on to-hit, to-dam (`TOBOTH`/`TOHIT`/`TODAM`) or to-AC: the attempt fails with probability `enchant_table[current] / 1000` (0, 1%, 2%, 4%, 8%, 16%, 28%, 40%, 55%, 70%, 80%, 90%, 95%, 97%, 99% for +0..+14, 100% above +15); artifacts also resist 50% per point; a stack of n items gets only a 1-in-n chance per point (ammo 20-in-n). |
| RECHARGE | Wand or staff; failure chance is `1 in (strength + (100 − item level)/10 − 2 × charges per item)`, minimum "1 in 1" (certain), which destroys the item; success adds `2 + 1d(strength / (10 − ease) + 1)` charges where `ease = (100 − level) / 10`. |
| PROJECT_LOS / PROJECT_LOS_AWARE | Apply the projection type to every monster in line of sight / in view (dispel, turn, sleep, mass banishment effects). |
| ACQUIRE | `acquirement()`: `value` "great" objects on the player's grid. |
| WAKE | Wake every sleeping monster within 40 grids, making it aware with chance `100 − 2 × distance`. |
| SUMMON | Summon up to `value` monsters of the subtype at `depth + other` (monster casters: keep summoning while the total "summoned level²" is below `depth × caster level`; Monsters chapter). |
| BANISH | Ask for a monster symbol; every non-unique monster of that symbol is removed, costing the player 1d4 HP each. |
| MASS_BANISH | Every non-unique monster within radius (20) removed, 1d3 HP each. |
| PROBE | Reports current HP of every visible monster and teaches its full lore. |
| TELEPORT | Distance `base + XdY`, or `M` percent of the distance to the farthest level edge; the actual distance is varied by ±25%, and a destination is drawn uniformly from the grids whose distance is closest to that (vault grids only if nothing else fits). Not allowed from a NO_TELEPORT grid (except short hops ≤ 10) or with the NO_TELEPORT flag; landing grids must be passable, empty, trap-free, not damaging, not webbed, not a shop. |
| TELEPORT_TO | Dimension Door: pick a target grid; land as close to it as possible (expanding search radius; 10 if the target is in a vault). Monster version pulls the player next to the caster. |
| TELEPORT_LEVEL | Up or down one level at random (down only on quest levels' neighbours, with force_descend, or in town; never down from a quest level). Nexus resistance blocks the monster version. |
| RUBBLE | 1d3 rubble grids (half passable) among the player's empty neighbours. |
| GRANITE | A granite wall behind the player (monster effect). |
| DESTRUCTION | Radius `r` around the player: monsters deleted, objects destroyed (artifacts lost if known or `birth_lose_arts`), terrain randomised, map forgotten; blinds 10 + 1d10 unless the subtype element (light or dark) is resisted. Not in town. |
| EARTHQUAKE | Radius `r` (max 15): each grid has 15% chance to be rebuilt; the player on an affected grid is either crushed for 300 (no safe grid), or 1 in 3 dodges, else takes 10d4 and 1d50 stun and is moved; monsters without PASS/KILL_WALL take 4d8 or die if they cannot be moved. Rooms and vaults lose their flags. |
| LIGHT_LEVEL / DARKEN_LEVEL | `wiz_light()`/`wiz_dark()`: light and map (Clairvoyance) or darken the whole level. |
| LIGHT_AREA / DARKEN_AREA | Light or darken the room the player is in; DARKEN_AREA blinds a non-dark-resistant player for 3 + 1d5. |
| SPOT, SPHERE, BALL, BREATH, ARC, SHORT_BEAM, LASH, SWARM, STRIKE, STAR, STAR_BALL, BOLT, BEAM, BOLT_OR_BEAM, LINE, ALTER, BOLT_STATUS, BOLT_STATUS_DAM, BOLT_AWARE, TOUCH, TOUCH_AWARE | Projection shapes; see the Ranged Combat chapter. BALL's `other` grows the radius by `level / other` for player casts. |
| CURSE_ARMOR / CURSE_WEAPON | Body armour −1d3 AC (or weapon set to −1d3/−1d3) and 1d3 random curses of power `10 × m_bonus(9, depth)`; artifacts resist 50%. |
| BRAND_WEAPON / BRAND_AMMO / BRAND_BOLTS | Turn the item into the "of Flame"/"of Frost"(/"of Venom") ego via `brand_object()`. |
| CREATE_ARROWS | Turns a staff into arrows (Ranger). |
| TAP_DEVICE | Drains a wand or staff: SP gained is `(5 + item level) × 3 × charges / 2`. |
| TAP_UNLIFE | Damages the nearest undead for `value` and gives the player that much SP. |
| SHAPECHANGE | Assume the named shape (Player Stats chapter), running the shape's own effects. |
| CURSE | Direct damage to a targeted monster (Necromancer's Curse). |
| COMMAND | Take control of the targeted monster for `value` turns unless `1d(player level) < 1d(monster level)`. |
| JUMP_AND_BITE, MOVE_ATTACK, SINGLE_COMBAT, MELEE_BLOWS, SWEEP | Necromancer/Blackguard/Paladin melee tricks: teleport to the nearest living monster and bite; move up to 4 grids and strike `value` blows; enter a one-on-one arena level; strike `value` blows with a projection type on hit; strike `value` blows at every adjacent monster. |
| BIZARRE / WONDER | Wonder rolls `1d100 + level / 5` (from the item's dice) and maps it onto a table from "clone monster" (< 8) through bolts and balls of increasing power up to earthquake (101–103), destruction (104–105), banishment (106–107) and dispel-all 120 (108–109). |
| SET_VALUE / CLEAR_VALUE | Fix / release the shared value for the rest of the chain. |
| SCRAMBLE_STATS / UNSCRAMBLE_STATS | Shuffle the five stats (`stat_map` remembers the permutation) / restore them. |

## 9.4 Spell tables

Fields: level / mana / base fail % / first-cast experience (× level). Damage uses `L` for the caster's level, `M` for `m_bonus`. Books shared between classes have different spell lists per class.

### Mage (arcane, INT)

| Spell | Lv | Mana | Fail | Exp | Effect |
|---|---|---|---|---|---|
| **First Spells** | | | | | |
| Magic Missile | 1 | 1 | 22 | 4 | Bolt or beam (chance L − 10) of missile, `((L−1)/5 + 3)d4` |
| Light Room | 1 | 2 | 26 | 4 | Light the room; sphere of weak light radius 2 |
| Find Traps, Doors & Stairs | 1 | 1 | 20 | 2 | Detect traps, doors, stairs in 22×40 |
| Phase Door | 2 | 2 | 22 | 4 | Teleport 10 |
| Electric Arc | 2 | 2 | 34 | 4 | Short beam of lightning, length 1 + L, `((L−1)/5 + 3)d6` |
| Detect Monsters | 3 | 2 | 24 | 4 | Detect visible monsters |
| Fire Ball | 6 | 5 | 33 | 5 | Fire ball radius 2, `2L` |
| **Attacks and Knowledge** | | | | | |
| Recharging | 5 | 5 | 28 | 6 | Recharge, strength `L/8 + 6` |
| Identify Rune | 8 | 7 | 25 | 8 | Identify one rune |
| Treasure Detection | 10 | 3 | 60 | 5 | Detect ore, sense gold and objects |
| Frost Bolt | 13 | 5 | 40 | 6 | Bolt or beam of cold, `((L−5)/3 + 6)d8` |
| Reveal Monsters | 15 | 6 | 40 | 8 | Detect visible and invisible monsters |
| Acid Spray | 20 | 5 | 30 | 12 | Arc of acid, radius 10, 60°, `(L/2)d8` |
| **Magical Defences** | | | | | |
| Disable Traps, Destroy Doors | 5 | 5 | 30 | 6 | Kill doors and traps in the adjacent grids |
| Teleport Self | 7 | 6 | 35 | 5 | Teleport `M = 9L/5` percent of the level |
| Teleport Other | 15 | 10 | 30 | 12 | Bolt of teleport-away, distance `3L` |
| Resistance | 20 | 20 | 65 | 20 | Temporary acid, elec, cold, fire resistance for 20 + 1d20 |
| Tap Magical Energy | 22 | 2 | 30 | 12 | Drain a device for mana |
| Mana Channel | 25 | 10 | 50 | 20 | Fast casting 5 + 1d5 |
| **Arcane Control** | | | | | |
| Door Creation | 13 | 9 | 40 | 12 | Doors in all adjacent grids |
| Mana Bolt | 25 | 8 | 60 | 30 | Bolt or beam of missile, `(L−10)d8` |
| Teleport Level | 28 | 17 | 65 | 20 | Teleport level |
| Detection | 30 | 10 | 70 | 30 | Detect everything in 22×40 |
| Dimension Door | 35 | 30 | 80 | 40 | Teleport to a chosen grid |
| Thrust Away | 40 | 12 | 90 | 40 | Short beam of force, length 1 + L/10, `Ld8` |
| **Wizard's Tome of Power** | | | | | |
| Shock Wave | 20 | 5 | 40 | 16 | Sound ball radius 2, `2L` |
| Explosion | 30 | 10 | 50 | 20 | Shard ball radius 2, `2L`, then force ball radius 2, `L/5` |
| Banishment | 35 | 45 | 95 | 25 | Banish a monster symbol |
| Mass Banishment | 40 | 75 | 90 | 100 | Mass banishment |
| Mana Storm | 45 | 16 | 85 | 200 | Mana ball radius 3, `2L + 300` |

### Druid (nature, WIS)

| Spell | Lv | Mana | Fail | Exp | Effect |
|---|---|---|---|---|---|
| **Lesser Charms** | | | | | |
| Detect Life | 1 | 1 | 23 | 2 | Detect living monsters |
| Fox Form | 1 | 2 | 20 | 10 | Shapechange: fox |
| Remove Hunger | 2 | 2 | 25 | 2 | Food to at least 50% |
| Stinking Cloud | 3 | 2 | 27 | 4 | Poison ball radius 2, `L/2 + 10` |
| Confuse Monster | 5 | 3 | 30 | 5 | Bolt of confusion, `5 + 1d(L−5)` |
| Slow Monster | 6 | 4 | 30 | 5 | Bolt of slowing, `5 + 1d(L−5)` |
| **Gifts of Nature** | | | | | |
| Cure Poison | 4 | 4 | 30 | 4 | Cure poison |
| Resist Poison | 7 | 6 | 32 | 5 | Temporary poison resistance 20 + 1d20 |
| Turn Stone to Mud | 8 | 3 | 25 | 5 | Line of stone-to-mud, 20 + 1d30 |
| Sense Surroundings | 9 | 4 | 35 | 6 | Map 22×44 (44×88 from level 30) |
| Lightning Strike | 12 | 6 | 35 | 8 | Strike: elec `(L/4)d4` radius 0, then sound `L + 5` radius 3 |
| Earth Rising | 14 | 5 | 40 | 12 | Short beam of shards length 4 + L/5, `(L/3 + 2)d6` |
| **Creature Dominion** | | | | | |
| Trance | 20 | 10 | 45 | 15 | Hold all adjacent monsters `3 + 1d(L/7)` |
| Mass Sleep | 25 | 15 | 50 | 15 | Sleep all in LOS, power `10L + 500` |
| Become Pukel-man | 30 | 20 | 75 | 50 | Shapechange |
| Eagle's Flight | 35 | 20 | 80 | 80 | Shapechange |
| Bear Form | 40 | 20 | 85 | 100 | Shapechange |
| **Nature Craft** | | | | | |
| Tremor | 20 | 20 | 60 | 16 | Targeted earthquake radius 4 |
| Haste Self | 25 | 12 | 65 | 15 | Haste `L + 1d20` (+5 if already hasted) |
| Revitalize | 35 | 70 | 90 | 90 | Restore all stats and experience |
| Rapid Regeneration | 37 | 20 | 90 | 100 | HEAL timed effect 5 + 1d3 |
| Herbal Curing | 40 | 20 | 90 | 100 | Cure cuts, poison, stun, Black Breath; food to 80% |
| **Wild Forces** | | | | | |
| Meteor Swarm | 30 | 14 | 85 | 20 | `M = L/20 + 2` meteor balls radius 1, `L/2 + 30` each |
| Rift | 35 | 20 | 60 | 25 | Gravity beam `40 + Ld7` |
| Ice Storm | 37 | 25 | 75 | 24 | Ice on every monster in LOS, `3d(3L)` |
| Volcanic Eruption | 40 | 30 | 75 | 50 | Fire sphere radius 5, `3L/2 + 1d(3L)`; earthquake radius 5 |
| River of Lightning | 43 | 35 | 75 | 100 | Plasma arc 20°, `(L + 10)d8` |

### Priest (divine, WIS)

| Spell | Lv | Mana | Fail | Exp | Effect |
|---|---|---|---|---|---|
| **Novice's Handbook** | | | | | |
| Call Light | 1 | 1 | 10 | 2 | Light room; weak-light sphere radius 1 + L/10, `2d(L/2)` |
| Detect Evil | 1 | 1 | 10 | 4 | Detect evil monsters |
| Minor Healing | 1 | 2 | 15 | 4 | Heal `L + 10` or `(L/4)%` of missing; cut and stun −20 |
| Bless | 1 | 2 | 20 | 4 | Blessed `L + 10 + 1d(L + 10)` |
| Sense Invisible | 3 | 4 | 25 | 4 | See invisible 24 + 1d24 |
| Heroism | 5 | 2 | 30 | 5 | Heal 10, cure fear, hero `L − 19 + 1d(L − 19)` |
| **Cleansing Power** | | | | | |
| Orb of Draining | 7 | 7 | 40 | 4 | Holy orb ball radius 2 (+1 per 30 levels), `3L/2 + 3d6` |
| Spear of Light | 7 | 6 | 30 | 5 | Line of weak light 6d8 |
| Dispel Undead | 10 | 14 | 55 | 6 | Undead in LOS take `1d(5L)` |
| Dispel Evil | 12 | 20 | 70 | 10 | Evil in LOS take `1d(5L)` |
| Protection from Evil | 14 | 8 | 42 | 5 | Protection `3L + 1d25` |
| Remove Curse | 16 | 6 | 38 | 8 | Curse removal strength `L + 1dL` |
| **Healing and Sanctuary** | | | | | |
| Portal | 10 | 4 | 30 | 8 | Teleport `L/2 + 30` |
| Remembrance | 20 | 30 | 90 | 50 | Restore experience |
| Word of Recall | 25 | 30 | 75 | 10 | Recall |
| Healing | 30 | 50 | 80 | 100 | Heal 2000; cure cuts, poison, stun, amnesia |
| Restoration | 35 | 70 | 90 | 130 | Restore all stats |
| Clairvoyance | 37 | 50 | 80 | 150 | Light and map the level |
| **Battle Blessings** | | | | | |
| Glyph of Warding | 20 | 40 | 90 | 35 | Glyph |
| Smite Evil | 25 | 20 | 70 | 40 | Temporary Slay Evil 20 + 1d20 |
| Enchant Weapon | 35 | 50 | 80 | 230 | Enchant to-hit and to-dam 1d4 |
| Enchant Armour | 37 | 60 | 85 | 250 | Enchant to-AC 1 + 1d3 |
| Demon Bane | 42 | 40 | 80 | 300 | Temporary ×5 slay demon 20 + 1d20 |
| **Wrath of the Valar** | | | | | |
| Banish Evil | 25 | 25 | 80 | 250 | Teleport away 100 all evil in LOS |
| Word of Destruction | 35 | 35 | 80 | 115 | Destruction radius 15 (light) |
| Holy Word | 39 | 32 | 95 | 20 | Dispel evil `1d(4L)`, heal 1000, cure fear, poison, stun, cuts |
| Spear of Oromë | 40 | 10 | 75 | 130 | Holy orb beam `(L/2)d8` |
| Light of Varda | 42 | 40 | 85 | 200 | Light ball radius 4, `5L`; weak light 100 on all in LOS |

### Necromancer (shadow, INT)

| Spell | Lv | Mana | Fail | Exp | Effect |
|---|---|---|---|---|---|
| **Into the Shadows** | | | | | |
| Nether Bolt | 1 | 1 | 22 | 2 | Nether bolt `(L/4 + 3)d4` |
| Sense Invisible | 2 | 4 | 25 | 3 | See invisible 24 + 1d24 |
| Create Darkness | 3 | 3 | 10 | 4 | Darken room; weak-dark sphere radius 1 + L/10 |
| Bat Form | 3 | 4 | 20 | 10 | Shapechange |
| Read Minds | 4 | 4 | 10 | 6 | Detect souls; map around detected monsters |
| **Dark Rituals** | | | | | |
| Tap Unlife | 7 | 0 | 50 | 3 | Drain `(L/4 + 2)d6` from the nearest undead as SP |
| Crush | 10 | 6 | 40 | 5 | Kill every monster in LOS with fewer than `4L` HP; player takes `1d(2L)` |
| Sleep Evil | 12 | 5 | 50 | 5 | Sleep evil in LOS, `10L + 500` |
| Shadow Shift | 15 | 10 | 50 | 10 | Teleport 30; 2d5 damage to self |
| Disenchant | 16 | 12 | 50 | 15 | Disenchantment bolt `2d(2L + 10)` |
| **Fear and Torment** | | | | | |
| Frighten | 17 | 4 | 40 | 12 | Bolt of fear, `L` |
| Vampire Strike | 20 | 5 | 50 | 10 | Jump to nearest living monster and bite for `2L` |
| Dispel Life | 22 | 20 | 50 | 10 | Living in LOS take `1d(3L)` |
| Dark Spear | 25 | 10 | 60 | 12 | Line of darkness `2d(2L)` |
| Warg Form | 28 | 20 | 60 | 80 | Shapechange |
| **Deadly Powers** | | | | | |
| Banish Spirits | 25 | 25 | 80 | 25 | Teleport away 100 all spirits in LOS |
| Annihilate | 30 | 20 | 75 | 25 | Life-drain bolt `4L` |
| Grond's Blow | 35 | 35 | 80 | 115 | Destruction radius 15 (dark) |
| Unleash Chaos | 38 | 15 | 90 | 100 | Random: chaos beam / arc 10° / ball radius 3, all `8dL` |
| Fume of Mordor | 40 | 50 | 80 | 150 | Darken the level; wake all; terrify all in LOS (`L`) |
| Storm of Darkness | 43 | 16 | 80 | 200 | Dark ball radius 4, `4d(2L)` |
| **Corruption of Spirit** | | | | | |
| Power Sacrifice | 27 | 0 | 20 | 20 | 50 damage to self, restore 50 SP |
| Zone of Unmagic | 32 | 16 | 60 | 110 | Disenchantment spot radius 4, `3L` (includes the caster) |
| Vampire Form | 37 | 20 | 60 | 140 | Shapechange, then bite for `L` |
| Curse | 40 | 50 | 60 | 180 | 100 damage to self; direct damage `(L/12 + 1)d(monster % HP gone + 50)` |
| Command | 45 | 40 | 60 | 250 | Command a monster 5 + 1d10 turns |

### Paladin (divine, WIS; first spell level 1)

| Spell | Lv | Mana | Fail | Exp | Effect |
|---|---|---|---|---|---|
| Bless | 1 | 2 | 20 | 4 | Blessed `L + 10 + 1d(L + 10)` |
| Detect Evil | 3 | 2 | 10 | 4 | Detect evil |
| Call Light | 5 | 3 | 10 | 2 | As Priest |
| Minor Healing | 7 | 3 | 15 | 4 | As Priest |
| Sense Invisible | 8 | 4 | 25 | 4 | See invisible 24 + 1d24 |
| Heroism | 12 | 5 | 30 | 5 | Heal 10, cure fear, hero `L − 14 + 1d(L − 14)` |
| Protection from Evil | 15 | 8 | 42 | 5 | `3L + 1d25` |
| Remove Curse | 20 | 12 | 38 | 8 | Strength `L + 1dL` |
| Word of Recall | 25 | 30 | 75 | 10 | Recall |
| Healing | 30 | 50 | 80 | 100 | As Priest |
| Clairvoyance | 37 | 50 | 80 | 150 | As Priest |
| Smite Evil | 25 | 20 | 70 | 40 | Slay evil 20 + 1d20 |
| Demon Bane | 30 | 40 | 80 | 150 | Slay demon 20 + 1d20 |
| Enchant Weapon | 35 | 50 | 80 | 230 | 1d4 |
| Enchant Armour | 37 | 60 | 85 | 250 | 1 + 1d3 |
| Single Combat | 40 | 50 | 30 | 300 | Fight a targeted monster in a sealed arena |

### Rogue (arcane, INT; first spell level 5)

| Spell | Lv | Mana | Fail | Exp | Effect |
|---|---|---|---|---|---|
| Detect Monsters | 5 | 1 | 50 | 4 | Detect visible monsters |
| Phase Door | 7 | 2 | 55 | 4 | Teleport 10 |
| Object Detection | 10 | 3 | 60 | 5 | Detect ore, gold and objects |
| Detect Stairs | 12 | 3 | 50 | 5 | Detect stairs in 44×60 |
| Recharging | 20 | 10 | 50 | 6 | Strength `L/10 + 4` |
| Reveal Monsters | 25 | 3 | 40 | 8 | Visible and invisible monsters |
| Teleport Self | 17 | 6 | 35 | 5 | `9L/5` percent of the level |
| Hit and Run | 23 | 20 | 40 | 20 | ATT_RUN 10 (next melee blow teleports the Rogue away) |
| Teleport Other | 30 | 10 | 30 | 50 | Bolt, distance `3L` |
| Teleport Level | 35 | 17 | 65 | 80 | Teleport level |

### Ranger (nature, WIS; first spell level 3)

| Spell | Lv | Mana | Fail | Exp | Effect |
|---|---|---|---|---|---|
| Remove Hunger | 3 | 1 | 25 | 2 | Food to 50% |
| Detect Life | 5 | 2 | 23 | 2 | Detect living |
| Herbal Curing | 9 | 6 | 30 | 4 | Cure cuts, poison, stun, Black Breath |
| Resist Poison | 12 | 10 | 32 | 5 | 20 + 1d20 |
| Turn Stone to Mud | 15 | 5 | 25 | 5 | Line, 20 + 1d30 |
| Sense Surroundings | 20 | 8 | 35 | 8 | Map |
| Cover Tracks | 20 | 20 | 40 | 40 | COVERTRACKS `2L + 1d20` (+5) |
| Create Arrows | 22 | 20 | 40 | 40 | Staff → arrows |
| Haste Self | 25 | 12 | 65 | 15 | `L + 1d20` (+5) |
| Decoy | 30 | 30 | 40 | 60 | Decoy glyph |
| Brand Ammunition | 40 | 60 | 95 | 120 | Brand a stack of ammunition |

### Blackguard (shadow, INT; first spell level 1)

| Spell | Lv | Mana | Fail | Exp | Effect |
|---|---|---|---|---|---|
| Seek Battle | 1 | 1 | 15 | 2 | Detect monsters susceptible to fear |
| Berserk Strength | 3 | 2 | 20 | 4 | Cure fear; berserk `L + 5 + 1d(L + 5)` (+5) |
| Whirlwind Attack | 5 | 4 | 25 | 6 | `(L + 10)/15` blows at every adjacent monster |
| Shatter Stone | 7 | 3 | 20 | 8 | Short beam of stone-to-mud, length 1 |
| Leap into Battle | 10 | 5 | 30 | 10 | Move up to 4 grids and strike `(L + 5)/15` blows |
| Grim Purpose | 13 | 8 | 30 | 12 | Confusion resistance and free action 12 + 1d12 |
| Maim Foe | 15 | 6 | 35 | 14 | `L/15` blows that stun (6) |
| Howl of the Damned | 18 | 8 | 30 | 16 | Terrify all in LOS (`L`) |
| Relentless Taunting | 24 | 10 | 32 | 20 | TAUNT 12 + 1d12 |
| Venom | 28 | 18 | 35 | 30 | Poison brand 18 + 1d18 (+5) |
| Werewolf Form | 32 | 30 | 40 | 100 | Shapechange |
| Bloodlust | 30 | 25 | 37 | 80 | Bloodlust +10 (decrements by 1 if already active: `other` −1) |
| Unholy Reprieve | 34 | 45 | 60 | 120 | Restore STR, INT, CON and experience; 66 damage to self |
| Forceful Blow | 38 | 16 | 50 | 150 | One blow with a force effect (200) |
| Quake | 44 | 39 | 55 | 175 | Earthquake radius 13 |

## 9.5 Magic devices and consumables

Potions (`q`), food (`E`) and scrolls (`r`) are single-use and never fail (scrolls need `player_can_read()`: not blind, in light, not confused, not amnesiac). Wands (`a`), staffs (`u`), rods (`z`) and activatable equipment (`A`) go through `check_devices()`:

```c
lev  = artifact level, or activation level, or object kind level;
x    = 2 * (SKILL_DEVICE - lev) + 1;
fail = 380 - 370 * x / (5 + |x|);        /* per 1000 */
failure if randint1(1000) < fail
```

The 4.2.6 curve saturates: as `x` grows the fail rate approaches 380 − 370 = 10 (1%), and as `x` becomes very negative it approaches 750 (75%); the transition is steep around skill = level.

| Device skill − item level | fail / 1000 |
|---|---|
| −30 | 750 − 370×59/64 ≈ 721 → 72% |
| −10 | 380 + 370×19/24 ≈ 673 → 67% |
| −3 | 380 + 370×5/10 = 565 → 57% |
| 0 | 380 − 370×1/6 = 318 → 32% |
| +3 | 380 − 370×7/12 = 164 → 16% |
| +10 | 380 − 370×21/26 ≈ 81 → 8% |
| +30 | 380 − 370×61/66 ≈ 38 → 4% |
| +75 | 380 − 370×151/156 ≈ 22 → 2% |

Examples: a level 10 Mage with device skill 36 + 13 + `adj_int_dev` 3 = 52 using a Wand of Magic Missile (level 3): x = 99, fail = 380 − 36630/104 = 28 → 2.8%. The same character with a Wand of Dragon's Flame (level 55): x = −5, fail = 380 + 1850/10 = 565 → 56.5%. Item levels: Wand of Stinking Cloud 5, Rod of Treasure Location 10, Rod of Illumination 20, Staff of Teleportation 20, Rod of Detection 30, Rod of Recall 30, Staff of Speed 40, Rod of Speed 55, Staff of Healing 70, Rod of Healing 80. Artifacts use the artifact's level; randart and some standard activations use the `level:` of the activation in `activation.txt` (163 activations, each with its own difficulty and recharge time).

Then in `use_aux()`:

- The damage of attack effects is **boosted** by `max((SKILL_DEVICE − level) / 2, 0)` percent (a skill-52 character gets +24% from a level-3 wand).
- Wands beam with 20% chance, rods with 10%, for `BOLT_OR_BEAM` effects.
- A wand or staff spends one charge (`pval`); a rod sets its `timeout` to `randcalc(time)` and a stack of rods shares one timeout pool, recharging one rod at a time (`recharge_objects()` runs every world tick and decrements timeouts of carried and floor rods and of equipment activations).
- Unknown flavours become *aware* if the effect was noticed (`ident`), earning experience (Experience chapter); otherwise the flavour is marked "tried". Unknown consumables always become known.
- Using any device costs 100 energy, even on failure. Aimed devices whose effect is unknown fire in a random direction.
- Wands and staffs with 0 charges say so and cost nothing.

Activations of equipment are the same mechanism with the item's `activation` (artifacts and egos such as dragon scale mail, rings of elemental resistance, the Phial); the object must be worn ("Equip the item to use it"), and its `time` recharge is `randcalc` of the item's `time:` field.

**Recharging** (scroll or spell) is `EF_RECHARGE` in 9.3: the failure chance is 1 in `strength + (100 − level)/10 − 2 × charges per item`, so recharging an already full wand is likely to destroy it; a Scroll of Recharging has strength 6, Mage Recharging `level/8 + 6`, Rogue Recharging `level/10 + 4`.

**Drained charges** (monster `DRAIN_CHARGES` blows) and **tapping** (`TAP_DEVICE`) are in the Melee and 9.3 sections.

## 9.6 Class-specific magic mechanics

- **Necromancers** (UNLIGHT) cast at +25% failure when standing on a lit grid, see monsters and grids within `2 + level/6 − cur_light` in darkness, get stealth from darkness, and their `Create Darkness` and `Fume of Mordor` spells darken rooms and levels. Their spells are "rituals".
- **Blackguards** (COMBAT_REGEN) have inverted mana: SP drains at half the normal regeneration rate (and never regenerates naturally while above half HP), is gained by taking damage (X% of max HP lost gives X% of max SP) and by attacking in melee (5% of max SP per attack command), and spending SP on a spell heals HP (`convert_mana_to_hp()`: spending X% of max SP restores X/2% of missing HP, at most 25% of the missing HP per cast). Bloodlust makes `randint0(200) < bloodlust` of their energy-using commands become an attack on a random adjacent monster (`process_command()`), and decays with side effects (Timed Effects chapter).
- **Priests and Paladins** cannot choose which prayer to learn.
- **Rogues** can steal (`s`, `do_cmd_steal()` in `cmd-cave.c`) from adjacent monsters that carry objects: success is based on the monster's awareness and level versus the player's stealth and dexterity; failure wakes and aggravates the target (the steal command belongs to the STEAL flag, not to a spell).
- **Rangers** get spells from level 3 and the `FAST_SHOT` extra shots, not a shooting spell.
- **Warriors** have no spells and no mana (NO_MANA), but read scrolls and use devices like everyone else.
