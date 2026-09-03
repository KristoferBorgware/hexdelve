# Primer: turns, energy, speed and combat

This is a plain-language walkthrough of how Angband's turn engine and combat
fit together, written as a companion to the precise, source-derived chapters
in this folder. Read this first for the mental model; follow the `See:`
links into [02-time-energy-speed.md](02-time-energy-speed.md),
[07-melee-combat.md](07-melee-combat.md) and
[08-ranged-combat-projection.md](08-ranged-combat-projection.md) for the
exact formulas, constants and edge cases when you actually implement
something — this file intentionally simplifies and rounds where the real
tables are more nuanced.

## 1. It's turn-based, not real-time

Nothing in the game world changes while the engine is waiting for input.
There is no wall-clock timer anywhere — every unit of "time" that exists
(energy, hunger, light fuel, monster actions) is a count of simulated
**game turns**, and game turns only advance because the player submitted an
action. Pausing for a second or an hour between keypresses has zero effect
on the game state.

*See: [02 §2.1](02-time-energy-speed.md#21-game-turns-player-turns-standard-turns)*

## 2. The event loop, from your input to your next turn

1. You submit an action (move, attack, cast, quaff, ...). It resolves
   immediately.
2. The engine advances the game-turn clock by however much that action
   cost.
3. Every monster on the level gains energy for the elapsed turns, at its
   own speed-derived rate — this happens whether or not it's near you,
   awake, or asleep.
4. Any monster whose energy has now reached the action threshold takes its
   turn: it runs its AI (asleep / hunting / fleeing / casting), acts, and
   spends the energy.
5. This repeats — advance, let monsters catch up and act — until *your*
   energy has climbed back over the threshold.
6. Control returns to you and the engine waits again.

Multi-turn commands (`Rest`, running, repeated movement, digging) are the
same loop batched automatically on your behalf, stopped early by a
"disturbance" (a monster becomes visible, you take damage, etc.) instead of
running to completion blindly.

If literally nobody has enough energy to act on a given game turn, the
engine just keeps advancing turns silently — no rendering, no input, no
real delay — until someone does. Since every actor with positive speed
gains energy every turn, this always resolves within a handful of turns,
most reliably by your own energy crossing the threshold.

*See: [02 §2.3](02-time-energy-speed.md#23-who-acts-when), [02 §2.8](02-time-energy-speed.md#28-resting), [02 §2.9](02-time-energy-speed.md#29-repeating)*

## 3. Energy and the action threshold

Every actor (player and monster) has an energy reservoir. Each game turn it
gains energy at a rate set by its **speed**. When the reservoir reaches
**100**, the actor is eligible to act; acting spends 100 (or less/more,
depending on the action — see the cost table below) and any leftover energy
carries forward rather than being wasted. Energy is *not* hard-capped at
100 for an actor that's free to act — it simply gets spent down almost as
fast as it accrues, so it rarely builds up.

The one place a cap matters is when an actor **can't** spend energy despite
crossing the threshold — chiefly a paralysed actor. Without some limit, a
long paralysis would let energy climb far past 100, and the moment
paralysis ended the actor would be owed a burst of several actions in a
row to "use up" the stockpile. The engine avoids this by simply not banking
gains meaningfully beyond what's needed to act, so lost turns to paralysis
stay lost rather than converting into a free flurry once it wears off.

*See: [02 §2.2](02-time-energy-speed.md#22-speed-and-the-energy-table), [02 §2.6](02-time-energy-speed.md#26-energy-cost-of-commands)*

### Approximate cost model, for a first implementation pass

| Action | Energy |
|---|---|
| Normal action (move, open, wield, quaff, read, cast, ...) | 100 |
| Take off / drop / refuel | 50 |
| One melee blow (of N blows this round) | `100 * 100 / (N * 10)` |
| One ranged shot (of N shots per turn, in tenths) | `100 * 10 / N` |
| Free (look, inventory browse, map, character sheet) | 0 |

The real table has more entries and exceptions (movement-speed items,
fast-cast, shield bashes) — see 02 §2.6 before relying on any of these for
real balancing.

## 4. Speed

Speed is a *rate of energy gain*, not a turn-order priority. A creature at
+10 doesn't simply "go before" a normal one — it reaches the 100-energy
threshold roughly twice as often over the same stretch of game turns.
Loosely:

- **+10 speed ≈ 2× the actions** of normal in a given span.
- **+20 ≈ 3×**, **+30 ≈ 3.8×**, flattening out toward a ceiling around
  **4.9×** at very high speed.
- **-10 ≈ half**, **-20 ≈ a third**, bottoming out near the floor.

This is *not* a clean exponential in the real game — it's a hand-tuned
lookup table, roughly linear (+1 energy per point of speed) between -10 and
+30, then flattening sharply above that and bottoming out below -10. Don't
implement it as a smooth formula if you want Angband's actual feel; use (or
adapt) the real table.

*See: [02 §2.2](02-time-energy-speed.md#22-speed-and-the-energy-table) for the full table, [02 §2.4](02-time-energy-speed.md#24-monster-speed) for monster speed variance, [02 §2.5](02-time-energy-speed.md#25-the-players-speed) for what modifies the player's speed*

## 5. Melee combat

You attack by moving into a monster's square. Three separate numbers
combine into your round's output:

1. **Blows per round** — how many separate attack rolls you get, from
   class, STR/DEX and weapon weight. Each blow costs
   `100 * 100 / num_blows` energy, spent one blow at a time until the next
   blow wouldn't fit in the energy available — so a fast character never
   gets more blows than their stat allows in one command, but leftover
   energy is never lost, it just carries into the next attack.
2. **To-hit vs. AC** — each blow is a hit/miss roll. The real curve has a
   hard floor and ceiling:

   ```
   P(hit) = 0.12 + 0.83 × max(0, to_hit − 2·AC/3) / to_hit
   ```

   Every attack has at least a 12% chance to land and at most a 95% chance,
   regardless of how lopsided the skill/AC matchup is.
3. **Damage** — weapon dice × the best applicable slay/brand multiplier
   (only one ever applies, they don't stack) + to-dam bonuses, then
   possibly boosted by a critical hit. Monster AC only ever affects whether
   a blow *lands*, never how much damage it does once it has.

Monsters attack you through the same hit-chance formula, with their own
`to_hit = level × 3 + blow power` against your total AC, and their damage
is reduced by your armour on a sliding scale (`damage − damage × AC/400`,
capped at 60% reduction at AC 240) before status effects (poison,
paralysis, fear, stat drain, ...) are applied from whichever blow effect
they used.

*See: [07 §7.1](07-melee-combat.md#71-the-hit-test) (hit test), [07 §7.2](07-melee-combat.md#72-the-players-attack-round) (blow sequencing), [07 §7.4](07-melee-combat.md#74-slays-and-brands) (slays/brands table), [07 §7.5](07-melee-combat.md#75-critical-hits) (criticals), [07 §7.7](07-melee-combat.md#77-monster-melee-against-the-player) (monster blows and effects)*

## 6. Ranged combat

Same hit-test formula as melee, different setup: a launcher (sling/bow/
crossbow) needs matching ammo, has a damage multiplier, and grants shots
per turn (in tenths — e.g. 16 = 1.6 shots) instead of blows. Firing costs
`100 * 10 / num_shots` energy per shot. The missile travels in a straight
line up to a multiplier-derived range, stopping at the first wall or the
target; ammo that hits breaks more often than ammo that misses, and thrown
weapons/potions reuse the same flight and target-resolution machinery as
proper ammo.

*See: [08 §8.1](08-ranged-combat-projection.md#81-launchers-and-ammunition) (launchers/shots), [08 §8.2](08-ranged-combat-projection.md#82-the-flight-of-a-missile) (path and breakage)*

## 7. Where status effects hook into the turn engine

A few statuses matter specifically *because* of how the energy/turn system
works, not just as flat debuffs:

- **Paralysis** — the actor keeps gaining energy and crossing the
  threshold, but spends each turn doing nothing instead of acting. This is
  exactly the case the energy cap (§3) exists to guard against.
- **Fear** — blocks melee attacks specifically (you can still move, use
  items, cast, or shoot) rather than costing energy differently.
- **Slow / Haste** — directly modify the speed value that feeds the energy
  table (§4), so their effect compounds the same way any other speed change
  does — a hasted monster isn't just "faster," it's mechanically taking
  more turns against your one for the duration.

*See: [11 §11.2](11-timed-effects-food-recovery.md#112-the-effects) for the full timed-effects list and durations*

## Quick reference: where each formula lives

| Topic | File | Section |
|---|---|---|
| Game turn / player turn / standard turn counters | 02 | §2.1 |
| Speed → energy-per-turn table | 02 | §2.2 |
| Processing order (who acts when energy ties) | 02 | §2.3 |
| Monster speed variance at spawn | 02 | §2.4 |
| What modifies the player's speed | 02 | §2.5 |
| Energy cost per command | 02 | §2.6 |
| Day/night cycle | 02 | §2.7 |
| Resting | 02 | §2.8 |
| Command repeat | 02 | §2.9 |
| Hit-chance formula (melee, ranged, monster) | 07 | §7.1 |
| Player attack round / blow sequencing | 07 | §7.2 |
| Slay & brand multiplier tables | 07 | §7.4 |
| Critical hit tables (standard + O-combat) | 07 | §7.5 |
| Shield bashes | 07 | §7.6 |
| Monster blow methods & effects | 07 | §7.7 |
| Damage-to-monster / fear-on-damage | 07 | §7.8 |
| Player damage reduction, death check | 07 | §7.9 |
| Launcher multipliers & shot rate | 08 | §8.1 |
| Missile flight path & breakage | 08 | §8.2 |
| Timed effects (paralysis, fear, confusion, ...) | 11 | §11.2 |
