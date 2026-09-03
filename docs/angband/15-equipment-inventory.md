# Chapter 15 — Equipment, Inventory, Quiver and the Floor

*Derived from Angband 4.2.6 (`obj-gear.c`, `obj-pile.c`, `obj-util.c`,
`cmd-obj.c`, `cmd-pickup.c`, `player-calcs.c: calc_inventory`,
`lib/gamedata/body.txt`, `object_base.txt`, `constants.txt`).*

Where objects live once they exist: on the floor, in the pack, in the
quiver or on the body; how stacks merge; what it costs to pick up, wear,
remove and drop; and how weight slows you down.

---

## 15.1 One list, three views

All objects the player owns are on a single linked list, `player->gear`.
`calc_inventory` sorts that list into three *views* each time the
`PU_INVEN` update flag is set:

| View | Array | Size | Membership |
|---|---|---|---|
| Equipment | `player->body.slots[i].obj` | 12 slots (`body.txt`, Humanoid) | objects that are wielded/worn |
| Quiver | `upkeep->quiver[i]` | `quiver-size` 10 | ammo, and `THROWING` weapons, in numbered slots |
| Pack | `upkeep->inven[i]` | `pack-size` 23 | everything else |

The 12 equipment slots in `body.txt` order: weapon, shooting (bow),
right-hand ring, left-hand ring, neck (amulet), light, body, back
(cloak), arm (shield), head, hands, feet. `wield_slot` maps a tval to a
slot type; rings are the only type with two slots.

### 15.1.1 Pack slot accounting (`pack_slots_used`)

```
slots = number of unequipped, non-quiver stacks
quiver_ammo = Σ over quiver stacks of number × (ammo ? 1 : thrown_quiver_mult = 5)
slots += quiver_ammo / quiver_slot_size (40), rounded up
```

So the quiver is not free: every 40 arrows (or 8 throwing weapons)
occupy one pack slot. A character with 22 pack stacks and 41 arrows in
the quiver has 24 > 23 slots and the pack overflows. `pack_is_full`
compares to 23; `pack_is_overfull` (> 23) triggers `pack_overflow`:
"Your pack overflows!" and the *last* pack item is dropped
(`drop_near` at the player's feet, no breakage roll).

### 15.1.2 Quiver layout (`calc_inventory`)

1. An object inscribed `@f<n>` (fire; `@t<n>` with roguelike keys) or
   `@v<n>` (throw) prefers quiver slot `n` (`preferred_quiver_slot`). If that slot is free it goes there;
   if the stack exceeds 40 (8 for throwing items) it is split and the
   remainder goes to the pack, provided the pack has room for the split.
2. Remaining ammo fills empty quiver slots in "gear order" (`earlier_object`:
   by tval, then sval, then known-ness), splitting stacks larger than 40.
3. If the layout changed since last time: "You re-arrange your quiver."
   Likewise "You re-arrange your pack." when pack order changed.

The pack is sorted by `earlier_object`: books of your realm first, then
by tval order as listed in `list-tvals.h`, then sval, then unknown after
known, then by value.

---

## 15.2 Stacking (`obj-pile.c: object_similar`, `object_stackable`)

Two objects merge into one stack only if **all** of these hold:

* neither is equipped, neither is a mimicked object, they are not the
  same object;
* same kind, identical flag sets, identical element info (`res_level`
  and `HATES`/`IGNORE` per element);
* neither is an artifact; not chests;
* wands/staves and money: combined `pval` (charges / gold) ≤ 32767;
* weapons, armour, jewellery, lights: identical `ac`, `dd`, `ds`, `to_h`,
  `to_d`, `to_a`, every modifier, the same ego, identical curses; no
  `timeout` on either (a recharging activation) unless both are lights
  with equal fuel;
* in inventory *lists* (`OSTACK_LIST`), both must have the same
  known-ness (a known Potion of X does not merge with an unknown copy
  in the display, though flavour awareness is global so this only
  matters for wearables);
* `object_stackable` additionally requires inscriptions to be absent or
  identical (`obj1->note == obj2->note`).

Potions, scrolls, food and rods stack freely by kind (rods share a
combined timeout). Wands and staves pool their charges. A stack is
capped by the base's `max-stack` (default 40; pointer-style bases such
as swords are commented at 1 in `object_base.txt`, but the game applies
the default 40 — only `make_object` and `inven_carry_num` care).

---

## 15.3 Carrying

### 15.3.1 `inven_carry(p, obj, absorb, message)`

1. If `absorb`, look for the first unequipped gear object that
   `object_mergeable`s (quiver mode for quiver items) and merge into it.
2. Otherwise append to the gear list, apply any auto-inscription for
   the kind, and, if the flavour is unknown, apply the race flags:
   Hobbits learn mushrooms on pickup ("Mushrooms for breakfast!") and
   Gnomes learn wands and staves.
3. Add the weight, flag `PN_COMBINE`, `PU_BONUS | PU_INVEN`, redraw.
4. Message: "You have 3 Potions of Cure Light Wounds (d)." — the label
   is the pack letter after re-sorting.

### 15.3.2 How many can I take? (`inven_carry_num`)

```
free_slots = 23 − pack_slots_used
gold: always all
quiver_absorb_num: how many would fit into the quiver without adding a pack slot
if all fit in the quiver, or free_slots > 0: all of them
else: only what fits into existing matching stacks (up to max-stack each)
```

Thus with a full pack you can still pick up more of something you
already carry (up to the 40 cap), and arrows that fit into a partially
used quiver slot without crossing a multiple of 40.

### 15.3.3 Picking up (`cmd-pickup.c`)

| Action | What happens | Energy |
|---|---|---|
| Walking onto a grid | `do_cmd_autopickup`: gold is always taken; each non-ignored object is tested with `auto_pickup_okay` | 1/10 turn per object picked up, max one turn |
| `g` (pickup) | `player_pickup_item`: with several items shows a menu; `inven_carry_num` decides the quantity | 1/10 turn per object, max one turn |
| Pickup with `-` quantity prompt | partial pickup via `floor_object_for_use` | same |

`auto_pickup_okay` (in priority order):

1. If nothing would fit, no.
2. Option `pickup_always` → yes.
3. Inscription `!g` on the floor item → no.
4. Inscription `=g` (no number) → yes.
5. Option `pickup_inven` or inscription `=g<n>`: yes if a matching stack
   is already in the pack (and that stack is not inscribed `!g`); with
   `=g<n>` on either the floor item or the pack stack, pick up only up
   to `n` total in the pack.
6. Otherwise no.

Gold: "You have found 57 gold pieces worth of copper." (or "of
treasures" when the pile mixes coin kinds); the sound cue changes at
200 and 600 gold.

---

## 15.4 Wielding, wearing, removing, dropping (`cmd-obj.c`)

| Command | Function | Energy | Rules |
|---|---|---|---|
| `w` wield/wear | `do_cmd_wield` → `wield_item` | one full turn | rings ask which hand if both are full; items inscribed `!t`/`!w` ask for confirmation; a `STICKY` item in the target slot cannot be replaced ("Hmmm, it seems to be stuck"); the replaced item goes to the pack (or the floor if the pack is full); on wield, `object_learn_on_wield` fires, `PU_BONUS` recomputes everything (*Player Stats* 4.4); torches/lamps are lit; a two-handed check does not exist in 4.2 |
| `t` / `T` take off | `do_cmd_takeoff` → `inven_takeoff` | half a turn | refused if `STICKY` (cursed sticky items need the curse removed first); goes to the pack, or overflows to the floor |
| `d` drop | `do_cmd_drop` | half a turn | equipped items are taken off first (their half turn is included); quantity prompt for stacks; `drop_near` at your feet |
| `k` / `^D` ignore (destroy) | `do_cmd_ignore` | none | marks the object (or kind) ignored; nothing is physically destroyed |
| `{` / `}` inscribe | `do_cmd_inscribe` | none | sets `obj->note`; inscriptions affect stacking and commands (`@m1`, `!k`, `=g`, `!*`) |
| `F` refuel | `do_cmd_refill` | half a turn | lamp from a flask (or another lamp); torch from a torch; capped at the light's maximum (`fuel-torch` 5000, `default-lamp` 7500 initial, max 15000) |

Weapon weight limit (`calc_bonuses`): with `hold = adj_str_hold[STR]`
(4 at STR 3, 10 at STR 8, up to 100 at 18/200+), a weapon heavier than
`hold × 10` tenth-pounds is "heavy": `to_h += 2 × (hold − weight/10)`
(a penalty), the blows calculation is skipped so the character gets a
single blow, and "You have trouble wielding such a heavy weapon." is
shown. The same test applies to bows ("…such a heavy bow"). See *Melee
Combat* 7.2 for blows.

---

## 15.5 Dropping and breakage (`drop_near`, `drop_find_grid`)

```
drop_near(c, obj, chance, grid, verbose, prefer_pile):
    if not artifact and randint0(100) < chance: object breaks ("The X disappears") — used by throws/shots
    drop_find_grid: scan a 7×7 square (distance² ≤ 10) around the grid for
        floor grids in line of sight without traps, scoring
        1000 − (distance² + (prefer_pile ? 0 : 5 × visible objects there));
        ties broken randomly; grids that would exceed floor_size (23) or,
        without birth_stacking, would hold two visible objects are skipped
    if none found and the object is an artifact: random walk up to 1000 steps,
        then 2000 random grids, to find any grid — artifacts are never lost this way
    floor_carry: merge with a stackable floor object or add to the pile;
        "You feel something roll beneath your feet." if it lands on your grid
    if the floor grid is still unusable: floor_carry_fail → "The X disappears." (artifact → marked lost)
```

Breakage chances (`breakage_chance`, from `object_base.txt` `break:`):

| Object | Chance when it hits | Chance on a miss (`perc²/100`) |
|---|---|---|
| Arrows | 35 % | 12 % |
| Bolts | 20 % | 4 % |
| Shots | 0 % | 0 % |
| Potions, flasks, food | 100 % | 100 % |
| Lights (thrown torches) | 50 % | 25 % |
| `THROWING` weapons (daggers, spears) not ammo | 1 % | 0 % |
| Everything else (default) | 10 % | 1 % |
| Artifacts | 0 % | 0 % |

---

## 15.6 Weight and burden

```
weight_limit = adj_str_wgt[STR] × 100      (tenth-pounds)
if total_weight > limit / 2:
    speed −= (total_weight − limit/2) / (limit/10)
```

`adj_str_wgt` runs from 5 at STR 3 to 30 at 18/220+ (see *Player Stats*
4.3), so the "burden" threshold (half the limit) is 25 lb at STR 3,
75 lb at STR 12, 100 lb at 18/30 and 150 lb at 18/220. Each further
tenth of the limit costs 1 point of speed: a STR 18/30 character with
130 lb carried (limit 200 lb) is at −1 speed; at 160 lb, −3. The
character sheet's "Burden" line and `weight_remaining`
(`60 × adj_str_wgt − total − 1`, i.e. the headroom before the first
speed point) reflect the same numbers.

Weight itself: every object weight is in tenth-pounds (Long Sword 130 =
13 lb, Arrow 2 = 0.2 lb); curses with `weight:` can change it
(`MULTIPLY_WEIGHT` curses scale it, others add).

---

## 15.7 The floor (`obj-pile.c`, `floor_carry`)

* A grid holds a pile of at most `floor-size` 23 objects.
* `birth_stacking` (default on) allows more than one *visible* object
  per grid; with it off, a second object seeks another grid.
* Objects the player has *seen* get a `known` twin recorded in the
  player's memory map (`player->cave`); walking away and coming back
  shows the remembered pile until the grid is seen again.
* `square_know_pile` marks the pile known when you stand on it or look
  at it; `floor_get_oldest_ignored` frees a slot by deleting the oldest
  ignored object when a pile is full.
* Element damage to floor objects (fire balls burning scrolls, etc.)
  uses the same `HATES_x` / `IGNORE_x` flags as inventory damage, see
  *Elements and Resistances* 10.8.

---

## 15.8 Inventory damage from attacks

`inven_damage(p, type, cperc)` (in `player-util.c`, called from
`adjust_dam`/monster blows): scans the pack for objects that `HATES`
the element and are not `IGNORE`-protected, and for each, with chance
`cperc` per item (scaled by damage), for each such stack: unequipped weapons lose 1 to-hit and 1 to-dam,
armour loses 1 to-AC, each with probability `cperc / 10000`; other items
are destroyed one by one, each with probability `cperc / 10000` (rods a
quarter of that); artifacts and equipped items are skipped here
(equipped armour is handled separately by `minus_ac`, see *Chapter 10*
10.8). Callers pass `cperc` as a multiple of the damage taken, so a
300-point fire breath (`cperc` capped at 300) burns each scroll with
about 3 % chance.

---

## 15.9 Worked example: the overflowing archer

A Ranger carries 22 stacks in the pack and 80 arrows in quiver slot 0
(80/40 = 2 slots → 24 slots used? no: 22 + 2 = 24 > 23 — this state cannot
arise; `inven_carry_num` would have refused the 41st arrow beyond the
free slot). Start instead with 21 stacks + 80 arrows = 23 slots, pack
full. On the floor: 30 arrows and a Potion of Speed.

* Arrows: `quiver_absorb_num` finds that 30 more arrows make 110,
  needing 3 slots instead of 2 — one more pack slot, none free — so
  `inven_carry_num` returns 0; not picked up, "You have no room for…".
* Potion of Speed: no free slot and no matching stack → 0.
* Drop one stack (half a turn): now 22 slots. Auto-pickup with
  `pickup_always` grabs both (1/10 turn each): arrows merge into the
  quiver stack (110 arrows, 3 slots), the potion takes the last slot —
  23 used. "You re-arrange your pack."
