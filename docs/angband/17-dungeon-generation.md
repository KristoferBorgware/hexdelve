# 17. Dungeon generation

A level is built from nothing every time it is entered. `cave_generate()` picks a **cave profile**, calls that profile's builder, and retries up to 100 times if the builder reports failure; the builder lays out terrain, carves rooms, connects them with tunnels, adds streamers, stairs, rubble, traps, monsters and objects, and finally has the level rated for its feeling. The profiles are data (`dungeon_profile.txt`), the layouts are code (`gen-cave.c`), and the rooms are a mixture of both — nine builders in `gen-room.c` plus 161 hand-drawn vaults and 415 room templates.

Sources: `generate.c` (driver and profile choice), `gen-cave.c` (the ten level layouts), `gen-room.c` (room builders, vaults, templates), `gen-util.c` (placement helpers), `gen-chunk.c` (persistent levels), `gen-monster.c` (pit and nest population).

## 17.1 The profiles

| Profile | `params` (block, rooms, unusual, rarity) | `alloc` | `min-level` |
|---|---|---|---|
| town | 1, 0, 200, 0 | −1 | – |
| labyrinth | 1, 0, 200, 0 | −1 | – |
| cavern | 1, 0, 200, 0 | 10 | 15 |
| classic | **11**, 50, 200, 2 | 90 | – |
| modified | 1, 50, 300, 2 | 97 | – |
| moria | 1, 50, 250, 2 | −1 | – |
| lair | 1, 50, 500, 2 | 1 | 20 |
| gauntlet | 1, 0, 200, 0 | 1 | 20 |
| hard centre | 1, 0, 200, 0 | 1 | 50 |

`block_size` is the granularity at which rooms reserve space. Classic uses 11, so its rooms occupy whole 11×11 blocks of a 66×198 level — a 6×18 grid of blocks, and the source notes the theoretical maximum is about 36 rooms, which is why its `rooms: 50` target is never reached and room building always ends by exhausting blocks rather than by hitting the count. Every other room-based profile uses `block_size` 1, so rooms are placed at grid resolution and pack much more tightly.

`unusual` divides the chance of an exotic room (17.3); higher makes rare rooms rarer, so lair at 500 is the most conservative and modified at 300 less generous than classic at 200. `rarity` caps how exotic a room may be.

`alloc` is the selection weight. `−1` means the profile is reachable only through a hard-coded test, and `0` or less than `−1` means it is unreachable.

## 17.2 Choosing one

`choose_profile()` tests in order, and the first four are hard-coded:

```
depth == 0                                    -> town
is_quest(depth)                               -> classic   (quest levels are always normal)
labyrinth_check(depth) && labyrinth reachable -> labyrinth
depth in [10, 40) && one_in_(40) && moria ok  -> moria
otherwise                    -> weighted draw by alloc among profiles meeting min-level
```

`labyrinth_check()` is the one place a level type depends on the *number* of the depth:

```c
if (depth < 13) return false;
chance = 2;
if (depth % 3 == 0) chance++;
if (depth % 5 == 0) chance++;
if (depth % 7 == 0) chance++;
if (depth % 11 == 0) chance++;
if (depth % 13 == 0) chance++;
return randint0(100) < chance;
```

So a labyrinth is a flat 2% below any interesting divisor and up to 5% on a level like 105, which is divisible by 3, 5 and 7. Everything else falls through to the weighted draw, where classic (90) and modified (97) dominate and cavern (10 from depth 15), lair, gauntlet and hard centre share what is left.

The whole generation attempt is wrapped in a retry loop:

```c
for (tries = 0; tries < 100 && error; tries++) { ... }
```

A builder that fails returns an error string — "less than two rooms created", "could not place player" — and the level is torn down and rebuilt from scratch. `uncreate_artifacts()` is called on the discarded level so that an artifact generated into a level that was thrown away is not spent (Object Generation chapter 15.6).

## 17.3 Rooms, rarity and cutoff

Each profile lists its rooms as `room: name : rating : height : width : level : pit : rarity : cutoff`. `classic_gen()` walks unreserved blocks in random order and, for each, rolls two numbers:

```c
key = randint0(100);

i = 0; rarity = 0;
while (i == rarity && i < profile->max_rarity) {
	if (randint0(dun_unusual) < 50 + c->depth / 2) rarity++;
	i++;
}
```

`rarity` climbs only while every roll so far has succeeded, so the chance of reaching rarity 1 is `(50 + depth/2) / unusual` and rarity 2 is that squared. At depth 50 in the classic profile that is 75/200 = 37.5% for rarity 1 and 14% for rarity 2. Depth enters *only* here — it makes exotic rooms more likely, and does nothing else to the room mix.

The profile's room list is then scanned **in order** for the first entry with `rarity <= rarity` and `cutoff > key`, and that room is built. Because the list is ordered and cutoffs are cumulative thresholds rather than weights, the ordering in `dungeon_profile.txt` is the priority: greater vaults are listed first with rarity 0 and cutoff 100, so they are eligible on every roll, and are rare only because `room_build()` rejects them for want of space far more often than it accepts them.

`room_build()` enforces two further limits: the room's own `level` as a minimum depth, and `z_info->level_pit_max` (2) as the maximum number of pit or nest rooms per level.

If fewer than two rooms are built the whole level is scrapped and the loop in 17.2 tries again.

## 17.4 Vaults and room templates

Both are drawn as ASCII in data files and placed by a builder that reads the grid.

`vault.txt` holds 161 entries across seven types — 27 Greater vaults, 13 Greater (new), 14 Lesser, 12 Lesser (new), 14 Medium, 15 Medium (new) and 66 Interesting rooms — each with `rows`, `columns`, a `rating` added directly to the level's monster rating, and optional `min-depth`/`max-depth`. `room_template.txt` holds 415 smaller pieces with a `doors` count and an optional `tval` for the treasure they contain.

The symbol table is where the difficulty of a vault comes from, since it encodes out-of-depth generation per square:

| Symbol | Contents |
|---|---|
| `%` `#` `@` `*` `:` | Outside (corridors may connect), granite, impenetrable rock, treasure vein, rubble |
| `+` `^` `<` `>` | Secret door, trap (25%), up stair, down stair |
| `&` | Treasure 75%, trap 6.25% |
| `1` | Monster 50%, object 25%, trap 6.25% |
| `2` `3` | Monster +5 levels; object +3 levels |
| `4` | Monster +3 and/or treasure +7, 50% each |
| `5` `6` `7` | Object +7; monster +11; object +15 |
| `9` | Monster +9 **and** treasure +7 |
| `0` | Monster +20 |
| `8` | Monster +40 **and** treasure +20 |
| `~` `$` | Chest +5; gold |
| `]` `\|` `=` `"` `!` `?` `_` `-` `,` | Armour, weapon, ring, amulet, potion, scroll, staff, rod or wand, food — all +3 levels |

`<` is skipped on persistent levels and `>` on persistent and quest levels, so a vault cannot hand a player a staircase out of a level they are meant to finish.

## 17.5 Tunnelling

`do_traditional_tunneling()` connects the recorded room centres in sequence with `build_tunnel()`, a random walk from one point towards another governed by the profile's five `tunnel:` percentages — `rnd` (take a random direction instead of the correct one), `chg` (change direction at any grid), `con` (terminate early), `pen` (put a door at a room entrance), `jct` (put a door at a junction). Classic uses `10:30:15:25:50`.

The walk is capped at 2000 iterations against infinite loops, and `ensure_connectedness()` runs afterwards to join anything the tunnels missed, so a level is never generated with an unreachable room.

## 17.6 What is scattered afterwards

`classic_gen()` finishes with a fixed sequence:

```c
draw_rectangle(...FEAT_PERM...);                     /* permanent wall border */
do_traditional_tunneling(c); ensure_connectedness(c, true);
for (i = 0; i < profile->str.mag; i++) build_streamer(c, FEAT_MAGMA, profile->str.mc);
for (i = 0; i < profile->str.qua; i++) build_streamer(c, FEAT_QUARTZ, profile->str.qc);
handle_level_stairs(c, persist, quest, rand_range(3, 4), rand_range(1, 2));
k = MAX(MIN(c->depth / 3, 10), 2);
alloc_objects(c, SET_CORR, TYP_RUBBLE, randint1(k), depth, 0);
alloc_objects(c, SET_CORR, TYP_TRAP, randint1(k) / 5, depth, 0);
new_player_spot(c, p);
/* then monsters, then objects and gold (Object Generation chapter 15.9) */
```

`k` is the level's general density figure, `depth/3` clamped to 2–10, and both rubble and traps are drawn from it — traps at a fifth the rate. Streamers are random walks that stop at the dungeon edge, laying `den` grids of magma or quartz within `rng` of each step, with `1/mc` and `1/qc` of them bearing treasure; classic gets 3 magma at 1-in-90 and 2 quartz at 1-in-40.

Stairs are placed **away from each other** — `alloc_stairs()` takes a minimum separation, tightened on persistent levels so the staircase rooms do not overlap. Three or four down and one or two up is the classic allowance, and `stair_skip` in `constants.txt` (1) governs how far a staircase carries the player.

## 17.7 The other layouts

| Profile | Shape |
|---|---|
| **labyrinth** | A true maze, no rooms, smaller than a normal level. Walls are listed, shuffled and removed with a disjoint-set test, which is Kruskal's algorithm and yields a perfect maze. `lit = randint0(depth) < 25 \|\| one_in_(2)`, so most labyrinths are lit and deep ones are lit half the time. Refused outright on persistent levels |
| **cavern** | Organic open cave from depth 15, half to three-quarters of full size, built by repeatedly applying `mutate_cavern()` to random noise — a cellular automaton |
| **modified** | Classic's room set at `block_size` 1, so rooms pack tightly; adds huge rooms, rooms of chambers, and the "new" vault sets |
| **moria** | Only reachable by the 1-in-40 test between depths 10 and 39; moria rooms and interesting rooms, no simple rooms |
| **lair** | Two chunks side by side: one ordinary level and one monster lair, joined. `unusual` 500 makes exotic rooms rare in the normal half |
| **gauntlet** | Four chunks in a row — arrival, left, the gauntlet itself (a labyrinth `2·randint1(5)+3` by `2·randint1(10)+19`), and right — so the only route through is the maze |
| **hard centre** | From depth 50: a vault at the centre with four generated caverns around it, above, below, left and right |
| **arena** | Not chosen by profile at all — `cave_generate()` branches to `arena_gen()` first when `arena_level` is set, and lights the whole level |
| **town** | Built once, then stored and reloaded |

The town is the only level that persists without the persistent-levels option. `town_gen()` looks for a stored chunk named "Town"; on the first visit it runs `town_gen_layout()`, and thereafter it copies the stored chunk back and hunts for the down staircase. Its resident count comes from `town_monsters_day` or `town_monsters_night` depending on `is_daytime()`.

## 17.8 Level feeling

Two ratings are accumulated during generation and converted at the end:

- **`obj_rating`** gains `(value/100)²` for every object placed, with the value clamped to ±2,500,000 first — so it is dominated by the single best item rather than by the count. `good_item` is set by any artifact.
- **`mon_rating`** gains `race->level²` for every monster placed, plus `(race->level − depth) * race->level / 10` for an out-of-depth one. Vaults add their `rating:` field directly, and pits and nests add `dun->pit_type->ave / 20` plus a size term.

```c
chunk->feeling = calc_obj_feeling(chunk, p) + calc_mon_feeling(chunk);
```

`calc_obj_feeling()` returns a multiple of ten from 100 (nothing) down to 20 (superb), or 10 for an artifact when `birth_lose_arts` is on, and `calc_mon_feeling()` returns 1 (most dangerous) to 9. Both divide their rating by the depth first, so the same absolute treasure is less remarkable deeper down. The UI unpacks the sum with `feeling / 10` and `feeling - 10 * that`.

An artifact on the level forces the object feeling to at least 60 when it would otherwise be lower, so a level holding an artifact never reads as entirely dull.

The feeling is not shown immediately: `feeling_need` (10) FEEL squares must be seen before the object half is revealed (Movement chapter 6.8), so the player must explore a tenth of the level's marked squares to learn what is on it.

## 17.9 Persistent levels

With `birth_levels_persist`, generated levels are kept in a chunk list rather than discarded. `chunk_write()` copies a level out, `chunk_find_name()` and `chunk_find_adjacent()` retrieve one, and `chunk_copy()` restores it — adding the stored level's `obj_rating`, `good_item` and `mon_rating` back to the new chunk so the feeling survives the round trip.

`chunk_copy()` can also apply a **symmetry transform** — reflection and transposition, chosen by `get_random_symmetry_transform()` — which is how the same stored piece is reused at a different orientation.

Persistent levels change generation in three places: `build_staircase_rooms()` is called to guarantee connected stairs, trap doors are excluded from the trap pool (Traps chapter 14.3), and `<` and `>` in vault layouts are skipped.
