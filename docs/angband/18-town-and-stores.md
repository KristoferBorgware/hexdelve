# 18. The town and the stores

The town is depth 0: a small level (22 × 66) with no monsters worth the name, holding the seven shops and the player's home. It is the only level that persists across visits without the persistent-levels option, and the shops restock according to how long the player has been away rather than continuously. Everything a character sells, buys or stores passes through this chapter; nothing here is reachable from the dungeon, so a trip to town is a round trip.

Stores are `store.c` and `store.txt`; the town layout is `town_gen()` and `town_gen_layout()` in `gen-cave.c`.

## 18.1 The eight shops

A store is a terrain feature with the `SHOP` flag; its name comes from `terrain.txt` and its behaviour from a `store.txt` record keyed by the feature code.

| Store | `slots` (min–max normal) | `turnover` | Stocks |
|---|---|---|---|
| General Store | 0–4 | 2 | Staples: cloak, rations, torches, flasks of oil, shovel, pick, iron shot, arrows, bolts. Normal: wine, slime mould, whisky, biscuits, two mushrooms |
| Armoury | 6–18 | 9 | Boots, helms, soft and hard armour, gloves, shields |
| Weaponsmith | 3–14 | 9 | Weapons and ammunition |
| Bookseller | 0–2 | **0** | The first two books of each realm, as staples |
| Alchemist | 6–10 | 9 | Potions and scrolls |
| Magic shop | 4–14 | 9 | Wands, staves, rods, rings, amulets |
| Black Market | 6–18 | 9 | No stock list at all — anything, at a price |
| Home | – | – | Nothing; storage only |

Each store carries a list of owners with a **purse** (`max_cost`), one of whom is chosen at random when the game starts. The General Store's owners run from Bilbo the Friendly at 5,000 to Lyar-el the Comely at 30,000; the purse caps what that shopkeeper will pay for anything, which is why a valuable item sells for less than its worth in a poor store.

Three record fields drive stocking. `always:` items are staples the store is never without and always holds a full stack of. `normal:` items are the pool it restocks from. `buy:` names the tvals it will purchase, and `buy-flag:` names tvals it buys only when the object is *known* to carry a given flag.

## 18.2 Restocking is deferred until the player arrives

While the player is in the dungeon, `process_world()` increments a global `daycount` every `10 × store:turns` game turns — with `store:turns` at 1000, once every 10,000 game turns. Despite the name and the comment beside it, that is **not** a day: a day is `10 × world:day-length` = 100,000 game turns (Time chapter 2.7), so `daycount` ticks ten times a day. The counter only advances while the player is below town level.

Nothing happens to the shops at the time. `dungeon_change_level()` notices an arrival at depth 0 with a non-zero `daycount` and calls `store_update()`, which runs `store_maint()` on every store once per accumulated tick and then zeroes the counter. The source comment says why the work is deferred rather than done as it accrues: doing it live would let the player read the coming stock out of the knowledge menu without going to town.

So a player who dives for a long stretch finds every round of turnover applied at once on arrival, and a player who takes the stairs straight back up finds the shops as they left them.

`store_maint()` runs in a deliberate order, and the source explains why:

1. **Black Market only**: delete anything failing `black_market_ok()`.
2. **Sell**: reduce stock to `stock_num - randint1(turnover)`, clamped to the store's `normal_stock_max`, by deleting random items.
3. **Restore staples**: create any missing `always:` item and set it to a full stack.
4. **Buy**: raise stock to `stock_num + randint1(turnover)`, clamped between `normal_stock_min + always_num` and `normal_stock_max + always_num`, by creating random items.

Selling before restoring staples is what avoids the choice between deleting the staples and looping forever trying not to. The Bookseller has `turnover: 0` and so is handled by the else branch: it occasionally sells `randint1(stock_num)` books and then restores its staples, which is why its stock reappears rather than rotating.

Each tick there is also a `one_in_(store:shuffle)` — 1 in 25 — chance that one non-home store's shopkeeper is replaced with a different owner from its list, changing its purse.

## 18.3 What a store stocks

`store_create_random()` picks a generation level per item:

```c
if (store is Black Market) { min_level = max_depth + 5;  max_level = max_depth + 20; }
else                       { min_level = 1;              max_level = store_magic_level
                                                             + MAX(max_depth - 20, 0); }
min_level = MIN(min_level, 55);
max_level = MIN(max_level, 70);
level = rand_range(min_level, max_level);
```

Two things follow. **Ordinary stores scale with the player**: `store:magic-level` is 5, so before the player reaches depth 20 every ordinary store item is generated at level 1–5, and beyond that the ceiling rises one level per level of `max_depth`. **The Black Market scales harder and starts above the player**, generating items 5 to 20 levels deeper than the deepest level reached — which is what puts things there that cannot be found yet.

Ordinary stores draw their kind from the store's own `normal_table`; the Black Market calls `get_obj_num(level, false, 0)` and takes anything. Both then run `apply_magic(obj, level, false, false, false, false)` — artifacts disallowed, no forced good or great — so a store ego item is possible but a store artifact is not.

`black_market_ok()` then rejects the result unless it is worth having:

- ego items always pass;
- `to_a > 2`, `to_h > 1` or `to_d > 2` passes;
- anything valued under 10 gold is rejected;
- anything whose **kind** is already stocked by any ordinary store is rejected.

That last test is what keeps the Black Market from selling flasks of oil.

`mass_produce()` finally decides stack sizes by value: food, flasks and lights get `mass_roll(3,5)` extra at 5 gold or less and again at 20 or less; potions and scrolls at 60 and 240; books at 50 and 500; plain (non-ego) weapons and armour at 10 and 100; and ammunition is special — 20–40 in twenties under 5 gold, 10–40 in tens up to 50, 5–20 in fives up to 500, and singly above that.

## 18.4 Prices

`price_item()` is the whole of the economy.

```c
price = store_buying ? MIN(object_value_real(obj, n), object_value(obj, n))
                     : MAX(object_value_real(obj, n), object_value(obj, n));
```

`object_value()` reads the player's *known* version and `object_value_real()` the true one, so taking the minimum when the shop buys and the maximum when it sells means the shopkeeper is never on the losing side of the player's ignorance.

**When the shop buys** (the player sells), the price is two thirds of that figure, halved again in the Black Market, and finally capped at `owner->max_cost * qty`. Under the `birth_no_selling` option it is zero — the player gets nothing, which is compensated by the five-times multiplier on dungeon gold (Object Generation chapter 15.8).

**When the shop sells**, the price is re-evaluated from `object_value_real()` alone, doubled in the Black Market, then scaled by `adjust` — 100 normally, 150 in the Black Market — and rounded. The Black Market therefore charges roughly three times what another store would, once the doubling and the adjustment are combined.

A price is never allowed to reach zero: a sale of a worthless item returns `qty` gold rather than nothing.

`store_will_buy()` decides whether the transaction is offered at all. The Home takes anything. An ordinary store refuses apparently worthless items — with one exception: under `birth_no_selling`, an item of variable power whose runes are not all known is still accepted, so a player can hand in unidentified gear for identification without the game pretending it is worth money. Otherwise the object's tval must appear on the `buy:` list, and a `buy-flag:` entry additionally requires the player to *know* the object has that flag.

## 18.5 Buying, selling and the Home

Buying from a store calls `object_learn_unknown_rune()` on the purchase, so every purchase teaches one rune of that item (Object Knowledge chapter 16.4). Selling does the same, which is the standard way to identify an unknown item cheaply.

`store:inven-max` is 24 discrete objects per store. `store_check_num()` allows an addition beyond that only if it merges with existing stock; the Home merges under `OSTACK_PACK` rules and stores under `OSTACK_STORE`, which is why the Home stacks items the way the pack does.

The Home is not a store in any other sense: it has no owner, no turnover, no prices, and `store_maint()` returns immediately for it. It is a place to leave things.

## 18.6 The town level

`town_gen()` looks for a stored chunk named "Town". On the first visit it calls `town_gen_layout()`; afterwards it copies the stored chunk back, removes the old one, and locates the down staircase by scanning for `FEAT_MORE`.

`town_gen_layout()` fills the interior with granite, runs `3 + num_lava` streamers of lava (`num_lava` itself `3 + randint0(3)`), clears the `SQUARE_ROOM` flags, and places the player near the top edge, retrying the whole layout if it cannot find floor within the top quarter. The shops are then placed and joined to a crossroads.

Townsfolk are generated per visit rather than stored: `town_gen()` asks for `mon-gen:town-day` (4) residents by day and `mon-gen:town-night` (8) by night, from `is_daytime()`.

## 18.7 Getting to town and back

There is no way to reach a shop from the dungeon: no store can be entered, and nothing can be bought or sold, except by standing on the shop's entrance in town. The two routes to town are the up staircase and **Word of Recall**, and the same two lead back down.

Recall is the reason a trip to town does not undo a dive. Read in the dungeon it sets a timer and then yanks the player to depth 0; read in town it sends them to `recall_depth`, which is `max_depth` — the deepest level reached — rather than depth 1. The scroll read at a depth shallower than `max_depth` asks whether to reset the recall depth to where the player is standing, so a deliberate retreat to an easier level is possible but never accidental. The level the player leaves is discarded either way; recall is an exit from the level, not a suspension of it.

Both the recall timer and the day counter that drives restocking are handled by `process_world()` (World Loop chapter).
