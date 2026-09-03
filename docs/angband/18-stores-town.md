# Chapter 18 — Stores and the Town

*Derived from Angband 4.2.6 (`store.c`, `ui-store.c`, `gen-cave.c: town_gen`,
`game-world.c`, `lib/gamedata/store.txt`, `constants.txt`).*

---

## 18.1 The town level

The town is a 22 × 66 chunk (`town-hgt`/`town-wid`) generated **once** per
game and stored under the name "Town"; every later visit copies the
stored layout (`town_gen`), so the shops stay where they were.

`town_gen_layout`:

* permanent walls around the edge; the interior starts as granite and
  is opened into floor around a central crossroads;
* `3 + randint0(3)` extra lava streamers plus 3 more (`build_streamer`
  with `FEAT_LAVA`), so the town has 6–8 lava rivulets to walk around;
* the 8 buildings (General Store `1`, Armoury `2`, Weaponsmith `3`,
  Bookseller `4`, Alchemist `5`, Magic shop `6`, Black market `7`, Home
  `8`) are placed on random lots north/south or east/west of the
  crossroads (`lot_is_clear`), each a rectangle of permanent wall with
  the shop entrance feature on one side;
* some lots become **ruins** (scattered granite and rubble,
  `ruins_percent`) to give cover;
* the down staircase is placed south of the crossroads and the player
  starts on it.

**Day and night.** `day-length` is 10 000 game turns, so with 10 game
turns per player turn at normal speed a full day is 1 000 player turns.
`is_daytime()` is true for the first half. At dawn ("The sun has risen.")
the whole town is lit and remembered; at dusk ("The sun has fallen.")
only lit buildings remain visible (`cave_illuminate`). Residents:
`town-day` 4 monsters by day, `town-night` 8 by night, chosen from the
level-0 monster table (`get_mon_num` excludes level-0 races from the
dungeon and vice versa) — urchins, dogs, drunks, aimless merchants,
Grip and Fang.

---

## 18.2 Store data (`store.txt`)

```
store:STORE_GENERAL
owner:5000:Bilbo the Friendly (Hobbit)        # max purse : name (4 owners per store)
owner:10000:Rincewind the Chicken (Human)
owner:20000:Snafu the Midget (Gnome)
owner:30000:Lyar-el the Comely (Elf)
slots:0:4                                     # min : max number of "normal" stock lines
turnover:2                                    # items turned over per maintenance
always:cloak:Cloak                            # staples — always in stock, in max-stack quantity
always:food:Ration of Food
...
normal:food:Pint of Fine Wine                 # the random stock pool
buy:light                                     # tvals the store buys from you
buy:food
```

| Store | Owners' purses | Slots | Turnover | Always stocks | Buys |
|---|---|---|---|---|---|
| General Store (1) | 5 000–30 000 | 0–4 | 2 | Cloak, Ration of Food, Wooden Torch, Flask of Oil, Shovel, Pick, Iron Shot, Arrow, Bolt | lights, food, mushrooms, flasks, diggers, cloaks, ammo |
| Armoury (2) | 5 000–30 000 | 6–18 | 9 | — | all armour |
| Weaponsmith (3) | 5 000–30 000 | 3–14 | 9 | — | ammo, bows, diggers, swords, polearms, hafted |
| Bookseller (4) | 15 000–30 000 | 0–2 | 0 | every town book of all four realms | books |
| Alchemist (5) | 10 000–15 000 | 6–10 | 9 | Word of Recall, Phase Door, Remove Curse, Cure Light Wounds | scrolls, potions |
| Magic shop (6) | 15 000–30 000 | 4–14 | 9 | — | magic books, amulets, rings, staves, wands, rods |
| Black market (7) | 15 000–30 000 | 6–18 | 9 | — (random dungeon items) | nothing listed → buys anything of value |
| Home (8) | — | 24 slots | — | — | stores anything, free |

Each store holds at most `inven-max` = 24 distinct stacks.

---

## 18.3 Prices (`price_item`)

```
base = object_value (the *known* value) — a store never pays for what you don't know
       when the store sells: max(real, known); when it buys: min(real, known)
       wands/staves: value of the whole stack (charges count); otherwise per item
store selling to you:
    price = real value; black market ×2; then × adjust/100 with adjust = 150 for the black market
    → black market items cost 3× their value
    price × quantity (except charged items, already per stack)
store buying from you:
    price = value × 2/3; black market ÷2 further
    adjust = 100 + (100 − adjust) capped at 100  (so no bonus)
    birth_no_selling on → you get 0 gold (but the item is fully identified)
    capped at the owner's max purse × quantity
minimum price 1 per item
```

Owner purse matters only when selling: Bilbo (5 000) pays at most 5 000
per item, Lyar-el 30 000. Shopkeepers are shuffled (`store_shuffle`)
with probability `1/store-shuffle` = 1/25 per day of maintenance, and
when a purchase empties the shop.

`birth_no_selling` (default **on**) turns every sale into a free
identification and instead multiplies dungeon gold drops by 5
(*Objects* 14.6).

---

## 18.4 Buying (`do_cmd_buy`, `p`/`d` in the store UI)

1. Quantity prompt; `inven_carry_num` must accept it ("You cannot carry
   that many items.").
2. `price_item(store, obj, false, qty) > au` → "You cannot afford that
   purchase."
3. Gold deducted, the object is fully identified (all runes learned:
   shop goods teach you runes!), placed in your pack.
4. Stock reduction: staples (`always:` lines) are not reduced unless the
   item has pluses/ego/artifact; other items are removed. If the store
   becomes empty: `1/25` "The shopkeeper retires." (new owner), else "The
   shopkeeper brings out some new stock.", and 10 maintenance passes
   run.

Store goods come pre-identified (`store_create_random` marks them
assessed and known), which is the intended way to learn common runes
early: buying a Cloak [1,+1] teaches the to-AC rune.

## 18.5 Selling (`do_cmd_sell`, `s`)

1. `store_will_buy`: the Home takes anything; the tval must be in the
   store's `buy:` list (the black market has none → accepts everything
   with value); the item must have positive known value, except that
   under `birth_no_selling` an unassessed wearable is accepted for
   identification.
2. `STICKY` equipped items can't be sold ("Hmmm, it seems to be stuck").
3. "I have not the room in my store to keep it." if 24 stacks already.
4. Price computed on the *known* object; gold added; the item is then
   fully identified ("You sold X for N gold." / with no-selling "You
   had X (c)."). `purchase_analyze` prints the shopkeeper's reaction
   ("You hear someone sobbing…", "You've got no trouble at all")
   comparing what they paid to the real value.
5. The store keeps it (`store_carry`: lights refuelled to full, timeouts
   reset, wands recharged to at least the kind's expected charges).

---

## 18.6 Stock maintenance (`store_maint`, `store_update`)

While you are in the dungeon, `daycount` increments every
`10 × store-turns = 10 000` game turns (one day). On returning to town
(`dungeon_change_level(0)`), `store_update` runs `store_maint` once per
elapsed day for every store (and rolls the 1/25 owner shuffle each
day):

```
black market: discard anything no longer black_market_ok
if turnover > 0:
    sell off: stock_num −= randint1(turnover), floor 0, cap normal_stock_max
    (delete random stacks: ammo in multiples of 5–10, others whole/half/one)
else (bookseller): sell randint1(stock_num) random stacks
restock staples: each `always:` kind to a full stack (max-stack 40 for ammo/food, 5 for wands…)
if turnover > 0:
    stock_num += randint1(turnover), clamped to [normal_min + always, normal_max + always]
    fill with store_create_random until reached
```

`store_create_random`:

```
level = rand_range(1, store-magic-level (5) + max(max_depth − 20, 0)), capped at 70
black market: rand_range(max_depth + 5, max_depth + 20), min capped at 55
kind: from the store's `normal:` pool (black market: get_obj_num(level) from the whole dungeon table)
object_prep + apply_magic(level, no artifacts, not good, not great)
reject: negative pluses, any curse, chests, value < 1, black market items that are not black_market_ok
mass_produce: quantity by cost class (cheap food/lights/flasks up to +24, potions/scrolls ≤60 gold +3d5…, cheap armour/weapons stacks, ammo 20–40)
```

`black_market_ok`: an ego, or to-AC > 2, to-hit > 1, to-dam > 2, or a
kind that no ordinary store currently stocks and is worth ≥ 10 gold.
So the black market carries dungeon goods (potions of Healing, Speed,
rings, deeper books) at three times price, scaled to your max depth.

Because ordinary store item *level* depends on your `max_depth`
(5 + max(0, max_depth − 20)), shops improve as you dive: at max depth 40
the Armoury rolls enchantments at level 25.

---

## 18.7 The Home

24 stacks, no owner, no price; `home_carry` merges stacks like the
pack. Items in the home are safe from everything. `birth_no_selling`
does not affect it. The home is the only store where the `knowledge`
menu shows contents while you are away.

---

## 18.8 Worked example: selling a Long Sword (2d5) (+3,+5)

Real value from `object_power` ≈ 46 power → `46 × 51 = 2346` gold.
Known value with only the to-hit rune learned ≈ 20 power → 500.

* At the Weaponsmith (buys swords): price = `min(2346, 500) × 2/3 = 333`,
  capped by the owner's purse (fine); with `birth_no_selling` you get 0
  gold but learn the to-dam rune and the sword's real value shows from
  now on.
* Buying the same sword back later: `max(real, known) = 2346` gold; at
  the black market it would be listed for `2346 × 2 × 1.5 = 7038`.
