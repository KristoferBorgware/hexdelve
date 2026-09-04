# Chapter 14 — Objects: Generation, Egos, Artifacts, Curses and Knowledge

*Derived from Angband 4.2.6 (`obj-make.c`, `obj-power.c`, `obj-curse.c`,
`obj-knowledge.c`, `obj-ignore.c`, `obj-util.c`, `lib/gamedata/object.txt`,
`object_base.txt`, `ego_item.txt`, `artifact.txt`, `curse.txt`,
`object_property.txt`, `constants.txt`).*

This chapter follows an object from the moment the game decides "put
something here" through to the player fully knowing it. Carrying,
wielding and stacking are in *Equipment and Inventory*; what devices and
potions *do* is in *Magic, Effects and Devices*.

---

## 14.1 The object data model

| Structure | Source | Count in 4.2.6 | Role |
|---|---|---|---|
| `struct object_base` | `object_base.txt` | one per tval | The type ("sword", "potion"): default glyph colour, `break:` chance when thrown (default 10 %), `max-stack:` (default 40), default flags such as `HATES_ACID`. |
| `struct object_kind` | `object.txt` | 375 | The kind: Long Sword, Potion of Cure Light Wounds. Base stats, allocation, effect, flavour. |
| `struct ego_item` | `ego_item.txt` | 107 | A modifier template ("of Elvenkind") applied on top of a kind. |
| `struct artifact` | `artifact.txt` | 138 | A unique fixed object; a *special* artifact (Phial, One Ring…) also defines its own kind. |
| `struct curse` | `curse.txt` | 27 | A named curse with its own effect, flags and timing. |
| `struct object` | runtime | — | One instance: kind, ego, artifact, dice, pluses, modifiers, flags, element info, curses (with power and timeout), charges/pval, timeout, number, inscription, `known` twin. |

Every object carries a second `struct object` at `obj->known` holding
only what the player has learned; the game shows and prices the *known*
object, not the real one (14.9).

### 14.1.1 The `object.txt` record

```
name:& Long Sword~            # & = article slot, ~ = plural slot
type:sword                    # tval (object_base)
graphics:|:W
level:10                      # "native" level, used for XP on learning
weight:130                    # tenth-pounds: 13 lb
cost:300
alloc:20:10 to 100            # commonness 20 at depths 10–100
attack:2d5:0:0                # dice : to-hit : to-dam
armor:0:0                     # base AC : to-ac
```

Other fields: `pile:chance:dice` (stack generation — arrows `pile:100:7d7`,
CLW potions `pile:90:2d3`), `charges:6+d10` (wands/staves), `power:` for
pricing effects, `effect:`/`dice:`/`expr:` (the effect chain, see
*Chapter 9*), `flags:`, `values:STEALTH[d4] | SPEED[4+M5]`, `brand:`,
`slay:`, `curse:name:power`, `pval:` (food value, launcher multiplier,
light radius), `msg:` and `desc:`.

### 14.1.2 Randomised values: `base + XdY + Mz`

Nearly every numeric field accepts `10+2d3M4`. `randcalc(value, level,
RANDOMISE)` evaluates:

* the base plus the dice roll, plus
* the **M** term: `m_bonus(z, level)` — a normal deviate with mean
  `z × level / 128` and standard deviation `z / 4`, clamped to `0…z`
  (see *Overview* 1.8 for `m_bonus`).

So `SPEED[4+M5]` on Boots of Elvenkind is +4 to +9, with the top of the
range only likely at deep levels. In `MINIMISE`/`MAXIMISE`/`AVERAGE`
aspects (used for shop stock, wizard mode and pricing) the dice are
fixed to their minimum, maximum or average.

### 14.1.3 Object flags, modifiers and elements

`object_property.txt` is the master list of every property an object can
have, with its `power:` weight for pricing:

| Kind | Members (power in brackets) |
|---|---|
| Stats (`values:`) | STR[9] INT[5] WIS[5] DEX[8] CON[12] per point |
| Modifiers (`values:`) | STEALTH[8] SEARCH[2] INFRA[4] TUNNEL[3] SPEED[20] DAM_RED[5] LIGHT[3]; BLOWS, SHOTS, MIGHT, MOVES are priced by dedicated formulas |
| Sustains | SUST_STR[9] INT[4] WIS[4] DEX[7] CON[8] |
| Protections | PROT_FEAR[6] PROT_BLIND[16] PROT_CONF[24] PROT_STUN[12] |
| Abilities | SLOW_DIGEST[2] FEATHER[1] REGEN[5] TELEPATHY[35] SEE_INVIS[6] FREE_ACT[8] HOLD_LIFE[5] IMPACT[10] BLESSED[1] TRAP_IMMUNE[5] |
| Light | LIGHT_2[9] LIGHT_3[18] BURNS_OUT TAKES_FUEL NO_FUEL[5] |
| Digging | DIG_1[3] DIG_2[6] DIG_3[9] |
| Bad | IMPAIR_HP[−8] IMPAIR_MANA[−8] AFRAID[−20] NO_TELEPORT[−20] AGGRAVATE[−20] DRAIN_EXP[−5] STICKY[−5] FRAGILE[−1] |
| Misc | EXPLODE THROWING[4] MULTIPLY_WEIGHT |
| Elements | `el_info[elem].res_level`: −1 vulnerable, 0 none, 1 resist, 3 immune; plus `HATES_x` (can be destroyed by x) and `IGNORE_x` (immune to that destruction) per element |

Kind flags (`KF_*`, on the kind only): `RAND_HI_RES`, `RAND_SUSTAIN`,
`RAND_POWER`, `RAND_BASE_RES`, `RAND_RES_POWER` (ego random extras),
`INSTA_ART` (special artifact), `QUEST_ART`, `EASY_KNOW` (fully known
once the flavour is), `GOOD` (counts as "good" for generation),
`SHOW_DICE`, `SHOW_MULT`, `TWO_HANDED` (unused)…

---

## 14.2 Which kind? — the allocation tables

`alloc_init_objects` builds, for every level 0–100 (`max_obj_depth`), a
cumulative probability table over all kinds: a kind contributes its
`alloc` commonness at every level between its min and max depth, and 0
outside. A second "great" table contains only kinds for which
`kind_is_good` is true:

* any body armour, shield, cloak, boots, gloves, helm, crown whose
  minimum `to_a` is not negative;
* any bow, sword, hafted, polearm, digger whose minimum `to_h` and
  `to_d` are not negative;
* arrows and bolts (shots are *not* good);
* anything with the `GOOD` kind flag (dragon armour, good potions and
  scrolls such as Healing, Enlightenment, high books, some rings and
  amulets).

`get_obj_num(level, good, tval)`:

```
if level > 0 and one_in_(great_obj = 20):
    level = 1 + level × 100 / randint1(100)      /* the "boost" */
level = clamp(level, 0, 100)
pick from the (good ? great : normal) table row for that level, by cumulative weight
```

The boost makes 1 object in 20 be generated as if much deeper — with
`randint1(100)` uniform, the boosted level is above `2 × level` half the
time and above `10 × level` one time in ten. This is the main source of
"out of depth" finds.

---

## 14.3 `make_object` — the generation pipeline

```
make_object(c, lev, good, great, extra_roll, &value, tval):
    if one_in_(good ? 10 : 1000):
        obj = make_artifact_special(lev, tval)       /* INSTA_ART artifacts only */
        if obj: return obj
        good = true                                  /* a failed special roll still upgrades */
    base = good ? lev + 10 : lev
    kind = get_obj_num(base, good or great, tval)   /* up to 3 re-rolls if an unreadable book */
    obj  = object_prep(kind, lev)                    /* dice, modifiers, charges, fuel, pluses from the kind */
    apply_magic(obj, lev, allow_artifacts=true, good, great, extra_roll)
    if not artifact and kind->gen_mult_prob ≥ randint1(100):
        number = randcalc(kind->stack_size)          /* the pile: line */
    number = min(number, base->max_stack)
```

`lev` here is the "object level" the caller passes: the dungeon depth
for floor items, the monster drop level (*Chapter 13* 13.6.2), the
store level for stock, `depth + 10` or more for vaults.

Books whose realm the player cannot read (`obj_kind_can_browse`) are
re-rolled up to three times, and each time 1 in 5 is kept anyway, so
other classes' books still appear, just less often.

### 14.3.1 `apply_magic` — how good is it?

```
good_chance  = 33 + lev      (%)
great_chance = 30            (%)
power = 0
if good or randint0(100) < good_chance:   power = 1
    if great or randint0(100) < great_chance:  power = 2

artifact rolls: power ≥ 2 → 1 roll; great → 2 rolls; extra_roll (unique drops) → +2 rolls
    each roll: make_artifact(obj) → if success, return 3 (artifact) immediately
if power == 2: make_ego_item(obj, lev)
if one_in_(20) and wearable: apply_curse(obj, lev)      /* curses can land on anything, even egos */
weapons:  apply_magic_weapon (14.3.2)
armour:   apply_magic_armour
ring of speed: while one_in_(2): SPEED += 1            /* +1, +2 (50 %), +3 (25 %)… on top of the kind's value */
chests:   pval = pick_chest_traps (see *Traps* 17.8)
ego_apply_minima: raise pluses/modifiers to the ego's min-combat/min-values
```

At depth 30 an ordinary item has a 63 % chance of power ≥ 1 and
`0.63 × 0.30 = 19 %` of power 2 (ego + artifact roll). A `good` drop has
100 %/30 %; a `great` drop is always power 2 with two artifact rolls.

### 14.3.2 Weapon and armour enchantment

```
power ≥ 1:  to_h += randint1(5) + m_bonus(5, lev)
            to_d += randint1(5) + m_bonus(5, lev)
power 2:    to_h += m_bonus(10, lev);  to_d += m_bonus(10, lev)
            melee weapons: dice growth loop
                while dd×ds > 0 and one_in_(4 × dd × ds):
                    if randint0(dd + ds) < dd:  grow dice count by up to randint1(2 + dd/ds), each step 2/3 chance, while (dd+1)×ds ≤ 40
                    else:                       grow sides likewise, while dd×(ds+1) ≤ 40
            ammo: 1 in 6 → ds += 1, then 1 in 10 → ds += 1 again
armour:     power ≥ 1: to_a += randint1(5) + m_bonus(5, lev);  power 2: += m_bonus(10, lev)
```

A power-2 Long Sword (2d5, product 10) enters the dice loop with
probability 1/40 per iteration; a Dagger (1d4) 1/16. The cap
`dd × ds ≤ 40` means a 4d10 or 5d8 is the most a non-artifact blade can
reach. Note that in 4.2 ordinary magic never gives *negative* pluses;
badness comes only from curses.

---

## 14.4 Ego items

### 14.4.1 `ego_item.txt`

```
name:of Elvenkind
info:200000:30                 # cost : level-feeling rating
alloc:3:60 to 127              # commonness 3, depths 60–127
item:boots:Pair of Leather Boots
item:boots:Pair of Iron Shod Boots
flags:FEATHER | IGNORE_ACID | IGNORE_FIRE
values:STEALTH[d4] | SPEED[4+M5]
min-values:STEALTH[1] | SPEED[1]
```

`type:` allows a whole tval, `item:` individual kinds. `combat:` adds
`to_h:to_d:to_a` (random expressions), `min-combat:` sets floors,
`flags-off:` removes kind flags (e.g. a torch ego removing `BURNS_OUT`),
`act:`/`time:` gives an activation, `brand:`/`slay:`/`curse:` add those.
The same name can exist for several bases (there are two "of Elvenkind"
egos: boots and body armour).

### 14.4.2 Choosing an ego (`make_ego_item`, `ego_find_random`)

```
if level > 0 and one_in_(great_ego = 20):
    level = 1 + level × 128 / randint1(128), capped at 127
for each ego (table sorted by alloc_min):
    if level ≤ alloc_max and (level ≥ alloc_min or one_in_(max(2, (alloc_min − level) / 3)))
       and the ego lists this kind:
        weight = alloc commonness
weighted random choice; none → no ego
```

The out-of-depth clause matters: at level 30, Boots of Elvenkind
(min 60) are still eligible with probability `1 / ((60 − 30)/3) = 1/10`,
and Boots of Speed (min 20) are always eligible. At level 15 Boots of
Speed are eligible 1 time in 2 (the `max(2, …)`).

### 14.4.3 Applying it (`ego_apply_magic`)

1. Random extras from the ego's kind flags: `RAND_SUSTAIN` adds one
   random sustain; `RAND_POWER` one random ability flag (protection or
   misc); `RAND_BASE_RES` one of the four base resists;
   `RAND_HI_RES` one high resist; `RAND_RES_POWER` picks 1 → power,
   2–3 → base resist. Random resists are tagged `EL_INFO_RANDOM` so the
   description says "(random resistance)" until learned.
2. `to_h`, `to_d`, `to_a` += the ego's `combat:` rolls.
3. Each `values:` modifier += its roll.
4. Flags unioned, `flags-off` removed.
5. Slays, brands, curses copied; resist levels take the max of kind and
   ego; activation replaces the kind's.
6. Later, `ego_apply_minima` enforces `min-combat:`/`min-values:`.

Some notable egos and their allocation (commonness : depth range):

| Ego | Base | Alloc | Effect |
|---|---|---|---|
| of Speed | boots | 3 : 20–127 | `SPEED[2+M8]` |
| of Elvenkind | boots | 3 : 60–127 | `STEALTH[d4] SPEED[4+M5] FEATHER` |
| of Elvenkind | body armour | 10 : 30–127 | `STEALTH[d3]`, all base resists, one random high resist (`RAND_HI_RES`) |
| of Resistance | body armour | 50 : 10–100 | four base resists |
| of Permanence | robe | 10 : 30–127 | sustains all, hold life, base resists, random high resist |
| of Free Action | boots / gloves | 20 : 1–40 / 100 : 1–60 | `FREE_ACT` |
| of Power | gloves | 5 : 30–127 | `STR[d5]`, `+d5/+d5` |
| (Holy Avenger) | weapon | 10 : 15–127 | `WIS[d4]`, slay evil/undead/demon, `SEE_INVIS BLESSED PROT_FEAR`, random sustain |
| of Westernesse | weapon | 10 : 10–70 | `STR/DEX/CON[d2]`, slay orc/troll/giant, `FREE_ACT SEE_INVIS` |
| of Extra Attacks | weapon | 10 : 10–127 | `BLOWS[d2]` |
| of Extra Might | launcher | 20 : 15–100 | `MIGHT[1]` |
| of Extra Shots | launcher | 10 : 15–100 | `SHOTS[2d3]` (tenths of a shot, min 2) |
| of Slay Orc | weapon | 150 : 1–20 | slay orc |
| of Flame / of Frost | weapon or launcher | 10–20 | fire / cold brand |

---

## 14.5 Artifacts

### 14.5.1 `artifact.txt`

```
name:of Galadriel
base-object:light:Phial       # tval : sval — a non-standard sval makes a *special* artifact
graphics:~:y
level:5                       # difficulty of the activation
weight:10
cost:10000
alloc:40:5 to 100             # 40 % pass chance, depths 5–100
attack:1d1:0:0
armor:0:0
flags:NO_FUEL
values:LIGHT[4]
act:ILLUMINATION
time:10+d10
```

Special artifacts (Phial, Star, Arkenstone, the amulets and rings such
as the One Ring, the Palantír, the "'Thengel'"-style items that have no
mundane base) carry `INSTA_ART` on their generated kind and are handled
by `make_artifact_special`; every other artifact is a *normal* artifact
layered on a regular kind (Ringil is a Long Sword) and is found only
when that kind happens to be generated.

### 14.5.2 The two roads to an artifact

**`make_artifact_special(level, tval)`** — called by `make_object` 1 time
in 1000 (1 in 10 for `good` objects): walk the artifact list in file
order; for each uncreated `INSTA_ART` artifact matching the requested
tval (if any):

```
if alloc_min > depth: continue unless randint0(2 × (alloc_min − depth)) == 0
if alloc_max < depth: continue
if randint1(100) > alloc_prob: continue
→ create it (object_prep at alloc_min level), mark created, return
```

**`make_artifact(obj)`** — called from `apply_magic` for each artifact
roll: walk all *non*-special artifacts whose tval **and** sval match the
object already generated, with the same three tests. The first one to
pass wins, so file order is a mild bias among artifacts of the same
kind.

Common rules: never in the town (`depth == 0`), never with
`birth_no_artifacts`, never for a stack (`number != 1`), never twice
(`is_artifact_created`; with `birth_lose_arts` off, an artifact left on
a level you abandon is marked "lost" but not re-creatable — see
*Chapter 19* on preserve/lose).

**Example**: the Phial (`alloc:40:5 to 100`). At depth 3 the depth test
passes only when `randint0(4) == 0`, then 40 %: 10 % per special roll.
At depth 5+ it is 40 % per special roll, but the special roll itself
happens 1 in 1000 objects, so at depth 10 you expect one Phial per
~2500 ordinary objects — unless a `good` drop (1 in 10) comes along.
Grond and the Crown (`alloc:0:100 to 100`) can never be generated
randomly; they come only from Morgoth's drop (*Chapter 13*).

### 14.5.3 Artifact power and the "level feeling"

Each ego's `info:cost:rating` and each artifact's power add to the level
feeling (`cave->obj_rating`) when placed; see *Dungeon Generation* for
how the feeling is computed. Artifacts are `IGNORE_MAX` (never ignored)
and never break, stack, or take curses from generation.

### 14.5.4 Random artifacts (`birth_randarts`, `obj-randart.c`)

With the option on, `do_randart(seed, create_file)` replaces the whole of
`a_info` at startup. It switches the RNG to the reproducible linear
congruential generator (`Rand_quick`) seeded from the savefile, so one
seed always yields one set.

Exactly one thing survives from the standard artifact being replaced: its
**power rating**, recorded by `store_base_power()` before anything
changes. `parse_frequencies()` then measures how often each property
occurs across the standard set, and that becomes the table properties are
drawn from — so a randart set keeps roughly the standard distribution of
resistances, slays and activations without any individual item surviving.

Each artifact is then built up to its recorded power `power`:

```
1. pick a NEW base item kind (not the original's), rejecting any whose own
   power is already close to the target, so there is room to add to it
2. try_supercharge, rolled back if the result exceeds 23/20 × power
3. loop up to MAX_TRIES (200):
       add_ability; remove_contradictory; ap = artifact_power()
       ap > 23/20 × power + 1 → roll back and continue
       ap >= 19/20 × power    → accept
4. some artifacts are designated cursed up front and run through make_bad(),
   keeping their power rating while spending part of it on penalties
5. rarity and depth are recomputed from the achieved power, not inherited:
       alloc_prob = 4000000 / ap²  ÷ the base kind's own commonness, clamped 1–99
       alloc_max  = min(127, 3 × ap / 5)
       alloc_min  = min(100, (ap + 100) × 100 / max_power)
```

The name is replaced too, assembled from fragments by
`artifact_gen_name()`. Two artifacts are exempt and stay exactly as
written: the One Ring, and anything flagged `KF_QUEST_ART` — Grond and
Morgoth's crown — because the endgame depends on them.

The `INHIBIT_*` caps of 14.8.1 are what stop this loop running away.

---

## 14.6 Gold (`make_gold`)

```
avg    = 16 × lev / 10 + 16
spread = lev + 10
value  = rand_spread(avg, spread)          /* uniform in avg ± spread */
while one_in_(100): value ×= 10            /* the occasional windfall */
if birth_no_selling and in the dungeon: value ×= 5
cap 32767
```

At depth 20: 48 ± 30 gold per pile, ×5 = 240 ± 150 with no-selling on.
The coin *kind* (copper, silver, garnets, gold, opals, sapphires, rubies,
diamonds, emeralds, mithril, adamantite) is chosen by value bands in
`money_kind`; it is purely cosmetic.

---

## 14.7 Curses

### 14.7.1 `curse.txt`

27 curses: vulnerability, teleportation, dullness, sickliness, enveloping,
irritation, weakness, clumsiness, slowness, annoyance, poison, siren,
hallucination, paralysis, dragon summon, demon summon, undead summon,
impair mana recovery, impair hitpoint recovery, cowardice, stone,
anti-teleportation, treacherous weapon, burning up, chilled to the bone,
steelskin, air swing.

```
name:teleportation
type:helm | crown | amulet | ring          # eligible bases
effect:TELEPORT
dice:40
time:d100                                  # average interval between firings
msg:Space warps around you.
conflict:anti-teleportation
conflict-flags:NO_TELEPORT
```

A curse may carry `combat:` penalties (vulnerability: `0:0:-50` to AC),
`flags:` (vulnerability also gives `AGGRAVATE`), `values:` (dullness
`INT[-5] WIS[-5]`…), `weight:` (multiplicative or additive change) and a
random `effect:` fired on a `time:` timer.

### 14.7.2 Getting cursed (`apply_curse`)

In `apply_magic`, 1 wearable item in 20 gets:

```
max_curses = randint1(4)
power      = randint1(9) + 10 × m_bonus(9, lev)      /* 1–9 shallow, up to 99 deep */
for each: pick a random curse (3 tries to find one valid for the tval)
          append_object_curse(obj, pick, power)
BLESSED objects are immune
```

`append_object_curse` refuses a curse that conflicts with one already
present (`conflict:`), whose timed effect is foiled by a property the
object already has (an object with `PROT_CONF` cannot get a confusion
curse), or which conflicts with a flag the object has (`conflict-flags`).
A duplicate pick only raises the power. Each accepted curse adds
`randint1(1 + power/10)` to the generation level used afterwards for the
enchantment rolls — cursed items are often *better* in their pluses.

### 14.7.3 Curse effects in play

Every player turn (`process_world`), for each equipped item with curses,
each curse's `timeout` is decremented; at 0 the curse effect fires
(`do_curse_effect`: message, then the effect in a random direction)
and the timeout is re-rolled from `time:`. Learning the curse
(`player_learn_curse`) happens the first time its effect is noticed.
Static parts of a curse (flags, modifiers, combat penalties) apply
continuously through `calc_bonuses` (*Player Stats* 4.4).

`STICKY` (from steelskin-type curses, and some artifacts) prevents
removal — "Hmmm, it seems to be stuck".

### 14.7.4 Removing curses (`uncurse_object`)

| Source | Strength |
|---|---|
| Scroll of Remove Curse | `20 + d20` |
| Scroll of *Remove Curse* | `50 + d50` |
| Staff of Remove Curse | `35 + d30` |
| Priest spell Remove Curse (level 16) and Paladin spell Remove Curse (level 20) | `plev + d(plev)` |

```
choose a curse on the item
if curse power ≥ 100:        permanent, cannot be removed
if strength ≥ curse power:   removed ("The X curse is removed!")
else if not FRAGILE:         "The spell fails; your X is now fragile."  (FRAGILE flag)
else if one_in_(4):          "There is a bang and a flash!" — object destroyed, 5d5 damage to you
else:                        nothing happens
```

So a weak scroll on a power-60 curse first makes the item fragile and
thereafter has a 25 % chance per failed attempt of destroying it.

---

## 14.8 Value and power

### 14.8.1 `object_power` (`obj-power.c`)

For wearables and ammo the price is derived from a single "power"
number summing:

* to-dam and dice power (average damage scaled by blows), ammo and
  launcher damage (with multiplier), extra blows/shots/might (each with
  `INHIBIT_POWER` caps that make absurd combinations unsellable);
* slays and brands (each multiplies the dice power by a weight from
  `slay.txt`/`brand.txt`);
* to-hit, base AC, to-AC;
* a bonus for jewellery;
* modifiers (each point × the `power:` value in `object_property.txt`,
  with speed 20/pt and stats 5–12/pt), flags (their `power:`), elements
  (resists 5–30ish, immunities much more, vulnerabilities negative),
  activations, curses (negative), and non-standard weight.

### 14.8.2 `object_value_real`

```
variable-power items (wearables, ammo):   value = power × (power + 5)    (0 if power ≤ 0)
    ammo and torches: value /= AMMO_RESCALER (20)
others:                                    value = kind cost
wands/staves:                              value += kind cost × charges / 20
× quantity
```

Stores show the *known* value (`object_value`, using `obj->known`), so an
unidentified rune on an item does not raise its price until learned.
`make_object` also inflates the reported value of a naturally
out-of-depth kind by `ood × value/5` for level-feeling purposes only.

---

## 14.9 Knowledge: runes, flavours and identification

4.2 has no "identify" spell; knowledge is **rune-based**. Each property
(each combat plus, each modifier, each element, each brand, slay, curse
and flag) is a *rune*. Once you have learned a rune, you see it on every
object that has it, immediately, forever. Until then an object with an
unknown property shows `{??}`.

### 14.9.1 Rune varieties

`RUNE_VAR_COMBAT` (to-hit, to-dam, to-AC), `RUNE_VAR_MOD` (stats and
modifiers), `RUNE_VAR_RESIST` (elements), `RUNE_VAR_BRAND`,
`RUNE_VAR_SLAY`, `RUNE_VAR_CURSE`, `RUNE_VAR_FLAG`.

### 14.9.2 When a rune is learned

| Trigger | Function | What is learned |
|---|---|---|
| Wield/wear | `object_learn_on_wield` | every *obvious* flag (`id-type: on wield` in `object_property.txt`: TELEPATHY, SEE_INVIS, BLESSED, light and digging flags, AFRAID, STICKY, FRAGILE, THROWING…), every non-zero modifier ("You feel strangely fast!"), any sustain of a stat the item modifies, and the curses' visible parts |
| Something happens | `equip_learn_flag`, `equip_learn_element` | `id-type: on effect` flags are learned when they matter: FREE_ACT when a paralysis attack fails, PROT_CONF when confusion is resisted, a sustain when a drain is shrugged off, a resist when you take that element |
| Time | `equip_learn_after_time` (`id-type: timed`) | REGEN, SLOW_DIGEST, IMPAIR_HP, IMPAIR_MANA, AGGRAVATE, DRAIN_EXP are noticed after a while worn (checked from the world loop) |
| Hitting a monster | `player_learn_brand`, `player_learn_slay` | the brand/slay that applied (and the monster lore flag) |
| Being hit / hitting with a weapon | `object_learn_on_...` in `player-attack.c` | to-hit and to-dam runes after enough attacks; to-AC after being hit |
| Using it | `object_learn_on_use` | the *flavour* (potion/scroll/wand/staff/rod/ring/amulet kind) becomes aware; XP `(kind level + plev/2) / plev` |
| Identify Rune effect (scroll of Identify Rune / Mage spell) | `object_learn_unknown_rune` | one unknown rune on the chosen object |
| Pick-up with race flags | `inven_carry` | Hobbits (`KNOW_MUSHROOM`, "Mushrooms for breakfast!") know mushrooms and Gnomes (`KNOW_ZAPPER`) know wands and staves the moment they pick them up |

`object_flavor_aware` marks the *kind* aware for the whole game (all
copies in the pack, in stores and on the floor update at once).
`EASY_KNOW` kinds (potions, scrolls, wands, staves, rods, torches…) are
fully known as soon as the flavour is. An object is
`object_fully_known` when every rune it has is known **and** its effect
(activation) is known.

### 14.9.3 Artifacts and egos

Ego and artifact names are shown once every rune on the object is known
(`player_know_object` → `obj->known->ego/artifact` set), or immediately
for an artifact whose properties are all previously-learned runes. Once
an ego is known (all its runes seen on one item), further items of that
ego are recognised on sight.

---

## 14.10 Ignoring (`obj-ignore.c`)

Objects can be ignored by kind (unaware flavours, `ignore` command on a
known kind), by ego, or by **quality** per equipment type. The quality of
a known wearable is:

```
jewellery: any positive modifier/plus → average; any negative plus → bad; else average
fully known: score = 4×sign(to_d − kind to_d) + 2×sign(to_h − kind to_h) + 1×sign(to_a − kind to_a)
             > 0 good, < 0 bad, else average;   ego → "non-artifact" (IGNORE_ALL);   artifact → never
not fully known but assessed (all runes seen, `{??}` gone) → treated as non-artifact
```

The quality levels are: no ignore < bad < average < good < non-artifact.
Setting "ignore good and below" on boots hides every non-ego, non-artifact
pair. `ignore_item_ok` also honours the `birth_know_flavors` option and
the `PN_IGNORE` notice that re-evaluates after every knowledge gain.

---

## 14.11 Worked example: a floor item at depth 30

1. The generator calls `make_object(c, 30, false, false, false)`.
2. 1-in-1000 special-artifact roll fails. `base = 30`; `get_obj_num(30)`:
   1 in 20 the level is boosted (say to 45). The cumulative table at
   level 30 picks a Long Sword (`alloc:20:10 to 100`).
3. `object_prep`: 2d5, no pluses, weight 130.
4. `apply_magic(lev 30)`: `good_chance = 63 %` → power 1; then 30 % →
   power 2. Suppose power 2. One artifact roll: no Long Sword artifact
   passes (Ringil needs depth ≥ 60… `randint0(60) == 0` at depth 30 then
   its `alloc_prob`). `make_ego_item`: 1 in 20 the ego level is
   boosted; otherwise from egos listing swords with `alloc_min ≤ 30` or
   the OOD clause — say Westernesse (`10 : 10–70`).
5. `ego_apply_magic`: +d… combat from the ego, STR/DEX/CON[d2], slays,
   flags. Then `apply_magic_weapon` power 2: `to_h += d5 + m_bonus(5,30)
   + m_bonus(10,30)`, same for `to_d`, and a 1-in-40 dice-growth check.
6. 1 in 20: a curse is added — say "cowardice" at power `d9 + 10 ×
   m_bonus(9, 30)` ≈ 20–30, raising the generation level for step 5.
7. `ego_apply_minima` enforces Westernesse's minimums. The sword lands
   on the floor as "a Long Sword {??}" (if you already know the
   Westernesse runes it appears as "the Long Sword of Westernesse
   (2d5) (+7,+9) <+2, +1, +2>" at once).
