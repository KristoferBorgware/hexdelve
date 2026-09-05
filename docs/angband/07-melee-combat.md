# 7. Melee combat

Melee happens when the player moves into a monster (or a monster into the player). Both directions use the same hit test, `test_hit()`, but the numbers fed into it differ: the player's side uses a skill plus bonuses against the monster's armour class, the monster's side uses `3 × level + blow power` against the player's total armour. This chapter gives every formula in `player-attack.c` (the player's blows), `mon-attack.c` and `mon-blows.c` (the monster's blows), and `obj-slays.c` (slays and brands), plus what happens to a monster that is hurt.

## 7.1 The hit test

```c
void hit_chance(random_chance *c, int to_hit, int ac)
{
	to_hit = MAX(9, to_hit);
	numerator   = MAX(0, to_hit - ac * 2 / 3);
	denominator = to_hit;
	/* scaled to 10,000; then 12% guaranteed hit and 5% guaranteed miss */
	p = 1200 + (10000 - 1200 - 500) * numerator / denominator / 10000
}
```

So the probability of a hit is

```text
P(hit) = 0.12 + 0.83 × max(0, to_hit − 2·AC/3) / to_hit
```

with `to_hit` floored at 9. Every attack, however hopeless, hits 12% of the time, and every attack, however skilled, misses 5% of the time. The same function serves the player's melee and missiles and the monsters' melee and hostile spells.

Examples: to_hit 60 vs AC 30 → 0.12 + 0.83 × 40/60 = 67%; to_hit 60 vs AC 90 → 12%; to_hit 200 vs AC 90 → 0.12 + 0.83 × 140/200 = 70%.

## 7.2 The player's attack round

`py_attack()` is entered from moving into a monster, `+`/`T`/`o`/`D` on a monster's grid, or a bloodlust-forced attack. It disturbs the player, and then:

1. Blackguards (COMBAT_REGEN) gain 5% of their maximum SP (at least half a point).
2. If the class has SHIELD_BASH and the monster is visible, `attempt_shield_bash()` may happen first (7.6).
3. Blows are struck while `energy_use + blow_energy <= min(player energy, 100)` and the monster is alive, where `blow_energy = 100 * 100 / num_blows`. A character with 2.5 blows (250) spends 40 energy per blow, so gets two blows in a normal turn (80 energy) and banks the remaining 20; with 320 blows (31 each) three blows use 93 and the fourth cannot fit, and so on. Because the cap is one turn's energy, a fast character never gets more than `num_blows` blows per attack command, but partial blows are never lost: the leftover energy is still in the reservoir.
4. If the monster became afraid during the round, "flees in terror" is reported once at the end.

Each blow is `py_attack_real()`:

1. The player cannot attack while afraid (`OF_AFRAID` in the state flags, from the timed effect or an item): "You are too afraid to attack".
2. The monster is woken and made aware of the player (`monster_wake(mon, false, 100)`), and any hold on it is cleared.
3. **To hit**: `chance = SKILL_TO_HIT_MELEE + (state.to_h + weapon to_h + 2 if bless_wield) × 3`, halved if the monster is not visible; `test_hit(chance, race AC)`. A miss ends the blow (with a 1-in-50 bloodlust side effect of scrambled stats).
4. **Slays and brands**: `improve_attack_modifier()` is run over every equipped item other than the weapon and launcher (rings, gloves, etc. can carry brands), then over the weapon, then over temporary brands and slays from timed effects. The single best multiplier wins (7.4).
5. **Damage** (standard combat): `damroll(dd, ds) × multiplier + weapon to_d`, then `critical_melee()` (7.5), then `+ state.to_d` (the player's own to-dam from stats, rings, gloves, bless and timed effects). Unarmed damage is a flat 1 with no criticals. Damage is floored at 0 ("You fail to harm").
6. Shape-changed players use one of their shape's blow verbs at random.
7. `IMPACT` weapons cause an earthquake of radius 10 when a blow does more than 50 damage. Runes are learnt: attacking teaches the weapon's to-hit/to-dam and any slay or brand that applied.
8. Pre-damage side effects: a `TMD_ATT_CONF` (confusing touch) is consumed to confuse the monster for `10 + randint0(level) / 10` turns.
9. `mon_take_hit()` (7.8). Vampiric attacks (`TMD_ATT_VAMP`) heal the player by the damage dealt to a living monster. Bloodlust has a 1-in-50 chance of draining CON.

### Worked example

Level 20 Warrior, melee skill 70 + 45 × 20/10 = 160, `state.to_h` +8 (18/50 STR gives +1, 18/20 DEX +3, plus a +4 ring), wielding a Long Sword (2d5) (+5,+7), 3.0 lb, 2.7 blows, `state.to_d` +5 (STR +3, ring +2), against an Ogre (AC 33, level 13):

- to_hit = 160 + (8 + 5) × 3 = 199; P(hit) = 0.12 + 0.83 × (199 − 22) / 199 = 85.8%.
- Damage per hit: 2d5 (avg 6) + 7 = 13, critical adjustments (below), + 5 = about 18 without a critical.

## 7.3 Damage against armour is not reduced

Nothing reduces the player's melee damage against a monster except the monster's own resistances to brands. Monster AC only affects the chance to hit.

## 7.4 Slays and brands

`slay.txt` and `brand.txt` define the multipliers. A slay matches a monster race flag (or a monster base); a brand applies unless the monster has the brand's resist flag, and is doubled if the monster has the brand's vulnerability flag.

| Slay | Flag | Mult | O-mult | Verb |
|---|---|---|---|---|
| EVIL_2 | EVIL | ×2 | 1.8 | smite |
| ANIMAL_2 | ANIMAL | ×2 | 2.0 | smite |
| ORC_3, TROLL_3, GIANT_3, DEMON_3, DRAGON_3, UNDEAD_3 | ORC, TROLL, GIANT, DEMON, DRAGON, UNDEAD | ×3 | 2.5 | smite |
| DEMON_5, DRAGON_5, UNDEAD_5 | DEMON, DRAGON, UNDEAD | ×5 | 3.5 | fiercely smite |

| Brand | Resisted by | Doubled against | Mult | O-mult | Verb |
|---|---|---|---|---|---|
| ACID_3, ELEC_3, POIS_3 | IM_ACID, IM_ELEC, IM_POIS | – | ×3 | 2.5 | dissolve, shock, poison |
| FIRE_3 | IM_FIRE | HURT_FIRE (×6) | ×3 | 2.5 | burn |
| COLD_3 | IM_COLD | HURT_COLD (×6) | ×3 | 2.5 | freeze |
| ACID_2, ELEC_2, POIS_2 | as above | – | ×2 | 1.5 | corrode, zap, sicken |
| FIRE_2, COLD_2 | as above | HURT_FIRE / HURT_COLD (×4) | ×2 | 1.5 | singe, chill |

The `_2` brands are the weaker "cursed" or lower-tier versions found on some egos and randarts. `improve_attack_modifier()` starts from the multiplier already chosen (so a brand on a ring competes with the weapon's slay) and keeps the highest; ties keep the earlier one. Only one multiplier is ever applied; slays and brands never stack. The `power:` field in the data files is only used by object power evaluation.

Temporary brands come from timed effects with a `brand:` line in `player_timed.txt` (`TMD_ATT_ACID`, `ATT_ELEC`, `ATT_FIRE`, `ATT_COLD`, `ATT_POIS`: the `_3` brands) and temporary slays from `TMD_ATT_EVIL` (EVIL_2) and `TMD_ATT_DEMON` (DEMON_5); they are checked with a NULL object in the loop above.

In standard combat the multiplier applies to the dice only: `dice × mult + to_d`. A 2d5 sword of Slay Orc (+0,+9) does 3 × 2d5 + 9 against an orc (avg 27), not 3 × (2d5 + 9).

## 7.5 Critical hits

Two systems exist; the standard one is used unless `birth_percent_damage` is on. The constants live in `constants.txt`.

**Standard** (`critical_melee()`):

```c
to_h   = state.to_h + weapon to_h  (+10 if the monster is confused, held, afraid or stunned)
chance = weight(tenth lb) × 1 + to_h × 5 + level × 0 + SKILL_TO_HIT_MELEE × 1 − 60
if randint1(5000) > chance: no critical
else power = weight × 1 + randint1(650), and the first level whose cutoff exceeds power applies:
```

| Power | Multiplier | Added | Message |
|---|---|---|---|
| < 400 | ×2 | +5 | "It was a good hit!" |
| < 700 | ×2 | +10 | "It was a great hit!" |
| < 900 | ×3 | +15 | "It was a superb hit!" |
| < 1300 | ×3 | +20 | "It was a *GREAT* hit!" |
| ≥ 1300 | ×4 | +20 | "It was a *SUPERB* hit!" |

The critical multiplies the dice-plus-weapon-to-dam figure but *not* the player's `state.to_d`, which is added afterwards. For the Warrior above (weapon 30, to_h 13, skill 160): chance = 30 + 65 + 160 − 60 = 195 out of 5000 = 3.9% per hit; power = 30 + 1d650, so 57% of those are "good", 40% "great", and about 3% "superb". A 30 lb weapon has chance 495 (9.9%) and power 300 + 1d650, reaching "*GREAT*" 40% of the time and "*SUPERB*" never (max 950). Heavy weapons are thus the only way to the top criticals, which is why weight is in both formulas. Unarmed blows never crit.

**O-combat** (`o_critical_melee()`, `o_melee_damage()`): damage is `(dd + extra dice) d sides` where the number of sides is derived from the weapon's average die, the slay/brand "o-multiplier" (`o-multiplier / 10`, so EVIL_2 is ×1.8 and a `_3` brand ×2.5) and a "deadliness" percentage from `to_d`: the sum of `state.to_d` and the weapon's to-dam is looked up in `deadliness_conversion[]` (0, 5, 10, 14, 18, 22, 26, 30, 33, 36, 39, 42, ..., rising by 3 per point to about +20, then by 2, reaching 255 at 100 and capped there), and the die average is multiplied by `1 + table/100`, so +10 to-dam means +39% damage and +20 means +69%, with a hard cap of +255%. Criticals add whole dice: the chance is `power / (power + 240)` where `power = to_hit chance / 3` (+10 if the target is debuffed), and the level is picked by successive 1-in-N rolls: 1/40 for +5 dice ("*SUPERB*"), else 1/12 for +4, else 1/3 for +3, else 1/2 for +2, else +1. A `_3` brand adds a flat +15 damage (`o_multiplier − 10`) on top. Minimum blows are 2.0 in this mode.

## 7.6 Shield bashes

Warriors, Paladins and Blackguards (`SHIELD_BASH`) wearing a shield may open a melee round with a bash if the monster is at least half the player's level:

```c
bash_chance = SKILL_TO_HIT_MELEE / 8 + adj_dex_th[DEX] / 2;   ×4 if unarmed, ×2 if weapon dice×blows < shield dice×3
bash if bash_chance > randint0(200 + monster level)
bash_quality = melee skill / 4 + player weight / 8 + carried weight / 80 + shield weight / 2
bash_dam = damroll(shield dd, ds) × (bash_quality / 40 + level / 14) + adj_str_td[STR], capped at 125
```

Then: stun the monster for `randint0(level/5) + 4` if `bash_quality + level > randint1(200 + 8 × monster level)`; confuse it for the same duration if `> randint1(300 + 12 × monster level)`; and the player stumbles, losing 26–75% of a turn, when `35 + adj_dex_th < randint1(60)` (so a 18/50 DEX character with +4 stumbles 35% of the time). The bash uses no blows and is not a critical.

## 7.7 Monster melee against the player

`make_attack_normal()` iterates the monster's up to four blows (`mon_blows_max`). For each blow with a method:

1. **Hit check**: blows with effect `NONE` always "hit"; otherwise `check_hit(p, to_hit)` with `to_hit = max(level, 1) × 3 + effect power`, reduced by 25% if the monster is stunned, versus `state.ac + state.to_a`, through `test_hit()`. Being hit teaches the runes of any armour bonuses. Example: a level 30 monster's HURT blow (power 40) has to_hit 130; against AC 100 the hit chance is 0.12 + 0.83 × (130 − 66) / 130 = 53%; against AC 40 it is 78%. The powers: HURT 40, ELEC/FIRE/COLD 40, SHATTER 60, POISON 20, ACID 20, CONFUSE 20, EXP_* 20, DISENCHANT 10, DRAIN_CHARGES 10, and 0 for the theft, eating, blindness, terror, paralysis, stat-loss, hallucination and Black Breath blows.
2. **Protection from evil**: with `TMD_PROTEVIL`, an evil monster of level ≤ the player's is repelled when `randint0(100) + level > 50`.
3. **Damage** is `randcalc(blow dice, level, RANDOMISE)`, reduced 25% if the monster is stunned, then handed to the effect handler.
4. **Cuts and stuns** from the blow *method* (HIT can do either, CLAW/BITE cut, PUNCH/KICK/BUTT/CRUSH stun; the rest neither). If both are possible one is chosen at random. `monster_critical()` grades the blow: no critical unless damage ≥ 95% of the blow's maximum (and, for damage below 20, a `damage`% roll); grade 1–6 by damage thresholds 11/18/25/33/45, +1 for exactly maximum damage and further +1s with 2% chance each above 20 damage. Cut amounts by grade: 1d5, 5+1d5, 20+1d20, 50+1d50, 100+1d100, 300, 500; stun amounts: 1d5, 10+1d10, 20+1d20, 30+1d30, 40+1d40, 100, 200.
5. If the player moved (teleported by an effect) the remaining blows are skipped. Thieves that stole "blink" away with a teleport of `2 × max_sight + 5` = 45 grids afterwards.
6. Lore: a visible monster's blow is counted as seen when it was obvious or did damage (or has already been seen 10 times); the player's death by this monster increments `lore->deaths`.

Blows never target monsters in 4.2 except through `monster_attack_monster()` (used when the player commands a monster); the same handlers cover that case.

### Blow methods

| Method | Cut | Stun | Miss message | Physical |
|---|---|---|---|---|
| HIT | yes | yes | yes | yes |
| TOUCH | – | – | yes | – |
| PUNCH, KICK, BUTT, CRUSH | – | yes | yes | yes |
| CLAW, BITE | yes | – | yes | yes |
| STING | – | – | yes | yes |
| ENGULF | – | – | yes | – |
| CRAWL, DROOL, SPIT, GAZE, WAIL, SPORE, BEG, INSULT, MOAN | – | – | – | – |

"Physical" matters for elemental blows: a non-physical FIRE touch does only the elemental part.

### Blow effects

`adjust_dam_armor(damage, ac) = damage − damage × min(ac, 240) / 400`, so armour reduces plain damage by AC/4 percent, up to 60% at AC 240. The player's flat damage reduction (`DAM_RED`) is applied after the handler to the hit points lost, but not to the damage used for side effects.

| Effect | What happens (level = monster level) |
|---|---|
| NONE | Message only. |
| HURT | Damage reduced by armour, then taken. |
| SHATTER | As HURT; if the damage exceeds 23, an earthquake of radius damage/12 centred on the monster; if over 100, `randint1(dam − 100) > 40` knocks the player back `1 + (dam − 100)/40` grids. |
| ACID, ELEC, FIRE, COLD | "You are covered in acid!" etc. Physical part: damage reduced by armour with +50 AC bonus (0 for non-physical methods); elemental part: damage through `adjust_dam()` with the player's resistance (Elements chapter). The player takes the *larger* of the two, and inventory is damaged by the element with chance `min(5 × elemental damage, 300)` per 10,000 per item. |
| POISON | As an elemental blow with poison, plus poisoned for `5 + 1d(level)` turns (unless resisted). |
| DISENCHANT | Damage, then `EF_DISENCHANT` on a random equipped item unless the player resists disenchantment. |
| DRAIN_CHARGES | Damage, then up to 10 tries to find a charged wand or staff in the pack: it loses `level / (kind level + 2) + 1` charges and the monster heals `level × charges lost`. |
| EAT_GOLD | Damage; then unless paralysed the player saves with `adj_dex_safe[DEX] + level` percent ("You quickly protect your money pouch!", monster still blinks 2/3 of the time). On failure the monster takes `au / 10 + 1d25` gold (minimum 2; if that exceeds 5000, `au / 20 + 1d3000` instead), carries it, and blinks away. |
| EAT_ITEM | Damage; same DEX + level save ("You grab hold of your backpack!"). Otherwise up to 10 random pack slots are tried; artifacts are skipped; an item that would slay the monster is fumbled ("tries to steal ... but fails"); else one item of the stack is stolen and carried (it drops when the monster dies). Blink away. |
| EAT_FOOD | Damage; one random food item is eaten (10 tries). |
| EAT_LIGHT | Damage; `EF_DRAIN_LIGHT` drains 250 + 1d250 turns of fuel from a fuelled light. |
| BLIND | Damage; blind for `10 + 1d(level)` unless PROT_BLIND. No save. |
| CONFUSE | Damage; confused for `3 + 1d(level)` unless PROT_CONF. No save. |
| TERRIFY | Damage; afraid for `3 + 1d(level)` unless PROT_FEAR; a saving throw (`randint0(100) < SKILL_SAVE`) avoids it: "You stand your ground!". |
| PARALYZE | Damage (at least 1 while already paralysed, to prevent perma-paralysis with no damage); paralysed for `3 + 1d(level)` unless FREE_ACT; saving throw: "You resist the effects!". |
| LOSE_STR/INT/WIS/DEX/CON | Damage; `EF_DRAIN_STAT` on that stat (blocked by the sustain; see Player Stats for the reduction). |
| LOSE_ALL | Damage; all five stats drained. |
| EXP_10/20/40/80 | Damage; experience drain of 10d6/20d6/40d6/80d6 + 2% of exp, Hold Life saves 95/90/75/50% (Experience chapter). |
| HALLU | Damage; hallucinating for `3 + 1d(level/2)`. |
| BLACK_BREATH | Damage; 1 in 5: Black Breath timer +damage/10. |

Every blow that matters teaches the monster something under `birth_ai_learn` (`update_smart_learn()`), e.g. an elemental touch records whether the player resisted, a paralysis attempt records Free Action.

## 7.8 Damage to monsters

`mon_take_hit(mon, p, dam, &fear, note)` — the wake-and-reveal, the
`hp < 0` death test (a monster at exactly 0 is alive), the kill
bookkeeping and the `monster_scared_by_damage()` fear rules, with a
worked example — is in *Chapter 12* 12.8. Two points belong here rather
than there: monsters hurt by other monsters
(`mon_take_nonplayer_hit()`) and by projections
(`project_m_player_attack()`) run the same fear logic, and uniques and
arena opponents can only be *killed* by the player, their hit points
being floored at 0 by every other source.

Pain messages (`pain.txt`, `mon-msg.c: get_pain_msg_code()`) are chosen by the percentage of hit points the monster has left *relative to what it had before the blow*: `100 × hp_after / hp_before` above 95 gives the mildest message ("shrugs off the attack"), then the bands above 75, 50, 35, 20 and 10, down to the feeblest message ("cries out feebly") when less than 10% of the previous total remains. Each monster base has one of 12 message sets (type 1 "shrugs off / grunts / cries out / screams", type 2 for oozes, type 3 for dogs, and so on).

## 7.9 The player taking damage

`take_hit(p, dam, cause)` subtracts hit points (Blackguards convert lost HP into SP, except from poison, bleeding and starvation), records the cause of death, and kills the player when `chp < 0` — again strictly negative, so a character at exactly 0 HP is alive. Wizards and `cheat_live` characters get a "Die?" prompt. A Blackguard whose `chp + bloodlust + level >= 0` survives ("Your lust for blood keeps you alive!"). The "*** LOW HITPOINT WARNING ***" fires when HP drops below `mhp × hitpoint_warn / 10`. `player_apply_damage_reduction()` subtracts the flat `DAM_RED` and then the percentage `perc_dam_red`, and invulnerability (`TMD_INVULN`) negates any damage under 9000.
