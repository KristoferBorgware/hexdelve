# Chapter 16 — Dungeon Generation

*Derived from Angband 4.2.6 (`generate.c`, `gen-cave.c`, `gen-room.c`,
`gen-util.c`, `gen-chunk.c`, `gen-monster.c`, `lib/gamedata/dungeon_profile.txt`,
`room_template.txt`, `vault.txt`, `pit.txt`, `constants.txt`).*

Every time the player changes level, `prepare_next_level` builds a new
`struct chunk` (the level), or restores a stored one when levels
persist. This chapter explains how the profile is chosen, how rooms,
vaults, tunnels and streamers are laid down, how stairs, monsters,
objects, rubble and traps are sprinkled in, and how the "level feeling"
is computed.

---

## 16.1 Dimensions and constants

| Constant (`constants.txt`) | Value | Meaning |
|---|---|---|
| `dungeon-hgt` / `dungeon-wid` | 66 × 198 | maximum level size in grids |
| `town-hgt` / `town-wid` | 22 × 66 | town size |
| `max-depth` | 128 | deepest level index; Morgoth is at 100, levels 101–127 exist but the game is "won" at 100 |
| `cent-max` | 100 | maximum rooms per level (`level_room_max`) |
| `door-max` / `wall-max` / `tunn-max` | 200 / 500 / 900 | tunnel bookkeeping arrays |
| `amt-room` (`room_item_av`) | 9 | average objects placed in rooms |
| `amt-item` (`both_item_av`) | 3 | average objects placed anywhere |
| `amt-gold` (`both_gold_av`) | 3 | average gold piles anywhere |
| `pit-max` | 2 | pits/nests per level |
| `mon-gen:level-min` (`level_monster_min`) | 14 | base number of monsters on a new level |
| `feeling-total` / `feeling-need` | 100 / 10 | feeling squares scattered on the level, and how many must be seen before the object feeling is revealed |
| `stair-skip` | 1 | levels skipped per staircase (1 = normal) |

---

## 16.2 Choosing a profile (`generate.c: choose_profile`)

```
depth 0                                   → "town"
quest level (Sauron 99, Morgoth 100)      → "classic"
labyrinth_check(depth)                    → "labyrinth"
depth 10–39 and one_in_(40)               → "moria"
otherwise: weighted choice among profiles with alloc > 0 and depth ≥ min-level
           (classic 90, modified 97, cavern 10 from depth 15, lair 1 from 20,
            gauntlet 1 from 20, hard centre 1 from 50)
```

`labyrinth_check`: never above depth 13; base chance 2 %, +1 % for each
of 3, 5, 7, 11, 13 that divides the depth. Depth 15 (3 and 5) → 4 %;
depth 30 (3, 5) → 4 %; depth 39 (3, 13) → 4 %; depth 105 (3, 5, 7) → 5 %.

So at depth 30 the odds are roughly: labyrinth 4 %, moria 2.4 %, then
of the remainder classic 90/198 = 45 %, modified 49 %, cavern 5 %,
lair 0.5 %, gauntlet 0.5 %. Below depth 50 "hard centre" joins at 0.5 %.

A wizard-mode jump (`NOSCORE_JUMPING`) lets you name the profile.

### 16.2.1 The profile record (`dungeon_profile.txt`)

```
name:classic
params:11:50:200:2          # block_size : rooms : unusual : max rarity
tunnel:10:30:15:25:50       # rnd : chg : con : pen : jct  (percent chances)
streamer:5:2:3:90:2:40      # den : rng : magma count : 1/mc treasure : quartz count : 1/qc
alloc:90
room:Greater vault:0:44:66:35:0:0:100
room:monster pit:0:11:33:5:1:2:8
...
room:simple room:0:11:33:1:0:0:100
room:staircase room:0:3:3:1:0:99:0
```

`room:name:rating:height:width:level:pit:rarity:cutoff` — the maximum
size (which determines how many 11×11 blocks it reserves in the
classic profile), the minimum depth, whether it counts against
`pit-max`, its rarity class (0 normal, 1 unusual, 2 very rare, 99 never
random) and the `cutoff` used to pick among rooms of the same rarity.

### 16.2.2 Room rarity roll

For each room attempt:

```
key = randint0(100)
rarity = 0
while rarity == i and i < max_rarity:
    if randint0(unusual) < 50 + depth/2: rarity++
    i++
```

With `unusual = 200`: at depth 20, `P(rarity ≥ 1) = 60/200 = 30 %`,
`P(rarity 2) = 9 %`; at depth 60, 40 % and 16 %. The profile's room list
is then scanned **in file order** for the first room whose `rarity ≤`
the rolled rarity and whose `cutoff > key`, and that room is tried;
if it fails to build (no space, depth restriction, greater-vault odds)
the scan continues to the next candidate. In the classic list with
rarity 2 and key 30: monster pit (cutoff 8) no, nest (16) no, Medium
vault (38) yes → try a medium vault; if that fails, Lesser vault (55),
then rarity-1 rooms (large room 15 no, crossed 35 yes)…

The room builders (`list-rooms.h` → `gen-room.c`):

| Room | Builder | Notes |
|---|---|---|
| staircase room | `build_staircase` | 3×3, only for persistent levels, placed on stair connectors |
| simple room | `build_simple` | rectangle; 1 in 20 has inner pillars, 1 in 50 ragged walls; lit if `depth ≤ randint1(25)` |
| moria room | `build_moria` | large ragged ovals (moria profile) |
| large room | `build_large` | rectangle with an inner room: plain, an inner vault with a monster and treasure, a pillar, a maze, or four quadrants |
| crossed room | `build_crossed` | two overlapping rectangles, optional centre feature (vault, pillars, "checkerboard") |
| circular room | `build_circular` | radius 2–?; 1 in 3 has an inner chamber with a monster, possibly hidden by a secret door |
| overlap room | `build_overlap` | two overlapping rectangles |
| room template | `build_template` | one of 415 templates in `room_template.txt` of the requested rating (1, 2 or 3) |
| Interesting room | `build_interesting` | one of the 66 "Interesting room" vaults |
| monster pit / nest | `build_pit`, `build_nest` | 16.5 |
| huge room | `build_huge` | very large ragged room with several inner rooms (modified profile, depth ≥ 40) |
| room of chambers | `build_room_of_chambers` | maze of small chambers filled with themed monsters (depth ≥ 10) |
| Lesser / Medium / Greater vault (and "(new)") | `build_vault_type` | 16.4 |

---

## 16.3 The classic and modified builders

### 16.3.1 Level size

```
i = randint1(10) + depth / 24
quest level → 100 %;  i < 2 → 75 %;  < 3 → 80 %;  < 4 → 85 %;  < 5 → 90 %;  < 6 → 95 %;  else 100 %
```

Classic: `num_rooms = 50 × size_percent / 100` rooms are *attempted*
(the comment in the source notes that with 11×11 blocks the 66×198
map has only 6 × 18 = 108 blocks, so the level fills up before the
target is reached). Modified: the map itself is shrunk to
`size_percent ± 5 %` of 66 × 198 and rooms are added until at least
`height × width / 7` floor grids exist and there are at least 2 rooms
(up to 500 attempts).

### 16.3.2 Room placement

**Classic** divides the map into `block_size` (11) squares; a random
untried block is picked, the room is built centred on the block
rectangle its size needs, and those blocks are reserved. Rooms cannot
overlap. **Modified** (`block_size 1`) lets each builder find its own
space with `find_space`, which searches for an unreserved rectangle,
allowing tighter packing and irregular layouts.

### 16.3.3 Tunnels (`do_traditional_tunneling`, `build_tunnel`)

The rooms' centres (`dun->cent[]`) are shuffled and each is connected
to the next in that order, the last to the first, by `build_tunnel`
from a random entrance grid of one room (`choose_random_entrance`)
toward the other. At each step the tunnel:

* heads towards the target, but with `tunnel:rnd` (10 %) picks a random
  direction, and with `chg` (30 %) changes direction;
* stops early with `con` (15 %) once it has reached a room;
* pierces outer room walls, recording the spot (up to `wall-max`) and
  placing a door there with `pen` (25 %) chance;
* at junctions with existing corridors places a door with `jct` (50 %).

`ensure_connectedness` then flood-fills from the first room and tunnels
to any room not yet reachable, so every level is connected (without
needing to dig). Doors placed by tunnels are open, closed, locked, or
jammed via `place_random_door` (16.6).

### 16.3.4 Streamers

`build_streamer(feat, chance)` starts near the map centre and random
walks in a fixed random direction until it leaves the map; at each
step it converts `den` (5) rock grids within `rng` (2) into the mineral
and, with `1/chance`, into a *treasure* vein (`FEAT_MAGMA_K` /
`FEAT_QUARTZ_K`, which drop gold when dug). Classic/modified: 3 magma
streamers with treasure 1 in 90, 2 quartz with 1 in 40.

### 16.3.5 Stairs, rubble, traps, monsters, objects

```
handle_level_stairs: down stairs rand_range(3, 4), up stairs rand_range(1, 2),
    at least min(width, height)/4 apart, preferring grids with 3 adjacent walls (corridor dead ends), then 2, 1, 0
k = max(min(depth / 3, 10), 2)                       /* "density" 2 … 10 */
rubble:  randint1(k) piles in corridors
traps:   randint1(k) / 5 in corridors (so none at all until k ≥ 5, depth 15)
player:  new_player_spot — a grid suiting stairs; with birth_connect_stairs the grid becomes the staircase you arrived by
monsters: level_monster_min (14) + randint1(8) + k, each placed by pick_and_place_distant_monster
          (out of the player's sight, sleeping, with escorts)  → 17–32 at depth 30
objects:  Rand_normal(9, 3) in rooms, Rand_normal(3, 3) anywhere, Rand_normal(3, 3) gold anywhere
```

Additional traps and objects come from rooms and vaults themselves
(template `^`, `&`, digits), and `place_trap` is also called for traps
in vault descriptions. The trap density here is deliberately low; most
traps you meet are in rooms and vaults or are created by monster
spells.

Quest levels (`is_quest`): after the builder runs, every quest monster
for this depth is placed with `find_empty` (Sauron at 99, Morgoth at
100); levels with fewer than 2 rooms or too many monsters are rejected
and regenerated (up to 100 tries).

---

## 16.4 Vaults (`vault.txt`, `build_vault`)

161 vaults: 27 Greater, 13 Greater (new), 14 Medium, 15 Medium (new),
14 Lesser, 12 Lesser (new), 66 Interesting rooms. Each has `rating:`
(added to the danger feeling), `rows`/`columns`, `min-depth`/`max-depth`,
optional `flags:` and the `D:` map.

**Selection** (`random_vault(depth, type)`): among vaults of the type
whose depth range includes the current depth, choose uniformly (reservoir
sampling, `one_in_(n)` for the n-th candidate).

**Greater vaults** are additionally gated by `help_greater_vault`: they
must be the first room built on the level; the chance is
`(2/3)^n` where `n` is the number of 10-level steps from the current
depth up to 90 — at depth 30, `n = 6`: `64/729 = 8.8 %`; at depth 60,
`n = 3`: 30 %; at depth 90+, 100 % — and outside the classic profile a
further 1-in-3 roll applies.

**Map symbols** (`build_vault`):

| Symbol | Result |
|---|---|
| `%` | outer wall (tunnels may connect) — `#` inner granite, `@` permanent rock |
| `*` | 50 % magma / 50 % quartz treasure vein |
| `:` | passable rubble 50 %, else rubble |
| `` ` `` | lava (`/` water and `;` tree are floor in Vanilla) |
| `+` | secret door |
| `^` | trap 25 % |
| `&` | object 75 %, else trap 25 % of the rest |
| `<`, `>` | stairs (down stairs omitted on quest levels; both omitted on persistent levels) |
| `1` | monster 50 %; else object 50 % (good 1 in 8); else trap 25 % |
| `2` / `6` / `0` | monster at depth +5 / +11 / +20 |
| `3` / `5` / `7` | object at depth +3 / +7 / +15 |
| `4` | 50 % monster +3, 50 % object +7 |
| `9` | monster +9 **and** good object +7 |
| `8` | monster +40 **and** great object +20 |
| `~` | chest at depth +5 |
| `$` | gold |
| `]` `|` `=` `"` `!` `?` `_` `-` `,` | armour / weapon (good, +3) and ring, amulet, potion, scroll, staff, wand-or-rod, food (good 1 in 4, +3) |
| letters | a monster of that base symbol (`get_vault_monsters`), chosen at depth for the vault type |

All vault grids are flagged `SQUARE_VAULT` (no teleport-into,
`icky`) and `SQUARE_MON_RESTRICT` during generation so random monsters
are not dropped inside. Vaults add their `rating` to `mon_rating` and
every out-of-depth monster and object adds to the feelings as usual.

---

## 16.5 Pits and nests (`build_pit`, `build_nest`, `pit.txt`)

Both are an 11×33 room with an inner 5×… chamber, one door, lit only at
shallow depth. `set_pit_type(depth, 1 or 2)` (see *Chapter 12* 12.9)
picks the profile. Then:

* **Pit**: 16 monsters are drawn with `get_mon_num(depth + 10)` under the
  profile's filter, sorted by level, and laid out symmetrically — the
  weakest at the edges, the two deepest in the very centre. Every
  monster is asleep. The room's `obj-rarity` gives each grid a chance
  of an object.
* **Nest**: 64 monster slots filled at random from the filtered table
  at `depth + 10`, no ordering.

The pit's total monster experience adds strongly to the danger feeling
(`mon_rating += level²` per monster), which is why "Omens of death"
usually means a pit, a nest or a greater vault.

Pits are limited to `pit-max` = 2 per level and have `rarity 2`
(`cutoff` 8 for pits, 16 for nests in the classic profile: a
pit is tried when rarity 2 is rolled and `key < 8`, i.e. about
`P(rarity 2) × 8 %`).

---

## 16.6 Doors (`place_random_door`, `place_closed_door`)

```
place_random_door:
    tmp = randint0(100)
    tmp < 30  → open door
    tmp < 40  → broken door
    else      → place_closed_door
place_closed_door:
    closed door; one_in_(4) → locked with power randint1(7)
```

Jammed (stuck) doors are not created by the generator in 4.2.6; they
come only from the player's own "lock/jam" command (`SPIKE` is gone,
`do_cmd_lock_door`) — see *Chapter 17*. `place_secret_door` creates a
closed door flagged secret; searching is automatic: every player turn
`search()` checks the 8 adjacent grids and, provided you are not blind,
in the dark, confused or hallucinating, reveals any secret door ("You
have found a secret door.") and any unknown trap on an adjacent known
chest. Opening, locking and bashing are in *Chapter 17*.

---

## 16.7 The other profiles

| Profile | How it is built |
|---|---|
| **cavern** (depth ≥ 15, alloc 10) | `cavern_chunk`: a cellular-automaton cave of 33–49 × 99–148 grids, joined into one connected region, no rooms; 1–3 down and 1–2 up stairs; density `k` scaled to area (min 6); `randint1(8)+k` monsters; objects at `depth + 5`, `Rand_normal(k, 2)` items, `k/2` gold, `k/4` good items. Never lit. |
| **labyrinth** (depth ≥ 13, `labyrinth_check`) | a perfect maze of `15 + 2×randint0(depth/10)` by `51 + 2×…` grids; `lit` if `randint0(depth) < 25` or 50 %; `known` (fully mapped on arrival) if lit and `randint0(depth) < 25`; walls are *soft* (diggable granite) if `randint0(depth) < 35` or 2 in 3, else permanent. One up and one down stair; monsters `14 + randint1(8) + k`; objects `Rand_normal(6k, 2)`, gold `3k`, plus `randint1(2)` good items. Not allowed in persistent dungeons. |
| **moria** (depth 10–39, 1 in 40) | modified-style level with `moria room`s (large ragged ovals) and monsters restricted to "Moria dwellers" (orcs, ogres, trolls, giants — the `pit.txt` profile of that name). |
| **lair** (depth ≥ 20, alloc 1) | a modified level joined to a cavern filled with one themed monster group (`pit.txt` type 3 via `set_pit_type(depth, 0)`); the cavern side gets `depth + 5` objects. |
| **gauntlet** (depth ≥ 20, alloc 1) | two caverns joined by an unmappable, un-teleportable labyrinth; the arrival cavern has only up stairs, so you must cross the gauntlet to descend. |
| **hard centre** (depth ≥ 50, alloc 1) | a greater vault in the middle surrounded by cavern. |
| **town** | see *Stores and the Town*. |
| **arena** | a tiny lit chunk used for the wizard/arena monster fight; not reachable normally. |

---

## 16.8 Persistent levels (`birth_levels_persist`)

With this birth option every level is stored (`cave_store`) when you
leave and restored (`chunk_find_name`) when you return, monsters and
objects included (`restore_monsters` catches up regeneration and timed
effects; scent is aged, noise forgotten). New levels are generated with
`staircase room`s at the positions of the stairs on the adjacent
levels (`get_join_info`, `build_staircase_rooms`) so that stairs line
up; labyrinths and the gauntlet are disabled. Without persistence, the
previous level is freed and any artifact left on its floor is either
permanently lost (`birth_lose_arts`) or made available for regeneration
(if it was never seen) or marked lost (if it was seen).

---

## 16.9 Level feelings

### 16.9.1 Ratings

* `mon_rating` — `place_new_monster_one` adds `level²` per monster, plus
  `(level − depth) × level` for out-of-depth ones; vaults add their
  `rating`.
* `obj_rating` — `place_object` adds `(value/100)²` where `value` is the
  object's real value inflated by out-of-depth-ness (*Objects* 14.8.2),
  capped so no single object exceeds 2.5 M value; any artifact also
  sets `good_item`.

### 16.9.2 Two numbers (`calc_mon_feeling`, `calc_obj_feeling`)

```
x = mon_rating / depth          x = obj_rating / depth
> 7000 → 1  "Omens of death"    artifact and birth_lose_arts → 1 (wondrous power)
> 4500 → 2  murderous           artifact and x < 641 → 6 (excellent... see below)
> 2500 → 3  terribly dangerous  > 160000 → 2  superb treasures
> 1500 → 4  anxious             >  40000 → 3  excellent
>  800 → 5  nervous             >  10000 → 4  very good
>  400 → 6  not too risky       >   2500 → 5  good
>  150 → 7  reasonably safe     >    640 → 6  something worthwhile
>   50 → 8  tame, sheltered     >    160 → 7  may not be much
else   → 9  quiet, peaceful     >     40 → 8  not many treasures
                                >     10 → 9  scraps of junk
                                else     → 10 naught but cobwebs
```

`cave->feeling = 10 × obj + mon`. The displayed line is
"<monster text>, and/yet <object text>" (`yet` when the two disagree in
tone), e.g. "You feel nervous about this place, yet there are superb
treasures here." The `LF:5-3` display on the status bar is
`mon feeling-obj feeling`.

### 16.9.3 When you learn it

The monster feeling is given on arrival. The object feeling stays
"still uncertain" until you have *seen* `feeling-need` = 10 of the 100
`SQUARE_FEEL` grids scattered over the level (`place_feeling`, and the
counter in `cave-view.c` when a feel grid becomes viewed), at which point
"You feel that…" is announced. `birth_feelings` turns the whole system
off.

---

## 16.10 Worked example: depth 35, classic profile

1. Not a quest level; labyrinth check 2 % (35 divides by 5 and 7: 4 %),
   fails; moria check fails; weighted roll picks classic (45 %).
2. `i = randint1(10) + 1`; say 7 → size 100 %, 50 rooms attempted on
   the 6 × 18 block grid.
3. Attempt 1: rarity roll — `randint0(200) < 67` → 33 % rarity ≥ 1, 11 %
   rarity 2. Suppose rarity 0, key 60: the first rarity-0 room with
   cutoff > 60 in list order is "overlap room" (70). Built.
4. Attempt 7: rarity 2, key 12: pit (8) no, nest (16) yes → `set_pit_type`
   picks, say, "Orc" (level 10, rarity 1 — closest average via
   `Rand_normal(ave, 10)` and passing `one_in_(rarity)`). 64 orcs from
   `get_mon_num(45)` filtered to orcs. `mon_rating` jumps by ~64 × 15².
5. Remaining attempts fill blocks; ~25 rooms exist when all 108 blocks
   are tried. Rooms are tunnelled in shuffled order; 3 magma, 2 quartz
   streamers.
6. Stairs: 3–4 `>`, 1–2 `<`, at least 16 apart. `k = 10`: 1–10 rubble,
   0–2 traps in corridors. Player placed in a corridor dead end (arrives
   on a connected staircase if the option is on).
7. Monsters: `14 + randint1(8) + 10 = 25–32` placed out of sight, asleep.
   Objects: ~9 in rooms, ~3 anywhere, ~3 gold. A 1-in-1000 special
   artifact roll and the `good`/`great` rolls happen per object
   (*Objects* 14.3).
8. Feelings: `mon_rating / 35` with the nest ≈ 64 × 225 / 35 ≈ 411 → "not
   too risky"… but the nest's own monsters plus 30 others at level
   ~35 (1225 each) add another ~1000 → total ≈ 1400 → "You feel
   anxious about this place". `obj_rating` depends on what was rolled;
   with nothing special, `x` is typically 40–640 → "there may not be
   much interesting here".
