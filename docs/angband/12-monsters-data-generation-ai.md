# Chapter 12 — Monsters I: Data, Generation and AI

*Derived from Angband 4.2.6 (`mon-make.c`, `mon-move.c`, `mon-group.c`,
`mon-timed.c`, `mon-util.c`, `lib/gamedata/monster.txt`,
`monster_base.txt`, `pit.txt`, `constants.txt`).*

Monsters are the other half of the game. This chapter explains what a
monster *is* (the race record and the per-instance struct), how the game
decides which monsters to create and where, how a monster wakes up, and
the complete decision tree a monster runs through on each of its turns.
Spells, summoning, lore and drops are in the next chapter; monster melee
attacks against the player are in *Melee Combat*.

---

## 12.1 The two monster structures

| Structure | File | Meaning |
|---|---|---|
| `struct monster_race` | `monster.h` | The species: everything read from `monster.txt` plus computed allocation data. There are **624** races in 4.2.6, **106** of them uniques. |
| `struct monster` | `monster.h` | One creature on the level: race pointer, grid, current/max hp, energy, timed effects, held objects, group id, target, `mflag` bits. Lives in the `cave->monsters` array, index 0 unused. |
| `struct monster_base` | `monster.h` | Template from `monster_base.txt`: default glyph, pain message set, base flags. E.g. `ancient dragon` gives `D`, `DRAGON | EVIL | POWERFUL | SMART | SPIRIT | DROP_4 | MOVE_BODY | CLEAR_WEB | NO_CONF | NO_SLEEP | NO_HOLD | FORCE_SLEEP`. |
| `struct monster_lore` | `monster.h` | What the player has learned about the race (see *Chapter 13*). |

### 12.1.1 `monster.txt` record fields

| Line | Field | Notes |
|---|---|---|
| `name:` | race name | Starts a record. `plural:` overrides irregular plurals. |
| `base:` | template | Supplies glyph, pain messages, base flags. |
| `glyph:` / `color:` | display | `glyph` overrides the base glyph. 28 colours. |
| `speed:` | speed | Same scale as the player: 110 normal, 120 = +10. |
| `hit-points:` | average hp | Uniques get exactly this; others are rolled (12.3.4). |
| `light:` | light radius | Negative for darkness (unlight). |
| `hearing:` | hearing | Distance (in grids, via `cdis`) at which the monster notices the player. |
| `smell:` | smell | How strong a scent trail it can follow (compared to the scent map). |
| `armor-class:` | AC | Used by the player's hit rolls. |
| `sleepiness:` | sleep | Base "depth of sleep" at creation. |
| `depth:` | native level | Level at which it is normal. |
| `rarity:` | rarity | 1 = common. Allocation weight is ∝ 1/rarity. |
| `experience:` | exp per level | XP = `experience × monster level / player level` (see *Experience*). |
| `blow:` | method:effect:dice | Up to 4 blows. See *Melee Combat* 7.9. |
| `flags:` / `flags-off:` | RF_ flags | `flags-off` removes flags inherited from the base. |
| `innate-freq:` / `spell-freq:` | 1-in-N chances | Innate = breath/missile; spells = everything else. |
| `spell-power:` | power | Defaults to the monster level. |
| `spells:` | spell list | RSF_ flags, see *Chapter 13*. |
| `drop:` / `drop-base:` | specific drops | `tval:sval:chance:min:max`. |
| `mimic:` | tval:sval | Object mimics choose one of these to look like. |
| `friends:` / `friends-base:` | escorts | `chance:dice:name:role`. |
| `desc:` | description | Recall text. |

Example:

```
name:cave spider
base:spider
color:p
speed:120
hit-points:7
hearing:8
armor-class:19
sleepiness:80
depth:2
rarity:1
experience:7
blow:BITE:HURT:1d4
flags:ANIMAL | WEIRD_MIND
flags:GROUP_AI
friends:100:2d8:Same
```

### 12.1.2 Race flags (RF_*)

The full list lives in `list-mon-race-flags.h`. Grouped by what they do:

| Group | Flags |
|---|---|
| Identity | `UNIQUE`, `QUESTOR` (Sauron/Morgoth), `MALE`, `FEMALE`, `POWERFUL`, `SEASONAL` |
| Kinds (for slays, summons, pits) | `ORC`, `TROLL`, `GIANT`, `DRAGON`, `DEMON`, `UNDEAD`, `EVIL`, `ANIMAL`, `SPIDER`, `HYDRA`, `AINU`, `METAL`, `NONLIVING` |
| Behaviour | `NEVER_BLOW`, `NEVER_MOVE`, `RAND_25`, `RAND_50`, `MULTIPLY`, `FRIGHTENED`, `GROUP_AI`, `SMART`, `STUPID`, `COVERTRACKS`, `REGENERATE`, `ESCORT` handled via `friends` |
| Movement through terrain | `PASS_WALL`, `KILL_WALL`, `SMASH_WALL`, `OPEN_DOOR`, `BASH_DOOR`, `PASS_WEB`, `CLEAR_WEB`, `IM_WATER`, `HURT_LIGHT`, `HURT_ROCK` |
| Interaction with objects/monsters | `TAKE_ITEM`, `KILL_ITEM`, `MOVE_BODY`, `KILL_BODY` |
| Drops | `ONLY_GOLD`, `ONLY_ITEM`, `DROP_20`, `DROP_40`, `DROP_60`, `DROP_1..4`, `DROP_GOOD`, `DROP_GREAT` |
| Perception | `EMPTY_MIND`, `WEIRD_MIND` (telepathy), `INVISIBLE`, `COLD_BLOOD` (infravision), `ATTR_CLEAR`, `ATTR_MULTI`, `ATTR_FLICKER`, `CHAR_CLEAR`, `UNAWARE` (camouflaged mimics), `FORCE_DEPTH`, `FORCE_SLEEP` |
| Immunities | `IM_ACID`, `IM_ELEC`, `IM_FIRE`, `IM_COLD`, `IM_POIS`, `IM_NETHER`, `IM_PLASMA`, `IM_NEXUS`, `IM_DISEN`, `HURT_FIRE`, `HURT_COLD`, `NO_FEAR`, `NO_STUN`, `NO_CONF`, `NO_SLEEP`, `NO_HOLD`, `NO_SLOW` |
| Innate ranged | `SHRIEK`, `WHIP`, `SPIT`, `SHOT`, `ARROW`, `BOLT`, `BOULDER`, `WEAVE`, `BR_*` (these are spell flags but are marked innate in `monster_spell.txt`) |

### 12.1.3 Per-instance flags (MFLAG_*)

| Flag | Set when |
|---|---|
| `MFLAG_VIEW` | monster is in the player's view |
| `MFLAG_ACTIVE` | monster has noticed the player and is processing turns |
| `MFLAG_AWARE` | monster has become aware of the player's exact position (a step beyond ACTIVE) |
| `MFLAG_NICE` | monster was created with `FORCE_SLEEP`; it will not cast on its first turn |
| `MFLAG_SHOW` | must be redrawn |
| `MFLAG_MARK` | detected by magic |
| `MFLAG_VISIBLE` | visible for display purposes |
| `MFLAG_CAMOUFLAGE` | unaware mimic that has not yet revealed itself |
| `MFLAG_HANDLED` | already processed this turn (used by the level-restore logic) |
| `MFLAG_TRACKING` | is following the player's scent |

---

## 12.2 Which monster? — the allocation table

### 12.2.1 Building the table (`mon-make.c: init_race_allocs`)

At startup one entry per race is added to `alloc_race_table`, sorted by
level, with

```
prob = (100 / rarity) * (1 + level / 10)
```

So a rarity-1 level-40 monster has weight 100 × 5 = 500; a rarity-3 level-5
monster has weight 33 × 1 = 33. The `(1 + level/10)` term is a deliberate
bias towards deeper monsters when the level cap allows them.

### 12.2.2 Choosing (`mon-make.c: get_mon_num(generated_level, current_level)`)

1. **Out-of-depth boost**: if `generated_level > 0` and `one_in_(25)`, add
   `MIN(generated_level / 4 + 2, 10)` to the generation level (so at
   depth 40 the level becomes 50 one time in 25; the boost caps at +10).
2. Walk the sorted table and accept an entry only if:
   * race level ≤ generation level (town monsters, level 0, are never
     generated in the dungeon and vice versa);
   * `SEASONAL` races only between 24 and 26 December;
   * unique with `cur_num < max_num` (uniques have `max_num` 1, and it
     drops to 0 forever when they die);
   * `FORCE_DEPTH` races need race level ≤ the *current* dungeon depth
     (the boost cannot pull them up);
   * the caller's optional filter (used by pits, summons, themed levels).
3. Weighted random pick over the accepted entries.
4. Then `p = randint0(100)`: if `p < 60`, pick again and keep the *deeper*
   of the two; if `p < 10` (nested, so 10 % overall) pick a third time and
   again keep the deeper. This is why the average generated monster is
   noticeably deeper than a naive weighted pick would give.

### 12.2.3 `monster_level` used by the dungeon generator

The generator calls `pick_and_place_monster(c, grid, depth, sleep, group_okay, origin)`
with `depth = cave->depth` for random monsters, and higher values for room
vaults (see *Dungeon Generation*). `cave.c: pick_and_place_distant_monster`
is what the world loop uses to add wandering monsters: one attempt every
game turn with probability 1/500 (see *Chapter 19*), placing a monster
more than `max_sight + 5 = 25` grids away from the player (up to 10 000
attempts to find a grid).

---

## 12.3 Placing one monster (`mon-make.c: place_new_monster_one`)

Conditions: the grid must be in bounds, empty (no monster, not the player),
walkable for the race (walls only for `PASS_WALL`/`KILL_WALL`), not a glyph
of warding, not a decoy, and not a `NO_MONSTER`-flagged grid (vault
interiors during generation are marked). Uniques already alive are refused.

Once accepted:

| Step | Rule |
|---|---|
| Level feeling | `cave->mon_rating += level²`; if the race is deeper than the level, `+ (level − depth) × level` extra ("out of depth" contributes to the feeling). |
| Sleep | if the caller asked for sleep and race `sleepiness > 0`: `msleep = sleep × 2 + randint1(sleep × 10)`. A cave spider (80) starts at 160 + 1d800. Timed effect `MON_TMD_SLEEP`. |
| Hit points | Uniques: exactly the average. Others: `mon_hp()` returns `Rand_normal(avg, sd)` with `sd = ((avg × 10 / 8) + 5) / 10` (+1 if avg > 1), floored at 1. For 100 average hp, sd = 13. |
| Speed | Non-uniques get `± rand_spread(0, turn_energy(speed) / 10)`. At 110 energy is 10 so ±1; at 120 energy is 20 so ±2. Uniques are exact. |
| Energy | `randint0(50)` initial energy, so a freshly placed monster acts within its first few game turns. |
| Flags | `FORCE_SLEEP` → `MFLAG_NICE`; `UNAWARE` → `MFLAG_CAMOUFLAGE` (mimics); `ATTR_RAND` colour chosen. |
| Group | Assigned to a monster group (`mon-group.c`), new or the caller's. |

`place_monster()` then increments `race->cur_num`, `num_repro` if
`MULTIPLY`, creates the monster's drop *now* (`mon_create_drop`, carried
until death; see *Chapter 13* 13.6), and for mimics creates the mimicked
object on the floor.

### 12.3.1 Escorts and groups (`mon-make.c: place_friends`, `place_new_monster_group`)

For each `friends:chance:dice:name:role` line (and `friends-base:` for a
whole base), when `randint0(100) < chance`:

```
diff  = level_depth − friend_race->level + 5
if diff ≤ 0 and friend is not unique   → no escort
total = damroll(dice)
if diff < 10                            → total = total × diff / 10, +1 with probability (total × diff) % 10 / 10
```

If the friend race is the same race ("Same"), `place_new_monster_group`
flood-fills outward from the leader's grid, up to
`monster_group_max = 25` members. A different race is scattered within
`monster_group_dist = 5` grids. Roles: `LEADER`, `SERVANT`, `BODYGUARD`,
`SUMMON` — bodyguards stay next to their leader, servants and summons obey
group AI, and a group without its leader loses its `leader` field so the
"follow the leader" branch of movement stops applying.

**Worked example** — Bullroarer (level 5) with `friends:80:1d7:Scruffy
looking hobbit:servant` (hobbit level 1) generated at depth 3:
diff = 3 − 1 + 5 = 7, so a roll of 1d7 = 5 gives 5 × 7 / 10 = 3 hobbits,
plus a 50 % chance of a fourth.

**Rousing** (`mon-group.c: monster_group_rouse`): whenever a monster in a
group is awake and aware of the player, each sleeping visible group-mate
at distance `d` wakes with probability 1 in `d × 20` per turn (halved to
1 in `d × 40` when the rouser is only ACTIVE, not AWARE). This is why
one awake wolf in a pack soon brings the rest.

---

## 12.4 Waking up (`mon-move.c: monster_reduce_sleep`)

A sleeping monster does nothing except test, once per *game* turn it is
processed, whether the player's noise reached it.

```
player_noise = 1 << (30 − stealth)      /* stealth = state.skills[SKILL_STEALTH] */
notice       = randint0(1024)
if notice³ ≤ player_noise:
    reduce sleep by 1
    or, if 0 < local_noise < 50, by 100 / local_noise   (local noise map, see 12.6.1)
```

The probability of a wake step per monster turn is therefore
`cbrt(2^(30−stealth)) / 1024`:

| Stealth skill | Chance of a wake step each monster turn |
|---|---|
| 0 | 100 % |
| 3 | 50 % |
| 6 | 25 % |
| 9 | 12.5 % |
| 12 | 6.25 % |
| 15 | 3.1 % |
| 18 | 1.6 % |
| 21 | 0.8 % |
| 24 | 0.4 % |
| 27 | 0.2 % |
| 30 (Superb) | 0.1 % |

Every three points of stealth halves the rate at which you erode a
monster's sleep counter; the counter itself (2 × sleep + 1d(10 × sleep))
can be several hundred, so a Superb-stealth rogue can walk past most
sleepers indefinitely while a stealth-0 warrior wakes them almost at once.

Additional rules:

* The player's `AGGRAVATE` flag (or the aggravation curse) sets sleep to 0
  immediately.
* Only monsters within `hearing` distance of the player (through the
  noise map) are checked at all.
* When the timer hits 0 the monster wakes, becomes `ACTIVE`, and the
  lore `wake` counter increments; if the check fails, `ignore` increments
  (both capped at 255; see 13.5 for how they unlock the sleepiness line
  in monster recall).
* Damage always wakes the monster (`mon_clear_timed(SLEEP)` in
  `mon_take_hit`).

---

## 12.5 The monster's turn

`process_monsters(minimum_energy)` (in `mon-move.c`) runs every game turn
after the player, iterating monsters from the top of the array down.
Each monster with `energy ≥ move_energy (100)` and enough to have acted
this tick is handed to `process_monster`.

```
process_monster(mon):
    mon->energy -= move_energy
    if monster_check_active(mon) is false → return          /* not interested in the player */
    if process_monster_timed(mon) is true → return          /* asleep, held, stunned skip */
    monster_turn(mon)
```

### 12.5.1 Is the monster active? (`monster_check_active`)

A monster is flagged `ACTIVE` (and so processes a turn) if **any** of:

* it is within `hearing` distance of the player *and* its race passes
  walls (`PASS_WALL | KILL_WALL`), so the noise map is irrelevant;
* it is hurt (`hp < maxhp`);
* it is in the player's view;
* it can *hear*: `hearing − stealth / 3 > noise_at(grid)` where the noise
  map value counts grid steps from the player through open terrain;
* it can *smell*: `smell > scent_at(grid)` (scent map, updated
  as the player walks);
* it is standing on terrain that damages it.

Otherwise it goes dormant this turn (it still regenerates and its timers
still tick down).

### 12.5.2 Timed effects (`process_monster_timed`)

| Effect | Per-turn change | Effect on the turn |
|---|---|---|
| `SLEEP` | reduced by the noise test in 12.4 | monster does nothing |
| `FAST`, `SLOW`, `HOLD`, `DISEN`, `STUN`, `CONF`, `CHANGED` | −1 | — |
| `FEAR` | −randint1(level / 10 + 1) | flees instead of fighting |
| `HOLD`, `COMMAND` | | monster skips its turn entirely |
| `STUN` | | 1 in 10 chance to skip the turn; hit and damage −25 % |
| `CONF` | | erratic movement chance `30 × level` %, spell hit −20 per level, random spell 40 % |
| `SLOW` | | −2 speed per effect level |

Also: an awake ACTIVE monster has a 1-in-10 chance each turn of becoming
`AWARE` (it now knows where you are, rather than merely that you are
around).

`mon-timed.c` defines each effect's stacking rule and cap (`monster_timed.txt`):

| Effect | Stack rule | Resist flag | Max |
|---|---|---|---|
| SLEEP | no stacking, save allowed | `NO_SLEEP` | 10000 |
| STUN | takes the max | `NO_STUN` | 50 |
| CONF | takes the max | `NO_CONF` | 50 |
| FEAR | increments, save allowed | `NO_FEAR` | 10000 |
| SLOW | increments | `NO_SLOW` | 50 |
| FAST | increments | — | 50 |
| HOLD | takes the max | `NO_HOLD` | 50 |
| DISEN | takes the max | `IM_DISEN` | 50 |

`mon_inc_timed` starts an effect with at least 2 turns. Resistance is
checked when starting or increasing: the flag resists outright; for SLEEP
and FEAR there is also a *saving throw* with chance
`min(90, level + max(0, 25 − timer/2))` %, and uniques get **two** rolls.
`MON_TMD_FLG_NOFAIL` (used by some effects such as Hold Monster at high
power) bypasses this. The effect "level" shown to the player
(`monster_effect_level`) is `ceil(timer / (max / 5))`, from 1 to 5.

### 12.5.3 The main decision tree (`monster_turn`)

In order:

1. **Webs.** If standing in a web: `PASS_WEB` ignores it; wall-passers
   ignore it; `CLEAR_WEB` clears the web and *ends the turn*; anything
   else is stuck and ends the turn.
2. **Rouse the group** (12.3.1).
3. **Breed.** If `MULTIPLY` and `num_repro < repro_monster_max (100)`:
   count adjacent monsters `k`; if `k < 4` and (`k == 0` or
   `one_in_(k × 8)`) then try to place a clone next door
   (`multiply_monster`) and end the turn if it worked. Worms in an open
   room breed fast; a pinned worm pack slows down.
4. **Ranged attack.** `make_ranged_attack` — see *Chapter 13*. If a spell
   was cast, the turn ends.
5. **Stagger.** Confusion gives a `30 × level` % chance of a random
   step; `RAND_25` adds 25 %, `RAND_50` adds 50 % (cumulative, capped at
   100). A staggering monster picks a random direction and skips the
   pathing below.
6. **Choose a direction** with `get_move` (12.6). If the monster decided
   not to move (e.g. holding its ground), the turn ends.
7. **Try to move.** The chosen direction first, then up to 5 alternative
   `side_dirs` (the neighbours of the chosen direction, in order of
   closeness). For each, `monster_turn_can_move` decides:

| Target grid | Result |
|---|---|
| Player | melee attack (`make_attack_normal`) unless `NEVER_BLOW` |
| Damaging terrain (lava etc.) | refused unless the race has the matching `IM_` flag |
| Permanent wall | refused |
| Rubble / passable rubble | wall-passers and `KILL_WALL` go through; others walk on passable rubble only |
| Granite / magma / quartz | `PASS_WALL` passes; `KILL_WALL` tunnels (destroys the wall, "You hear grinding"); `SMASH_WALL` likewise; else refused |
| Closed door | see 12.5.4 |
| Glyph of warding | broken if `randint1(550) < monster level`; otherwise the monster refuses that grid |
| Decoy | destroyed (monster attacks it) unless `NEVER_BLOW` |
| Another monster | `KILL_BODY` tramples a weaker (lower `mexp`, never a unique) monster; `MOVE_BODY` swaps past a weaker one; otherwise blocked |

`NEVER_MOVE` monsters never step, only attack an adjacent player.

8. **Consequences of moving.** Update position, view and light.
   Objects on the new grid: `TAKE_ITEM` picks them up unless the object
   is an artifact or has a slay/brand that hurts the monster ("tries to
   pick up X, but fails"); `KILL_ITEM` crushes them ("crushes X").
   Moving out of camouflage (mimic) reveals the monster
   (`become_aware`).
9. **Fear that could not be acted on.** If the monster was afraid but
   could not move at all, its fear is converted to `HOLD` for a couple of
   turns ("turns to fight!" logic in `monster_turn` when `did_something`
   is false and it is adjacent to the player).

### 12.5.4 Doors

```
if door is locked (power k > 0):
    can only open if OPEN_DOOR and not confused
    if randint0(monster hp / 10) > k:  power -= 1   /* "fiddles with the lock" */
    (a monster with hp 300 and k=7 succeeds 23 times in 30)
else (closed, unlocked):
    OPEN_DOOR (not confused) → opens it (50% chance to bash instead if it also has BASH_DOOR)
    BASH_DOOR, or a confused door-opener 1 time in 3 → bashes: door becomes broken,
        "You hear a door burst open!", monster occupies the grid *next* turn
```

Jammed (stuck) doors have `power < 0` — their absolute value is the
jam level; the same hp-vs-power test is used for bashing.

---

## 12.6 Where does it want to go? (`get_move`)

### 12.6.1 The noise and scent maps

Every player turn `game-world.c: make_noise()` floods a breadth-first
"noise" map from the player over passable grids (`cave->noise`), and
`update_scent()` lays down a scent value that decays with age.
Monsters use them as a cheap path-finder: to approach the player they
step to the adjacent grid with a **lower** noise value (closer in walking
distance), and to follow a trail they step to the adjacent grid with the
**freshest** scent. Neither requires line of sight, so a monster that has
heard you can path around corners.

### 12.6.2 Ranges (`get_move_find_range`)

```
flee_range = max_sight (20) + flee_range constant (5) = 25
m_lev = monster level + (midx & 8) + 25      /* the & 8 term gives ~half of monsters a +8 quirk */

if afraid or FRIGHTENED:            min_range = flee_range
else if bodyguard:                  min_range = 1
else if m_lev + 3 < player level:   min_range = flee_range               /* hopelessly outclassed */
else if m_lev − 5 < player level:
    if (plev × p_mhp + 4 × p_chp) × m_mhp > (m_lev × m_mhp + 4 × m_chp) × p_mhp:
        min_range = flee_range                                         /* wounded and outclassed */
if NEVER_MOVE or NEVER_BLOW:        min_range += 3
if cdis < turn_range (5):           min_range = 1                       /* cornered, turn and fight */

best_range = min_range
if ARCHER (has ranged innate) and not afraid:       best_range += 3
if innate_freq > 24 and has a breath and hp > maxhp/2:  best_range = max(best_range, 1)
if spell_freq > 24:                                 best_range += 3
```

So monsters that mostly cast prefer to hover a few grids away; hurt
breathers close in; frightened or outclassed monsters aim to stay 25
grids away.

### 12.6.3 Choosing the goal grid (`get_move`)

1. **Bodyguards** whose leader is alive head for the leader.
2. **Wall-passers** (`PASS_WALL`/`KILL_WALL`) head straight at the player
   unless they are next to a permanent wall (then they path normally).
3. Otherwise the monster needs a *reason* to move:
   * it **sees** the player (player in view; a `COVERTRACKS` player is only
     visible within `max_sight / 4 = 5` grids) → target the player's
     grid;
   * else it can **hear** (noise map) → target the adjacent grid with the
     lowest noise value;
   * else it can **smell** → target the adjacent grid with the best scent
     (sets `MFLAG_TRACKING`);
   * else, if a group-mate can see the player → target that grid;
   * else keep the old target, or wander randomly.
4. **Terrain damage** on the current grid overrides everything: find a
   safe grid (`get_move_find_safety`) and flee to it.
5. **Group AI hiding**: if `GROUP_AI`, fewer than 5 open grids surround
   the player (a corridor) and the player is above half hit points, the
   monster hides (`get_move_find_hiding`: nearest grid the player can't
   see, at least ¾ of the current distance + 2 away). This is the
   "hounds lurk outside the corridor" behaviour.
6. **Fleeing** (`min_range == flee_range`): `get_move_find_safety` looks
   within radius 9 for the farthest grid that the player cannot see and
   whose noise value is not more than the monster's own + 2 × distance;
   if none, `get_move_flee` scores each neighbour
   `5000 / (dis_to_player + 3) − 500 / (noise + 1)` and takes the
   lowest, i.e. simply steps away.
7. **Surrounding** (`GROUP_AI`, player in view, `cdis > 1`): pick a random
   empty grid adjacent to the player and path to it, so packs spread
   around you rather than queuing in a line.
8. Otherwise the goal is the player's grid (or the range-adjusted
   position: a monster already at ≤ `best_range` with a ranged attack
   holds its ground).

`get_move_choose_direction` converts the goal grid into the primary
direction: whichever of the 8 directions best matches the dx/dy sign,
with the secondary `side_dirs` ordering used when the first grid is
blocked.

---

## 12.7 Regeneration and persistent levels

`mon-util.c: regen_monster` runs every 100 game turns for each monster
(the world loop's "monster regen" tick):

```
frac = maxhp / 100  (minimum 1)
if REGENERATE: frac *= 2
hp = min(maxhp, hp + frac)
```

A 1560-hp ancient red dragon regains 15 hp per 100 game turns (i.e. per
10 player turns at normal speed). Trolls, with `REGENERATE`, heal twice
as fast.

With persistent levels (`birth_levels_persist`), `restore_monsters`
catches monsters up for the game turns that elapsed while the level was
stored: regeneration and timed-effect decay are applied in bulk.

---

## 12.8 Damage to monsters and death (`mon-util.c: mon_take_hit`)

```
mon_take_hit(mon, player, dam, &fear, note):
    if dam ≤ hp: monster_wake(mon), clear HOLD        /* any non-lethal hit wakes it */
    camouflaged mimic → become_aware
    if dam == 0: return
    player's COVERTRACKS is cancelled
    hp -= dam
    if hp < 0:
        player_kill_monster → XP (race->mexp × race->level / p->lev, see Experience),
                              monster_death (drops, quest check, unique bookkeeping, lore)
        return true (dead)
    else:
        *fear = monster_scared_by_damage(mon, dam)
```

`monster_scared_by_damage` — fear caused by pain:

```
if already afraid:
    tmp = randint1(dam)
    tmp < fear timer → reduce fear by tmp ("pain snaps it out of it" a little)
    else             → cure fear entirely, and it does not re-flee this hit
else if monster_can_be_scared (no NO_FEAR, not a unique-with-NO_FEAR etc.):
    percentage = 100 × hp / maxhp          (remaining, after the hit)
    low_hp  = randint1(10) ≥ percentage    (only possible at ≤10 % hp; certain at 0–1 %)
    big_hit = dam ≥ hp and randint0(100) < 80   (the hit took at least half of what it had)
    if low_hp or big_hit:
        time = randint1(10)
        if dam ≥ hp and percentage > 7:  time += 20
        else:                            time += (11 − percentage) × 5
        FEAR += time  (NOFAIL: the resist roll is skipped, only NO_FEAR prevents it)
```

**Example**: a troll at 100/300 hp takes 60. Remaining 40 hp, percentage
13. `low_hp` is impossible (1d10 ≥ 13 never holds) and `big_hit` is false
(60 < 100), so no fear. The next hit does 25: remaining 15 hp, percentage
5. `big_hit` is still false (25 < 40), but `low_hp` holds whenever
1d10 ≥ 5, a 60 % chance, giving fear for 1d10 + (11 − 5) × 5 = 31–40
turns. Had the second hit done 45 instead (dam ≥ hp), the troll would
be dead; had it done exactly 40 with 40 remaining, `big_hit` applies
80 % of the time and, since the remaining percentage is 0, the timer is
1d10 + 55.

Kill bookkeeping (`player_kill_monster` → `monster_death`): `race->cur_num--`,
uniques set `max_num = 0` permanently, lore `pkills++` and `tkills++`,
`player->total_kills++`, the monster's carried objects are dropped
(*Chapter 13* 13.6), and if the race is `QUESTOR` the quest system is
notified (*Chapter 19*).

## 12.9 Pits, nests and themed rooms (`pit.txt`)

Monster pits and nests (see *Dungeon Generation*) pick their occupants
from a **pit profile**. Each profile has:

| Field | Meaning |
|---|---|
| `room:` | 1 = pit (ordered, few species), 2 = nest (disordered, many species), 3 = only usable for "other" themed fills |
| `alloc:rarity:level` | rarity weight and the depth where it is most common |
| `obj-rarity:` | percent chance of an object per grid |
| `color:` | restrict monsters to these colours (e.g. red dragons) |
| `mon-base:` / `mon-ban:` | allowed templates / forbidden names |
| `flags-req:` / `flags-ban:` | required/forbidden race flags |
| `spell-req:` / `spell-ban:` / `innate-freq:` | required spells (e.g. `Archers`) |

Profiles in 4.2.6: Orc, Troll, Giant, Acid/Electric/Fire/Ice/Poison/
Multi-hued/Gold dragons, Demons, Minor demons, Jelly, Animals, Undead,
Lesser undead, Ants, Kobolds, Creepy crawlies, Spellcasters, Archers,
Naga, Thieves, Warriors, Dark dwarves, Eyes, Ogres, Believers, Serpents,
Wizards, Vampires, Hydra, Golems, Ainur, Insects, Reptiles, Cave dwellers,
Moria dwellers, Creatures of Earth, Elemental creatures.

`gen-room.c: set_pit_type(depth, type)` chooses the profile: for every
profile of the requested room type it draws `offset = Rand_normal(ave, 10)`
and keeps the profile whose offset is closest to the current depth,
*provided* `one_in_(rarity)` also succeeds for it. So a rarity-1 profile
whose average level is near the current depth wins most of the time,
while a rarity-5 profile is considered only 20 % of the time even when
its level matches. The profile's restrictions are installed as the
`get_mon_num_hook` filter; pits then generate their monsters with
`get_mon_num(depth + 10 …)` ordered by level from the outside in (the
deepest in the centre); nests fill randomly (see *Dungeon Generation*).

---

## 12.10 Worked example: a cave spider swarm at depth 3

1. The generator wants a random monster; `get_mon_num(3, 3)`. The cave
   spider (level 2, rarity 1) has weight 100 × (1 + 0) = 100 alongside all
   other level ≤ 3 races. Suppose it wins.
2. `place_new_monster_one`: hp = `Rand_normal(7, 1)` → 6–9; speed 120 ±
   2; sleep = 160 + 1d800 ≈ 560; energy 0–49.
3. `friends:100:2d8:Same`: diff = 3 − 2 + 5 = 6 < 10, so with 2d8 = 9 we
   get 9 × 6 / 10 = 5 spiders, plus 40 % (54 mod 10 = 4) chance of a
   sixth. They are flood-filled next to the leader.
4. A stealth-6 rogue passes 6 grids away: each spider hears (hearing 8 −
   6/3 = 6 > noise 6? no — exactly equal fails, so at 6 grids they are
   *not* active). At 5 grids they are active and each has a 25 % chance
   per monster turn (at speed 120 that is 2 per player turn) of losing 1
   sleep — but their sleep is ~560, so they will not wake by noise alone
   for hundreds of turns.
5. One spider gets hit by a stray bolt: it wakes, becomes ACTIVE, and
   `monster_group_rouse` wakes each adjacent sleeper with probability
   1/20 per turn. With `GROUP_AI` the awake spiders spread out to
   surround rather than queue, and if the rogue stands in a corridor at
   high hp they hide out of sight instead.
