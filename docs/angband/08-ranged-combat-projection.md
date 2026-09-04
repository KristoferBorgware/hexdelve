# 8. Ranged combat, throwing and projection

Firing a missile, throwing an object, and every bolt, ball, beam or breath in the game share one piece of machinery: the projection path (`project_path()`) that traces a line of grids, and for spells the full `project()` engine that collects an affected area and applies the effect to objects, monsters, the player and terrain. This chapter covers missiles and thrown objects (`player-attack.c`), the projection engine (`project.c`), the per-element handlers for monsters, objects and terrain (`project-mon.c`, `project-obj.c`, `project-feat.c`), the projection types table, and targeting (`target.c`). What projections do to the *player* is in the Elements chapter.

## 8.1 Launchers and ammunition

A launcher's multiplier is its `pval` (Sling ×2, Short Bow ×2, Long Bow ×3, Light Crossbow ×3, Heavy Crossbow ×4), stored in `state.ammo_mult` plus any MIGHT bonuses; the ammunition type is fixed by the launcher's kind flag (`SHOOTS_SHOTS`, `SHOOTS_ARROWS`, `SHOOTS_BOLTS`). Shots per turn are `state.num_shots` in tenths (Player Stats chapter): 10 for everyone, plus SHOTS modifiers, plus `level / 3` for Rangers, none of which apply while the launcher is too heavy to hold.

```c
range  = MIN(6 + 2 * ammo_mult, max_range);      /* 10 for ×2, 12 for ×3, 14 for ×4; max 20 */
energy = move_energy * 10 / num_shots;            /* 100 for one shot, 62 for 1.6 shots */
```

`do_cmd_fire()` (`f`, or `h`/`TAB` for "fire at nearest", which picks the first quiver slot holding the right ammunition and the closest targetable monster) asks for ammunition from the quiver, pack or floor and a target, applies confusion to the direction, and calls `ranged_helper()`.

## 8.2 The flight of a missile

`ranged_helper()` computes `project_path(cave, path, range, player grid, target, 0)`: a straight line up to `range` grids that stops at the target grid (unless the target is a direction, in which case the "target" is 99 grids away and the path runs to full range) and at the first non-projectable grid. If a targeted monster is beyond range the player is asked "Target out of range by N squares. Fire anyway?".

Along the path, at each grid: stop before a wall; show the missile; if a monster is there, resolve the attack (8.3); a hit or a miss on a monster ends the flight unless the player has `TMD_POWERSHOT` and the missile is sharp, which lets it pierce `ammo_mult` monsters. Then one missile is removed from the stack and `drop_near()` is called at the last grid with the breakage chance:

```c
perc = kind's base break chance;   /* object_base.txt: arrows and bolts 35, shots 0, potions/flasks 100, ... */
if artifact: 0
if throwing weapon (OF_THROWING, not exploding, not ammo): 1
if the missile missed everything: perc * perc / 100      /* 35% -> 12%, 100% -> 100%, 10% -> 1% */
```

so ammunition that hits breaks more often than ammunition that misses.

## 8.3 Hitting and damage with a launcher

```c
chance = SKILL_TO_HIT_BOW + (ammo to_h + launcher to_h + state.to_h) * 3
chance -= distance(player, monster)
if the monster is not obvious: chance /= 2
hit if test_hit(chance, monster AC)                 /* same 12%/5% formula as melee */
```

Damage (`ranged_damage()`):

```c
mult = ammo_mult (+ brand or slay multiplier, whichever is best, ADDED not multiplied)
dmg  = damroll(ammo dd, ds) + ammo to_d + launcher to_d
dmg *= mult
dmg  = critical_shot(...)
```

Note two differences from melee: slays and brands on the ammunition *or the launcher* add their multiplier to the launcher's (a ×3 bow firing arrows of Slay Evil ×2 does ×5 against evil), and the player's `state.to_d` does not apply to shots at all. `improve_attack_modifier()` is run on the ammunition first, then the launcher, and the best single multiplier is kept.

Criticals (`critical_shot()`, constants `ranged-critical:*`):

```c
to_h   = state.to_h + ammo to_h  (+10 vs a debuffed monster)
chance = weight × 1 + to_h × 4 + level × 2 + 0        (no skill term)
if randint1(5000) > chance: no critical
power  = weight + randint1(500)
```

| Power | Multiplier | Added | Message |
|---|---|---|---|
| < 500 | ×2 | +5 | good hit |
| < 1000 | ×2 | +10 | great hit |
| ≥ 1000 | ×3 | +15 | superb hit |

Ammunition weighs 1–3 tenths of a pound, so the weight term is negligible and criticals come from to-hit and level: a level 30 archer with total to-hit +15 has 60 + 60 = 120 / 5000 = 2.4% per hit, and can never reach "superb" (max power 503).

### Worked example

Level 20 Ranger: bow skill 72 + 45 × 2 = 162; DEX 18/50 gives +4 to-hit; Long Bow (×3) (+5,+7); Arrows (1d4) (+3,+4); shooting at a monster with AC 40 at distance 8.

- chance = 162 + (3 + 5 + 4) × 3 = 198, minus 8 = 190; P(hit) = 0.12 + 0.83 × (190 − 26) / 190 = 83.6%.
- damage = (1d4 + 4 + 7) × 3 = 3d... i.e. 3 × (5..8) = 15–24, average 19.5, before criticals.
- shots: 10 + 20/3 = 16 → 1.6 per turn, 62 energy each: about 26 expected damage per 100 energy, ignoring criticals (chance 2 + 4×(4+3) + 40 = 70/5000 = 1.4%).

Under `birth_percent_damage` the multiplier, slay/brand and "deadliness" (ammo + launcher to-dam + `state.to_d`) all scale the die sides (see the Melee chapter for the mechanism) and O-criticals add dice with chance `power / (power + 360)` where `power` is the base hit chance (×1 for launched, ×3/2 for thrown): 1/50 for +3 dice, else 1/10 for +2, else +1.

## 8.4 Throwing

`do_cmd_throw()` (`v`) accepts anything the player can throw (`obj_can_throw()`), including the wielded weapon (it is taken off first). Range depends on strength and weight:

```c
str    = adj_str_blow[STR]                         /* 3..240 */
weight = MAX(object weight in tenth lb, 10)
range  = MIN((str + 20) * 10 / weight, 10)
```

A 1 lb dagger (10) thrown with 18/50 STR (70): (90 × 10) / 10 = 90 → capped at 10. A 15 lb (150) item with STR 17 (17): 370 / 150 = 2 grids. Throwing always costs a full turn (`shots = 10`).

Hit chance uses the throwing skill: for objects with the `THROWING` flag (daggers, spears, darts, throwing axes, some others), `SKILL_TO_HIT_THROW + (object to_h + state.to_h) × 3`; for everything else `3/2 × SKILL_TO_HIT_THROW + object to_h × 3` (easier to hit with, but no benefit from the player's to-hit bonuses). Distance and visibility penalties as for shooting. Damage:

```c
dmg = damroll(dd, ds) + object to_d
if THROWING: dmg *= 2 + weight / 12      /* ×2 for anything under 1.2 lb, ×3 at 1.2 lb, ×4 at 2.4 lb ... */
dmg *= (1 + brand/slay multiplier)        /* mult starts at 1 with no launcher */
critical_shot(..., launched = false)
if OF_EXPLODE (Flask of Oil): dmg *= 3
```

so a thrown Dagger (1d4, 1.2 lb) of Slay Orc does `(1d4) × 3 × 4 = 12d4`-ish against an orc (`(dice + to_d) × 3 × (1 + 3)`), and a Flask of Oil (2d6, fire brand `FIRE_2`... in fact it has the brand as a property) does `2d6 × (1 + 2) × 3` to a non-fire-resistant monster. The throwing multiplier is what keeps thrown weapons competitive with launchers, as the code comment says.

## 8.5 The projection engine

`project(origin, rad, finish, dam, typ, flg, degrees_of_arc, diameter_of_source, obj)` is called by every spell, breath, wand, rod, trap and artifact effect. `origin` is the player, a monster, a trap, an object or nothing; `typ` is a projection type (8.6); `flg` selects the shape and the passes:

| Flag | Meaning |
|---|---|
| `PROJECT_JUMP` | No path: the effect starts at the target grid (used for ball-at-target and "smite" effects). |
| `PROJECT_BEAM` | Affect every grid along the path, not only the endpoint. `rad` limits beam length if non-zero. |
| `PROJECT_THRU` | The path continues past the target grid to full range (bolts and beams aimed in a direction); explosions with THRU may affect walls. |
| `PROJECT_STOP` | The path stops at the first monster or player (or decoy) after the origin. |
| `PROJECT_ARC` | A cone of `degrees_of_arc` centred on the line to the target (breaths). |
| `PROJECT_GRID`, `PROJECT_ITEM`, `PROJECT_KILL`, `PROJECT_PLAY` | Run the terrain, object, monster and player passes respectively. |
| `PROJECT_HIDE` | No visual effect. |
| `PROJECT_AWARE` | The effect is known to the player even if not seen (player effects the player understands). |
| `PROJECT_SAFE` | Monsters of the caster's race are unaffected (used for breaths, so dragons do not roast their kin). |
| `PROJECT_SELF` | The player is affected by their own effect (SPOT effects). |
| `PROJECT_SHORT` | Range is quartered while the player has `TMD_COVERTRACKS` (used in `projectable()` for monster spell checks). |
| `PROJECT_INFO` | Targeting mode: stop at walls the player *believes* in, so the path display does not leak map information. |
| `PROJECT_ROCK` | Path ignores walls (level generation). |

### The path

`project_path()` walks from the origin towards the target one grid at a time along the major axis, using a fractional accumulator (`frac`, `half = dx*dy`, `full = 2*dx*dy`, slope `m = 2*minor²`) to decide when to step along the minor axis; the effective range counts a diagonal step as 1.5 (`n + k/2 >= range` stops it). It stops at the target grid unless THRU, at the first non-projectable grid (walls, closed doors, rubble) after the first, and, with STOP, at the first grid holding a monster or player. A path can hit an intervening monster that is not the target; there is no "dodge" for bystanders.

### Bolts, beams and balls

- A **bolt** (`BOLT` effect: STOP | KILL, THRU added by `project_aimed()`) affects the single grid where the path ends: the first monster in the line, or the target grid.
- A **beam** (BEAM | KILL) affects every grid of the path out to full range or the first wall.
- A **ball** (BALL: THRU | STOP | GRID | ITEM | KILL, default radius 2) travels like a bolt, stops at the first monster (or at the target grid when a target was explicitly selected, since STOP and THRU are then cleared), *explodes before entering a wall*, and then collects every grid within `rad` of the centre (by `distance()`) that is passable and has `los()` from the centre, or lies on the path. One layer of wall around the explosion is included ("all explosions can affect one layer of terrain which is passable but not projectable" refers to rubble-like grids; true walls need `PROJECT_THRU`, which no 4.2 explosion uses). Player-cast balls with an `other` parameter grow: `rad += level / other`.
- **Damage falloff**: with no `diameter_of_source`, the damage at distance i from the centre is `(dam + i) / (i + 1)`: full at the centre, half at 1, a third at 2. With a source diameter d, `dam × d / (i + 1)` capped at `dam`, so the blast is at full strength out to distance `d − 1`.
- The affected grids are sorted by distance so that objects, monsters and the player nearer the centre are processed first.

### Arcs and breaths

`BREATH` and `ARC` set `PROJECT_ARC`. The explosion is centred on the *caster* and only grids whose angle from the centreline (computed with a 41×41 `get_angle_to_grid` table, in half-degrees) is within `(degrees_of_arc + 6) / 4` are kept, plus grids on the path itself. The radius is the breath's reach (`max_range` = 20 unless the effect gives one). Breath width is `max(spell's other, 20)` degrees, and the source diameter starts at 4 (full strength for 3 grids), is multiplied by 1.5 for POWERFUL monsters, and is scaled by `60 / degrees` for cones narrower than 60°, capped at 25:

| Cone | Normal | POWERFUL |
|---|---|---|
| 30° | full strength to 7 grids | 11 grids |
| 20° | 11 grids | 17 grids |

Breath damage is `breath_dam(type, hp) = hp / divisor`, capped at `damage-cap`, both from `projection.txt` (8.6); e.g. fire: HP / 3 up to 1600, poison HP / 3 up to 800, light HP / 6 up to 500, gravity HP / 3 up to 200, time HP / 3 up to 150. Monster breaths and balls have a 40% chance per level of confusion (`CONF_RANDOM_CHANCE`) of going in a random direction.

Other shapes in `effect-handler-attack.c`: `STAR` (eight beams from the player), `STAR_BALL` (eight balls), `LINE` (a beam with terrain effects), `SHORT_BEAM` (an arc of 0 degrees with fixed length and full-strength source: the Necromancer's beams, length `radius + level / other`), `SPOT` (a ball centred on the player that includes the player, `PROJECT_SELF`), `SPHERE` (a ball centred on the player that excludes the player), `STRIKE` (a ball that jumps to the target), `SWARM` (`m_bonus` separate balls at the target), `LASH` (a monster's melee blows delivered as a short arc: full damage of the first blow plus half of each other blow, with the projection type taken from the first blow's `lash-type`), `TOUCH`/`TOUCH_AWARE` (radius-1 explosion around the player, hidden), `PROJECT_LOS`/`PROJECT_LOS_AWARE` (jump directly to every monster in line of sight, or in view), `BOLT_OR_BEAM` (beam with probability `beam + other` percent, where `beam` is the caster's beam chance: Mages get `level`, others `level / 2`; see the Magic chapter).

### The four passes

After the grid list is built, in order: `project_o()` on every grid (if ITEM), `project_m()` on every grid (if KILL), `project_p()` (if PLAY; stops after the first grid that hits the player), and `project_f()` (if GRID). Each returns whether something was noticed, which is what identifies a wand or rod. `project_m()` never affects the monster that cast the projection, and `PROJECT_SAFE` breaths skip the caster's race; `project_p()` skips the player for player-cast effects unless SELF.

## 8.6 Projection types

`projection.txt` defines every type; `list-projections.h` names them. The `element` types carry damage; `numerator/denominator` is the fraction the *player* takes when resisting (Elements chapter); `divisor` and `damage-cap` define monster breath damage; `obvious` marks effects the player learns by seeing; `wake` marks types that wake the monster hit.

| Code | Type | Player resist fraction | Breath: HP divisor / cap | Monster-side handling (`project-mon.c`) |
|---|---|---|---|---|
| ACID, ELEC, POIS | element | 1/3 | 3 / 1600 (POIS 800) | `IM_x`: damage / 9 ("resists a lot") |
| FIRE, COLD | element | 1/3 | 3 / 1600 | `IM_x`: / 9; `HURT_FIRE`/`HURT_COLD`: × 2 |
| LIGHT | element | 6 / (8+1d4) | 6 / 500 | Breathes light: ×2 / (6+1d6); `HURT_LIGHT`: ×2 ("cringes from the light") |
| DARK | element | 6 / (8+1d4) | 6 / 500 | Breathes dark: ×2 / (6+1d6) |
| SOUND | element | 6 / (8+1d4) | 6 / 500 | 1 in 3: stun 5+1d10 (radius-adjusted); breathes sound: ×2 / (6+1d6) |
| SHARD | element | 6 / (8+1d4) | 6 / 500 | Breathes shards: ×3 / (6+1d6) |
| NEXUS | element | 6 / (8+1d4) | 6 / 400 | `IM_NEXUS`: ×3 / (6+1d6); else 1 in 3 blink 10, else 1 in 4 teleport 50 |
| NETHER | element | 6 / (8+1d4) | 6 / 600 | Undead: immune; `IM_NETHER`: ×3 / (6+1d6); evil: / 2 |
| CHAOS | element | 6 / (8+1d4) | 6 / 600 | Confuse 10+1d10; breathes chaos: ×3 / (6+1d6), else polymorph attempt (save if level > 1d90) |
| DISEN | element | 6 / (8+1d4) | 6 / 500 | `IM_DISEN`: ×3 / (6+1d6); else spell-casters lose spells (`MON_TMD_DISEN`) for 5+1d10 |
| WATER | element | – | 6 / none | `IM_WATER`: immune |
| ICE | element | 1/3 | 6 / none | 1 in 3 stun; `IM_COLD` / 9, `HURT_COLD` ×2 |
| GRAVITY | element | – | 3 / 200 | Teleport 10 unless level ≥ 1d127 or breathes gravity; breathes gravity: ×3 / (6+1d6) |
| INERTIA | element | – | 6 / 200 | Breathes inertia: ×3 / (6+1d6) (slowing is applied by the spell effect) |
| FORCE | element | – | 6 / 200 | 1 in 3 stun; breathes force: ×3 / (6+1d6); else thrown back `3 + dam/20` grids |
| TIME | element | – | 3 / 150 | Breathes time: ×3 / (6+1d6) |
| PLASMA | element | – | 6 / 150 | `IM_PLASMA`: ×3 / (6+1d6) |
| METEOR, MISSILE, ARROW | element | – | 6 / none | No special handling (pure damage) |
| MANA | element | – | 3 / 1600 | Pure damage; destroys every object it touches |
| HOLY_ORB | element | – | 6 / none | Evil: ×2 ("is hit hard") |
| LIGHT_WEAK / DARK_WEAK | environs | – | – | `HURT_LIGHT` monsters take the damage from LIGHT_WEAK; others none; lights/darkens grids |
| KILL_WALL, KILL_DOOR, KILL_TRAP, MAKE_DOOR, MAKE_TRAP | environs | – | – | Terrain only (8.7) |
| AWAY_UNDEAD / AWAY_EVIL / AWAY_SPIRIT / AWAY_ALL | monster | – | – | Teleport the monster `dam` grids if it has the flag (ALL: always) |
| TURN_UNDEAD / TURN_EVIL / TURN_LIVING / TURN_ALL | monster | – | – | Fear for `dam` turns (radius-adjusted) if it has the flag |
| DISP_UNDEAD / DISP_EVIL / DISP_ALL | monster | – | – | Damage only if it has the flag |
| SLEEP_UNDEAD / SLEEP_EVIL / SLEEP_ALL | monster | – | – | Sleep for `dam` if it has the flag |
| MON_CLONE | monster | – | – | Full heal, haste 50, and `multiply_monster()` |
| MON_POLY | monster | – | – | Polymorph: saves if level > `1d(max(1, dam − 10)) + 10` |
| MON_HEAL | monster | – | – | Heal `dam` HP |
| MON_SPEED / MON_SLOW / MON_CONF / MON_HOLD / MON_STUN | monster | – | – | The timed effect for `dam` turns (resistance checks in `mon_inc_timed()`, Monsters chapter) |
| MON_DRAIN | monster | – | – | Damage only to living monsters |
| MON_CRUSH | monster | – | – | Kills outright if the monster has fewer than `dam` HP, else nothing |

"Radius-adjusted" means `(amount + r) / (r + 1)`: a side effect is weaker on the fringe of a ball. Players with CHARM (Druids) get +50% duration on MON_SLOW/CONF/HOLD/STUN/SLEEP/POLY against animals. The "breathes X" resistances mean any monster that can breathe an element resists that element: `dam × factor / (6 + 1d6)`, i.e. to between 1/12 and 1/4 of the factor.

Damage from the player's projections goes through `project_m_player_attack()` → `mon_take_hit()` (fear, death, experience as in melee); damage from a monster's projection to another monster goes through `project_m_monster_attack()`, which cannot kill uniques. Side effects are applied afterwards in the order polymorph, teleport, timed effects (`project_m_apply_side_effects()`); polymorph replaces the monster with `poly_race()` — a race of similar level chosen from the allocation table.

Monster lore is learnt from projections: hitting a monster with fire teaches whether it is `IM_FIRE`/`HURT_FIRE`, nether teaches `UNDEAD`/`IM_NETHER`/`EVIL`, and so on, provided the monster is seen.

## 8.7 Effects on terrain and objects

`project_f()` (only with `PROJECT_GRID`; bolts do not have it):

| Type | Terrain effect |
|---|---|
| LIGHT_WEAK / LIGHT | Sets GLOW on the grid (lights rooms and corridors permanently) |
| DARK_WEAK / DARK | Clears GLOW (not in daylight town, not on BRIGHT terrain) |
| KILL_WALL (stone to mud) | Rubble → floor with a 10% object; door → floor; treasure vein → floor plus gold; magma/quartz/granite → floor; permanent walls unaffected |
| KILL_DOOR | Destroys any door ("There is a bright flash of light!") |
| KILL_TRAP (disarming) | Reveals secret doors, disables traps ("The trap seizes up"), unlocks locked doors ("Click!") |
| MAKE_DOOR | Creates a closed door on an empty floor grid (objects are pushed aside) |
| MAKE_TRAP | Places a random trap on a suitable floor grid |
| FIRE, PLASMA | Burn webs; if `dam > 1d1800 + 600` turn floor into lava |
| COLD, ICE | Freeze lava back to floor (similar strength test) |
| ACID, ELEC, and the rest | Nothing to terrain except destroying webs where coded |

`project_o()` (with `PROJECT_ITEM`) offers every object on the grid to the type's handler: ACID, ELEC, FIRE, COLD, SOUND, SHARD, ICE, FORCE, PLASMA (fire + elec), METEOR (fire + cold) destroy objects whose kind `HATES_x` that element unless the object `IGNORE_x`; MANA destroys everything. Artifacts always survive ("is unaffected"). Mimics disguised as objects are revealed instead of destroyed. The `HATES_*` and `IGNORE_*` flags come from `object_base.txt` and item properties (*Objects* 14.1.3).

Objects in the player's pack are damaged by `inven_damage(p, type, cperc)`, called by the player-side handlers with `cperc = min(dam * 5, 300)` for the base elements (a chance of up to 3% per item, in units of 1/10,000): each vulnerable, non-equipped, non-artifact pack item is tested — weapons and armour that hate the element are *damaged* (−1 to-hit/to-dam, or −1 to-AC) instead of destroyed, rods have their chance quartered, and stacks lose each member independently.

## 8.8 Targeting

`target_able(mon)`: the monster must be obvious (visible and not camouflaged), `projectable()` from the player (a clear path that ends on the monster's grid, not longer than `max_range`), and the player must not be hallucinating. `target_set_closest()` sorts targetable monsters by `cmp_distance()` — double the approximate distance, so ties are rare — and takes the nearest; it is what `'` and `h` use. `target_okay()` re-validates a stored monster target on every use, so a target that has moved out of sight is dropped and the player is asked again. A target can also be a grid (`target_set_location()`), in which case balls explode there and bolts fly towards it. The `use_old_target` option makes every aimed command reuse the current target without prompting. In interactive targeting (`*`, `'`) the path is drawn with `PROJECT_INFO`, which stops at walls the player *remembers* rather than the true ones so that it does not reveal unknown terrain.
