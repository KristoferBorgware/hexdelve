# Chapter 20 — Gamedata File Reference (`lib/gamedata/`)

*Derived from Angband 4.2.6 `lib/gamedata/*.txt` and the parsers in
`init.c`, `obj-init.c`, `mon-init.c`, `player-init.c`, `generate.c`.*

Almost every number in the previous chapters lives in one of these
files. Each is a line-oriented text file: `field:value:value…`, `#`
comments, blank lines separating records, and a record starts with a
`name:` (or the file's own key line). Random values use the
`base+XdY+Mz` notation explained in *Objects* 14.1.2. The parser for
each file is registered in `init.c` (`pl[]` table) and files are read
in dependency order at start-up; a syntax error aborts the game with the
offending line.

The tables below give, for each file: what it defines, the record
fields, and where in this bible it is explained.

---

## 20.1 World and rules

| File | Records | Defines | Fields | See |
|---|---|---|---|---|
| `constants.txt` | ~80 lines | every tunable constant: `level-max`, `mon-gen`, `mon-play`, `dun-gen`, `world`, `carry-cap`, `store`, `obj-make`, `player`, `melee-critical` | `section:name:value` | Ch. 2, 7, 12, 15, 16, 18 |
| `world.txt` | 128 | the level list: `level:depth:name:up:down` | | Ch. 19.2 |
| `dungeon_profile.txt` | 9 | level generation profiles: `params`, `tunnel`, `streamer`, `alloc`, `min-level`, `room:` lines | | Ch. 16.2 |
| `terrain.txt` | 25 | floor, walls, doors, stairs, shops, rubble, lava, passable rubble: `graphics`, `priority`, `mimic`, `flags` (`LOS`, `PROJECT`, `PASSABLE`, `WALL`, `ROCK`, `DOOR_ANY`, `SHOP`, `BRIGHT`, `FIERY`…), `digging:1–5`, `walk-msg`, `run-msg`, `hurt-msg`, `die-msg`, `resist-flag`, `confused-msg`, `look-prefix` | | Ch. 6, 17.7 |
| `trap.txt` | 40 | floor traps, runes, webs, locks, glyphs: `appear`, `visibility`, `flags`, `effect`/`dice`/`expr`, `save`, `msg*` | | Ch. 17.1 |
| `chest_trap.txt` | 7 | chest traps: `code`, `level`, `effect`, `magic`, `destroy`, `msg` | | Ch. 17.8 |
| `room_template.txt` | 415 | ASCII room layouts with `rating`, `doors`, `tval`, `D:` lines | | Ch. 16.2 |
| `vault.txt` | 161 | ASCII vaults: `type`, `rating`, `rows`/`columns`, `min-depth`/`max-depth`, `D:` | | Ch. 16.4 |
| `pit.txt` | 40 | pit/nest profiles: `room`, `alloc`, `obj-rarity`, `color`, `mon-base`, `mon-ban`, `flags-req/ban`, `spell-req/ban` | | Ch. 12.9 |
| `quest.txt` | 2 | Sauron and Morgoth | `level`, `race`, `number` | Ch. 19.3 |
| `store.txt` | 8 | shops and home: `owner`, `slots`, `turnover`, `always`, `normal`, `buy`, `buy-flag` | | Ch. 18.2 |
| `hints.txt` | | one-line hints shown on death/load (`H:` lines) | | — |

---

## 20.2 Player

| File | Records | Defines | Key fields | See |
|---|---|---|---|---|
| `p_race.txt` | 11 | races: `stats`, `skill-*` bases, `hitdie`, `exp` (%), `infravision`, `history` chart, `age`, `height`/`weight`, `obj-flags`, `player-flags` (`KNOW_MUSHROOM`, `KNOW_ZAPPER`, `SEE_ORE`…), `values` (resists) | | Ch. 3, 4 |
| `class.txt` | 9 | classes: `stats`, `skill-*:base:increment` (per 10 levels), `hitdie`, `max-attacks`, `min-weight`, `strength-multiplier`, `title:` × 10, `equip:` starting kit, `magic:first level:weight:realm`, `book:` and `spell:name:level:mana:fail:exp` with `effect`/`dice`/`expr`, `flags` (`CUMBER_GLOVE`, `ZERO_FAIL`, `BEAM`, `CHOOSE_SPELLS`, `KNOW_ZAPPER`, `BLESS_WEAPON`, `COMBAT_REGEN`, `SHIELD_BASH`, `UNLIGHT`, `STEAL`…) | | Ch. 3, 4, 7, 9 |
| `realm.txt` | 4 | arcane, divine, nature, necromantic: `stat`, `verb`, `spell-noun`, `book-noun` | | Ch. 9 |
| `shape.txt` | 9 | player shapes (fox, Púkel-man/stone, bear, bat, eagle, vampire…): `combat`, `skill-*`, `obj-flags`, `player-flags`, `values`, `blow:` verbs | | Ch. 9 |
| `player_property.txt` | 44 | descriptions and pricing of player flags, object flags and elements: `type`, `code`, `name`, `desc`, `power`, `id-type` (on wield / on effect / timed), `bindui` | | Ch. 14.1.3, 14.9 |
| `player_timed.txt` | 53 | timed effects: `name`, `desc`, `on-begin`/`on-end`/`on-increase`/`on-decrease` messages, `msgt`, `fail:code:flag` (what prevents it), `grade:color:max:name:up-msg:down-msg` (e.g. food and cut grades), `resist`, `brand`/`slay` (for temporary brands), `flags` (`NONSTACKING`) | | Ch. 11 |
| `history.txt` | | background-story charts per race: `chart:n:next:cutoff`, `phrase:` | | Ch. 3 |
| `names.txt` | | per-race syllable lists for random name generation (Markov style) | | Ch. 3 |
| `body.txt` | 1 | the Humanoid body: 12 equipment slots | | Ch. 15.1 |

---

## 20.3 Objects

| File | Records | Defines | Key fields | See |
|---|---|---|---|---|
| `object_base.txt` | 34 | tvals: `graphics`, `break`, `max-stack`, default `flags` (`HATES_*`, `EASY_KNOW`, `SHOW_DICE`) | | Ch. 14.1, 15.5 |
| `object.txt` | 375 | object kinds: `type`, `level`, `weight`, `cost`, `attack`, `armor`, `alloc:commonness:min to max`, `charges`, `pile`, `power`, `effect`/`dice`/`expr`, `flags`, `values`, `brand`, `slay`, `curse`, `pval`, `msg`, `desc` | | Ch. 14 |
| `ego_item.txt` | 107 | ego templates: `info:cost:rating`, `alloc`, `combat`, `min-combat`, `type`/`item`, `flags`, `flags-off`, `values`, `min-values`, `act`, `time`, `brand`, `slay`, `curse` | | Ch. 14.4 |
| `artifact.txt` | 138 | fixed artifacts: `base-object`, `graphics`, `level`, `weight`, `cost`, `alloc:prob:min to max`, `attack`, `armor`, `flags`, `act`, `time`, `msg`, `values`, `brand`, `slay`, `curse`, `desc` | | Ch. 14.5 |
| `curse.txt` | 27 | curses: `type` (object bases), `weight`, `combat`, `effect`/`dice`/`expr`, `time`, `flags`, `values`, `msg`, `conflict`, `conflict-flags` | | Ch. 14.7 |
| `activation.txt` | 163 | named activations for artifacts, egos and randarts: `aim`, `level`, `power`, `effect`, `dice`, `expr`, `msg`, `desc` | | Ch. 9 |
| `brand.txt` | 10 | brands: `code`, `name`, `verb`, `multiplier`, `o-multiplier`, `power`, `resist-flag`, `vuln-flag` | | Ch. 7.4 |
| `slay.txt` | 11 | slays: `code`, `name`, `race-flag`/`base`, `multiplier`, `o-multiplier`, `power`, `melee-verb`, `range-verb` | | Ch. 7.4 |
| `flavor.txt` | | flavour pools: `kind:tval:char`, `flavor:index:attr:text`, `fixed:index:sval:attr:text` (e.g. the One Ring's fixed look) | | Ch. 14.9 |
| `object_property.txt` | shared with player | see 20.2 | | |

---

## 20.4 Monsters

| File | Records | Defines | Key fields | See |
|---|---|---|---|---|
| `monster_base.txt` | 56 | templates: `glyph`, `pain` (message set), `flags`, `desc` | | Ch. 12.1 |
| `monster.txt` | 624 | races: `base`, `glyph`, `color`, `speed`, `hit-points`, `light`, `hearing`, `smell`, `armor-class`, `sleepiness`, `depth`, `rarity`, `experience`, `blow:method:effect:dice`, `flags`, `flags-off`, `innate-freq`, `spell-freq`, `spell-power`, `spells`, `message-*`, `drop`, `drop-base`, `mimic`, `friends`, `friends-base`, `shape`, `desc` | | Ch. 12, 13 |
| `monster_spell.txt` | 91 | monster spells: `msgt`, `hit`, `effect`/`dice`/`expr` (with `SPELL_POWER`, `PLAYER_LEVEL`, `DUNGEON_LEVEL`, `MAX_SIGHT`, `WEAPON_DAMAGE`, `PLAYER_HP`, `MONSTER_PERCENT_HP_GONE`), `power-cutoff`, `lore`, `lore-color-*`, `message-vis/invis/miss`, `save-message` | | Ch. 13.1 |
| `blow_methods.txt` | 19 | HIT, TOUCH, BITE, CLAW, CRUSH, STING, KICK, BUTT, ENGULF, CRAWL, DROOL, SPIT, GAZE, WAIL, SPORE, BEG, INSULT, MOAN, HOWL: `cut`, `stun`, `miss`, `phys`, `msg`, `act`, `desc` | | Ch. 7.7 |
| `blow_effects.txt` | 30 | HURT, POISON, DISENCHANT, DRAIN_CHARGES, EAT_GOLD, EAT_ITEM, EAT_FOOD, EAT_LIGHT, ACID, ELEC, FIRE, COLD, BLIND, CONFUSE, TERRIFY, PARALYZE, LOSE_STR…LOSE_ALL, SHATTER, EXP_10…EXP_80, HALLU, BLACK_BREATH: `power`, `eval`, `desc`, `lore-color-*`, `effect-type`, `resist`, `lash-type` | | Ch. 7.7 |
| `pain.txt` | ~12 | pain message sets: 7 messages per set by remaining-hp band | | Ch. 7.8 |
| `summon.txt` | 17 | summon types: `msgt`, `uniques`, `base`/`race-flag`, `fallback`, `desc` | | Ch. 13.4 |
| `projection.txt` | 25 + | projections: elements first (ACID … DISEN, in `list-elements.h` order), then LIGHT_WEAK, DARK_WEAK, KILL_WALL, KILL_DOOR, KILL_TRAP, MAKE_DOOR, MAKE_TRAP, AWAY_UNDEAD/EVIL/SPIRIT/ALL, TURN_*, DISP_*, SLEEP_ALL, MON_CLONE, MON_POLY, MON_HEAL, MON_SPEED, MON_SLOW, MON_CONF, MON_HOLD, MON_STUN, MON_DRAIN, MON_CRUSH: `type`, `desc`, `player-desc`, `blind-desc`, `lash-desc`, `numerator`/`denominator` (resist fraction), `divisor` and `damage-cap` (breaths), `msgt`, `obvious`, `wake`, `color` | | Ch. 8, 10 |

---

## 20.5 User interface data

| File | Purpose |
|---|---|
| `visuals.txt` | colour table and the "flicker" colour cycles for `ATTR_FLICKER` monsters |
| `ui_entry.txt`, `ui_entry_base.txt`, `ui_entry_renderer.txt` | the rows of the second character screen and the equipment comparison view: which properties are combined, how they are rendered (numbers, resist symbols, `+`/`-`), labels |
| `ui_knowledge.txt` | monster categories in the knowledge (`~`) menu: `monster-category`, `mcat-include-base`, `mcat-include-flag` |
| `lib/customize/*.prf` | (not gamedata) default keymaps, colours, sounds, message colours, per-class/race font/graphics prefs |
| `lib/help/*.txt` | in-game help text, generated from `docs/*.rst` |

---

## 20.6 Reading a record: three examples

**A monster**

```
name:Ancient red dragon      # 12.1.1: hp 1560 exactly (unique? no → Rand_normal), speed 120 (+10, ±2)
base:ancient dragon          # 12.1: D, DRAGON|EVIL|POWERFUL|SMART|SPIRIT|DROP_4|MOVE_BODY|CLEAR_WEB|NO_CONF|NO_SLEEP|NO_HOLD|FORCE_SLEEP
color:r
speed:120
hit-points:1560
hearing:20
armor-class:108
sleepiness:80                # 12.3: sleep 160 + 1d800
depth:51                     # 12.2: alloc weight 100/rarity × (1 + 51/10) = 600 at rarity 1
rarity:2                     # → 300
experience:2800              # 5.3: 2800 × 51 / plev exp
blow:CLAW:HURT:6d12
blow:CLAW:HURT:6d12
blow:BITE:HURT:8d14
flags:IM_FIRE | HURT_COLD ...
innate-freq:12               # 13.2: 8 %/turn to breathe
spell-freq:8                 # 13.2: 12 %/turn to cast BLIND/CONF/SCARE, 24 % fail
spells:BR_FIRE | BLIND | CONF | SCARE
```

**An ego**

```
name:of Speed
info:100000:25               # rating 25 → level feeling
alloc:3:20 to 127            # 14.4.2: eligible from level 20; at level 15 1-in-2
type:boots
values:SPEED[2+M8]           # 14.1.2: +2 to +10, m_bonus(8, level)
min-values:SPEED[0]
```

**A timed effect**

```
name:CUT
desc:cuts
grade:y:10:Graze:You have been given a graze.       (player_timed.txt)
grade:y:25:Light Cut:You have been given a light cut.
grade:o:50:Bad Cut:You have been given a bad cut.
grade:o:100:Nasty Cut:You have been given a nasty cut.
grade:r:200:Severe Cut:You have been given a severe cut.
grade:r:1000:Deep Gash:You have been given a deep gash.
grade:R:10000:Mortal Wound:You have been given a mortal wound.
fail:4:ROCK                  # fail code 4 = a player flag: the stone shape is immune
```

The grade bands are what `process_world` reads to decide 1/2/3 hp per
tick (*Chapter 19* 19.1) and what `player_timed_grade_eq` compares
against.
