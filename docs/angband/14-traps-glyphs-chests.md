# 14. Traps, glyphs, webs and chests

The "trap layer" (`trap.c`) is one singly-linked list of `struct trap` per grid, and it carries four unrelated things that happen to share the same storage: **player traps** (the `^` the dungeon puts under you), the **magical runes the player lays** (glyph of warding, decoy), **webs**, and **door locks**. What separates them is flags, not type: `TRF_TRAP` marks the ones that fire when walked on, and everything in this chapter that talks about triggering, disarming, detection or placement means those only. Chest traps are a *different* system with its own data file and its own code path (`obj-chest.c`), and are covered in 14.10 because the player cannot tell them apart.

Definitions are in `lib/gamedata/trap.txt`, flags in `list-trap-flags.h`, and the effects a trap fires are ordinary `effect:` chains from the same effect system spells and devices use (Magic chapter).

## 14.1 The trap layer

```c
struct trap {
	struct trap_kind *kind;
	struct trap *next;
	struct loc grid;
	uint8_t t_idx;      /* index into trap_info[] */
	uint16_t power;     /* rolled from the kind's "visibility" dice */
	uint8_t timeout;    /* >0 means disabled for this many turns */
	bitflag flags[TRF_SIZE];
};
```

`square(c, grid)->trap` is the head of the list and the `SQUARE_TRAP` info flag marks the grid so that the common case (no trap) costs one bit test. Flags are copied from the kind at placement and then mutated per instance — `TRF_VISIBLE` in particular is a property of *this* trap, not of its kind. `player->cave` holds a parallel list containing only the traps the player can see, rebuilt by `square_memorize_traps()` whenever the grid changes; that is why a remembered trap survives leaving the room and why an unseen one is not remembered at all.

| Flag | Meaning |
|---|---|
| `TRAP` | Is a player trap — required to be generated, to trigger, and to be disarmed |
| `GLYPH` | Is a player-laid rune (warding or decoy) |
| `WEB` | Is a web |
| `LOCK` | Is a door lock |
| `FLOOR` | May be set on a floor grid — required for normal generation |
| `VISIBLE` | Currently seen (set per instance, not just per kind) |
| `INVISIBLE` | Unused |
| `DOWN` | Drops the player a dungeon level after the effects run |
| `PIT` | Moves the player onto the trap's grid |
| `ONETIME` | Disappears after activating |
| `MAGICAL` | Disarmed with the magical disarm skill; absence means physical |
| `SAVE_THROW` | Standard saving throw avoids every effect |
| `SAVE_ARMOR` | An AC roll avoids every effect |
| `DELAY` | Fires as the player *leaves* the grid, not as they enter |

Under normal generation a grid may hold **at most one** trap and **no objects** (`square_player_trap_allowed()`): both a second trap and any object on the grid veto placement, and the terrain must carry the `TF_TRAP` flag (`square_istrappable()`). The comment in the source notes that lifting the one-trap restriction would require changes elsewhere; several routines assume the list is short and that "the trap here" is unambiguous.

## 14.2 The record format

```
name:pit:spiked pit                  # kind name : short description (lookup key)
graphics:^:s                         # glyph : colour
appear:1:2:0                         # rarity : minimum depth : maximum per level
visibility:80                        # dice for the trap's power
flags:TRAP | FLOOR | PIT
effect:DAMAGE
dice:2d6
effect-xtra:DAMAGE                   # fired additionally, 50% of the time
dice-xtra:2d6
save:FEATHER                         # object flags that avoid the whole trap
msg:You fall into a spiked pit!      # on triggering
msg-good:You float gently ...        # on a successful save
msg-bad:...                          # on a failed save (its presence enables the AC roll)
msg-xtra:You are impaled!            # when the extra effects fire
```

`visibility:` is parsed into `power` as a dice expression, and `place_trap()` evaluates it once with `randcalc(kind->power, trap_level, RANDOMISE)`. So `visibility:90` is a fixed power of 90, `20+d5` is 21–25, and `2d10M50` is `2d10 + m_bonus(50, depth)` — which means a trap door on level 20 has power around 19 and on level 90 around 46. **Power is how hard the trap is to see, and for several traps it grows with depth.** `visibility:0` (the summoning runes, the acid trap, the blast trap) means power 0, which no search skill can fail to beat: those are always revealed the moment their grid is seen.

`appear:` is `rarity : min_depth : max_num`. `max_num` is parsed and stored but never read; the count of traps on a level comes from the level-generation call site instead.

## 14.3 Placement

`place_trap(c, grid, t_idx, trap_level)` is the only routine that puts traps in the dungeon outside savefile loading. Called with an illegal index it picks a random *player* trap via `pick_trap()`:

- no traps in town (`c->depth == 0`);
- the kind must have a name, a non-zero rarity, and `TRF_TRAP`;
- `kind->min_depth <= trap_level`;
- on a floor grid the kind must have `TRF_FLOOR`;
- trap doors (`TRF_DOWN`) are additionally refused on quest levels, on the deepest level (`max_depth - 1`), when persistent levels are on, and in single-combat arenas.

Survivors are weighted `100 / rarity` in a cumulative table and one is drawn uniformly, so `rarity:1` kinds are twice as likely as `rarity:2` kinds and depth only ever *adds* kinds to the pool. A trap generated deep is therefore not a deep trap — it is any trap whose `min_depth` you have passed, which is why level 90 is still full of confusion gas.

Level generation allocates them per cave profile with `alloc_objects(c, SET_CORR, TYP_TRAP, randint1(k), c->depth, 0)`, where `k` scales with level size; the classic and hard-centre profiles use `randint1(k)` and the cavern/labyrinth-flavoured ones `randint1(k)/5`, so open cave levels are markedly less trapped than corridor levels. Room templates and vaults place their own with `'^'` in the layout, each firing `one_in_(4)`.

## 14.4 Visibility and detection

A trap is invisible until something sets `TRF_VISIBLE` on it. `square_reveal_trap(c, grid, always, domsg)` walks the grid's list, skips non-player traps, and skips any trap whose power beats the player's search skill unless `always` is set:

```c
if (!always && player->state.skills[SKILL_SEARCH] < trap->power) continue;
```

This one line is the **only** use of `SKILL_SEARCH` in the entire game. It is called with `always = false` from `cave-map.c` and `cave-view.c` whenever a grid becomes seen — so spotting a trap takes no turn and no action, and is a threshold test against a number rolled when the level was made — and with `always = true` from `effect_handler_DETECT_TRAPS()`, which is why detection finds everything regardless of skill. A character with low search walks onto traps they never had a chance of seeing.

`search()`, run after every step by `player_handle_post_move()`, does *not* look for floor traps. It converts adjacent secret doors into closed doors with no roll at all and reveals traps on adjacent known chests, and it is skipped entirely while blind, confused, hallucinating or in the dark.

Detection paints `SQUARE_DTRAP` over the area it covered. `square_dtrap_edge()` reports grids inside that area with a non-detected orthogonal neighbour, and the UI draws those grids as the boundary of the detected region, so the map shows how far the last detection reached as well as what it found.

## 14.5 Triggering — `hit_trap()`

Three callers, distinguished by the `delayed` argument:

| Caller | `delayed` | When |
|---|---|---|
| `player_handle_post_move()` | 0 | The player entered the grid |
| `player_leaving()` (`mon-util.c`) | 1 | The player left the grid — fires `TRF_DELAY` traps only |
| `do_cmd_disarm_aux()` | −1 | A botched disarm; matches both |

For each trap on the grid, in list order:

1. Skip anything without `TRF_TRAP`, anything with a non-zero `timeout`, and anything whose `TRF_DELAY` does not match the caller's `delayed` (unless `delayed == -1`).
2. **Trap-safety.** `player_is_trapsafe()` is `TMD_TRAPSAFE || OF_TRAP_IMMUNE`. A trap-safe player makes the trap visible, learns the rune if it came from an item, and skips it — the trap is not consumed.
3. `disturb()`, then the kind's `msg`.
4. **Saves**, any of which sets `saved`:
   - any object flag on the kind's `save:` line that the player has (and learns);
   - `TRF_SAVE_ARMOR` and `!check_hit(player, 125)` — an AC roll against attack power 125;
   - `TRF_SAVE_THROW` and `randint0(100) < skills[SKILL_SAVE]`.
5. Saved prints `msg_good` and runs nothing. Otherwise `msg_bad`, then the whole `effect:` chain through `effect_do()`, and then — `one_in_(2)` — `msg_xtra` and the `effect-xtra:` chain.
6. `TRF_DOWN` calls `dungeon_change_level()`.
7. `TRF_PIT` calls `monster_swap()` to drag the player onto the trap's grid, then re-runs the post-move handling with trap evaluation off.
8. `TRF_ONETIME` **or `one_in_(3)`** removes the trap; otherwise it becomes visible.

Two consequences follow from that ordering:

**Steps 6 and 7 are outside the save branch.** Feather Fall is on the `save:` line of the trap door and all three pits, so it cancels the 2d8 fall damage, the spikes and the poison. The level change and the move into the pit happen anyway: a save removes a trap door's damage and not its descent.

**Two thirds of traps survive firing.** Only `ONETIME` kinds always vanish; everything else has a flat 1-in-3 chance of being consumed and otherwise remains on the grid, now visible, and triggers again on the next step onto it.

## 14.6 The player traps

Damage and durations below use `L` for the dungeon level the trap was placed on. All of these carry `TRAP | FLOOR`.

| Trap | Rarity | Depth | Power | Other flags | Effects |
|---|---|---|---|---|---|
| trap door | 1 | 2 | `2d10M50` | `DOWN` | `2d8`; save FEATHER; falls a level regardless |
| pit | 1 | 2 | 90 | `PIT` | `2d6`; save FEATHER |
| spiked pit | 1 | 2 | 80 | `PIT` | `2d6`; xtra `2d6` + cut `4d6`; save FEATHER |
| poison pit | 1 | 2 | 70 | `PIT` | `2d6`; xtra cut `4d6` + poison `8d6`; save FEATHER |
| rune of summon foe | 1 | 3 | 0 | `ONETIME MAGICAL` | summons 1 monster, 5 levels out of depth |
| rune of summoning | 2 | 3 | 0 | `ONETIME MAGICAL` | summons `2+1d3` any |
| rune of necromancy | 1 | 20 | 0 | `ONETIME MAGICAL` | summons `1d3M2` undead |
| rune of dragonsong | 1 | 20 | 0 | `ONETIME MAGICAL` | summons `1d3` dragons |
| hellhole | 1 | 20 | 0 | `ONETIME MAGICAL` | summons `1+1d3` demons |
| teleport rune | 1 | 1 | `30+d30` | `MAGICAL` | teleport `M80` |
| fire trap | 1 | 2 | 20 | `MAGICAL` | fire spot `4d(L/2)` |
| acid trap | 1 | 2 | 0 | `MAGICAL` | acid spot `4d(L/2)` |
| slow dart | 1 | 2 | `M50` | `SAVE_ARMOR` | `1d4` + slow `20+1d20` (`NO_RES`, so Free Action does not help) |
| strength / dexterity / constitution loss dart | 2 | 6 | 30 | `SAVE_ARMOR` | `1d4` + drain that stat |
| blinding gas trap | 1 | 2 | `20+d5` | – | blind `25+1d50` |
| confusion gas trap | 1 | 1 | `20+d5` | – | confuse `10+1d20` |
| poison gas trap | 1 | 2 | `20+d5` | – | poison `10+1d20` |
| sleep gas trap | 1 | 2 | `20+d5` | – | paralyse `5+1d10` |
| aggravation trap | 1 | 5 | `M50` | `MAGICAL` | wake all + haste every monster in line of sight by 25 |
| siren | 1 | 1 | `60+d10` | `MAGICAL` | wake all |
| mine trap | 1 | 15 | `10+d5` | `ONETIME` | shards spot radius 2, `2L` |
| blast trap | 2 | 25 | 0 | `ONETIME` | light `2d6` r1, sound `L/2` r2, fire `L` r2, force `L` r2 |
| mind blasting trap | 1 | 20 | `30+d10` | `MAGICAL SAVE_THROW` | `8d(L/10)` + confuse `3+1d4` |
| brain smashing trap | 2 | 40 | `30+d10` | `MAGICAL SAVE_THROW` | `10d(L/5)` + slow, confuse, paralyse `3+1d4` each + blind `7+1d8` |
| rock fall trap | 1 | 4 | `40+d5` | `ONETIME` | `(L/10+1)d5` + stun `2d20` (`NO_RES`) + rubble |
| earthquake trap | 1 | 30 | `30+d5` | – | `(L/10+1)d5` + earthquake radius 5 |
| block fall trap | 1 | 4 | `40+d5` | `ONETIME DELAY` | drops granite — behind you, as you step off |
| area blast trap | 2 | 40 | `20+d5` | `ONETIME` | stone-to-mud ball r2 + force `L` r2 + rubble |
| blinding flash trap | 1 | 5 | `30+d5` | `MAGICAL ONETIME` | light ball r4 `(L/10+2)d8` |
| blinding trap | 1 | 5 | `20+d5` | `MAGICAL ONETIME` | dark ball r4 `(L/10+2)d8` + drain light `100+1d100` |
| mana drain trap | 1 | 5 | `50+d10` | `MAGICAL` | drain `1d(L/2+1)` SP |
| knife trap | 1 | 20 | `20+d5` | – | cut 150 + `L/2` damage |
| petrifying trap | 1 | 5 | `20+d5` | `MAGICAL` | stoneskin `20+1d20` + stun `20+1d20` |

Only two traps in the whole table allow a saving throw and only four allow an AC save; almost everything else lands unconditionally, and the gas traps in particular are stopped only by the relevant protection flag through the ordinary `player_inc_timed()` check (Elements chapter 10.4). Free Action does not stop the slow dart or the rock fall's stun, because both are applied with `TIMED_INC_NO_RES`.

The `MAGICAL` column is not flavour: it selects which disarm skill applies.

## 14.7 Disarming

`do_cmd_disarm_aux()` acts on the first `TRF_TRAP` on the grid (which is normally the only one):

```c
skill = MAGICAL ? skills[SKILL_DISARM_MAGIC] : skills[SKILL_DISARM_PHYS];
if (blind || no_light || confused || hallucinating) skill /= 10;
power  = cave->depth / 5;
chance = MAX(skill - power, 2);

if (randint0(100) < chance)      -> disarmed, gain 1 + power experience
else if (randint0(100) < chance) -> failed safely, may repeat
else                             -> hit_trap(grid, -1)
```

Two independent rolls at the same chance, so the trap fires with probability `(1 − c)²` — 25% at a 50% skill, 1% at 90%. Note that the difficulty is `depth / 5` and has nothing to do with the trap's own power: the trap's power governs *seeing* it, the level's depth governs *removing* it, and a deep-but-easy trap and a shallow-but-obscure one are equally hard to disarm at the same depth. Disarming is driven at 99 auto-repeats by the command table (Architecture chapter 1.4), so one keypress keeps trying until it succeeds, fires, or is disturbed.

`square_set_trap_timeout()` disables traps on a grid for a number of turns instead of removing them; `square_isdisabledtrap()` is what keeps `player_handle_post_move()` from firing one, and a disabled trap is skipped at step 1 of `hit_trap()` too.

## 14.8 Glyphs, decoys and webs

These are the same storage with `TRF_TRAP` absent, so nothing in 14.3–14.7 applies to them: they are not generated, not detected, not disarmed, and they never fire on the player.

**Glyph of warding** (`;` yellow, `GLYPH | VISIBLE | FLOOR`) is laid under the player by `EF_GLYPH:WARDING`. A monster that wants to move onto it runs `monster_turn_attack_glyph()`:

```c
if (randint1(z_info->glyph_hardness) < mon->race->level)  /* break-glyph:550 */
```

so the chance to break it in one attempt is roughly `level / 550` — about 1 in 11 for a level-50 monster, and never for anything under level 1. A failed roll does not break the monster's movement loop, so a monster gets one roll per movement attempt rather than one per turn, and a glyph delays a strong monster by a turn or two while stopping a weak one outright.

**Decoy** (`;` green, same flags) comes from `EF_GLYPH:DECOY`. Monsters that are `monster_is_decoyed()` path towards `cave_find_decoy()` instead of the player, and any monster reaching it destroys it in one action unless it is `RF_NEVER_BLOW`. It also dies on its own if the player moves further than `max_sight` from it (`player_leaving()`).

**Webs** (`%` yellow, `WEB | VISIBLE`) are created only by monsters — `effect_handler_WEB()` returns false outright for a player caster — in a radius that grows with the caster's spell power (1, +1 above 40, +1 above 80), on floor grids that hold no other trap (`square_iswebbable()`). Handling differs sharply by side:

| Who | Result |
|---|---|
| `RF_PASS_WEB` monster | Ignores it entirely |
| `RF_PASS_WALL` monster | Passes through, web intact |
| Wall-destroying monster | Destroys the web, keeps its turn |
| `RF_CLEAR_WEB` monster | Destroys the web and **spends the turn** doing it |
| Any other monster | Stuck; turn ends |
| Player | Clears it and spends the move, from any movement command |

A web therefore takes one turn from the player per web crossed, and takes every turn from a monster that can neither pass nor clear it, which is what holds a webbed monster in place while the rest of its group closes.

## 14.9 Door locks

A door lock is a `LOCK | INVISIBLE` trap on a closed door grid, carrying its difficulty in `power`. `square_set_door_lock()` adds or updates one, `square_door_power()` reads it back, and because it lacks `TRF_TRAP` it is invisible to detection, to `hit_trap()` and to trap disarming — picking a lock is the open command, not the disarm command. Lock power is rolled with `m_bonus()` at generation, so doors get harder to open with depth (Architecture chapter 1.8).

## 14.10 Chest traps

Chests carry their traps in the object's `pval` as a **bit set**, so one chest can hold several at once, and the sign of `pval` doubles as the locked flag: positive means locked, negative means unlocked, zero means empty. Definitions live in `chest_trap.txt`:

| Code | Level | Effect |
|---|---|---|
| `NO_TRAP` | 1 | Locked, nothing else |
| `POISON` | 1 | Poison `10+d20` |
| `LOSE_STR` | 2 | `1d4` + drain STR |
| `LOSE_CON` | 3 | `1d4` + drain CON |
| `SUMMON` | 15 | Summons `2+1d3` — the only `magic:1` chest trap |
| `PARALYZE` | 19 | Paralyse `10+d20` |
| `EXPLODE` | 25 | `5d8`, and `destroy:1` sets `pval = 0`, destroying the contents |

`pick_chest_traps()` runs at object generation from the chest kind's level: `one_in_(10)` for no trap at all, otherwise one trap, plus a second above level 5 with probability `1/(1 + (65 − level)/10)`, plus a third above level 45 with probability `1/(65 − level)` and a fourth `one_in_(40)` after that. Duplicate picks simply OR into the same bit, so the deep-chest numbers are looser than they look.

Opening (`do_cmd_open_chest()`) picks the lock at `chance = MAX(skills[SKILL_DISARM_PHYS] − pval, 2)`, with the same blind/dark and confused/hallucinating tenth-ing applied *twice* if both hold, and fires every armed trap on success unless the player is trap-safe. Disarming (`do_cmd_disarm_chest()`) uses physical skill for physical traps, magical for magical, and the **mean of the two** when the chest has both; success negates `pval` and grants `pval` experience, and, exactly as with floor traps, there are two rolls — succeed, fail safely, or set it off.

Contents are rolled at `origin_depth + 5` by `chest_death()`: one item for wooden chests, two for iron, three for steel, `randint1(3)` otherwise, all forced good and forced great for "Large" chests, with nested chests rejected and re-rolled.

## 14.11 Damaging terrain

Lava is not a trap and has no saving throw, no visibility and no disarm — it is terrain, checked every turn by `process_player_cleanup()` rather than on entry:

```c
base_dam = 100 + randint1(100);
dam = adjust_dam(p, ELEM_FIRE, base_dam, RANDOMISE, res, actual);
if (OF_FEATHER) dam /= 2;
```

Fire resistance therefore applies in full, and Feather Fall halves what is left. Damage reduction (`DAM_RED`) is applied to the hit-point loss afterwards, but `inven_damage()` is called with the **raw** figure as its `cperc`, which is why standing in lava wrecks a pack far faster than being breathed on — a breath's inventory chance is capped at 300, and lava's is not (Elements chapter 10.5).
