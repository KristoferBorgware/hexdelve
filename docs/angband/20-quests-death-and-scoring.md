# 20. Quests, death and scoring

Angband has exactly two quests, and they are the whole of the endgame: kill Sauron on level 99, then Morgoth on level 100. Everything the game does to enforce that — refusing to generate a down staircase, refusing to let Deep Descent skip past, refusing to place a trap door — follows from one flag on a level, and the reward for finishing a quest is a single magical staircase. This chapter covers that machinery, then what happens when a character dies or retires, and how the score is computed.

Sources: `player-quest.c` and `quest.txt`, `score.c` and `score-util.c`, the death path in `player-util.c` and `ui-game.c`.

## 20.1 The two quests

```
name:Sauron              name:Morgoth
level:99                 level:100
race:Sauron, the Sorcerer race:Morgoth, Lord of Darkness
number:1                 number:1
```

That is the entire `quest.txt`. Each record is a level, a monster race and a count, and the parser builds a `quests[]` array from them. `player_quests_reset()` copies the array into `player->quests` at birth, so quest progress is per-character state rather than global.

`is_quest(p, level)` is true when any of the player's quests still names that level — and note the "still": completing a quest sets `quests[i].level = 0`, so the level stops being a quest level once its monster is dead.

## 20.2 What a quest level forbids

Five separate places test `is_quest()`, and together they make levels 99 and 100 one-way:

| Where | Effect |
|---|---|
| `square_add_stairs()` | On a quest level, or at `max_depth - 1`, a generated staircase is **always up**. There is no down staircase on level 99 or 100 |
| `dungeon_get_next_level()` | Scans every level between the current one and the target and returns the first quest level found, so Deep Descent and forced descent stop at 99 rather than passing it |
| `pick_trap()` | Trap doors are excluded from the trap pool on quest levels (Traps chapter 14.3) |
| `choose_profile()` | Quest levels are always generated with the **classic** profile, never a labyrinth or cavern (Dungeon Generation chapter 17.2) |
| Teleport-level and stair effects | Refuse to move the player down out of a quest level |

`cmd-cave.c` additionally warns a `birth_force_descend` player before they take stairs that would land them on a quest level, since that option removes the ability to come back up.

## 20.3 Completing one

`quest_check()` runs when any monster dies. It compares the monster's race and the current depth against each of the player's quests, increments `cur_num`, and when that reaches `max_num` zeroes the quest's level and marks it complete.

Completion does exactly two things. First, `build_quest_stairs()` places a down staircase at the dead monster's grid — staggering to a nearby changeable grid if that one cannot hold stairs, and pushing any objects out of the way — with the message "A magical staircase appears...". That staircase is the only route from level 99 to level 100.

Second, if **no** incomplete quests remain:

```c
p->total_winner = true;
msg("*** CONGRATULATIONS ***");
msg("You have won the game!");
msg("You may retire (key is shift-q) when you are ready.");
```

Winning does not end the game. `total_winner` is a flag; the character keeps playing until they retire or die, and a winner who then dies **loses the flag** — `take_hit()` sets `p->total_winner = false` before setting `is_dead`. A won game is only banked by retiring.

## 20.4 Death

`take_hit()` reaches death when hit points go below zero, with two escapes before it:

- **Bloodlust** saves a Blackguard whose `chp + bloodlust + level >= 0`, with a message ("Your lust for blood keeps you alive!", or one time in ten a line about the Mormegil).
- **Cheat death** is offered to a wizard-mode or `cheat_live` character through the "Die? " prompt.

Otherwise `died_from` is set to the killer's description — recorded *before* the prompt so that handlers and external tools can read it — `total_winner` is cleared, `is_dead` is set, and the function returns.

Retiring (`shift-Q`) takes the same path deliberately: `do_cmd_retire()` sets `is_dead` with `died_from` of "Retiring", because the end-of-game logic is written once.

`death_knowledge()` then runs, and for a winner it rewrites the character into a good final state before the score is taken:

```c
if (p->total_winner) {
	p->depth = 0;
	my_strcpy(p->died_from, WINNING_HOW, ...);   /* "Ripe Old Age" */
	p->exp = p->max_exp;
	p->lev = p->max_lev;
	p->au += 10000000L;
}
```

So a winner is recorded as having died in town of old age with ten million gold, and any experience drain suffered on the way is undone. For every character, winner or not, `death_knowledge()` also calls `player_learn_all_runes()` and makes every carried flavour aware, so the death screen and the final dump show what the character was actually carrying rather than what they knew about it.

The savefile is then written rather than deleted — a dead character's file is kept, and the game refuses to continue playing it.

## 20.5 Scoring

```c
static long total_points(const struct player *p)
{
	return p->max_exp + 100 * p->max_depth;
}
```

The score is maximum experience plus a hundred per level of maximum depth reached. Both are maxima, so neither experience drain nor climbing back to town reduces it.

`enter_score()` refuses to record a character with any `OP_SCORE` option set — the cheat options — printing "Score not registered for cheaters."

`highscore_cmp()` orders the table:

1. Non-empty records before empty ones.
2. **A winner before any non-winner**, regardless of points. Winning is detected by comparing `how` against `WINNING_HOW` ("Ripe Old Age"), which is why `death_knowledge()` overwrites `died_from` for a winner — the flag is not saved in the score file, the cause of death is.
3. More points before fewer.
4. Otherwise the existing order is kept, so equal entries do not shuffle.

## 20.6 Arena levels

The arena is a single-combat level reached by an effect rather than by stairs: it sets `upkeep->arena_level`, records `old_grid`, and calls `dungeon_change_level()` with the *same* depth, so the level is regenerated as an arena around the player and the chosen monster.

It is exempted from much of the ordinary machinery: `cave_generate()` branches to `arena_gen()` before choosing any profile and lights the whole level, `place_trap()` refuses trap doors there, Word of Recall is suspended while it lasts, and `on_new_level()` skips the ambient sound, the target reset, the level feeling and the arrival search.
