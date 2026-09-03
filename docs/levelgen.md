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
flood            label the connected components
stitch           dig tunnels until the level is one piece
prune            fill in anything the stitch could not reach
farthest pair    two breadth-first sweeps; the ends are the entry and the exit
route            breadth-first again, entry to exit
```

**A hexagon is the atom.** Two floor cells side by side are joined, full stop;
a wall is a rock cell and there is nothing else a wall can be. There used to be
a six-bit mask per cell so a tile could carry a wall on an *edge*, which is how
the old socket tileset drew a room's back — and it was wrong for a reason no
amount of tuning would have found: an edge is not somewhere a character can
stand, or path around, or be stopped by. Nothing else in the project believed in
it; the yard's `passable` asks about a cell and Angband's doors are grids. The
mask, the symmetry pass that repaired it, and the wall slabs the bench drew for
it all went with the tileset that wanted them.

The finish is shared on purpose. If the cave carve had its own idea of
"connected", the region count on screen would not mean the same thing for both,
and the comparison would be worthless.

### Stitching

Both stacks need this and neither can do it. The noise band opens a tile where a
field crosses a band and has no way to ask whether the tile next door landed on
the same side of it. The wave function enforces adjacency and nothing else, so
every one of its levels is locally legal and globally a handful of separate
dungeons. **Connectivity is not a property either algorithm is able to state**,
which is exactly why it belongs in the finish — after the carve has had its say,
applying to whatever the carve was.

**One flood, not one per join.** The obvious shape is Prim's on the graph of
pieces: breadth-first from everything joined so far, dig to the nearest piece
that is not, repeat. It is correct, it reads well, and it is quadratic — one
flood of the whole disc per join. Invisible at radius 14 with eight pieces, and
fatal at radius 200 with seven hundred: **158 seconds**, measured, against about
a tenth of a second for everything else the level needed.

So the flood happens once. A single breadth-first search leaves every floor cell
at the same time and spreads through the rock; each rock cell records which
piece reached it first and which way that piece lies. That is a **Voronoi
diagram of the pieces, drawn in rock**, and the moment two territories touch is
a candidate tunnel between them whose length is how far each had come plus the
step across. Every candidate any join could want is found in that one pass.
What remains is Kruskal's over a few hundred pieces rather than a few hundred
thousand cells, and digging the chosen tunnels costs their own length and
nothing more, because the way back to each piece is already recorded.

Same output, 120× faster: radius 200 went from 158 s to 1.1 s, still 699 pieces
joined into one by 698 tunnels.

**It digs exactly one tile wide** — the minimum that connects, and it reads on
screen as something cut rather than something found.

What it will not touch is `sealed` rock: the rim both stacks keep so a passage
cannot run off the boundary. A stitcher free to route round the outside would
join the level up by removing the thing that made it a place.

Measured over 240 levels (both stacks, 30 seeds, radii 6–20), it takes every
level to one piece:

| | carved in | tunnels | cells dug |
| --- | --- | --- | --- |
| cave | 7.5 pieces | 6.5 | 8.0 |
| WFC | 9.0 pieces | 8.0 | 2.4 |

Tunnels are always *pieces − 1*, which is what Prim's guarantees and what the
test asserts. The wave function costs almost no digging — 2.4 cells for eight
joins — because most of its joins are two floor cells already side by side with
a wall between them, and the join is to open the wall.

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

## Scale

| | radius 100 | radius 200 | radius 300 |
| --- | --- | --- | --- |
| cells | 30,301 | 120,601 | 270,901 |
| cave | 0.19 s | 1.1 s | ~2.5 s |
| rooms | 0.17 s | 1.2 s | 2.1 s |
| WFC | — | — | — |

The rooms stack grows each room over **its own neighbourhood** rather than
asking every cell about every room: a level is mostly not room, so the second
way asks thirty million questions to which the answer is almost always no.

**The wave function does not scale and this is not a tuning problem.** Its
working set is one supporter count per cell, per pattern, per direction — at
radius 300 with 121 patterns that is 787 MB, before any time is spent. It runs
comfortably to about radius 80 (19,441 cells, 1.9 s) and should be given a
level of its own size rather than a shared slider. The fix is not a bigger
budget: it is **model synthesis** (item 6 below), which solves in overlapping
blocks and keeps the working set the size of a block.

## Stack two — wave function collapse, overlapping

The solver is still mxgmn's `Model.cs` on six neighbours
(`levelgen/wfc/model.ts`) — but what it solves changed completely, because the
tileset it used to solve was wrong.

### Why the tiled model went

It was thirteen hand-written tiles whose six edges each carried a wall,
corridor or room socket. It produced dungeons and it was wrong for a reason
that had nothing to do with the solver: a *wall between two floor tiles* was a
socket on an **edge**, and an edge is not something a character can stand on,
walk round or be stopped by. There is no such thing as half a hexagon.

The obvious repair — make a wave cell hold several hexagons, so a wall can be a
rock cell inside a patch — does not work either, and it is worth writing down
why. Take the natural patch, a hex and its six neighbours. Its six ring cells
each serve **two** of its six borders, so a socket declared on border *k* and
one declared on border *k+1* constrain the same cell; chase that round the ring
and every border is forced to carry the same socket. A seven-cell patch cannot
carry independent per-border sockets at all.

Which leaves the model that needs no declared adjacency: the overlapping one.

### The solver
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

The panel draws them. Every spec appears as the hexagon it is, once per
distinct rotation, with each socket on the edge it belongs to — which is how you
see that `hall` opens east and west rather than being told it, and that it comes
out as three tiles rather than six. Those glyphs are the solver's own
`expandTiles` output, not a redrawing of the spec, so a rotation that turned the
wrong way would show up in the panel as six halls.

`npm test` asserts the rest without a browser, because a tileset is
the other part of this that fails without telling anyone: every mistake
available in one still produces levels. A rotation that turns the wrong way
bends corridors the wrong way, an asymmetric propagator drifts the solver's
supporter counts and makes it ban tiles it had no reason to, and a tile with no
legal neighbour in some direction is simply never placed — its weight is a lie
and nothing says so. None of them throws; all of them look like a dungeon. So
the check pins the edge mapping (edge `d` faces the neighbour the grid puts in
direction `d`, which the bench's edge walls stand on too), the rotation
cardinalities, that a rotation carries edge `d - k` onto edge `d`, the
propagator's symmetry, that all 61 tiles are placeable, and that the open mask
the level is built from is the sockets it came from. Flip the sign in the
rotation and it reports 132 sockets that did not survive it — the tile counts
alone do not notice, which is why that assertion is separate.

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

## Stack three — rooms, sites and a graph

The other two stacks each make **one kind of space** and vary it. The noise band
makes passage everywhere and widens it; the wave function makes tiles that
happen to clump. Neither builds a level out of *places*. This one does nothing
else.

It also has no partial hexagons anywhere in it: a room is a cluster of whole
hexes, a corridor is a chain of them, and a wall is rock — which is a hexagon,
the same as everything else on the grid.

**Scatter.** Room sites are thrown at the disc and rejected if they land too
close to one already placed — dart throwing, the cheap half of Poisson-disc
sampling. Sizes are drawn per room and the **big ones are placed first**: placing
them in draw order strands the large rooms, because by the time one is tried the
disc is full of small ones and the only gaps left are small.

The rejection radius is `reach(a) + reach(b) + 2`, using each room's *nominal*
reach rather than its worst case. Using the worst case is the obvious thing and
it is wrong twice: it doubles the exclusion radius against a coincidence needing
the noise at its extreme in exactly the spot two rooms face each other, and a
radius-13 disc then holds three rooms when it was asked for twelve. And the
coincidence is not a fault — two rooms whose edges bulge into each other merge
into one larger lobed chamber, which is a shape nothing else in the stack can
produce.

**Grow.** A cell is floor if it is within a room's reach, and the reach is the
room's size pushed about by a coherent noise field — the cave stack's own value
noise, read at 4.5 tiles per lattice cell, **one octave**. The octave count is
load-bearing. Two octaves at that scale puts the second at a wavelength under
two tiles, finer than the grid it is sampled on; the reach then changes by more
than a tile's worth between neighbours and rooms grow single stray hexes with
gaps behind them. That is fringe, not lobes, and turning `ragged` down does not
fix it — not asking the field for detail the grid cannot hold does.

**Link.** This is the interesting decision and it is two decisions, not one.

The **minimum spanning tree** (Prim's, over the complete graph of sites) is the
guarantee: the cheapest set of corridors reaching every room, and being a tree
it can never be redundant. It is also, alone, a bad level — one route between
any two rooms, so every dead end is a walk back the way you came.

The **extra edges** fix that, and where they come from matters more than how
many. Taken from the complete graph they cut clean across the map between rooms
that are nowhere near each other, so both options are *proximity* graphs:

| | `a—b` survives if |
| --- | --- |
| **neighbourhood** (RNG) | no third room is closer to *both* a and b than they are to each other |
| **gabriel** | no third room lies inside the circle with `ab` as its diameter |

Gabriel is a superset of the neighbourhood graph and of the spanning tree, so it
offers strictly more to choose from — it is the default. Both are computed
straight from the definition in O(n³) rather than by building a Delaunay
triangulation and filtering it: with a dozen rooms that is a few thousand
comparisons, and a Delaunay implementation is several hundred lines that would
earn their place at a thousand sites and not at twelve. (`MST ⊆ RNG ⊆ Gabriel ⊆
Delaunay`, so nothing is lost but the outermost layer.)

`loops` is the share of those candidates added on top of the tree. It is
shuffled and cut rather than filtered by a coin per edge, so the count is exactly
the share asked for instead of that share on average — a slider that sometimes
does nothing at 0.1 is a slider nobody trusts.

**Dig.** Each link is walked one hex at a time from one site to the other. The
directions that get closest are collected and one is taken at random; on a hex
grid there are usually two, so the walk wanders a little without being asked to,
which is why a hex corridor looks hand-drawn where a square one looks like a
staircase. `wiggle` is the chance of a sideways step instead. Cells already
floor are left alone, which is what makes a corridor stop at a room rather than
draw a stripe across it — and it costs nothing to arrange, because the walk
starts inside one room and ends inside the other.

At radius 20 it produces ~26% floor in about 10 ms, and it is the only stack
here that comes out in one piece before the stitcher touches it — the spanning
tree is that guarantee, made in the algorithm rather than after it.

## Where this leaves the three

|  | cave | WFC | rooms |
| --- | --- | --- | --- |
| rooms | none, ever | yes | yes, as first-class objects |
| corridor width | a knob | exactly one tile | exactly one tile |
| connectivity | often one piece | rarely one piece | **one piece by construction** |
| cost | ~5 ms | ~60 ms, can fail | ~10 ms |
| tuning surface | two numbers | thirteen weights and socket rows | six knobs |
| partial hexagons | none | **walls on edges** | none |

The rooms stack wins on every row that matters for an ARPG-shaped level, and it
wins for a structural reason rather than a tuning one: it is the only one that
**decides where the places are before deciding what any hexagon is**. Both of
the others hope structure falls out of a local rule, and structure does not fall
out of local rules.

What all three still share is that **none of them can say anything about the
level as a whole** beyond connectivity. No lock and key, no "the exit is behind
the room with the three doors", no difficulty gradient. The rooms stack is the
one positioned to gain that, because it already has a graph of rooms to hang it
on — which is what item 6 below is about.

## What to consider next

Roughly in the order they would pay off.

~~**1. Connectivity stitching.**~~ **Done** — see *Stitching* above. Angband
does the same thing and calls it `ensure_connectedness`
(`docs/angband/16-dungeon-generation.md` §16.3.3); the *placement* of the step
mattered as much as the step, since running it after the generator rather than
inside it is what lets every profile that game has inherit it.

**2. Rectangular rooms and traditional tunnelling.** The rooms stack scatters
and grows; Angband *places builders* and tunnels between their centres in a
shuffled cycle, and the difference shows in the output — its rooms have straight
walls and can be read from a file as vaults. Worth having as a fourth stack
rather than as a replacement.
`docs/angband/16-dungeon-generation.md` is a chapter on a shipped one;
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

~~**3. Delaunay + minimum spanning tree.**~~ **Done** — see *Rooms, sites and a
graph* above, with Gabriel and relative-neighbourhood graphs standing in for the
Delaunay triangulation, which they are subsets of and which needs several
hundred lines this does not.

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
