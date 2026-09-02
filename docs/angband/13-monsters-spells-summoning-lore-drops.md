# Chapter 13 — Monsters II: Spells, Summoning, Lore and Drops

*Derived from Angband 4.2.6 (`mon-attack.c`, `mon-spell.c`,
`mon-summon.c`, `mon-lore.c`, `mon-make.c`, `lib/gamedata/monster_spell.txt`,
`summon.txt`, `monster.txt`).*

This chapter covers everything a monster does at range — spells,
breaths, missiles, summons — and the two bookkeeping systems attached to
monsters: what the player learns about them (lore) and what they carry
(drops). Monster melee is in *Melee Combat* 7.9; how a monster decides to
act at all is in *Chapter 12*.

---

## 13.1 Spells are effects

Every monster ranged action is an entry in `monster_spell.txt`, and each
entry is a list of the same **effects** the player's spells and devices
use (see *Magic, Effects and Devices*). A spell record looks like:

```
name:BA_FIRE
msgt:BR_FIRE
hit:100
effect:BALL:FIRE:2
dice:10+1d$S
expr:S:SPELL_POWER:* 7 / 2
lore:fire balls
lore-color-base:Orange
lore-color-resist:Yellow
lore-color-immune:Light Green
message-vis:{name} casts a fire ball.
message-invis:Something mumbles.
```

| Field | Meaning |
|---|---|
| `hit:` | base to-hit: 100 always, 0 never, otherwise tested against AC (13.3.3) |
| `effect:` / `dice:` / `expr:` | effect chain; `$S` is usually spell power (`SPELL_POWER`), `$P` player level, `$D` dungeon level, `$B` max sight, `$H` player hp, `$M` percent of target's hp gone |
| `power-cutoff:` | at these spell powers the lore text and messages switch (e.g. "casts a magic missile" vs "casts a mana bolt" flavour tiers) |
| `lore*:` | text and colours for monster recall |
| `message-*:` | shown when seen / unseen / missed |
| `save-message:` | shown when the player's saving throw succeeds |

`list-mon-spells.h` divides spells into types (`RST_*`): `INNATE`,
`BOLT`, `BALL`, `BREATH`, `ATTACK` (direct-damage curses), `ANNOY`
(scare/blind/confuse…), `HASTE`, `HEAL`, `HEAL_OTHER`, `TACTIC`
(blink/teleport), `ESCAPE`, `SUMMON`. The AI filters on these types.

**Innate vs. spell.** Breaths, `SHRIEK`, `WHIP`, `SPIT`, `SHOT`, `ARROW`,
`BOLT`, `BOULDER` and `WEAVE` are innate: they use the monster's
`innate-freq`, they *never fail*, and they are learned separately in
lore. Everything else is a spell governed by `spell-freq` and the
failure rate in 13.3.2.

### 13.1.1 Damage table

`spell_power` (P below) defaults to the monster's level unless the
record sets `spell-power:`. Breath damage is a fraction of the
monster's *current* hit points and is listed in *Elements and
Resistances* 10.6; the standard divisors are 3 for the basic four
elements and poison, 6 for most others, and fixed caps per element.

| Spell | Damage / effect |
|---|---|
| `BA_ACID` | radius-2 ball, `15 + 1d(3P)` |
| `BA_ELEC` | `8 + 1d(3P/2)` |
| `BA_FIRE` | `10 + 1d(7P/2)` |
| `BA_COLD` | `10 + 1d(3P/2)` |
| `BA_POIS` | `(P/2 + 3)d4` radius 2 |
| `BA_SHAR` | `10 + 1d(3P/2)`, shards |
| `BA_NETH` | `4P + 10d10` nether |
| `BA_WATE` | `50 + 1d(5P/2)` water |
| `BA_MANA`, `BA_HOLY` | `5P + 10d10` |
| `BA_DARK` | `4P + 10d10` |
| `BA_LIGHT` | `10 + 1d(3P/2)` |
| `STORM` | three radius-3 balls in one cast: water `30 + (P/3)d5`, elec `20 + (P/3)d5`, ice `20 + (P/3)d5` |
| `BO_ACID` | bolt, `P/3 + 7d8` |
| `BO_ELEC` | `P/3 + 4d8` |
| `BO_FIRE` | `P/3 + 9d8` |
| `BO_COLD` | `P/3 + 6d8` |
| `BO_POIS` | `P/3 + 9d8` |
| `BO_NETH` | `30 + 3P/2 + 5d5` |
| `BO_WATE` | `P + 10d10` |
| `BO_MANA` | `50 + 1d(5P/2)` |
| `BO_PLAS` | `10 + P + 8d7` |
| `BO_ICE` | `6 + P + 6d6` |
| `MISSILE` | `P/3 + 2d6` |
| `BE_ELEC`, `BE_NETH` | beams (line effects) |
| `MIND_BLAST` | `8d8`, saving throw, plus confusion |
| `BRAIN_SMASH` | `12d15`, saving throw, plus slow/stun/confuse/blind |
| `WOUND` | `(2P/3)d5` + cut; save allowed; at higher power-cutoffs the wound is described as "causes serious/critical/mortal wounds" |
| `DRAIN_MANA` | drains `1d(P/2)+1` mana from the player, heals the monster ×6 |
| `HEAL` | monster heals `6P` |
| `HEAL_KIN` | heals nearby injured kin |
| `HASTE` | monster `FAST` +50 turns |
| `BLINK` / `TPORT` | monster teleports 10 / 45 grids |
| `TELE_TO` | player pulled next to the monster |
| `TELE_SELF_TO` | monster teleports to the player |
| `TELE_AWAY` | player teleported 100 grids |
| `TELE_LEVEL` | player up/down a level, save allowed |
| `BLIND`, `CONF`, `SCARE`, `SLOW`, `HOLD`, `FORGET` | timed effects on the player, all with a saving throw |
| `DARKNESS` | unlights the room / area |
| `TRAPS` | creates traps around the player |
| `SHRIEK` | wakes monsters (aggravate radius) and hastes nearby monsters |
| `SHOT`, `ARROW`, `BOLT` | innate missile, hit 50, `(P/8+1)d5` / `d6` / `d7` |
| `BOULDER` | hit 60, `(P/7+1)d12` |
| `WHIP` | `LASH` reaching 2 grids: damage = full dice of the monster's first blow + half the dice of each further blow, element from the first blow's `lash_type` |
| `SPIT` | same `LASH` rule, reaching 3 grids |
| `WEAVE` | creates webs around the monster |
| `S_KIN` | summon 8 attempts of the same base |
| `S_MONSTER` | 1 any monster |
| `S_MONSTERS` | 8 any monsters |
| `S_ANIMAL`, `S_SPIDER`, `S_HOUND` | 12 attempts |
| `S_HYDRA` | 6 |
| `S_AINU`, `S_DEMON`, `S_UNDEAD`, `S_DRAGON` | 1 |
| `S_HI_DEMON`, `S_HI_UNDEAD`, `S_HI_DRAGON`, `S_WRAITH`, `S_UNIQUE` | 8 |

The "attempts" numbers are the `dice:` value of the `SUMMON` effect; how
many monsters actually arrive is governed by the level budget in 13.4.2.

---

## 13.2 Will it cast this turn? (`mon-attack.c: monster_can_cast`)

Called from `monster_turn` before movement, first for spells, then for
innate attacks:

```
chance = innate ? freq_innate : freq_spell       /* percent per turn */
if MFLAG_NICE (created FORCE_SLEEP, not yet acted) → no
if chance == 0 → no
if player is TAUNTed → chance /= 2
if distance to target == best_range → chance *= 2
if randint0(100) ≥ chance → no
if distance > max_range (20) → no
if not projectable(mon→target, PROJECT_SHORT) → no
if the target is not the player and neither end is in view:
    the projection path must pass through at least one grid the player can see
```

`freq_spell` is stored as a percentage (`spell-freq:8` in `monster.txt`
means "1 in 8", converted to 100/8 = 12 % at load time). An ancient red
dragon has `spell-freq:8` and `innate-freq:12`: each turn it has a 12 %
chance to try a spell (BLIND/CONF/SCARE) and, failing that, an 8 %
chance to breathe — doubled to 24 %/16 % when it is exactly at its
preferred range.

---

## 13.3 Choosing and casting (`make_ranged_attack`)

### 13.3.1 Filtering

1. Start from the race's spell list.
2. `SMART` monster below 10 % hp: one time in two, drop all `RST_DAMAGE`
   spells (it will heal, blink or summon instead).
3. Unless `STUPID`, run `remove_bad_spells`:
   * `HEAL` removed at full hp; `HEAL_KIN` removed if no injured kin nearby;
   * `HASTE` removed if already `FAST` for more than 10 turns;
   * `TELE_TO` / `TELE_SELF_TO` removed when the target is adjacent;
   * `WHIP` removed beyond 2 grids, `SPIT` beyond 3;
   * with `birth_ai_learn` on: the monster forgets everything it knows
     about you 1 time in 20, otherwise `unset_spells` removes spells you
     are known to resist — each bolt/ball/breath of an element you resist
     is dropped with probability `res_level × 50 %` for `SMART` monsters
     and `res_level × 25 %` otherwise (immunity, res_level 3, always
     removes it); timed-effect spells against a known protection flag
     (`PROT_FEAR`, `PROT_CONF`, `PROT_BLIND`, `FREE_ACT`, `HOLD_LIFE`)
     are dropped always by `SMART` monsters and 2 times in 3 by others;
     `DRAIN_MANA` is dropped if you are known to have no mana.
   * Bolt spells need a clean line (`projectable` with `PROJECT_STOP`): no
     monster in the way.
   * Summons need an empty grid within 2 of the caster.
4. If the list is empty the monster does not cast (and, since this is
   checked *before* movement, it moves instead).
5. `choose_attack_spell`: uniform random choice among the surviving
   spells of the chosen category (innate or not). There is no weighting
   by usefulness; a dragon with BLIND, CONF and SCARE picks each 1/3.

### 13.3.2 Failure

```
power    = MIN(spell_power, 1)            /* always 1 for any real monster */
failrate = STUPID ? 0 : 25 − (power + 3) / 4  = 24
if afraid:                failrate += 20
if confused or disenchanted: failrate += 50
```

Because the code takes `MIN(spell_power, 1)` rather than `MAX`, every
non-stupid caster in 4.2.6 has a flat **24 %** failure rate regardless of
level ("tries to cast a spell, but fails"). A frightened caster fails
44 % of the time and a confused one 74 %. Innate attacks (breaths,
missiles) never fail.

### 13.3.3 Hitting (`mon-spell.c: do_mon_spell`)

For spells with `hit:` other than 100 or 0 (`mon-spell.c: chance_of_spell_hit`):

```
to_hit = max(level, 1) × 3 + spell hit value
for each level of confusion the monster has: to_hit = to_hit × 80 / 100
hits = check_hit(player, to_hit)      /* same test_hit as melee, against ac + to_a */
```

`test_hit` is the melee formula from *Melee Combat* 7.3:
`0.12 + 0.83 × max(0, to_hit − 2AC/3) / to_hit`. A level-30 archer with
`hit:50` arrows has to_hit 140; against AC 60 that hits
`0.12 + 0.83 × (140 − 40)/140 = 71 %`. Spells with `hit:100` (all balls,
bolts, breaths and curses) always hit.

Spells with a **saving throw** (`MIND_BLAST`, `BRAIN_SMASH`, `WOUND`,
`SCARE`, `BLIND`, `CONF`, `SLOW`, `HOLD`, `TELE_LEVEL`, `FORGET`) are
resisted when `randint0(100) < skills[SKILL_SAVE]` ("You resist the
effects!"); see *Player Stats* 4.7 for the saving-throw skill.

### 13.3.4 Breath geometry

Breaths use the `ARC` projection with a 30° cone (`BREATH` effect,
degrees 30) from the monster to the target; the damage is divided by the
distance from the source as described in *Ranged Combat and Projection*
8.6 — a breath at point blank does full damage, and grids to the side of
the cone take less. Breath damage is computed from the monster's
*current* hp, so a wounded dragon breathes for less: an ancient red
dragon at full 1560 hp breathes fire for 1560/3 = 520 (capped at 1600,
so uncapped), which becomes 173 with a single fire resistance
(× 1/3) and 17 with double resistance (temporary + permanent, × 1/9).
At 400 hp the same breath is only 133 unresisted.

---

## 13.4 Summoning (`mon-summon.c`, `summon.txt`)

### 13.4.1 Summon types

`summon.txt` defines each type: which monster base or flag qualifies,
whether uniques are allowed, and an optional **fallback** type when
nothing qualifies.

| Type | Accepts | Uniques? | Fallback |
|---|---|---|---|
| `ANY` | anything | yes | — |
| `KIN` | same base as the summoner | no | — |
| `MONSTER` / `MONSTERS` | anything non-unique | no | — |
| `ANIMAL` | `ANIMAL` flag | no | — |
| `SPIDER` | base spider | no | — |
| `HOUND` | base zephyr hound / canine | no | — |
| `HYDRA` | base hydra | no | — |
| `AINU` | `AINU` | no | — |
| `DEMON` | `DEMON` | no | — |
| `UNDEAD` | `UNDEAD` | no | — |
| `DRAGON` | `DRAGON` | no | — |
| `HI_DEMON` | base major demon | yes | — |
| `HI_UNDEAD` | bases vampire, wraith, lich | yes | — |
| `HI_DRAGON` | base ancient dragon | yes | — |
| `WRAITH` | base wraith **and** `UNIQUE` | yes | `HI_UNDEAD` |
| `UNIQUE` | `UNIQUE` | yes | `HI_UNDEAD` |

### 13.4.2 `summon_specific(grid, lev, type, delay, call)`

1. Look for a free grid within distance 1, then 2, 3, 4 of the
   summoner (`scatter_ext` with `square_allows_summon`). None → 0.
2. If `call` is set (player-cast summons use it 1 time in 4, never for
   `UNIQUE`/`WRAITH`), pick an existing monster elsewhere on the level
   that is out of the player's line of sight and *move* it here
   (`call_monster`), waking it. This is why the level's population does
   not always grow when you read a scroll of summon.
3. Otherwise install the type filter and call
   `get_mon_num((depth + lev) / 2 + 5, depth)` — the monster's level and the
   dungeon depth are averaged and 5 added. A level-40 summoner at depth
   30 summons from the level-40 table; at depth 60 from level 55.
4. Place the monster awake, no escorts, in the summoner's group with
   role `SUMMON`.
5. If `delay` (player-cast summons), set its energy to 0 and, if it is
   faster than the player, put it in `HOLD` for exactly the number of
   turns needed so that the player gets to act first.
6. Return the summoned monster's level (0 on failure).

### 13.4.3 Monster summons: the level budget (`effect_handler_SUMMON`)

```
rlev = summoner level
val = 0; attempts = 0
while val < depth × rlev and attempts < summon_max (the dice value):
    level = summon_specific(...)
    val += level²
    attempts++
    if val > 0: count++
if count == 0 and fallback type exists: repeat with the fallback
if count == 0: "But nothing comes."
```

The budget is `depth × rlev` in *squared* monster levels, so a few deep
summons exhaust it quickly while many shallow ones are needed to fill it.

**Worked example**: a level-60 summoner at depth 60 casts `S_UNDEAD`
(1 attempt): budget 3600, one attempt, one undead of level up to
(60 + 60)/2 + 5 = 65. Casting `S_HI_UNDEAD` (8 attempts): each summon of
level ~55 adds 3025, so the second summon overshoots the budget and the
loop stops after 2 monsters. At depth 98 against Morgoth (level 100,
`S_HI_UNDEAD` with budget 9800): three or four level-50–60 liches and
wraiths arrive per cast.

Note that `count` is incremented whenever `val > 0`, which includes
attempts that returned 0 after an earlier success — so `count` is really
"attempts after the first success", but it is only compared against 0.

### 13.4.4 Player summons

`SUMMON` from a scroll or the `Summon` spells of the player's classes uses
the else-branch: `summon_max` independent calls with `delay = true` and
the 1-in-4 `call` behaviour, at `depth + level_boost`.

---

## 13.5 Monster lore (`mon-lore.c`)

`struct monster_lore` records, per race: `sights`, `deaths` (player
deaths to it), `pkills` (this character's kills), `tkills` (kills across
all characters), `wake`, `ignore`, `drop_gold`, `drop_item`,
`cast_innate`, `cast_spell`, per-blow `times_seen`, the known `flags`
and `spell_flags`, and `all_known` (probed).

`lore_update` decides what the recall screen may show:

| Fact | Known when |
|---|---|
| Obvious flags (`RFT_OBV`: e.g. `UNIQUE`, `MALE`, `INVISIBLE`, `NEVER_MOVE`…) | always |
| Blow `i` | seen at least once (`times_seen`), or all-known |
| Armour class, drop flags, kind flags (orc/troll/…), `FORCE_DEPTH` | at least one kill (`tkills > 0`) |
| Sleepiness / alertness | `wake² > race->sleep`, or `ignore == 255`, or race sleep is 0 and 10 kills |
| Innate frequency | more than 50 innate attacks observed |
| Spell frequency | more than 50 spells observed |
| Everything | probed (`all_known`, from the Probing effect) or cheat option |

Individual flags are learned as they matter: an element immunity when
you hit it with that element (`lore_learn_flag_if_visible`), the
`NO_CONF` etc. flags when your effect fails, a spell when you see it cast
(`rsf_on(lore->spell_flags, spell)`), the exact damage of a blow after
enough hits, `HURT_LIGHT` when it takes light damage. The recall text
(`lore_description`) prints kill counts, speed, hp (exact once
`armour_known`, i.e. one kill), the escape/AI notes, blows with
"(1d8)" once seen enough times, and drop counts as the *maximum*
observed (`lore_treasure` keeps the max of items/gold seen; `ONLY_ITEM`
/ `ONLY_GOLD` are guessed with a 1-in-4 chance per consistent drop).

### 13.5.1 What monsters learn about you (`update_smart_learn`)

When a spell or attack interacts with one of your properties (you
resist fire, you have free action, you have no mana), the game first
lets *you* learn the rune (`equip_learn_flag`), then, if `birth_ai_learn`
is on:

* `STUPID` monsters never learn;
* non-`SMART` monsters learn only 50 % of the time;
* 1 % of the time learning silently fails;
* otherwise the flag/element is recorded in the monster's
  `known_pstate`, and is used by `remove_bad_spells` (13.3.1) until the
  1-in-20 per-cast forgetting resets it.

---

## 13.6 Drops (`mon-make.c: mon_create_drop`)

Drops are created **when the monster is placed** and carried in its
`held_obj` list; `monster_death` drops them on the floor. This has two
consequences: monsters that pick items up (`TAKE_ITEM`) add to the
same list, and stealing from a monster reduces what it will drop later.

### 13.6.1 How many

```
number = 0
DROP_20: +1 with 20 %      DROP_40: +1 with 40 %      DROP_60: +1 with 60 %
DROP_1:  +1
DROP_2:  + rand_range(1, 3)
DROP_3:  + rand_range(2, 4)
DROP_4:  + rand_range(2, 6)
unique: number = max(0, number − lore->thefts)   /* items you stole from it earlier */
```

Then specific `drop:` lines each fire with their own `percent_chance`
and quantity `min + randint0(max − min)`.

### 13.6.2 Quality level

```
monlevel = race level
if unique: monlevel = MIN(monlevel + 15, monlevel × 2); extra_roll = true
level = MIN(MAX((monlevel + depth) / 2, monlevel), 100)
```

So a monster is never generated with drops shallower than its own
level, and fighting a deep monster near the surface still pays: a
level-40 troll chieftain killed at depth 10 drops level-40 goods. A
unique gets `+15` (or double if that is less) and an extra artifact
roll in `apply_magic` (see *Objects* 14.4).

`DROP_GOOD` forces `good`, `DROP_GREAT` forces `great`; `ONLY_GOLD` /
`ONLY_ITEM` restrict the type; otherwise each of the `number` drops is
gold or an item with 50 % each. Items come from
`make_object(c, level, good, great, extra_roll, NULL, 0)` and gold from
`make_gold(level, "any")` (see *Objects* 14.6).

### 13.6.3 Morgoth

If the race is `QUESTOR` at level 100, every artifact whose kind has
`KF_QUEST_ART` (the Crown of Morgoth and Grond) is created and given to
him explicitly, in addition to his `DROP_4 | DROP_GREAT` regular drop.

### 13.6.4 Example: Bullroarer the Hobbit

`flags: UNIQUE | DROP_2 | DROP_GOOD | ONLY_ITEM`, level 5, killed at
depth 7:

* number = 1–3 items (`DROP_2`), no gold (`ONLY_ITEM`);
* monlevel = min(5 + 15, 10) = 10; level = max((10 + 7)/2, 10) = 10;
* each item is `good` (so weapons/armour get positive enchantments,
  and `apply_magic` uses `good_chance = 33 + 10 = 43 %` for the ego
  roll — see *Objects*) with `extra_roll` for an artifact.

---

## 13.7 Mimics and camouflage

Races with `UNAWARE` (lurkers, creeping coins, mimics) are placed with
`MFLAG_CAMOUFLAGE`. `mimic:` lines give the tval/sval of the object
they imitate; `place_monster` drops a matching object on the monster's
grid, and `mon->mimicked_obj` links them. The monster is invisible to
`update_mon` until it `become_aware`s: it moves, attacks, casts, takes
damage, or the player walks into / interacts with the mimicked object
(`square_isdisarmable`/pickup checks call `become_aware`). On awareness
the object is deleted and the monster drawn.

---

## 13.8 Shape-changing

`MON_TMD_CHANGED` and `mon->original_race` support monsters that have
changed shape (the `shape:` lines in `monster.txt` used by a few races
such as the mimic and shapechanger effects `MON_TIMED`-driven
`monster_change_shape` / `monster_revert_shape`). Drops and XP use the
*original* race (`effective_race` in `mon_create_drop`,
`player_kill_monster`), so a changed monster cannot be farmed for a
different race's loot.
