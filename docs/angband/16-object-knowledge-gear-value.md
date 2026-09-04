# 16. Object knowledge, gear and value

Angband 4.2 identifies objects by **rune**, not by item. The player does not learn "this is a Ring of Damage"; they learn the rune for *enchantment to damage*, and from that moment every object they have ever handled that carries that rune shows it. This chapter covers that system, the parallel "known object" the player carries around, what is learned by what action, and then the mundane half of object handling: equipment slots, the pack and quiver, stacking, ignoring, and how an object's price is derived from a computed power rating.

Knowledge lives in `obj-knowledge.c`, gear in `obj-gear.c`, piles and stacking in `obj-pile.c`, ignoring in `obj-ignore.c`, power and price in `obj-power.c`.

## 16.1 The rune list

`init_rune()` builds one flat list at startup from six sources:

| Variety | Entries |
|---|---|
| `RUNE_VAR_COMBAT` | 3 — enchantment to armour, to hit, to damage |
| `RUNE_VAR_MOD` | 11 — one per object modifier |
| `RUNE_VAR_RESIST` | 13 — one per element up to and including disenchantment |
| `RUNE_VAR_BRAND` | One per distinct brand **name**, so `FIRE_2` and `FIRE_3` share a rune |
| `RUNE_VAR_SLAY` | One per distinct set of monsters slain (`same_monsters_slain()`), so the ×3 and ×5 dragon slays share a rune |
| `RUNE_VAR_CURSE` | 27 — one per curse |
| `RUNE_VAR_FLAG` | One per object flag, except those whose property subtype is `NONE`, `LIGHT`, `DIG`, `THROW` or `CURSE_ONLY` |

The exclusions matter. Light radius, digging and throwing are visible from the item's description and need no rune; `CURSE_ONLY` flags appear only as part of a curse and are learned through the curse's own rune instead.

Grouping brands and slays by effect rather than by data record is what stops the player having to identify "slay dragon (×3)" and "slay dragon (×5)" separately: one sword teaches the rune, and every dragon-slaying weapon afterwards reads as identified.

## 16.2 `obj_k` — knowledge as an object

The player's knowledge is stored as an ordinary `struct object` hanging off `player->obj_k`, used as a mask rather than an item:

- a known flag is **set** in `obj_k->flags`;
- a known numeric property (`to_h`, `dd`, a modifier) is **set to 1**;
- a known resistance has `res_level` 1;
- a known brand or slay is present in `obj_k`'s brand or slay list.

Because the numeric entries are 1, applying knowledge is multiplication: `obj->known->dd = obj->dd * p->obj_k->dd` yields the real dice if the dice rune is known and zero if it is not. `player_know_object()` runs that multiplication across every field, and `update_player_object_knowledge()` runs it across every object the player has ever handled — gear, floor piles, and store stock — whenever a rune is learned.

Every real object carries a pointer to its own `known` object, which is what the UI displays. An object the player has only sensed is given a placeholder kind (`unknown_item_kind`, or `unknown_gold_kind` for money) so that the map can show something is there without saying what.

## 16.3 Degrees of contact

Four functions correspond to four degrees of contact, each doing a little more:

| Function | Trigger | Effect |
|---|---|---|
| `object_sense()` | Detection, or a pile felt but not seen | Creates a placeholder "unknown item" in `player->cave` |
| `object_see()` | The grid comes into view | Fills in the base: kind, tval, sval, weight, number, and generic dice or AC where those runes are known |
| `object_touch()` | Standing on the object | Notes any artifact, marks `OBJ_NOTICE_ASSESSED`, applies all known runes, logs artifacts to history |
| `object_grab()` | Taking it from a monster's inventory | As `object_touch()`, after building the base knowledge |

`object_set_base_known()` is the shared base step. It gives the player the kind's own dice and armour class multiplied by the relevant rune, the standard `to_h` where the object has not been enchanted away from it, a launcher's multiplier unconditionally, and — for aware flavoured items and for unflavoured non-wearables — the `pval` and the effect. `OBJ_NOTICE_ASSESSED` is the gate: until it is set, `player_know_object()` refuses to go past base properties, so an object seen across the room is never partly identified.

## 16.4 What teaches what

| Action | Learns |
|---|---|
| Wielding or wearing | Every flag with `OFID_WIELD`, plus a sustain when the item modifies that stat; **all** modifiers on the item; and the curse-detection pass below |
| Every 100 game turns while worn | Every flag with `OFID_TIMED`, from `equip_learn_after_time()` in `process_world()` |
| Using a device or consumable | Makes the flavour aware, reveals the effect, and grants `(kind->level + player->lev/2) / player->lev` experience |
| Melee, ranged and defensive use | The relevant combat runes and any element or flag that actually fired (`equip_learn_flag()`, `equip_learn_element()`) |
| Firing or throwing | `to_h` when the missile is not at its standard value, `to_d` when non-zero |
| A Scroll of Identify Rune, or buying from a store | One **random** unknown rune on the chosen object (`object_learn_unknown_rune()`) |
| Taking a shape | Every `OFID_WIELD` flag the shape grants |

Three of these are worth drawing out. Wielding teaches *all* modifiers at once but only the flags marked obvious on wield, which is why a `+3 STEALTH` cloak reads immediately while its Free Action does not. The timed pass fires on `turn % 100`, and it marks objects that are not yet fully known as having had their chance, so a flag that would have shown itself is not re-offered. And identification by scroll picks a rune at random from those the object carries and the player lacks — repeated scrolls on one object walk it towards full knowledge in no fixed order, and when nothing is left the object is simply marked assessed.

## 16.5 Curses are found, not learned

Curses do not surface through the ordinary flag pass, because their effects are indistinguishable from the object being worse than it looks. `object_curses_find_to_a()`, `..._to_h()`, `..._to_d()`, `..._find_flags()`, `..._find_modifiers()` and `..._find_element()` each compare what the object does against what its non-curse properties predict, and attribute the discrepancy to a curse when they can.

`append_object_curse()` already refuses at generation to place a curse whose timed effect the object itself prevents (Object Generation chapter 15.7), so the search never has to account for a curse that could never fire.

## 16.6 Flavours

Flavoured kinds — potions, scrolls, rings, amulets, wands, staves, rods, mushrooms — are shuffled at the start of each game from `seed_flavor`, so "a Smoky Potion" means something different per character. Two per-kind booleans track them:

- `kind->aware` — the player knows what this flavour is. Set by `object_flavor_aware()`, which also re-runs `object_set_base_known()` over all gear **and all store stock**, and re-applies ignore rules.
- `kind->tried` — the player has used one and learned nothing conclusive.

`easy_know()` marks kinds that need no identification at all. Awareness is a property of the kind rather than of the object, so one potion drunk identifies every other of its flavour in the world at once.

## 16.7 Equipment slots

The `Humanoid` body in `body.txt` has twelve slots:

```
WEAPON  BOW  RING  RING  AMULET  LIGHT
BODY_ARMOR  CLOAK  SHIELD  HAT  GLOVES  BOOTS
```

Slots are data rather than an enumeration, so a shape or a variant body with different slots requires no code change. `slot_object()` reads one, and `object_is_equipped()` tests membership by walking the body rather than by a flag on the object, which is why equipped items are excluded from stacking by identity rather than by state.

## 16.8 The pack and the quiver

`pack-size` is 23 slots, `quiver-size` 10, `quiver-slot-size` 40. The quiver is not additional storage: `pack_slots_used()` converts it back into pack slots.

```c
quiver_ammo += obj->number * (tval_is_ammo(obj) ? 1 : z_info->thrown_quiver_mult);
...
pack_slots += quiver_ammo / z_info->quiver_slot_size;
if (quiver_ammo % z_info->quiver_slot_size) pack_slots++;
```

Every 40 arrows occupy one notional pack slot, rounded up, and a throwing weapon in the quiver counts for several arrows apiece through `thrown_quiver_mult`. So filling the quiver reduces the pack, and the ten quiver slots are a display convenience rather than extra capacity.

`pack_overflow()` fires when `pack_slots_used()` exceeds `pack_size`: the player is disturbed, "Your pack overflows!" is printed, and the **last** inventory item is dropped with `drop_near()`. It runs from the wield path and from `process_player()` at the start of a turn, so an overflow caused by picking something up is resolved before the next command.

## 16.9 Stacking

`object_similar()` refuses to stack equipped items, mimics, artifacts, chests, and anything whose kind, flags or per-element information differ. Beyond that:

- food, potions, scrolls and rods stack freely, since an identical kind is either aware for both or unaware for both;
- gold, wands and staves stack unless the combined `pval` would exceed `MAX_PVAL`, which pools charges;
- wearables stack only when every combat value, modifier and property matches, which in practice means only unenchanted duplicates;
- in `OSTACK_LIST` mode — the inventory display — an object whose known kind differs from its real kind refuses to stack, so two unidentified rings of different types never merge in the list.

## 16.10 Ignoring

`ignore_level_of()` assigns each object one of `IGNORE_NONE`, `BAD`, `AVERAGE`, `GOOD`, `ALL` or `MAX`, and the player sets a threshold per item type from the 27 categories in `list-ignore-types.h` ("Sharp Melee Weapons", "High Dragon Scale Mail", "Elven Cloaks", and so on).

The rules differ by what is known:

- **Jewelry** is only ever bad or average — one positive modifier or combat value makes it average, one negative value makes it bad, and nothing makes it good, because a ring's worth is not visible from its numbers.
- **Fully known** objects are graded by `is_object_good()`, then overridden: an ego is `IGNORE_ALL`, an artifact `IGNORE_MAX`.
- **Assessed but not fully known** non-artifacts are `IGNORE_ALL`, so an item the player has handled without finishing is not hidden by a "good" threshold.

Flavoured kinds carry separate `IGNORE_IF_AWARE` and `IGNORE_IF_UNAWARE` settings, which is what lets a player hide known-useless potions while still picking up unknown ones.

## 16.11 Power and price

`object_power()` produces a single integer rating by accumulating contributions in a fixed order: damage dice, launcher and ammunition damage, extra blows, shots and might, slays and brands, a bow rescale, `to_h`, base AC, `to_a`, a jewelry bonus, modifiers, flags, elements, effects, curses, and a penalty for non-standard weight. Several steps short-circuit at `INHIBIT_POWER` (20,000), and the `INHIBIT_BLOWS` (3), `INHIBIT_SHOTS` (21), `INHIBIT_MIGHT` (4) and `INHIBIT_AC` (56) thresholds are what stop the random artifact generator producing an item off the scale.

`object_value_real()` turns that into gold:

```c
a = 1; b = 5;
if (power > 0) value = power * (power * a + b);   /* p² + 5p */
else if (power < 0) value = -power * (power * a - b);
```

so an item's gold value is quadratic in its power rating. Ammunition and plain burning torches are then divided by `AMMO_RESCALER` (20) for impermanence, and a value that rounds to zero is raised to 1 so that a cloak is never valueless.

Items without variable power take the kind's `cost:` field directly, with wands and staves adding `cost * charges / 20`. Unaware flavoured items get a flat guess by tval — 5 for food, 20 for potions and scrolls, 45 for rings and amulets, 50 for wands, 70 for staves, 90 for rods — which is why every unidentified potion is valued alike whatever it turns out to be.

The value the player sees is computed from `obj->known` rather than the object, so an item's apparent price rises as its runes are learned. Store buying and selling prices are derived from this figure (Town and Stores chapter).
