# 21. Gamedata reference

`lib/gamedata/` is 45 text files and about 1.2 MB, and it is where nearly every number in this bible comes from. This chapter lists every file, what it defines, how many records it holds, and which chapter covers what it means. The parsing machinery itself is in the Architecture chapter 1.7, and the dice and expression grammars in 1.8; this chapter is the index.

## 21.1 Shared conventions

Every file is line-oriented and colon-separated. A record begins at its first key line — usually `name:`, sometimes `code:`, `store:`, `body:` or `level:` — and continues until the next one. `#` begins a comment, and blank lines are ignored. Each parser registers its directives with `parser_reg()` and an unknown directive is an error at startup, not a silent skip.

Five syntaxes recur across files:

| Syntax | Meaning |
|---|---|
| `flags:A \| B \| C` | A set of flags from the matching `list-*.h`. Repeatable; entries accumulate |
| `values:RES_FIRE[1] \| STEALTH[d2]` | Labelled numbers — resistances, modifiers — each taking a dice expression |
| `dice:2d6` / `dice:10+2d3M4` | A `random_value`: base, dice, sides, `m_bonus` (Architecture chapter 1.8) |
| `expr:S:DUNGEON_LEVEL:/ 2` | Binds `$S` in a dice string to an expression over a named base, which is how data scales with depth or player level |
| `type:sword` / `item:sword:Long Sword` | Restricts a record to object bases, or to one specific kind |

`m_bonus(max, level)` in a dice expression is what makes a value drift towards its maximum with depth; a plain `Xd Y` does not scale at all.

## 21.2 The files

Sizes are line counts and record counts as of 4.2.6.

### The world and its rules

| File | Records | Defines | Chapter |
|---|---|---|---|
| `constants.txt` | – | Every `z_info` maximum and tuning constant: dungeon size, pack size, energy, allocation chances, fuel | Throughout |
| `world.txt` | 128 | The level list — `level:depth:name:up:down`, e.g. `level:0:Town:None:Angband 1` — which is how depths connect by name rather than by arithmetic | 17 |
| `dungeon_profile.txt` | 9 | Cave profiles: block size, room counts, tunnel and streamer parameters, room lists | 17 |
| `room_template.txt` | 415 | Small room layouts as ASCII, with door counts | 17 |
| `vault.txt` | 161 | Vault and interesting-room layouts as ASCII, with ratings and depth bands | 17 |
| `terrain.txt` | 25 | Terrain features: symbol, flags, digging index, and the walk, run and damage messages | 6 |
| `trap.txt` | 40 | Player traps, glyphs, webs and the door lock | 14 |
| `chest_trap.txt` | 7 | Chest traps as a bit set | 14 |
| `quest.txt` | 2 | Sauron and Morgoth | 20 |
| `store.txt` | 8 | The seven shops and the Home: owners, purses, stock lists, buy lists | 18 |

### Objects

| File | Records | Defines | Chapter |
|---|---|---|---|
| `object_base.txt` | 34 | One record per tval: default flags, breakage chance, `max-stack` | 15 |
| `object.txt` | 375 | Object kinds: level, weight, cost, allocation, dice, effects, flags | 15 |
| `ego_item.txt` | 107 | Ego affixes: allocation, combat bonuses, minima, possible items | 15 |
| `artifact.txt` | 138 | The fixed artifacts | 15 |
| `curse.txt` | 27 | Curses: the bases they attach to, their effect and its period, conflicts | 15 |
| `activation.txt` | 163 | Named activations: aim, level, power, effect chain, messages | 9 |
| `object_property.txt` | 79 | What each object flag and modifier *is*: type, subtype, identification type, and the power values used for pricing | 16 |
| `slay.txt` | 11 | Slay multipliers and the monster flags they match | 7 |
| `brand.txt` | 10 | Brand multipliers, the immunity that blocks each and the vulnerability that doubles it | 7 |
| `flavor.txt` | – | The flavour pool that is shuffled per game | 16 |

### The player

| File | Records | Defines | Chapter |
|---|---|---|---|
| `p_race.txt` | 11 | Races: stat adjustments, skills, hit die, experience factor, infravision, flags | 3 |
| `class.txt` | 9 | Classes: stats, skills and their per-level increments, blows and shots tables, magic realm, spell lists | 3, 9 |
| `old_class.txt` | 5 | **Not loaded by anything** — a leftover, parsed by no file parser | – |
| `body.txt` | 1 | The `Humanoid` body: twelve equipment slots | 16 |
| `realm.txt` | 4 | Magic realms: casting stat, and the nouns and verbs used for their magic | 9 |
| `shape.txt` | 9 | Player shapes: combat and skill deltas, object and player flags | 4, 13 |
| `player_property.txt` | 44 | What each player flag, object flag and element means as a player attribute | 4 |
| `player_timed.txt` | 53 | Timed effects: grades, messages, and the `fail:` rules that block them | 11 |
| `history.txt` | – | The birth history chart | 3 |
| `names.txt` | – | Name fragments, also used for random artifact names | 3, 15 |

### Monsters

| File | Records | Defines | Chapter |
|---|---|---|---|
| `monster_base.txt` | 56 | Templates: glyph, pain messages, shared flags | 12 |
| `monster.txt` | 1248 | Every monster race | 12 |
| `monster_spell.txt` | 91 | Monster spells: effects, messages, lore text, power cutoffs | 13 |
| `blow_methods.txt` | 19 | How a monster hits: the verb, whether it can miss, its message type | 7 |
| `blow_effects.txt` | 30 | What the hit does | 7 |
| `pain.txt` | – | Pain message sets, referenced by monster bases | 12 |
| `pit.txt` | 40 | Pit and nest definitions: allowed bases, required and banned flags, spells | 12 |
| `summon.txt` | 28 | Summon types: whether uniques are allowed, allowed bases and race flags, and a fallback type | 13 |

### Cross-cutting

| File | Records | Defines | Chapter |
|---|---|---|---|
| `projection.txt` | 25 | Every element and projection type: the player's resistance fraction, the breath divisor and damage cap, and the monster-side handling | 8, 10 |
| `hints.txt` | – | Loading-screen hints | – |
| `visuals.txt` | – | Default attribute and character assignments | – |
| `ui_entry.txt`, `ui_entry_base.txt`, `ui_entry_renderer.txt` | 47, 3, 5 | Character-sheet layout: which properties appear where and how they render | – |
| `ui_knowledge.txt` | – | Grouping for the knowledge menus | – |

## 21.3 Load order

`init_angband()` runs a fixed list of modules, and within the arrays module a fixed list of parsers (`pl[]` in `init.c`). Order is load-bearing wherever one file names something defined in another:

```
world, projections, ui renderers, ui entries, player properties, features,
object bases, slays, brands, monster pain messages, monster bases, summons,
curses, player shapes, objects, activations, ego-items, history charts,
bodies, player races, magic realms, player classes, artifacts,
object properties, timed effects, blow methods, blow effects, monster spells,
monsters, monster pits, monster lore, traps, chest traps, quests, flavours,
hints, random names
```

So object bases precede objects, objects precede ego-items and artifacts, monster bases precede monsters, and monsters precede pits and lore. `constants.txt` is parsed before all of these, since every other parser needs the `z_info` maxima to size its arrays. Four files sit outside this list: `store.txt` is loaded by the store module, and `dungeon_profile.txt`, `room_template.txt` and `vault.txt` by the generation module. `visuals.txt` and the `ui_*` files are loaded by the UI layer, which is why the engine builds without them.

Every file is read **once**, at startup, into the static info arrays described in the Architecture chapter 1.2. Nothing re-reads them, so editing a file needs a restart, and a savefile made against different data can disagree with the arrays it is loaded into.

## 21.4 Where the numbers in this bible came from

Any figure quoted in an earlier chapter is either in one of these files or in a `list-*.h` X-macro list. The `list-*.h` headers are the other half of the data: they define the enumerations the data files' flag names resolve to — `list-object-flags.h`, `list-elements.h`, `list-mon-race-flags.h`, `list-mon-spells.h`, `list-effects.h`, `list-trap-flags.h`, `list-player-flags.h`, `list-terrain.h`, `list-tvals.h`, `list-rooms.h`, `list-dun-profiles.h` and the rest. A flag exists only if it appears in both: the header gives it a number, the data file gives it a meaning.
