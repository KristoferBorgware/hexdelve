# Chapter 17 — Traps, Doors, Rubble, Digging and Chests

*Derived from Angband 4.2.6 (`trap.c`, `cmd-cave.c`, `player-calcs.c`,
`player-util.c`, `obj-chest.c`, `lib/gamedata/trap.txt`,
`chest_trap.txt`, `terrain.txt`).*

Interacting with the dungeon's furniture: floor traps and runes, doors
(opening, locking, bashing), rubble and walls (tunnelling), and chests.
All of these use the disarm and digging skills from *Player Stats* 4.5 and 4.11.

---

## 17.1 Trap data (`trap.txt`)

`trap.txt` holds 40 entries, but only those with `TRAP | FLOOR` flags are
floor traps; the rest are "runes" and special markers that reuse the
trap machinery: `door lock` (a locked door's lock is a trap object with
`LOCK`), `glyph of warding` (`GLYPH`), `decoy`, `web`.

```
name:trap door:trap door          # short name : full name
appear:1:2:0                      # rarity : minimum depth : max on level (0 = unlimited)
visibility:2d10M50                # "power" — compared with the player's searching skill
flags:TRAP | FLOOR | DOWN
effect:DAMAGE
dice:2d8
save:FEATHER                      # object flag that avoids the trap entirely
msg:You fall through a trap door!
msg-good:You float gently down to the next level.
```

Flags that matter:

| Flag | Meaning |
|---|---|
| `TRAP`, `FLOOR` | needed for random generation |
| `VISIBLE` | never hidden |
| `ONETIME` | disappears after triggering (otherwise 1 in 3) |
| `DOWN` | drops you a level after the effect |
| `PIT` | you end up in the trap's grid (used when the trap is triggered from a distance, e.g. a pushed monster) |
| `MAGICAL` | disarmed with the magic disarm skill instead of the physical one |
| `SAVE_ARMOR` | avoided if a `check_hit(player, 125)` roll against your AC fails |
| `SAVE_THROW` | avoided on a saving-throw roll (`randint0(100) < SKILL_SAVE`) |
| `DELAY` | fires when you *leave* the grid rather than enter it |

### 17.1.1 The floor traps

| Trap (full name) | Min depth | Rarity | Effect | Avoidance |
|---|---|---|---|---|
| trap door | 2 | 1 | 2d8 damage, fall one level | `FEATHER`; never on quest levels, the last level, or persistent levels |
| pit / spiked pit / poison pit | 2 | 1 | 2d6; spiked: 50 % extra 2d6 + 4d6 cut; poison pit: extra poison | `FEATHER` |
| rune of summon foe | 3 | 1 | one monster up to 5 levels out of depth, `ONETIME MAGICAL` | — |
| rune of summoning / necromancy / dragonsong / hellhole | 3+ | 2 | summon `2+1d3` of any / undead / dragons / demons, `ONETIME MAGICAL`, `visibility:0` (never hidden) | — |
| teleport rune | 1 | 1 | teleport `M80` (80 % of the level's size), `MAGICAL` | — |
| fire trap / acid trap | 2 | 1 | `SPOT` of fire / acid on your grid, `4d(depth/2)`, `MAGICAL` | resistance reduces |
| slow dart / STR / DEX / CON loss darts | 2 | 1 | 1d4 damage and SLOW 20+1d20 / drain a stat | `SAVE_ARMOR` (a hit roll vs AC); sustain blocks the drain |
| blinding / confusion / poison / sleep gas | 2 | 1 | BLIND 25+1d50 / CONF 10+1d20 / POISON 10+1d20 / PARALYSED | `PROT_BLIND`, `PROT_CONF`, resist poison, `FREE_ACT` |
| aggravation trap / siren | | | wakes and hastes monsters | — |
| mine trap | 15 | 1 | shard `SPOT` radius 2, `2 × depth` damage, `ONETIME` | resist shards |
| blast trap | 25 | 2 | light 2d6, then sound, fire and force balls of radius 2 at depth-scaled damage, `ONETIME` | resists |
| mind blasting / brain smashing | | | as the monster spells, `MAGICAL` | saving throw |
| rock fall / earthquake / block fall / area blast | 4+ | 1 | rock fall: `depth d5` damage, stun 2d20 (no resist), leaves rubble, `ONETIME` | |
| mana drain trap | 5 | 1 | drains `1d depth` mana, `MAGICAL` | — |
| knife trap | 20 | 1 | cut 150 (a mortal wound) and `depth` damage | — |
| blinding flash / blinding trap | | | blindness | `PROT_BLIND` |
| petrifying trap | 5 | 1 | `STONESKIN` 20+1d20 and stun 20+1d20, `MAGICAL` | — |

`appear:rarity:min depth:max`; `pick_trap` chooses among eligible traps
with weight `100 / rarity`, so rarity-2 runes are half as common as the
rarity-1 traps.

---

## 17.2 Where traps come from

* Level generation: `randint1(k)/5` in corridors (none until depth 15),
  vault/template `^` (25 %) and `&`/`1` symbols (*Dungeon Generation*).
* Monster spell `TRAPS` (creates traps around you) and the
  `CREATE_TRAP`-style effects of some cursed items.
* Chests carry their own traps (17.6).

`place_trap(c, grid, -1, level)` picks a kind and rolls its `power`
from the `visibility:` expression at the trap level (`2d10M50` for a
trap door: 2–20 plus up to 50 with depth).

---

## 17.3 Finding traps

There is no search command and no "detect traps" spell in 4.2 in the
old sense; instead:

1. Every time a grid comes into view (`cave-view.c: update_one`),
   `square_reveal_trap(grid, always=false)` is called, which reveals each
   hidden trap whose `power ≤ skills[SKILL_SEARCH]`. Traps with
   `visibility:0` (the summoning runes) are always seen; a trap door with
   power 60 at depth 40 needs searching 60+.
2. The **Detect/Find Traps** effects (`DETECT_TRAPS`, from spells and
   rods) call it with `always = true` for the whole area, and mark the
   area as "trap-detected" (`SQUARE_DTRAP`), giving the green
   `DTrap` indicator on the status line. Stepping from a detected grid
   to an undetected one disturbs you and the indicator goes out (the
   check is in `move_player`).
3. Once a trap fires it becomes visible if it survives.

Searching skill (`SKILL_SEARCH`, the "Searching" line on the character
sheet) comes from race/class bases plus the `SEARCH` modifier on items.

---

## 17.4 Triggering (`hit_trap`)

Walking into a grid runs `player_handle_post_move` → `hit_trap(grid, 0)`
for non-`DELAY` traps; leaving runs the `DELAY` ones. For each `TRAP`
on the grid:

```
if trap safe (TMD_TRAPSAFE, or TRAP_IMMUNE flag): trap becomes visible, nothing happens
msg
saved = any save: object flag you have (and you learn that rune)
     or SAVE_ARMOR and check_hit(125) *misses* you      (AC helps: 0.12 + 0.83 × max(0, 125 − 2AC/3)/125 to hit)
     or SAVE_THROW and randint0(100) < SKILL_SAVE
if saved: msg-good
else:     msg-bad; run effect; 50 %: run effect-xtra (with msg-xtra)
DOWN → next level;  PIT → you are moved onto the trap grid if you weren't
ONETIME, or one_in_(3): trap removed;  else it stays and is now visible
```

**Walking onto a known trap** (`move_player(dir, disarm)`): the walk
command automatically attempts to *disarm* a known trap in the target
grid instead of stepping on it (auto-repeating up to 99 times), unless
you are trap-safe; the `jump` command (`W` / `-`) moves without
disarming. Running stops before known traps.

---

## 17.5 Disarming (`do_cmd_disarm_aux`, `D`)

```
skill = MAGICAL trap ? skills[SKILL_DISARM_MAGIC] : skills[SKILL_DISARM_PHYS]
if blind, no light, confused or hallucinating: skill /= 10
power  = depth / 5
chance = max(2, skill − power)          (percent)
randint0(100) < chance → disarmed, XP 1 + power
else randint0(100) < chance → "You failed to disarm" (may repeat)
else                        → "You set off the trap!" → hit_trap
```

So with 60 disarm skill at depth 40: 52 % success, 25 % harmless
failure, 23 % set it off, per attempt. A magical trap (runes, mind
blasts, petrifying) uses the magic disarm skill, which favours
spellcasters.

---

## 17.6 Doors

Door states (`terrain.txt`): open, broken, closed, closed-and-locked
(lock power 1–7 stored as a `door lock` trap), secret (a closed door not
yet found). See *Dungeon Generation* 16.6 for how they are placed and
found.

| Command | Rule |
|---|---|
| Open (`o`, or walk into it with `easy_alter`) | unlocked: opens, one turn. Locked: `calc_unlocking_chance = max(2, DISARM_PHYS − 4 × lock power)` % (skill ÷ 10 if blind/unlit, ÷ 10 again if confused/hallucinating). "You have picked the lock." / "You failed to pick the lock." (auto-repeats). A power-7 lock against 50 skill: 22 %. |
| Close (`c`) | closes an open door; broken doors cannot be closed. |
| Lock / jam (`D` on an unlocked closed door) | `power = m_bonus(7, depth)`; succeeds with `max(2, DISARM_PHYS − power)` %; the door gets that lock power. There are no spikes in 4.2. |
| Bash / tunnel | doors can be *tunnelled* (`T`): digging chance `(DIGGING × 4 − 119) / 3` per turn — see 17.7. There is no separate bash command for the player. |
| Monsters | `OPEN_DOOR` / `BASH_DOOR` rules in *Chapter 12* 12.5.4. |

Opening or closing a door updates the view (`PU_UPDATE_VIEW`) and
monster visibility.

---

## 17.7 Rubble, veins and walls (`do_cmd_tunnel_aux`, `T`)

Each attempt is one turn and succeeds if `chance > randint0(1600)`:

| Terrain (`terrain.txt` `digging:`) | Chance out of 1600 |
|---|---|
| rubble, passable rubble (1) | `DIGGING × 8` |
| magma vein, with or without treasure (2) | `(DIGGING − 10) × 4` |
| quartz vein, with or without treasure (3) | `(DIGGING − 20) × 2` |
| granite (4) | `(DIGGING − 40) × 1` |
| doors, secret doors (5) | `(DIGGING × 4 − 119) / 3` |

Permanent rock cannot be dug. `SKILL_DIGGING` = race/class base +
`TUNNEL` modifier × 20 from equipment (shovel +1, pick +2, dwarven
pick +3, egos more) + wielded weapon weight / 10 + the STR-based
`adj_str_dig` table (see *Player Stats* 4.11).
The command automatically swaps to your **best digger** in the pack
(`player_best_digger`) for the calculation, so you need not wield it.

Examples: digging skill 30 → rubble 240/1600 = 15 % per turn, magma
80/1600 = 5 %, quartz 20/1600 = 1.25 %, granite 0. Skill 100 (a
dwarven pick and good STR) → rubble 50 %, magma 22.5 %, quartz 10 %,
granite 3.75 %, doors 17 %.

Results: rubble removed ("You have removed the rubble") with a 10 %
chance of an object underneath in the dungeon; a treasure vein
(`*` on the map) drops gold (`place_gold` at the current depth);
otherwise "You have finished the tunnel." In the town, digging exposes
the grid to daylight.

`T` and walking both repeat automatically (`cmd_set_repeat(99)`) until
success or a disturbance.

---

## 17.8 Chests

Six kinds (`object.txt`): Small/Large wooden (level 5/15), Small/Large
iron (25/35), Small/Large steel (45/55). A chest's `pval` encodes its
state: 0 = open and empty (a "ruined" chest, auto-ignored), > 0 = locked
with that trap bitmask, < 0 = disarmed but still closed (|pval| kept for
the contents).

### 17.8.1 Traps on generation (`pick_chest_traps`, in `apply_magic`)

```
level = chest kind level
1 in 10: pval = 1 (locked, no trap: "NO_TRAP")
otherwise: one random trap of level ≤ chest level
   level > 5:  one more with probability 1 / (1 + (65 − level)/10)     (wooden 15: 1/6, iron 35: 1/4, steel 55: 1/2)
   level > 45: one more with probability 1 / (65 − level), and then 1 in 40 a fourth
```

`chest_trap.txt`:

| Trap | Min chest level | Effect |
|---|---|---|
| locked (no trap) | 1 | nothing |
| gas trap (poison) | 1 | poison 10+d20 |
| poison needle (STR / CON) | 2 / 3 | 1d4 damage and drain STR / CON |
| summoning runes | 15 | summon 2+1d3 monsters (`magic:1` — needs the magic disarm skill) |
| gas trap (paralyse) | 19 | paralysed 10+d20 (Free Action protects) |
| explosion device | 25 | 5d8 damage and **the contents are destroyed** |

### 17.8.2 Opening (`do_cmd_open_chest`)

```
locked (pval > 0): chance = max(2, DISARM_PHYS (÷10 blind/unlit, ÷10 confused) − pval) %
    success: "You have picked the lock." +1 XP; failure repeats
once open: unless trap-safe, every trap in the bitmask fires (all of them, in file order; an explosion stops the rest)
then chest_death: contents dropped
```

Note that `pval` is a *bitmask*, so a chest with several traps has a
larger lock value and is harder to pick — and that opening a trapped
chest without disarming sets off **all** its traps.

### 17.8.3 Disarming a chest (`do_cmd_disarm_chest`)

The trap must be known (`search()` reveals traps on adjacent known
chests automatically, "You have discovered a trap on the chest!"). Skill
is `DISARM_PHYS`, or `DISARM_MAGIC` if all traps are magical, or the
average if mixed; the same ÷10 penalties apply; `diff = max(2, skill −
pval)`. Success ("You have disarmed the chest.", XP = pval) sets
`pval = −pval`; a second roll under `diff` is a harmless failure;
otherwise the traps fire.

### 17.8.4 Contents (`chest_death`)

```
number = wooden 1, iron 2, steel 3
level  = chest's origin depth + 5
each item: make_object(level, good = true, great = Large chest, …), never another chest
dropped around the chest; the chest becomes empty (pval 0)
```

So a Large steel chest found at depth 50 yields three *great* objects at
level 55 — chests are one of the best sources of egos and artifacts in
the game, which is why they are worth carrying up to a safe spot
before opening (they are objects; `k` ignores an empty one).
