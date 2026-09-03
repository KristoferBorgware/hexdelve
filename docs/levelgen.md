# Level generation

The editor's **Level** bench exists to answer one question — which algorithm
should build a Hexdelve dungeon — and to answer it by looking rather than by
arguing. Two stacks are in it. This is what they are, what they measured, and
what else is worth trying.

Everything here lives in `packages/client/src/levelgen`. The bench draws a
`Level` and knows nothing about how one is made, so adding a third algorithm is
adding a `LevelStack`: no new drawing code, no new panel, no new anything.

```
npm run dev:editor        # then: Level, in the toolbar
```

## What a stack is

A stack is a pipeline. Its own algorithm decides one thing — which cells are
floor, and which edges between them are open — and then the same finish runs on
every one of them:

```
carve            the stack's own business
symmetrise       an edge is open only if both sides say so
flood            label the connected components
prune            optionally fill in everything but the biggest
farthest pair    two breadth-first sweeps; the ends are the entry and the exit
route            breadth-first again, entry to exit
```

The finish is shared on purpose. If the cave carve had its own idea of
"connected", the region count on screen would not mean the same thing for both,
and the comparison would be worthless.

Connectivity is per **edge**, not per cell. Two floor tiles can sit side by side
with a wall between them, which is a room's back wall against a corridor and is
most of what makes a dungeon read as built rather than eroded. A carve with no
such notion opens every edge between two floors and nothing downstream can tell.

## Stack one — cave, noise band

Ported from chamfer's `generation/terrain/caveDensity.ts`, down to the hash and
the octave order. A tile is floor where a three-octave value-noise field lands
inside a narrow band either side of zero.

chamfer's own note on that function says the shape it carves is not a network of
corridors but **one folded sheet**, because the zero set of a scalar field in
three dimensions is a set of *surfaces* and the band around a surface is a slab.
Its passages are consequently wide, everywhere-connected, and impossible to
narrow — squeezed to a three-cell median the sheet shatters into 1,976 separate
systems with the largest holding 1.8% of the void.

**In two dimensions the same sentence gives the opposite answer.** The zero set
of a field on a plane is a set of *curves*, and the band around a curve is a
*ribbon* — which is a corridor. The algorithm that could not make a narrow
connected passage on a planet makes almost nothing else on a hex plane.

Measured over twelve seeds at radius 14 (631 cells), before pruning:

| band half-width | floor | components | entry→exit |
| --- | --- | --- | --- |
| 0.08 | 101 | 33.4 | 8 |
| 0.12 | 152 | 26.3 | 15 |
| 0.16 | 198 | 17.7 | 28 |
| 0.20 | 247 | 9.1 | 38 |
| 0.25 | 301 | 4.3 | 41 |
| 0.30 | 354 | 3.0 | 38 |

The width knob really is the corridor width, directly, and the component count
falls out of it: narrow contours are ribbons that pinch off, wide ones merge.
The lattice scale trades the same currency — at a fixed width, scale 3 gives 26
components and scale 11 gives 4.5, because a lazier field crosses zero less
often and each crossing runs further.

What it is good at: it is three lines of arithmetic per tile, it is under 8 ms
for a 631-cell disc, it has no failure mode, and the passages wind.

What it cannot do: a room. Every space is a widening of a passage, no wall is
straight, and there is no vocabulary in the algorithm for "a chamber with four
exits" — the field does not know what a chamber is.

## Stack two — wave function collapse, hex tiles

The solver is mxgmn's `Model.cs` on six neighbours (`levelgen/wfc/model.ts`).
Three things change and nothing else does: six directions rather than four with
`opposite(d) = d + 3`; a hex disc held as a flat array with an explicit
neighbour table rather than `i % MX`; and pattern size `N` gone, since it only
ever existed for the overlapping model.

Two deliberate departures, both marked in the source:

- **Contradictions are detected wherever they occur.** `Model.Propagate` ends
  `return sumsOfOnes[0] > 0`, which only notices a wave emptied at node zero. On
  a rectangle that is a corner and mostly harmless; on a disc it is one
  arbitrary cell. A flag set in `ban` costs nothing and is right.
- The random source is this project's mulberry32 rather than .NET's `Random`,
  so a seed means the same level in a browser as in a test.

The tileset (`levelgen/wfc/tileset.ts`) is ours. mxgmn's `SimpleTiledModel`
reads adjacency as an explicit list of legal neighbour pairs — hundreds of
`<neighbor left="corner 1" right="empty"/>` lines — which is right when the tiles
are bitmaps and adjacency is whatever the artist thought looked continuous.
These tiles are not bitmaps: every one is a hex cell with six edges, so
adjacency is a **rule**, not a list. Thirteen tile specs with six sockets each
expand to 61 rotations and about two thousand legal pairs with nobody typing
them, and the symmetry the solver depends on —
`t2 ∈ allowed[d][t1] ⟺ t1 ∈ allowed[d+3][t2]` — is structural rather than
asserted, because both questions come out of the same equality between the same
two sockets.

Three socket kinds, and three rather than two is the whole design:

```
.  wall       solid between the two cells
c  corridor   a passage one tile wide
r  room       open floor continuing into the next tile
```

With only *open* and *shut*, the model cannot tell a corridor from a room and
produces a random open subgraph of the hex grid — the same undifferentiated
sponge the noise carve gives, with more machinery. Making `c` and `r` refuse to
meet forces the two vocabularies apart: rooms grow only into rooms, corridors
continue only as corridors, and the only way between them is a tile with one of
each, which is a **door**. Rooms, corridors and doors are all consequences of
that one rule.

Measured over ten seeds at radius 14, before pruning:

| rock weight | floor | components | largest | attempts |
| --- | --- | --- | --- | --- |
| 1 | 472 | 3.9 | 452 | 1.6 |
| 2 | 402 | 6.6 | 369 | 2.1 |
| 4 | 285 | 10.0 | 195 | 1.8 |
| 6 | 192 | 12.5 | 114 | 1.4 |
| 8 | 152 | 15.3 | 54 | 1.2 |

The shipped default is 4.5, which lands around 34% floor.

What it is good at: rooms with backs, corridors exactly one tile wide, doors,
and a tileset that is thirteen lines of data — the character of the output is
tuned by editing numbers, not code.

What it is bad at, and this is the important row in the table: **the wave is a
purely local constraint system.** Every adjacency is legal and nothing anywhere
says the level is one piece. At the default weights a 631-cell disc comes out in
seven to ten components with two-thirds of the floor in the largest. The bench
draws that directly — the *Regions* toggle colours each component — because it
is the number a tileset gets tuned against.

It is also the only stack here that can **fail**. WFC has no backtracking: an
observation is never taken back, so a run that paints itself into a corner has
no move except to start over, exactly as mxgmn's `Program.cs` does. The attempt
count is in the readout for that reason. A tileset whose weights are wrong does
not look wrong on screen; it looks like twenty attempts.

At radius 24 (1,801 cells) a run costs roughly 90 ms and typically wants two to
four seeds, so 350 ms in the bad case. That is fine for a bench and would need
moving off the main thread for a game.

## Where this leaves the two

They fail in opposite directions, which is the useful result:

|  | cave | WFC |
| --- | --- | --- |
| rooms | none, ever | yes |
| corridor width | a knob | exactly one tile |
| doors | no concept | yes |
| connectivity | often one piece | rarely one piece |
| cost | ~5 ms | ~60 ms, can fail |
| tuning surface | two numbers | thirteen weights, thirteen socket rows |

Neither is finished. The gap they share is the interesting one: **neither can
say anything about the level as a whole.** No lock and key, no "the exit is
behind the room with the three doors", no difficulty gradient. Both are local
rules that happen to produce a global shape.

## What to consider next

Roughly in the order they would pay off.

**1. Connectivity stitching, as a shared finish step.** Not an algorithm of its
own — a post-pass. After flooding, join every component to the largest by
tunnelling between their nearest cells (A* over rock, weighted so it prefers
short runs and existing walls). This turns WFC's biggest weakness into a
non-issue and makes the cave carve usable at narrower widths, and it costs one
function that every future stack inherits for free. This is the highest-value
next thing in the folder.

Angband does exactly this and calls it `ensure_connectedness`: flood-fill from
the first room, tunnel to anything not yet reachable, and the level is connected
without the player needing to dig — see `docs/angband/16-dungeon-generation.md`
§16.3.3. It is worth copying the *placement* of the step as much as the step: it
runs after the generator has had its say, not inside it, which is why it works
for every profile that game has.

**2. Room-and-corridor.** The classic, and the one Angband uses;
`docs/angband/16-dungeon-generation.md` is a chapter-length description of a
shipped implementation and should be read before writing this stack. Place rooms
from a weighted table of *builders* (§16.2.2), then connect their centres in a
shuffled cycle with a tunneller that heads for its target but turns at random 30%
of the time, pierces room walls and leaves a door there 25% of the time, and
puts a door at 50% of the junctions it crosses (§16.3.3). Connected by
construction, trivially fast, and every room is a place the game can *name* — a
vault, a pit, a nest (§16.4, §16.5).

Two things do not port unchanged. Angband's classic profile reserves rooms in
11×11 blocks and its modified profile lets each builder find its own space; on a
hex disc the second is the one that generalises, since there is no clean
rectangular block to reserve. And the tunneller's four directions become six,
which is a simplification rather than a complication: there are no diagonals to
special-case, which is the reason this project uses hexes at all.
**Brogue-style accretion** — place one room, attach the next to a door on the
frontier, repeat — is the same family and suits an irregular disc even better.

**3. Delaunay + minimum spanning tree (the "TinyKeep" recipe).** Scatter room
centres, push them apart until they stop overlapping, triangulate the centres,
take the MST, then add back a small fraction of the discarded edges. The MST
guarantees connection; the added edges are what stop a dungeon being a tree, and
the fraction is a single readable knob for "how many loops". Pairs well with
either room placer above.

**4. Hex cellular automata.** The other classic cave generator, and genuinely
different from stack one: seed noise at random, then repeatedly set each cell to
the majority of its six neighbours. On a hex grid there are no diagonal
ambiguities and the rule is one comparison. Produces rounder, blobbier caverns
than the noise band, which are worth having as a contrast — and it is about
fifteen lines. Angband's own **cavern** profile is this, joined into one
connected region afterwards and never lit (§16.7). Cheap enough that it should
probably go in before anything complicated.

**5. Growing-tree mazes, then carve.** Recursive backtracker or Prim over the
hex grid gives a perfect maze — connected, no loops, every cell reachable — and
then the classic recipe is to remove a fraction of dead ends and widen some
cells into rooms. Its virtue is that connectivity is a *theorem* rather than a
hope, which is exactly what WFC lacks. Its vice is that undecorated maze output
is tedious to walk, which Angband concedes by making its **labyrinth** profile a
rare, mostly-lit, sometimes fully-mapped special case rather than a normal level
(§16.7).

**6. Generative grammars / mission graphs (Dormans).** Generate the *mission*
first as a graph — enter, find key, open lock, reach boss — and only then lay it
out in space. This is the one thing on the list that addresses the shared gap
above: it is how you get a level that is *about* something. Expensive to build,
and it wants one of the space-filling algorithms above underneath it, so it is
the right thing to want and the wrong thing to want first.

**7. WFC, overlapping model.** The other half of mxgmn's repository: learn the
adjacency from an example image rather than from a hand-written tileset. It
would mean authoring dungeons by drawing one, which is appealing. Harder on a
hex lattice than a square one — an `N x N` pattern window has no clean hex
analogue, so it becomes "a cell and its six neighbours", which is close to what
the tiled model already does with sockets. Probably not worth it before 1–5.

**8. Model synthesis (Merrell).** WFC's predecessor, and the answer to WFC's
scaling and failure problems: solve in overlapping blocks, keeping what worked,
so a contradiction throws away one block rather than the whole level. If the
wave function turns out to be the right approach and the retry count is the
thing standing in its way, this is the fix rather than more retries.

Two things that are **not** worth the trouble here: answer-set programming and
constraint solvers in general (the expressiveness is real, the dependency and
the solve times are not), and anything learned from data (there is no corpus of
Hexdelve levels to learn from, and there will not be one).

## Beyond the shape

Two things the bench does not yet ask about, both worth deciding early because
they constrain the choice above.

**Stairs and arrival.** Entry and exit here are the two ends of the floor graph,
which is a reasonable default and is not what a game wants: Angband places 1–3
down staircases and 1–2 up, and with persistent levels it places them where the
adjacent level's stairs were, so they line up (§16.3.5, §16.8). The moment
levels persist, "where is the exit" stops being a property of one level.

**What a room is for.** Every algorithm above produces space; none of them
produces *meaning*. Angband gets that from a rarity-weighted table of room
builders and from `pit.txt` — a pit is a room whose contents are one themed
monster group, and a vault is a room read from a text file with its own layout
and guarantee (§16.4, §16.5). That is a data problem sitting on top of whichever
generator wins, and it is the reason to prefer a stack whose output *has* rooms
that can be labelled, over one that merely has open space.

## Reading the bench

- **Regions** — colours the floor by connected component. The single most useful
  toggle: it turns "does this look connected" into a count.
- **Keep only the largest region** — the prune step, on by default. Turn it off
  to see what the carve actually produced.
- **Edge walls** — the walls the tileset put between two floor tiles. The one
  thing on screen the noise carve can never produce; without it, WFC output
  looks like a cave with tidier corners.
- **Attempts** — seeds burned on contradictions. Reads 1 for anything that
  cannot fail.
- **Entry to exit** — steps along the route, which is the closest single number
  to "how long is this level".
