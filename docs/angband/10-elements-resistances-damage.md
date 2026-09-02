# 10. Elements, resistances and damage to the player

Damage to the player arrives either as a plain hit-point loss (`take_hit()`, used by melee `HURT` blows, traps and self-inflicted effects) or through the projection system as one of 25 *elements* (`list-elements.h`), each of which has its own resistance level in the player's state, its own damage adjustment, and its own side effects (`project-player.c`). This chapter gives the resistance model, the exact `adjust_dam()` arithmetic, every element's side effects, the flags that block status effects, and the inventory damage rules.

## 10.1 Resistance levels

`state.el_info[element].res_level` is an integer:

| Level | Meaning | Displayed as |
|---|---|---|
| 3 | Immune | `*` |
| 2 | Double resistance (permanent + temporary) | `+` with temporary marker |
| 1 | Resistance | `+` |
| 0 | Nothing | `.` |
| −1 | Vulnerability | `-` |

`calc_bonuses()` (Player Stats chapter) computes it as: the race's level (`values:RES_X[n]` in `p_race.txt`); the *maximum* over all equipped items' levels for that element (an item's `values:RES_FIRE[1]` or `[3]` from `object.txt`/`artifact.txt`, or a shape's); then, if any source (race, item, shape) was −1 and the level is below 3, subtract one; then Necromancers get resist dark and Blackguards... no — the EVIL player flag gives resist nether and *vulnerability* to holy orb; finally each active temporary resistance (`TMD_OPP_x`) adds one, capped at 2. So:

- resistance + temporary resistance = 2 (the fraction is applied twice);
- immunity is never reduced by a vulnerability and never increased by a temporary resistance;
- vulnerability + resistance = 0; vulnerability + resistance + temporary = 1;
- two resistance items do not stack (maximum, not sum).

Sources in the standard game: races (Elf and High-Elf resist light, Half-Orc dark, Kobold poison; Dunadan/Half-Troll and others have sustains but no resistances), the Necromancer's Unlight (dark) and Evil (nether), the Pukel-man shape (poison immunity, shards), rings and amulets of resistance, elemental armour, dragon scale mail, ego items ("of Resistance", "of Elvenkind", "of Permanence", ...), artifacts, and the temporary `OPP_ACID/ELEC/FIRE/COLD/POIS` effects from potions, spells and activations. There is no temporary resistance to the higher elements. Immunities come only from a few artifacts and the "of Immunity" egos; vulnerabilities from cursed items ("vulnerability" curses) and the EVIL flag.

`player_resists(p, e)` is `res_level > 0`; `player_is_immune()` is `res_level == 3`.

## 10.2 The damage adjustment

```c
int adjust_dam(struct player *p, int type, int dam, aspect dam_aspect, int resist, bool actual)
{
	resist = p->state.el_info[type == ICE ? COLD : type].res_level;   /* ICE uses the cold resistance */
	if (actual) equip_learn_element(p, type);      /* the player learns the rune of whatever resisted */
	if (resist == 3) return 0;
	if (type == ACID && minus_ac(p)) dam = (dam + 1) / 2;   /* armour absorbs half of acid */
	if (resist == -1) return dam * 4 / 3;
	denom = randcalc(projections[type].denominator, 0, dam_aspect);
	for (i = resist; i > 0; i--)
		if (denom) dam = dam * projections[type].numerator / denom;
	return dam;
}
```

The `numerator`/`denominator` pair comes from `projection.txt`:

| Elements | Fraction per resistance level | Resisted once | Resisted twice |
|---|---|---|---|
| ACID, ELEC, FIRE, COLD, POIS, ICE | 1/3 | 33% | 11% |
| LIGHT, DARK, SOUND, SHARD, NEXUS, NETHER, CHAOS, DISEN | 6 / (8 + 1d4), rolled per hit | 50–67% (avg ≈ 58%) | 25–44% |
| WATER, GRAVITY, INERTIA, FORCE, TIME, PLASMA, METEOR, MISSILE, MANA, HOLY_ORB, ARROW | none (no resistance exists; immunity via level 3 only) | 100% | – |

Note that `dam_aspect` inverts the usual meaning for the random denominators so that object descriptions can show the worst case; in play (`RANDOMISE`) the denominator is a fresh 8 + 1d4 per hit.

**Acid and armour** (`minus_ac()`, `obj-gear.c`): one random armour slot (body, cloak, shield, helm, gloves, boots) is picked; if it holds an item with `ac + to_a > 0`, the acid damage is halved, and unless the item ignores acid it loses 1 point of `to_a` ("Your Leather Boots is damaged!"). The halving applies even when the item ignores acid, so any armour piece is half protection.

**Self-inflicted** projections (a Necromancer's Zone of Unmagic, `PROJECT_SELF` spots) are divided by 10 after adjustment. Damage reduction (`DAM_RED`, `perc_dam_red`) is applied last to the hit-point loss but not to the damage used for side effects. Breath damage caps (`damage-cap` in `projection.txt`: 1600 for the four base elements and mana, 800 poison, 600 nether/chaos, 500 light/dark/sound/shards/disenchantment, 400 nexus, 200 gravity/inertia/force, 150 time/plasma) are applied when the breath is *generated* from the monster's hit points, before resistance (Ranged chapter).

Worked examples with 300 incoming fire:

| Situation | Damage |
|---|---|
| No resistance | 300 |
| Resist fire | 100 |
| Resist + temporary resist | 33 |
| Immune | 0 |
| Vulnerable (cursed item), no resist | 400 |
| Vulnerable + resist | 300 (levels cancel) |

An Ancient Red Dragon at 3600 HP breathes fire for min(3600/3, 1600) = 1600: 1600 unresisted, 533 resisted, 177 double-resisted. Morgoth's nether breath from 20,000 HP is capped at 600: 600 unresisted, 300–400 resisted. Nether resistance is thus much weaker than fire resistance, which is by design ("high" resistances are partial).

## 10.3 Side effects by element

After the damage is applied (and only if the player survives), the element's handler runs with `dam` (the *adjusted* damage) and `power` (the caster's spell power; breaths from POWERFUL monsters count as at least 80; 0 for traps and objects). `inven_damage()` chances are in units of 1/10,000 per item.

| Element | Side effects |
|---|---|
| ACID | Unless immune: inventory damage, chance `min(5 × dam, 300)`; armour damage as above. |
| ELEC | Unless immune: inventory damage `min(5 × dam, 300)`. |
| FIRE | Unless immune: inventory damage `min(5 × dam, 300)`. If `power >= 80`, each with probability `P(randint0(dam) > 500)`: STR drained; blinded `1d(dam/100)`; poisoned `1d(dam/10)`. |
| COLD | Unless immune: inventory damage. If `power >= 80`, each `P(randint0(dam) > 500)`: DEX drained; experience drained by `dam` unless Hold Life. |
| POIS | Poisoned `10 + 1d(dam)` (blocked by resistance or temporary resistance, see 10.4). If `power >= 60`, each `P(randint0(dam) > 200)`: acid damage `dam/5` to inventory and body ("The venom stings your skin"); CON drained. |
| LIGHT | Unless resisted: blind `2 + 1d5`; if `dam > 300`, confused `2 + 1d(dam/100)`. |
| DARK | Unless resisted: blind `2 + 1d5`; if `power >= 70`: `P(randint0(dam) > 100)` experience drain of `dam` (Hold Life protects), `P(> 200)` slowed `dam/100`, `P(> 300)` amnesia `dam/100`. |
| SOUND | Unless resisted: stun `min(5 + 1d(dam/3), 35)` (PROT_STUN blocks); if `dam > 300`, confused `2 + 1d(dam/100)`. |
| SHARD | Unless resisted: cut `1d(dam)`. |
| NEXUS | Unless resisted: stat scramble `20 + randint0(20)` turns unless a saving throw succeeds; then 1 in 3 teleport-to the caster, else 1 in 4 teleport level (saving throw), else teleport 200. |
| NETHER | Unless resisted or Hold Life: experience drain `200 + 2% of exp`; if `power >= 80`: `P(randint0(dam) > 100)` lose `dam/10` SP, `P(> 200)` lose all energy ("Your energy is sapped!"). |
| CHAOS | Unless resisted: hallucination `1d10`, confusion `10 + randint0(20)`, experience drain 3% unless Hold Life. |
| DISEN | Unless resisted: `EF_DISENCHANT` on a random armour/weapon slot. |
| WATER | Confusion `5 + 1d5`, stun `1d40` (no resistance exists; PROT_CONF/PROT_STUN apply). |
| ICE | Uses cold resistance for damage; inventory damage by cold unless immune; cut `5d8` unless shards are resisted; stun `1d15`. |
| GRAVITY | "Gravity warps around you": teleport 5 unless `1d127 <= level`; slow `4 + randint0(4)`; stun `min(5 + 1d(dam/3), 35)`. |
| INERTIA | Slow `4 + randint0(4)`. |
| FORCE | Stun `1d20`; thrown `3 + dam/20` grids away from the source. |
| TIME | 1 in 2: experience drain `100 + 2% of exp`; else 4 in 5: two random stats drained ("You're not as strong as you used to be"); else all five stats. |
| PLASMA | Stun `min(5 + 1d(3 dam/4), 35)`. |
| METEOR, MISSILE, MANA, HOLY_ORB, ARROW | Damage only. |
| LIGHT_WEAK, DARK_WEAK, KILL_* etc. | No effect on the player (DARK_WEAK from a monster's darkness spell blinds through the spell effect, not here). |

The blind message for an unseen source is the element's `blind-desc` ("You are hit by something!").

Melee elemental blows (`ACID`, `ELEC`, `FIRE`, `COLD`, `POISON` effects in `mon-blows.c`) use `adjust_dam()` in the same way for their elemental half but do *not* run these projection handlers; they call `inven_damage()` directly and, for poison, apply the poison timer (Melee chapter).

## 10.4 Blocking status effects

`player_inc_timed(p, effect, amount, notify, disturb, check)` refuses the increase when `check` is set and `player_inc_check()` finds a matching `fail:` line for the effect in `player_timed.txt`:

| Code | Test | Used by |
|---|---|---|
| `fail:1:FLAG` | Object flag in the player's state | SLOW: FREE_ACT; BLIND: PROT_BLIND; PARALYZED: FREE_ACT; CONFUSED: PROT_CONF; AFRAID: PROT_FEAR; STUN: PROT_STUN |
| `fail:2:ELEMENT` | Resistance (level > 0) | IMAGE: chaos; POISONED: poison; SCRAMBLE: nexus |
| `fail:3:ELEMENT` | Vulnerability (level < 0) | OPP_ACID/ELEC/FIRE/COLD/POIS cannot be gained while vulnerable to that element |
| `fail:4:PFLAG` | Player flag | CUT: ROCK (Pukel-men do not bleed) |
| `fail:5:TIMED` | Another timed effect active | POISONED: OPP_POIS |

A blocked effect from a monster prints "You resist the effect!", teaches the rune of the flag or resistance responsible, and lets the monster learn it (`update_smart_learn()`). Effects applied with `TIMED_INC_NO_RES` (e.g. the paralysis from fainting or from casting with no mana) skip the check entirely. Hero and Berserk (`flag-synonym:PROT_FEAR:0`) act as fear protection while active, Bold (`PROT_FEAR:1`) likewise, and `OPP_CONF` duplicates PROT_CONF, `FREE_ACT` the flag, `SINVIS` see-invisible, `TELEPATHY` telepathy, `TRAPSAFE` trap immunity.

Saving throws (`randint0(100) < SKILL_SAVE`) are a separate mechanism used by specific sources: monster melee TERRIFY and PARALYZE, most monster status spells (blind, confuse, scare, slow, hold, forget: Monsters chapter), nexus stat scrambling and teleport-level, and traps that offer a save. The saving throw skill is `race + class + adj_wis_sav[WIS] + class increment × level/10`, and is *not* used against direct damage.

## 10.5 Inventory damage

`inven_damage(p, element, cperc)` gives every non-equipped, non-artifact object in the pack and quiver that `HATES` the element (from `object_base.txt`: potions and flasks hate cold, sound, shards, ice and force; scrolls, books, staffs, arrows, bows, soft armour hate fire; rings, amulets, wands and rods hate electricity; most weapons and armour and many others hate acid) and does not `IGNORE` it a `cperc / 10,000` chance per item. Weapons and armour that fail the roll are *damaged* (−1 to-hit and to-dam, or −1 to-AC) rather than destroyed; rods have a quarter chance; everything else is destroyed one item at a time out of a stack ("One of your Potions of Cure Light Wounds (e) was destroyed!"). With the standard `cperc = min(5 × dam, 300)`, a 60-point bolt gives each vulnerable item a 3% chance, and so does a 1000-point breath: the cap is what keeps breaths from emptying the pack. Lava (`player_take_terrain_damage()`) uses the raw damage as `cperc`, so standing in lava is far worse for the pack than being breathed on.

Objects on the floor in the blast area are handled by `project_o()` (Ranged chapter) with no chance roll: everything that hates the element is destroyed unless it ignores it.

## 10.6 Other flags that protect the player

| Flag | Effect |
|---|---|
| SUST_STR/INT/WIS/DEX/CON | Blocks `DRAIN_STAT` on that stat (and TIME's drains use the same effect, so sustains work against time). |
| HOLD_LIFE | Blocks nether and chaos experience drain fully, cold/dark drains fully, and melee EXP_* drains with 95/90/75/50% chance (a tenth of the loss on failure). |
| FREE_ACT | Blocks paralysis and slowing from monsters and traps (not from fainting or over-exertion). |
| PROT_FEAR / PROT_BLIND / PROT_CONF / PROT_STUN | Block the respective status entirely. |
| REGEN / IMPAIR_HP / IMPAIR_MANA | Regeneration multipliers (Timed Effects chapter). |
| SEE_INVIS, TELEPATHY | Vision chapter. |
| FEATHER | Halves lava damage; halves trapdoor/pit damage (Traps chapter). |
| TRAP_IMMUNE | Immune to traps. |
| NO_TELEPORT | Blocks all teleportation, including the player's own. |
| AGGRAVATE | Wakes and hastes nearby monsters (Monsters chapter). |
| DRAIN_EXP | Experience chapter. |
| AFRAID (item) | Permanent fear: no melee, −20 to-hit, +8 AC, −20% devices. |
| IMPACT | Earthquakes on big hits. |
