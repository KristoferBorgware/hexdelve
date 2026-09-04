# 15. Objects: kinds, generation, egos and artifacts

An object in play is built from up to four layers, each of which may add flags, modifiers, resistances, slays, brands, curses and an activation: the **base** (the tval's shared properties, `object_base.txt`), the **kind** (the specific item, `object.txt`), the **ego** (an optional affix, `ego_item.txt`) and the **artifact** (an optional named replacement for everything above the base, `artifact.txt`). Curses (`curse.txt`) are a fifth, orthogonal layer that can attach to any of them. This chapter covers how an object is chosen, built and made better or worse; what the player then learns about it, how it is carried and what it is worth are in the Object Knowledge chapter.

The data are 34 bases, 375 kinds, 107 egos, 138 artifacts and 27 curses. Generation lives in `obj-make.c`, random artifacts in `obj-randart.c`, curses in `obj-curse.c`.

## 15.1 The layers

`struct object` (`object.h`) carries the resolved result rather than a chain of pointers, so every routine that reads an object reads one flat record. `obj->kind` always points at a kind; `obj->ego` and `obj->artifact` are set or null. The fields that matter downstream are the combat trio `to_h`/`to_d`/`to_a`, the dice `dd`/`ds`, `ac`, `weight`, the eleven `modifiers[]`, the 39 object flags, `el_info[]` per element, the slay and brand lists, `curses`, `effect`/`activation` with its `time`, and `pval` — which means charges on a wand or staff, fuel on a light, and the trap bit set on a chest (Traps chapter 14.10).

| Layer | Contributes | Combined by |
|---|---|---|
| Base | Default flags (`HATES_ACID`, `SHOW_DICE`), breakage chance, `max-stack` | Copied first by `object_prep()` |
| Kind | Everything in the `object.txt` record | Copied over the base |
| Ego | Bonuses, extra flags, one or more random properties | Added by `ego_apply_magic()` |
| Artifact | Replaces dice, AC, modifiers, flags, activation wholesale | `copy_artifact_data()` |
| Curse | Adds its own flags, values, weight change and a timed effect | `append_object_curse()` |

The eleven modifiers are `STEALTH`, `SEARCH`, `INFRA`, `TUNNEL`, `SPEED`, `BLOWS`, `SHOTS`, `MIGHT`, `LIGHT`, `DAM_RED` and `MOVES`; what each does is in the Player Stats chapter. Ego and kind modifiers **add**, whereas resistances take the **maximum** of the two — two sources of resist fire do not stack, and two sources of `+2 STEALTH` do.

## 15.2 The allocation table

`alloc_init_objects()` builds, once at startup, a cumulative probability table indexed by `[level][kind]` for every level from 0 to `obj-make:max-depth` (100):

```c
rarity = kind->alloc_prob;
if (lev < kind->alloc_min || lev > kind->alloc_max) rarity = 0;
obj_alloc[lev][item + 1] = obj_alloc[lev][item] + rarity;
```

and a second table, `obj_alloc_great`, identical except that `rarity` is also zeroed for any kind failing `kind_is_good()`. The `alloc:` line of a kind supplies all three numbers — `alloc:20:10 to 100` is commonness 20 between levels 10 and 100 — so a kind is unreachable outside its band and uniformly weighted inside it. Depth changes *which* kinds are in the pool, never their relative weight within it.

`kind_is_good()` is deliberately crude: armour with a non-negative minimum `to_a`, weapons with non-negative minimum `to_h` and `to_d`, all arrows and bolts, and anything flagged `KF_GOOD`. It tests the *kind*, so a "good" roll can still produce a cursed instance.

`get_obj_num(level, good, tval)` draws from whichever table by binary search, after one modification:

```c
if (level > 0 && one_in_(z_info->great_obj))          /* great-obj: 20 */
	level = 1 + (level * z_info->max_obj_depth / randint1(z_info->max_obj_depth));
```

One object in twenty has its generation level rolled forward. The divisor is uniform on 1–100, so the multiplier is `100/roll`: usually near 1, occasionally enormous, clamped at 100. This single line is where an out-of-depth item on level 5 comes from, and its shape — close to the requested level most of the time, with a long tail — is why deep items on shallow levels are rare rather than absent.

## 15.3 `make_object()`

```c
/* 1. Special artifacts first */
if (one_in_(good ? 10 : 1000)) {
	new_obj = make_artifact_special(lev, tval);
	if (new_obj) return new_obj;
	good = true;                    /* consolation for a failed roll */
}

/* 2. Pick a kind */
base = good ? lev + 10 : lev;
kind = get_obj_num(base, good || great, tval);
/* books the player cannot read are rejected, up to 3 tries, with a 1-in-5 let-through */

/* 3. Build it */
object_prep(new_obj, kind, lev, RANDOMISE);
apply_magic(new_obj, lev, true, good, great, extra_roll);

/* 4. Stacks */
if (!artifact && kind->gen_mult_prob >= randint1(100))
	number = randcalc(kind->stack_size, lev, RANDOMISE);
number = MIN(number, kind->base->max_stack);
```

Three things are worth pulling out. The `good` flag adds **ten levels** to the kind draw as well as selecting the restricted table, so a "good" object is drawn deeper and from a better pool at once. A failed special-artifact roll upgrades the request to `good` rather than returning nothing. And the book rejection is not absolute: a book of a realm the character cannot read still appears one time in five, which is what keeps the other classes' books in circulation for sale.

`make_object()` also reports an inflated value to its caller when the kind's `alloc_min` is deeper than the current level — 20% more per level out of depth — which the level-feeling code reads, and which does not affect the object itself.

## 15.4 `apply_magic()`

Everything that separates a plain Long Sword from a Long Sword (+7,+8) of Extra Attacks happens here.

```c
good_chance  = 33 + lev;      /* percent */
great_chance = 30;            /* percent, flat */

if (good  || randint0(100) < good_chance)  { power = 1;
	if (great || randint0(100) < great_chance) power = 2; }
```

`power` 0 is a plain object, 1 is "good", 2 is "excellent". The good chance passes 100% at level 67, so every object generated below that depth is at least good; the great chance is a flat 30% and never changes with depth. What changes with depth is the *size* of the bonuses, through `m_bonus()`.

| `power` | Weapons | Armour |
|---|---|---|
| ≤ 0 | Nothing | Nothing |
| 1 | `to_h`, `to_d` each `+randint1(5) + m_bonus(5, lev)` | `to_a += randint1(5) + m_bonus(5, lev)` |
| 2 | The above, plus `m_bonus(10, lev)` on each, plus dice supercharging | The above plus `m_bonus(10, lev)` |

**Dice supercharging** applies to melee weapons at `power == 2` and is the reason a deep Main Gauche can out-damage a shallow Executioner's Sword:

```c
while (dd * ds > 0 && one_in_(4 * dd * ds)) {
	if (randint0(dd + ds) < dd) { /* add dice, capped at (dd+1)*ds <= 40 */ }
	else                        { /* add sides, capped at dd*(ds+1) <= 40 */ }
}
```

The loop re-rolls after every success, so a weapon that has already grown is more likely to grow again — but the trigger chance is `1/(4·dd·ds)`, which falls as it grows, and the total is capped at 40 average-adjusted. Ammunition gets a simpler treatment: `one_in_(6)` for `+1` side and then `one_in_(10)` for a second.

Artifact rolls happen before the ego attempt and short-circuit it: one roll at `power == 2`, two if `great` was forced, and two more if `extra_roll` is set (unique drops and Acquirement). A ring of Speed additionally supercharges — `while (one_in_(2)) modifiers[SPEED]++` — which is an unbounded geometric series and the reason a `+10` speed ring exists at all.

## 15.5 Ego items

An ego is an affix with its own allocation band, its own possible-item list, and optional randomness of its own. `make_ego_item()` is reached only at `power == 2` and only for objects that are not already artifacts or egos.

`ego_find_random()` walks every ego with a non-zero `alloc_prob` and keeps those where:

- `level <= ego->alloc_max` — strict; an ego is never generated below its band;
- `level >= ego->alloc_min`, **or** `one_in_(MAX(2, (alloc_min - level) / 3))` — the out-of-depth let-through, which is generous: three levels short is a 1-in-2 chance, and the floor of 2 means being one level short is also 1-in-2;
- the object's kind appears in the ego's `poss_items` list, built from its `type:` and `item:` lines.

Survivors are weighted by `alloc_prob` and one is drawn. Before that, `make_ego_item()` applies the same 1-in-20 level inflation as object kinds, this time against `max_depth` (128) rather than `max_obj_depth`.

`ego_apply_magic()` then adds the ego's `combat:` bonuses, adds its modifiers, unions its flags and subtracts its `flags-off`, copies its slays, brands and curses, takes the **maximum** of its and the object's resistance per element, and overwrites the activation if it has one. Random properties come from the ego's kind flags:

| Kind flag | Adds |
|---|---|
| `RAND_SUSTAIN` | One sustain the object lacks |
| `RAND_POWER` | One protection or miscellaneous flag the object lacks |
| `RAND_BASE_RES` | One base-element resistance the object lacks |
| `RAND_HI_RES` | One high-element resistance the object lacks |
| `RAND_RES_POWER` | Rolls 1–3: a power on 1, a base resist on 2 or 3 |

`get_new_attr()` picks among the available flags by reservoir sampling (`one_in_(++options)`), which gives a uniform choice in one pass and returns 0 when the object already has all of them — so an ego rolled onto an item that already carries the property silently gets nothing.

Finally `ego_apply_minima()` raises `to_h`, `to_d`, `to_a` and every modifier to the ego's `min-combat:` and `min-values:` floors. This runs **after** the curse step in `apply_magic()`, so an ego's minimum wins over a curse's penalty on the same field.

## 15.6 Artifacts

Artifacts come in two kinds, distinguished by whether their base object exists as an ordinary kind.

**Special artifacts** have `KF_INSTA_ART` on their kind and are attempted first, from `make_object()` directly, at `one_in_(10)` for a good request and `one_in_(1000)` otherwise. `make_artifact_special()` scans `a_info` in order and takes the first that passes every test, which is why the source notes a preference for creating them in order.

**Normal artifacts** replace an ordinary object of the matching tval and sval, and are attempted from `apply_magic()` by `make_artifact()`.

Both apply the same four tests:

```c
if (is_artifact_created(art)) continue;              /* once per game, ever */
if (art->alloc_min > player->depth) {                /* shallow: loose */
	int d = (art->alloc_min - player->depth) * 2;
	if (randint0(d) != 0) continue;                  /* 1-in-2d chance */
}
if (art->alloc_max < player->depth) continue;        /* deep: strict */
if (randint1(100) > art->alloc_prob) continue;       /* rarity roll */
```

The asymmetry is deliberate: an artifact can appear arbitrarily far above its home depth at a chance falling as `1/(2·levels)`, and never once below its maximum. Artifacts are also refused in town and under the `birth_no_artifacts` option, and `make_artifact()` refuses any stack of more than one.

`copy_artifact_data()` overwrites the object's dice, AC, modifiers, flags, elements, slays, brands, curses and activation from the artifact record — the base object supplies only its tval, sval and weight. Ringil is a Long Sword whose `2d5` has become `4d5`, with `+22,+25`, six flags, `SPEED[10]`, two resistances, a cold brand, four slays and a cold-ball activation on a 40-turn timer.

`mark_artifact_created()` is what makes an artifact unique across the whole game rather than the level, and it is set at generation, not at pickup — an artifact generated in a vault the player never opens is spent.

## 15.7 Curses

A curse is stored as a `curse_data` entry (power and timeout) in the object's `curses` array, and it is a property of the object rather than of its kind: two identical rings may carry different curses. There are 27, each naming the object bases it can attach to, and each may carry flags, values, a weight change, combat penalties and a periodic effect.

`apply_curse()` runs from `apply_magic()` at `one_in_(20)` for wearable objects, and is refused outright by `OF_BLESSED`:

```c
max_curses = randint1(4);
power = randint1(9) + 10 * m_bonus(9, lev);
while (max_curses--) { /* 3 tries to find a curse legal for this tval */ }
```

Each curse that lands raises the object's generation level by `randint1(1 + power/10)`, so a cursed object is drawn as a deeper — and therefore better — object than it would otherwise have been. That is the trade the system is built on: curses are a way to put a stronger item in the player's hands with a string attached, not simply a penalty.

`append_object_curse()` refuses a curse that conflicts with one already present (`conflict:` lines), and refuses one whose timed effect the object already prevents — a curse of paralysis will not attach to an item with Free Action, checked through the same `timed_effects[].fail` table the player uses (Elements chapter 10.4).

Curses with a periodic effect fire from `process_world()`: every equipped object's every curse decrements its `timeout`, and on reaching zero runs its effect through `effect_do()` and re-rolls the timer from the curse's `time:` field. The siren curse (`time:100+1d50`) wakes the level around the player on that schedule.

## 15.8 Gold

`make_gold(lev, coin_type)` produces a `TV_GOLD` object whose `pval` is the amount. Gold is not drawn from the object allocation table at all:

```c
avg    = (16 * lev) / 10 + 16;        /* 16 at depth 0, 80 at 40, 176 at 100 */
spread = lev + 10;
value  = rand_spread(avg, spread);
while (one_in_(100) && value * 10 <= SHRT_MAX) value *= 10;
```

The 1-in-100 decimal multiplier repeats, so the distribution has no upper bound short of the `int16_t` cap on `pval`, and the source notes it lifts the mean to about 110% of `avg`. `money_kind()` then picks which coin or gem to call it, by where `value` falls as a fraction of `3 * max_depth + 30`; a named `coin_type` from a monster's drop overrides that, so creeping copper coins leave copper.

Under the `birth_no_selling` option every dungeon gold find is multiplied by five, which is how that option replaces the income a player would otherwise get from selling.

## 15.9 Where objects come from

| Source | Call |
|---|---|
| Room floors | `alloc_objects(c, SET_ROOM, TYP_OBJECT, Rand_normal(9, 3), depth, ORIGIN_FLOOR)` |
| Anywhere on the level | `Rand_normal(3, 3)` objects and `Rand_normal(3, 3)` gold |
| Vaults and pits | Their own `alloc_objects` calls with `TYP_GOOD` and `TYP_GREAT` |
| Monster drops | `mon_create_drop()` (Monsters chapter 13.6) |
| Chests | `chest_death()` at `origin_depth + 5`, forced good (Traps chapter 14.10) |
| Acquirement | `acquirement()` — `good = true`, `extra_roll = true`, so two extra artifact rolls |
| Stores | Their own stocking rules (Stores chapter) |

The `dun-gen:amt-room:9`, `amt-item:3` and `amt-gold:3` constants are the means of those normal distributions; other cave profiles substitute their own counts, and the labyrinth and cavern generators are markedly poorer than the classic one.

Every object records where it came from in `origin` and `origin_depth`, which is what the object description reports ("dropped by a wight on level 34") and what `chest_death()` reads to decide the quality of a chest's contents.

## 15.10 Random artifacts

With the `birth_randarts` option, `do_randart(seed, create_file)` replaces the whole of `a_info` at startup. It switches the RNG to the reproducible linear congruential generator (`Rand_quick`) seeded from the savefile, so a seed always yields the same set.

Only one thing survives from the standard artifact it replaces: its **power rating**, recorded by `store_base_power()` before anything is changed. Everything else is new. `parse_frequencies()` first measures how often each property occurs across the standard set, and that becomes the probability table properties are drawn from — so a randart set has roughly the standard set's distribution of resistances, slays and activations without any individual item being preserved.

Each artifact is then built to hit its recorded power:

1. Draw a **new base item kind** — not the original's — rejecting any whose own power is already close to the target, so there is room to add to it.
2. Attempt a supercharge, rolled back if it exceeds `23/20` of the target.
3. Repeatedly `add_ability()` and re-evaluate with `artifact_power()`, rolling back anything above `23/20` of the target and stopping once the result is at least `19/20` of it, for up to `MAX_TRIES` (200) iterations.
4. Some artifacts are designated cursed up front and run through `make_bad()`, keeping their power rating while spending part of it on penalties.
5. Rarity and depth are recomputed from the achieved power `ap` rather than inherited: `alloc_prob = 4000000/(ap²)` divided by the base kind's own commonness and clamped to 1–99, `alloc_max = min(127, 3·ap/5)`, and `alloc_min = min(100, (ap+100)·100/max_power)`.

The name is replaced too, by `artifact_gen_name()` assembling one from name fragments. Two things are exempt and stay exactly as written: the One Ring, and anything with `KF_QUEST_ART` — Grond and Morgoth's crown — since the endgame depends on them.
