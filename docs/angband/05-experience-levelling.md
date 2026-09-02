# 5. Experience and levelling

Experience is a single 32-bit counter, `player->exp`, with a shadow `max_exp` that remembers the highest value reached (so that drained experience can be restored) and a 16-bit fraction `exp_frac` that accumulates sub-point remainders from monster kills. Level is derived from experience, never stored independently of it: whenever experience changes, `adjust_level()` in `player.c` recomputes `lev` from a fixed table scaled by the character's experience factor.

## 5.1 The experience table

`player_exp[PY_MAX_LEVEL]` in `player.c` holds the base experience needed to *leave* each level. The requirement to reach level L (L ≥ 2) is

```text
need(L) = player_exp[L - 2] * expfact / 100       (integer arithmetic, long)
```

`expfact` is `race->r_exp + class->c_exp`; every class has `c_exp = 0` in 4.2, so it is the race's `exp:` value: 100 for Humans, 145 for High-Elves, 120 for everybody else.

| Level | Base exp | Level | Base exp | Level | Base exp | Level | Base exp | Level | Base exp |
|---|---|---|---|---|---|---|---|---|---|
| 2 | 10 | 12 | 650 | 22 | 6,800 | 32 | 150,000 | 42 | 1,500,000 |
| 3 | 25 | 13 | 850 | 23 | 8,400 | 33 | 200,000 | 43 | 1,800,000 |
| 4 | 45 | 14 | 1,100 | 24 | 10,200 | 34 | 275,000 | 44 | 2,100,000 |
| 5 | 70 | 15 | 1,400 | 25 | 12,500 | 35 | 350,000 | 45 | 2,400,000 |
| 6 | 100 | 16 | 1,800 | 26 | 17,500 | 36 | 450,000 | 46 | 2,700,000 |
| 7 | 140 | 17 | 2,300 | 27 | 25,000 | 37 | 550,000 | 47 | 3,000,000 |
| 8 | 200 | 18 | 2,900 | 28 | 35,000 | 38 | 700,000 | 48 | 3,500,000 |
| 9 | 280 | 19 | 3,600 | 29 | 50,000 | 39 | 850,000 | 49 | 4,000,000 |
| 10 | 380 | 20 | 4,400 | 30 | 75,000 | 40 | 1,000,000 | 50 | 4,500,000 |
| 11 | 500 | 21 | 5,400 | 31 | 100,000 | 41 | 1,250,000 | – | (5,000,000 unused) |

The table has 50 entries; the last (5,000,000) can never be needed because `adjust_level()` stops at `PY_MAX_LEVEL = 50`. A Human needs 4,500,000 experience for level 50, a High-Elf 6,525,000. Experience is capped at `PY_MAX_EXP = 99,999,999`.

## 5.2 Gaining and losing experience

```c
void player_exp_gain(struct player *p, int32_t amount)
{
	p->exp += amount;
	if (p->exp < p->max_exp)
		p->max_exp += amount / 10;      /* drained characters slowly raise their ceiling */
	adjust_level(p, true);
}

void player_exp_lose(struct player *p, int32_t amount, bool permanent)
{
	if (p->exp < amount) amount = p->exp;
	p->exp -= amount;
	if (permanent) p->max_exp -= amount;
	adjust_level(p, true);
}
```

While drained (`exp < max_exp`), 10% of every gain also raises `max_exp`, so a drained character who keeps fighting gradually widens the gap they have to recover; the remaining 90% closes it. Non-permanent losses leave `max_exp` untouched and can be recovered in full.

`adjust_level()` then:

1. Clamps `exp` and `max_exp` to 0..99,999,999 and raises `max_exp` to `exp` if it has been exceeded.
2. Lowers `lev` while `exp < need(lev)`; this is how level drain works (there is no separate "lose a level" mechanic; losing enough experience simply lowers the level).
3. Raises `lev` while `lev < 50` and `exp >= need(lev + 1)`. For each level gained it records `max_lev`, logs "Reached level N" in the character history (`HIST_GAIN_LEVEL`), prints "Welcome to level N." with the level-up sound, and **restores all five stats** to their current maximums via `EF_RESTORE_STAT`. Stat drain in 4.2 is therefore always temporary until the next level-up (permanent drains lower `stat_max` itself and are not undone).
4. Raises `max_lev` while `max_exp` allows.
5. Flags `PU_BONUS | PU_HP | PU_MANA | PU_SPELLS`, so hit points (from the birth-rolled `player_hp[]` table), mana, spell counts and every derived value are recalculated immediately.

Nothing is rolled at level-up time: the hit-point gain for every level was fixed at birth (see Character Creation), which is why losing and regaining a level is lossless.

## 5.3 Experience from kills

`player_kill_monster()` in `mon-util.c`:

```c
div = p->lev;
new_exp      = ((long)race->mexp * race->level) / div;
new_exp_frac = ((((long)race->mexp * race->level) % div) * 0x10000L / div) + p->exp_frac;
if (new_exp_frac >= 0x10000L) { new_exp++; p->exp_frac = new_exp_frac - 0x10000L; }
else                            p->exp_frac = new_exp_frac;
player_exp_gain(p, new_exp);
```

So a kill is worth `mexp × monster level / player level`, with the remainder carried in 1/65536ths across kills so nothing is lost to rounding. `mexp` is the `experience:` field and `level` the `depth:` field of the monster's `monster.txt` entry. The same monster is worth less at every level the player gains; there is no depth term and no bonus for out-of-depth kills.

Examples:

| Killer | Monster | mexp × level | Experience |
|---|---|---|---|
| Level 1 | Grip, Farmer Maggot's Dog (level 2, mexp 30) | 60 | 60 (enough for level 3 outright for a Human) |
| Level 10 | the same | 60 | 6 |
| Level 20 | Cave orc (level 7, mexp 30) | 210 | 10 (plus 0.5 carried in `exp_frac`) |
| Level 40 | Sauron (level 99, mexp 50,000) | 4,950,000 | 123,750 |
| Level 50 | Morgoth (level 100, mexp 60,000) | 6,000,000 | 120,000 |

Special cases:

- Shape-changed monsters revert before experience is computed (`monster_revert_shape()`), so the original race's values are used.
- Uniques: `race->max_num = 0` (never generated again) and a "Killed X" history entry (`HIST_SLAY_UNIQUE`).
- Monsters killed by the player's projections, thrown objects and melee all go through this path. Monsters killed by other monsters (`mon_take_nonplayer_hit()`) give nothing.
- Experience is credited before `monster_death()` generates the drop, so a level-up message may precede the loot.

## 5.4 Experience from learning

| Source | Amount | Where |
|---|---|---|
| Using an unknown flavoured item (potion, scroll, wand, staff, rod, mushroom, ring/amulet by use) | `(kind level + player level / 2) / player level` | `object_learn_on_use()` in `obj-knowledge.c` |
| Successfully casting a spell for the first time | `spell exp × spell level` (`sexp` and `level` fields of the spell in `class.txt`; `PY_SPELL_WORKED` prevents repeats) | `spell_cast()` in `player-spell.c` |
| Potion of Experience (`GAIN_EXP` effect) | `dice value / 2` ("a slight hack to simplify food description"), only if `exp < PY_MAX_EXP` | `effect_handler_GAIN_EXP()` |

Learning a rune (an object property) gives no experience; only the first use of a flavour does. For a level 1 character reading a level 5 scroll: (5 + 0) / 1 = 5 points. For a level 30 character with a level 65 potion: (65 + 15) / 30 = 2.

## 5.5 Experience drain

All drains call `player_exp_lose()`; the "permanent" flag is only true for the malignant-aura outcome of the Wonder/curse effect (which takes a quarter of current experience from `max_exp` as well). The constant `mon-play:life-drain` (`z_info->life_drain_percent`, 2) makes most drains proportional to the character's total experience.

| Cause | Amount lost | Protection |
|---|---|---|
| Monster blow `EXP_10` / `EXP_20` / `EXP_40` / `EXP_80` | `10d6` / `20d6` / `40d6` / `80d6` + 2% of exp | Hold Life resists completely with 95 / 90 / 75 / 50% chance; on failure a Hold Life character loses one tenth of the amount ("You feel your life slipping away!") |
| Nether damage (`project_player_handler_NETHER`) | 200 + 2% of exp | Nether resistance or Hold Life blocks it entirely |
| Chaos damage | 3% of exp (`(exp * 3 / 200) * 2`) | Chaos resistance (no chaos effects at all) or Hold Life |
| Time damage | 50%: 100 + 2% of exp; otherwise stats are drained instead | none (Hold Life does not help against time) |
| Powerful cold (`power >= 80`, i.e. monster level ≥ 80) | if `randint0(dam) > 500`: drain equal to the damage | Hold Life |
| Powerful darkness (`power >= 70`) | if `randint0(dam) > 100`: drain equal to the damage | Hold Life, or resisting darkness |
| Wearing an item with `DRAIN_EXP` | each world tick (every 10 game turns), 1 in 10: `(10d6 + 2% of exp) / 10` | none; the rune is learnt on the first tick |
| Malignant aura (Wonder / curse effect) | exp / 4, permanent, plus all stats | none |

A level drop caused by drain is reversed the moment experience climbs back over the threshold, whether by kills or by restoration.

## 5.6 Restoring experience

`EF_RESTORE_EXP` (Potion of Restore Life Levels, some class spells and activations) does `player_exp_gain(p, max_exp - exp)` when `exp < max_exp`, i.e. it restores in one go and does not change `max_exp` beyond the 10% rule (which adds nothing here because the gain brings `exp` up to `max_exp` exactly, and the 10% is only added while `exp < max_exp` before the addition: `max_exp += amount / 10` runs *after* `exp += amount`, so once `exp == max_exp` the condition is false). Winning the game also sets `exp = max_exp` and `lev = max_lev` in `death_knowledge()`.

## 5.7 What the character sheet shows

`ui-player.c` prints Cur Exp (`exp`), Max Exp (`max_exp`), Adv Exp (`need(lev + 1)`, blank at level 50) and the experience factor. The level line is shown in yellow while `lev < max_lev` (drained), and Cur Exp is likewise highlighted while below Max Exp. The status bar's level indicator behaves the same way.
