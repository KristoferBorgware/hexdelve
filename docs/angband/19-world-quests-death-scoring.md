# Chapter 19 — The World Loop, Level Changes, Quests, Death and Scoring

*Derived from Angband 4.2.6 (`game-world.c`, `player-util.c`,
`player-quest.c`, `cmd-cave.c`, `cmd-misc.c`, `score.c`, `savefile.c`,
`ui-death.c`, `lib/gamedata/quest.txt`, `world.txt`, `constants.txt`).*

---

## 19.1 The game turn (`run_game_loop`, `process_world`)

*Time, Energy and Speed* (Chapter 2) describes the energy system. Every
**game turn** (10 per player turn at normal speed) the loop gives energy
to the player and all monsters, lets those with enough act, and then
runs `process_world` once per game turn *when `turn % 10 == 0`*, i.e.
once per "world tick" of 10 game turns. In that tick, in order:

| Step | Rule |
|---|---|
| Monster compaction | if monsters on the level + 32 > `level-max:monsters` (1024), `compact_monsters(64)` deletes distant/weak ones |
| Ambient sound | every quarter day |
| Town daylight | every half day: "The sun has risen/fallen", `cave_illuminate` |
| Shop clock | in the dungeon: `daycount++` every 10 000 game turns (see *Stores*) |
| Unlight | `PF_UNLIGHT` races (Necromancer's unlight) recompute bonuses |
| Wandering monster | `one_in_(500)`: `pick_and_place_distant_monster` beyond `max_sight + 5` = 25 grids, asleep, with escorts, at the current depth |
| Poison | 1 damage (after damage reduction) — "poison" as cause of death |
| Cuts | 1 hp per tick for a graze up to a nasty cut, 2 for a severe cut, 3 for a deep gash or mortal wound; none while in the stone shape (`PF_ROCK`) |
| Bloodlust | over-exertion penalties |
| Heal timed effect | 30 hp per tick |
| Black Breath | 50 % each: −CON, −STR, and drain `100 + exp/100 × life-drain (2)` experience |
| Food | see *Timed Effects* 11.4: every 100 game turns digest `turn_energy(speed) × 100 / food-value`, ×2 `REGEN`, ÷2 `SLOW_DIGEST`; when Full, lose `5000/food_value` per tick instead; Faint: 1 in 10 faint (paralysed 1–5); Starving: damage `(PY_FOOD_STARVE − food) / 10` |
| Regeneration | `player_regen_hp` (if below max), `player_regen_mana` — *Chapter 11* |
| Timed effects | `decrease_timeouts` — every player timed effect −1 (or its grade rule), curse timeouts −1 and curse effects fire at 0 (*Objects* 14.7.3) |
| Light | `player_update_light`: torches/lanterns burn 1 fuel; "Your light is growing faint" at 100, out at 0 |
| Noise and scent | `make_noise` / `update_scent` unless resting (*Monsters I* 12.6.1) |
| Experience drain | `DRAIN_EXP` flag: 1 in 10 ticks lose `(10d6 + exp/100 × 2) / 10` xp |
| Recharge | `recharge_objects`: rods in pack and on the floor recharge; "Your Rod of X has recharged" (`notify_recharge`) |
| Rune learning | every 100 game turns `equip_learn_after_time` (timed runes) |
| Trap timeouts | disabled traps count down |
| Word of Recall | counter −1; at 0: in the dungeon → depth 0 ("yanked upwards"); in town → `recall_depth` ("yanked downwards") |
| Deep Descent | counter −1; at 0: to `max_depth + 5` levels down (or a quest level in between), else "thrown back in an explosion" with a radius-5 destruction |

The player then gets a turn (`process_player`) when their energy
reaches 100; monsters are processed after the player each game turn.

---

## 19.2 Levels and stairs

`world.txt` lists 128 levels: `level:0:Town:None:Angband 1` and
`level:n:Angband n:Angband n−1:Angband n+1` up to 127. `max-depth` is
128, so level 127 is the deepest ("The dungeon does not appear to extend
deeper").

`dungeon_get_next_level(p, from, added)`:

```
target = from + added × stair-skip (1)
clamped to 0 … 127
if any quest level lies between from and target (inclusive) → stop at the first one
```

So you can never skip past Sauron (99) or Morgoth (100) by deep
descent, trap doors, or recall.

| Action | Rule |
|---|---|
| `<` on an up staircase | not allowed with `birth_force_descend`; goes to depth −1; next level starts on a down staircase (with `birth_connect_stairs`) |
| `>` on a down staircase | goes to depth +1 (with force descend: to `max_depth + 1`, asking before a quest level); next level starts on an up staircase |
| trap door | depth +1, no connected stair |
| Deep Descent (scroll, spell) | `3 + 1d4` turns later, to `max_depth + 5` (quest-limited); "You sense a malevolent presence blocking passage" if that is not deeper than the current level |
| Word of Recall (scroll, rod, spells) | `15 + randint0(20)` turns; in the dungeon, if you are above your max depth and levels don't persist, "Set recall depth to current depth?" lets you reset `max_depth`; reading again cancels ("Do you want to cancel it?"); `birth_no_recall` disables it (except for winners); force-descend recall goes to `max_depth + 1` |
| Teleport Level (scroll, spell, monster) | up is impossible in town or with force-descend; down is impossible on an unfinished quest level or the last level; if both are possible, 50/50 |

Each level change sets `generate_level` and `autosave`; the game saves
on every new level. `max_depth` and `recall_depth` are tracked
separately so the "depth" line on the character sheet shows both.

---

## 19.3 Quests

`quest.txt`:

```
name:Sauron
level:99
race:Sauron, the Sorcerer
number:1

name:Morgoth
level:100
race:Morgoth, Lord of Darkness
number:1
```

* `is_quest(depth)`: level 99 or 100 while the quest is open. Quest
  levels always use the **classic** profile, never generate down
  staircases in vaults, never get trap doors, and place the quest
  monster with `find_empty` after generation (*Dungeon Generation*
  16.3.5).
* When the quest monster dies (`quest_check` from `monster_death`): its
  `cur_num` reaches `max_num`, the quest's level is set to 0
  (completed), and `build_quest_stairs` creates a down staircase where
  it fell ("A magical staircase appears…"). Killing Morgoth (both
  quests complete) sets `total_winner`: "*** CONGRATULATIONS *** You
  have won the game! You may retire (key is shift-q) when you are
  ready."
* Sauron's `QUESTOR` flag also means he is never generated randomly
  and always appears at his level; Morgoth (level 100, `FORCE_DEPTH`)
  cannot be summoned or generated elsewhere.
* A winner's title becomes "**WINNER**" / "Emperor/Empress"; Word of
  Recall works even with `birth_no_recall`; the winner may keep
  playing below level 100.

---

## 19.4 Death

`take_hit(p, dam, cause)`: `chp −= dam`; if `chp < 0`:

* `TMD_BLOODLUST` can keep a berserk warrior alive while
  `chp + bloodlust + level ≥ 0` ("Your lust for blood keeps you
  alive!");
* otherwise `died_from = cause` and, unless wizard mode or the
  `cheat_live` option lets you answer "Die?" with no, "You die." and
  `is_dead = true` (`total_winner` is cleared if you die after winning).

Causes are strings: the monster's name ("a Cave spider"), "poison",
"a fatal wound" (cuts), "starvation", "a trap door" etc. from the
`kb_str` of every damage source (`take_hit` callers). Below the
`hitpoint_warn` threshold (option, tenths of max hp) each hit prints
"*** LOW HITPOINT WARNING! ***" and beeps.

**On death** (`ui-death.c`): the tombstone is shown, the character is
recorded in the score file (19.5), a character dump can be written, and
the menu offers Information, Messages, File dump, View scores, Examine
items, History, Spoilers. The savefile is kept with the dead
character; starting a new character from it keeps the monster memory
and object knowledge.

**Retiring** (`Q`, `do_cmd_retire`): treated as death with
`died_from = "Retiring"`; a winner's retirement is scored, a
non-winner's is *not* ("Score not registered due to retiring").

---

## 19.5 Score (`score.c`)

```
total_points = max_exp + 100 × max_depth
```

That is the whole formula: experience *ever* earned (not current
experience, so drains don't hurt) plus 100 per level of maximum depth.
A level-50 winner with 5 000 000 max exp who reached level 100 scores
5 010 000; a character killed at depth 30 with 20 000 exp scores 23 000.

`enter_score` refuses to record (with a message) if:

* any `score_*` option is set (the cheat options `cheat_hear`,
  `cheat_room`, `cheat_xtra`, `cheat_live` permanently set their
  `score_*` twin once used — "Score not registered for cheaters");
* `NOSCORE_WIZARD` or `NOSCORE_DEBUG` was ever set (wizard mode `^W`,
  debug commands `^A`) — "for wizards"; borg use likewise;
* the character was "Interrupting" (killed by a signal) or "Retiring"
  without having won.

`NOSCORE_JUMPING` (a wizard level jump) only affects profile choice.

The score entry (`struct high_score`) stores: version, points, gold,
turns, date, name, uid, race, class, current and max character level,
current and max dungeon level, and the cause of death. `scores.raw` in
the user directory keeps the top `MAX_HISCORES` (100).

---

## 19.6 Character history (`history.c`)

`player->hist` is a list of timestamped entries (`turn`, `depth`,
`clev`) with types: birth, artifact found (unknown), artifact
identified, artifact lost, player slain, slain a unique
(`HIST_SLAY_UNIQUE` from `monster_death`), user note (`:` command),
savefile import, gained a level (`HIST_GAIN_LEVEL` from
`player_exp_gain`). The character dump prints it as the "[Player
history]" table.

---

## 19.7 Savefiles (`savefile.c`)

Block-based format: an 8-byte header (magic + variant), then blocks of
`16-byte name | 4-byte version | 4-byte size | 4-byte checksum | data`,
padded to 4 bytes. Blocks written by `savers[]`, in order:

`description rng options messages monster memory object memory quests
player ignore misc artifacts player hp player spells gear stores dungeon
objects monsters traps chunks history`

Each block is versioned independently; the loader dispatches on
(name, version) so old savefiles keep loading as long as a loader for
that block version exists. `chunks` holds stored levels (the town,
persistent levels), `dungeon` the current level's terrain and square
flags, `player hp` the per-level hit-die rolls (`player_hp[]`, see
*Character Creation* 3.5), `artifacts` which artifacts exist/are lost,
and `player` everything on the character including timed effects,
`max_depth`, `recall_depth`, `word_recall`, `deep_descent`, `au`,
`total_winner`, `noscore`, `died_from`.

The game autosaves on every level change (`upkeep->autosave`) and on
`^S`/`^X`. Savefiles are never overwritten with a dead character's
state unless the character actually died (the "panic save" on crash
writes a separate file).

---

## 19.8 Birth options that change the world

| Option | Default | Effect |
|---|---|---|
| `birth_randarts` | off | replace the standard artifact set with random artifacts (`randart.c`) of equivalent power |
| `birth_connect_stairs` | on | arrive on a staircase of the type you used |
| `birth_force_descend` | off | no up staircases work; recall goes to `max_depth + 1`; deep descent from `max_depth` |
| `birth_no_recall` | off | Word of Recall does nothing (until you win) |
| `birth_no_artifacts` | off | no artifacts are generated |
| `birth_stacking` | on | more than one object may occupy a floor grid |
| `birth_lose_arts` | off | artifacts left on a level are gone for good (otherwise unseen ones may be regenerated) |
| `birth_feelings` | on | level feelings shown |
| `birth_no_selling` | on | selling gives 0 gold and identification; dungeon gold ×5 |
| `birth_start_kit` | on | start with the class kit instead of extra gold |
| `birth_ai_learn` | on | monsters remember your resistances (*Chapter 13* 13.5.1) |
| `birth_know_runes` | off | all runes known from the start |
| `birth_know_flavors` | off | all flavours known from the start |
| `birth_levels_persist` | off | levels are stored and restored (*Dungeon Generation* 16.8) |
| `birth_percent_damage` | off | experimental: to-dam is a percentage of the dice (*Melee Combat* 7.4 O-combat multipliers) |

Birth options are frozen when the character is accepted; they are
shown on the character dump.
