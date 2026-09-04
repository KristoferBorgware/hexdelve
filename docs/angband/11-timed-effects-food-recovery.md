# 11. Timed effects, food and recovery

Almost every temporary condition on the player — haste, blindness, poison, heroism, temporary resistances, bleeding, hunger — is one of 53 *timed effects* (`list-player-timed.h`, `player_timed.txt`), each an integer counter in `player->timed[]`. This chapter describes the counter mechanics (`player-timed.c`), the schedule on which counters tick down and hurt (`game-world.c`), the special case of food, and regeneration of hit points and mana (`player-util.c`). What each effect does to the character's numbers is tabulated in the Player Stats chapter; how they are blocked is in the Elements chapter.

## 11.1 Counters, grades and messages

Each timed effect is defined by a `name:`, a description, `on-increase`/`on-decrease`/`on-end` messages, one or more `grade:colour:max:name:up-message[:down-message]` lines, optional `fail:` lines (Elements chapter), and optional extras: `resist:ELEMENT` (the effect is a temporary resistance), `brand:`/`slay:` (a temporary attack modifier), `flag-synonym:FLAG:n` (the effect duplicates an object flag, shown in the character sheet as that flag when n is 1), `on-begin-effect`/`on-end-effect` (an effect chain run at the transition), `flags:NONSTACKING`, `lower-bound`.

`player_set_timed(p, idx, v, notify, can_disturb)` is the only writer:

1. `v` is floored at the effect's lower bound (1 for food, 0 otherwise) and capped at the top grade's `max` (10,000 for most effects, i.e. effectively unlimited; 50 for bloodlust, 10 for Black Breath).
2. The grade of the new value and of the old value are found (the first grade whose `max` ≥ value). Going *up* a grade always prints that grade's up message ("You have been given a nasty cut."); going *down* prints the down message if one exists ("You are no longer full."); otherwise, if `notify`, the end / increase / decrease messages are printed.
3. `on-begin-effect` runs when the counter goes from 0 to positive (SCRAMBLE shuffles the stats), `on-end-effect` when it reaches 0 (SCRAMBLE restores them; SPRINT applies `TIMED_INC_NO_RES:SLOW` for 100 turns, so a sprint always ends with a long slowness).
4. If notified, the player is disturbed (interrupting rest and runs) and the effect's `PU_`/`PR_` flags are set (`list-player-timed.h`: every effect triggers `PU_BONUS`; blindness also `PU_UPDATE_VIEW | PU_MONSTERS`; hallucination redraws map, monster and item lists).

`player_inc_timed(p, idx, v, notify, disturb, check)` adds `v` after the resistance check (Elements chapter) and refuses to add to a running `NONSTACKING` effect (only paralysis is non-stacking, which is why a paralysed character cannot be perma-paralysed by repeated hits: the timer must run out before a new one can start). `player_dec_timed()` subtracts and always notifies when the counter reaches 0. `player_clear_timed()` sets 0.

## 11.2 The effects

Durations here are the *common* sources; the Player Stats chapter has the numeric modifiers and the Magic and Objects chapters the spells and items.

| Effect | What it does | Grades / notes |
|---|---|---|
| FAST | +10 speed | |
| SLOW | −10 speed; blocked by Free Action | |
| BLIND | No sight: map not updated, cannot read, cast, or see monsters; searching off | Blocked by PROT_BLIND |
| PARALYZED | No turns at all (a `CMD_SLEEP` is forced each turn) | Blocked by FREE_ACT; NONSTACKING |
| CONFUSED | Random movement 75% of the time, cannot read/cast/run/pathfind, device −25%, aiming scrambled | Blocked by PROT_CONF |
| AFRAID | No melee; −20 to-hit, +8 AC, devices −20%, spells +20% fail | Blocked by PROT_FEAR, hero, berserk, bold |
| IMAGE | Hallucination: monsters and objects drawn as random symbols, devices −20% | Blocked by chaos resistance |
| POISONED | 1 damage per world tick; no HP regeneration; devices −5% | Blocked by poison resistance or OPP_POIS; recovers `adj_con_fix + 1` per tick |
| CUT | Bleeding damage per tick and no regeneration | Graze ≤ 10, Light Cut ≤ 25, Bad Cut ≤ 50, Nasty Cut ≤ 100, Severe Cut ≤ 200, Deep Gash ≤ 1000, Mortal Wound > 1000. Damage per tick: 1 up to Nasty, 2 for Severe, 3 for Deep Gash and Mortal Wound. Recovers `adj_con_fix + 1` per tick, except a Mortal Wound, which never heals by itself. ROCK (Pukel-man) players neither bleed nor recover. |
| STUN | To-hit/to-dam −5 (−20 heavy), device −10% (−20%), spells +15% (+25%) fail; no regeneration; cancels FASTCAST | Stun ≤ 50, Heavy Stun ≤ 150, Knocked Out > 150 (no turns). Blocked by PROT_STUN; recovers `adj_con_fix + 1` per tick |
| FOOD | Hunger scale (11.4) | Starving ≤ 100, Faint ≤ 400, Weak ≤ 800, Hungry ≤ 1500, Fed ≤ 9000, Full ≤ 10000 |
| PROTEVIL | Repels melee from evil monsters of level ≤ the player's, with chance `randint0(100) + level > 50` | |
| INVULN | +100 AC and all damage under 9000 negated (no source in the standard game) | |
| HERO | +12 to-hit, +10 HP (via the HEAL on cast), fear immunity, devices +5% | |
| SHERO (Berserk) | +75 melee skill, −10 AC, fear immunity, devices −10% | |
| SHIELD | +50 AC | |
| BLESSED | +5 AC, +10 to-hit, devices +5% | |
| SINVIS | See invisible | Synonym for SEE_INVIS |
| SINFRA | +5 infravision | |
| OPP_ACID/ELEC/FIRE/COLD/POIS | +1 resistance level to that element (max 2) | Cannot be gained while vulnerable |
| OPP_CONF | Confusion protection | Synonym for PROT_CONF |
| AMNESIA | Cannot read; spells `50 + fail/2`; devices −20% | |
| TELEPATHY | Telepathy | Synonym for TELEPATHY |
| STONESKIN | +40 AC, −5 speed | |
| TERROR | +10 speed but AFRAID (cannot fight) | |
| SPRINT | +10 speed; ends with 100 turns of slowness | Potion of ... / Rogue |
| BOLD | Fear protection | |
| SCRAMBLE | Stats permuted for the duration (`stat_map`), restored at the end | Blocked by nexus resistance |
| TRAPSAFE | Trap immunity (does not learn the rune) | |
| FASTCAST | Spells cost 75 energy | Cancelled by stun |
| ATT_ACID/ELEC/FIRE/COLD/POIS | Temporary `_3` brand on melee | |
| ATT_CONF | Next melee hit confuses (consumed by the hit) | |
| ATT_EVIL / ATT_DEMON | Temporary Slay Evil ×2 / Slay Demon ×5 | |
| ATT_VAMP | Melee heals the player by the damage dealt to living monsters | |
| HEAL | 30 HP per tick, but hunger runs 800 units per tick and the effect ends when Hungry | Rapid Regeneration |
| COMMAND | The player controls a monster; each command is redirected to it (`CMD_COMMAND_MONSTER`) | Ends if the monster leaves line of sight |
| ATT_RUN | Hit and Run: the next melee blow is followed by a teleport | |
| COVERTRACKS | No scent; noise increment 4 instead of 1 (monsters hear the player at a quarter of the distance); monsters' spell range quartered (`PROJECT_SHORT`) | |
| POWERSHOT | Next shot pierces `ammo_mult` monsters | |
| TAUNT | Monsters are aggravated towards the player (Blackguard) | |
| BLOODLUST | +bloodlust/2 to-dam, +bloodlust/20 blows, random attacks; decays with side effects (11.6) | Grades at 10, 18, 26, 34, 45, 50 |
| BLACKBREATH | Each tick: 50% CON drain, 50% STR drain, 50% experience drain `100 + 2%` | Max 10; cured by Herbal Curing and potions of *Healing*/Life |
| STEALTH | +10 stealth | |
| FREE_ACT | Free action | Synonym for FREE_ACT |

## 11.3 When counters change: the world tick

`process_world()` runs every 10 game turns (once per normal-speed player turn). In this order it: applies poison (1 damage) and bleeding (1/2/3); handles bloodlust decay and `HEAL`; applies Black Breath; digests food; checks fainting and starvation; regenerates HP (if below maximum) and mana; calls `decrease_timeouts()`; burns light fuel; updates noise and scent; drains experience for `DRAIN_EXP` items; recharges rods and activations; runs curse effects whose timers expire; counts down Word of Recall and Deep Descent. Everything in this chapter therefore happens on the 10-game-turn clock regardless of the player's speed: a hasted character gets two actions per tick of poison, a slowed one half an action.

`decrease_timeouts()`: every non-zero timed effect decreases by 1 per tick, except FOOD (handled by digestion), CUT, POISONED and STUN, which decrease by `adj_con_fix[CON] + 1` (1 at CON ≤ 13, 2 at 14–17, 3 at 18/00–18/49, 4 at 18/50–18/99, up to 10 at 18/200+), a Mortal Wound (0), and cuts on a ROCK player (0). Curse timers on worn items also count down here (Object Generation chapter 15.7).

Because effects tick per world turn, a duration of "20 + 1d20" from a potion is 20–40 player turns at normal speed, 40–80 actions for a +10 character.

## 11.4 Food

The food counter runs from 1 to 10,000; `player:food-value` (100) is the number of game turns one percent of the scale lasts at normal speed, so the scale is conveniently read as hundredths of a percent. Grade maxima are stored multiplied by 100:

| Grade | Range | Effects |
|---|---|---|
| Full ("gorged") | 9,001–10,000 | Speed −1 per 100 units above 9,000 (up to −10); digestion 50 units per tick instead of the normal rate; vampires (ATT_VAMP) are exempt from the slowdown |
| Fed | 1,501–9,000 | Normal |
| Hungry | 801–1,500 | To-hit and to-dam −`lack`, where `lack = (1500 − food) × 20 / 1500` (1 at 1,425, up to 9); devices, disarming, saving throw and searching lose 10–30% as `lack` grows past 10, 15 and 18 (Player Stats chapter) |
| Weak | 401–800 | As above, plus HP regeneration halved (`PY_REGEN_WEAK`) |
| Faint | 101–400 | Regeneration at a sixth (`PY_REGEN_FAINT`); each tick 1 in 10 chance of fainting: paralysed `1 + randint0(5)`, bypassing Free Action |
| Starving | 1–100 | No regeneration; `(100 − food) / 10` damage per tick, i.e. up to 9 per tick at 1 food |

The character starts at 8,999 (just under "Full", see Character Creation).

**Digestion** happens every 100 game turns (10 ticks), not every tick:

```c
i = extract_energy[speed];        /* 10 at normal speed, 20 at +10, 5 at -10 */
i = i * 100 / food_value;          /* = i */
if (REGEN) i *= 2;
if (SLOW_DIGEST) i /= 2;
food -= MAX(i, 1);
```

So a normal-speed character burns 10 units per 100 game turns, or 1% of the scale per 1,000 game turns: the 7,500 units between Fed-full and Hungry last 75,000 game turns = 7,500 player turns. A +10 character burns twice as fast per game turn but the same per action; Regeneration doubles consumption and Slow Digestion halves it (a Hobbit... no race has it innately; it comes from items). While gorged, digestion is 50 units per tick (500 per 100 game turns) until the counter drops below 9,000.

**Eating** uses the `NOURISH` effect: Ration of Food +30% (3,000 units), Apple +10%, Slime Mold +15%, Honey-cake to at least 60%, Elvish Waybread to at least 75% (plus cure poison and 4d8 healing), Fine Wine +3% and `BOLD`, Slime Mold Juice +10%, Cure Light Wounds potions and most other potions a few percent (their `NOURISH` lines), and the Remove Hunger spells set the counter to at least 50%/80%. `NOURISH:INC_TO` raises to the target and never lowers; `SET_TO` can lower it ("You vomit!"; Potion of Salt Water sets it to 1... unverified value).

## 11.5 Regeneration

Hit points and mana are stored with a 16-bit fraction (`chp_frac`, `csp_frac`), and regeneration works in 1/65,536ths of a point per tick:

```c
/* player_regen_hp(), every world tick while chp < mhp */
percent = food >= Weak ? 197 : food >= Faint ? 98 : food >= Starving ? 33 : 0;   /* PY_REGEN_NORMAL/WEAK/FAINT */
percent = percent * (100 + fed_percent / 3) / 100;    /* fed_percent = food / 100: up to +33% when full */
if (REGEN)  percent *= 2;
if (resting for 5+ turns, or in a special rest mode) percent *= 2;
if (IMPAIR_HP) percent /= 2;
if (paralysed, poisoned, stunned or cut) percent = 0;
hp_gain = mhp * percent + 1442;                        /* PY_REGEN_HPBASE, in 1/65536 HP */
```

So per tick the character regains `mhp × percent / 65536 + 0.022` HP. With 197 (fed, 0%) that is 0.3% of maximum HP per tick, or 1.2% resting with Regeneration. Examples per tick:

| Max HP | Fed 50%, awake | Fed 50%, resting | Resting + Regeneration |
|---|---|---|---|
| 50 | 0.20 | 0.37 | 0.72 |
| 200 | 0.72 | 1.42 | 2.81 |
| 1000 | 3.50 | 6.98 | 13.9 |

Resting from 1 HP to full takes about 140 ticks (1,400 game turns) at any hit-point total, half that with Regeneration, and about 2.5% longer per grade of hunger. The first 5 turns of a numeric rest count (`R` with a number) do not get the resting bonus (`REST_REQUIRED_FOR_REGEN`); `R&` and `R*` do from the first turn.

Mana (`player_regen_mana()`) uses `percent = 197`, ×2 for Regeneration and ×2 for resting, ÷2 for `IMPAIR_MANA`, `sp_gain = msp × percent + 524`: 0.3% of maximum SP plus 0.008 per tick, so full mana returns in roughly the same 140 resting ticks. Hunger does not affect mana. Blackguards (COMBAT_REGEN) have `percent / −2`: they *lose* 0.15% of max SP per tick (no bonuses while above half HP), and each SP lost this way heals HP at double the rate that casting does (`convert_mana_to_hp()`).

Poison, cuts and stuns stop hit-point regeneration entirely, which is why a poisoned character does not recover by resting until the poison wears off.

## 11.6 Over-exertion and bloodlust decay

`player_over_exert(p, flags, chance, amount)` is the generic "you pushed too hard" routine: each flagged consequence happens with `chance`%: CON drain (permanent 50% of the time when `chance >= 50`), fainting (paralysis `1d(amount)`, ignoring Free Action), stat scramble, cuts, confusion, hallucination, slowness, or `1d(amount)` damage ("You cry out in sudden pain!"). It is called by casting without mana (Magic chapter), by bloodlust side effects in melee (1 in 50 per blow: scramble on a miss, CON damage on a hit), and every tick while bloodlust is active: `player_over_exert(HP | CUT | SLOW, max(0, 10 − bloodlust), chp / 10)`, so the *tail* of a bloodlust (the last nine points) is when the damage, wounds and slowing arrive, with chance `10 − bloodlust` percent per tick each.

## 11.7 Light fuel

`player_update_light()` runs every tick: a wielded light without `NO_FUEL` (torches and lanterns; artifacts and the Phial have NO_FUEL) loses 1 turn of fuel, except in town by day. "Your light is growing faint" at 40 and 20 turns left; at 0 "Your light has gone out!" and a torch (`BURNS_OUT`) is destroyed while a lantern stays, empty. While blind the last turn of fuel is preserved. Torches hold up to 5,000 turns, lanterns 15,000 (default 7,500 when found); refuelling (`F`) with a flask or another torch costs half a turn.
