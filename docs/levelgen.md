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
| boxes | 0.19 s | 0.78 s | ~1.8 s |

The rooms stack grows each room over **its own neighbourhood** rather than
asking every cell about every room: a level is mostly not room, so the second
way asks thirty million questions to which the answer is almost always no.

## Stack two — rooms, sites and a graph

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

## Stack three — boxes and doors

The other three all **carve**. The noise band opens tiles where a field crosses
a band; the wave function paints patterns; even the rooms stack grows blobs and
lets their edges land where the noise puts them. All three produce *space*, and
space with rock in it reads as a cave system however carefully it is tuned —
because a cave is exactly what "connected open space" means.

A room is not open space. It is a shape with an inside, a wall all the way
round it, and a countable number of ways in. Everything below follows from
insisting on that.

### Offset coordinates

An axis-aligned box needs rows and columns. Axial `(q, r)` is a perfectly good
integer lattice, but its rows shear half a cell right of the one above, so a box
in axial space is a *rhombus* in the world and a room drawn that way leans.
**Odd-r offset** does not shear: a rectangle of cells is a rectangle on screen,
with left and right edges that zigzag by half a hex — which is what a hex wall
looks like anyway. It is the same space the wave function's sample is drawn in,
and for the same reason.

### The shape of a room

Sites are scattered, each gets a random box, and the boxes are allowed to
overlap. They are then placed one at a time, and **a room is not the box it was
given** — it is the largest rectangle that actually fits inside that box, given
everything placed so far. Placing a room blocks its own cells plus a margin, so
the next room cannot reach them.

Then the same question is asked again of what is left inside the box, and a
second rectangle is taken if it is big enough and touches the first. That single
repetition is the whole shape vocabulary: two rectangles sharing an edge are an
L, two meeting across a third are a T or a cross, and the pair is most often
neither — it is a room with an alcove, which a hand-drawn dungeon is full of and
a generator almost never produces. Measured, **30–49% of rooms come out
non-rectangular.**

### Largest rectangle in a bitmap

`rect/largestRectangle.ts`, in O(w·h), and worth reading because it is not the
kind of algorithm anyone derives at the keyboard.

Walk the bitmap row by row keeping one running count per column: zero where the
cell is blocked, otherwise one more than the row above. That number is how far
straight up you can go without hitting anything — so after each row you hold a
**histogram**, and every rectangle whose bottom edge lies on this row is a
rectangle under it. A column of height `h` extends left and right until the
first bar strictly shorter than it, so its best rectangle is
`h × (nextLower − prevLower − 1)`.

Finding those two neighbours by scanning would cost a factor of the width.
Instead each is precomputed in one pass with a **monotonic stack**: push indices
while heights are not decreasing, and when one decreases, unwind — every index
that comes off has just found its next lower bar. Each index is pushed once and
popped once.

The defaults are the part to get right: `nextLower` defaults to `width` and
`prevLower` to `-1`, so a bar with nothing shorter beside it reaches the edge
with no special case. Ties are treated as strictly lower both ways, so neither
of two equal bars thinks it can reach past the other — the maximum is still
correct, and `npm test` says so by comparing against the four-nested-loop
definition over 3,000 random bitmaps.

### Corridors between facing edges

A corridor here is **not a path found through rock**. It is a straight run along
one column or one row, from an edge of one room to an edge of another *facing
it*, and it exists only where those two edges see each other. Any run that would
cross a third room is rejected outright, and of what remains the shortest is
taken. The ends of a run are **doors**.

That rule is why the output reads as rooms and doors. A pathfinder asked to join
two rooms will happily enter a third on the way and leave by the other side, and
the moment that happens the two rooms it passed through have become one L-shaped
space. Straight runs between facing edges cannot do that.

Rooms that are diagonal from each other share neither a column nor a row and get
an **L** instead: out along a column, one turn, in along a row. Both arms are
still straight runs and both are still checked against every other room. The
alternative — leave those links and let the shared stitcher have them — works
and looks wrong: the stitcher digs the shortest path it can find and wanders by
design, and a wandering tunnel between two square rooms reads as a mistake. At
radius 100 it was digging 235 cells of it per level; with the L fallback that is
**13**, and the whole stack got faster.

### What is not here

The reference this was built from finishes by converting the grid to polygons
with marching squares. That is a rendering step for a game that draws walls as
lines, and this one draws them as hexagonal prisms — there is no outline to
extract, because every wall is already a cell you can stand next to. Skipped on
purpose rather than missed.

| | radius 20 | radius 100 | radius 200 |
| --- | --- | --- | --- |
| rooms placed | 14 | 193 | 313 |
| non-rectangular | 42% | 30% | 17% |
| floor | 49% | 46% | 24% |
| time | 8 ms | 185 ms | 781 ms |

## Where this leaves the three

|  | cave | rooms | boxes |
| --- | --- | --- | --- |
| rooms | none, ever | organic blobs | **discrete, with walls** |
| doors | no concept | no concept | **yes, marked** |
| connectivity | often one piece | by construction | by construction |
| cost at r100 | 0.19 s | 0.17 s | 0.19 s |

### The one that was removed

A wave function collapse lived here, first as a tiled model over hand-written
socket tiles and then as mxgmn's overlapping model learning from a drawn
sample. Both worked. Both were removed, and the reason is the same reason the
tiled tileset was wrong before it: **a local constraint system has no way to say
anything about a level above the scale of a few cells.** Every structure it
produced was structure that *happened* rather than structure that was decided —
which is fine for a texture and is not what a dungeon is. It also did not scale;
its working set is one supporter count per cell per pattern per direction, which
is 787 MB at radius 300.

The two graph stacks both **decide where the places are before deciding what any
hexagon is**, and that is the structural reason they beat the other two at
producing a level rather than a space. Between them it is a question of what
kind of level: the rooms stack erodes, the boxes stack builds. Caves against
architecture.

What all four still share is that **none can say anything about the level as a
whole** beyond connectivity. No lock and key, no "the exit is behind the room
with the three doors", no difficulty gradient. The two graph stacks are the ones
positioned to gain it, because they already have a graph of rooms to hang it on
— which is what item 6 below is about.

## What to consider next

Roughly in the order they would pay off.

~~**1. Connectivity stitching.**~~ **Done** — see *Stitching* above. Angband
does the same thing and calls it `ensure_connectedness`
(`docs/angband/16-dungeon-generation.md` §16.3.3); the *placement* of the step
mattered as much as the step, since running it after the generator rather than
inside it is what lets every profile that game has inherit it.

~~**2. Rectangular rooms, and vaults.**~~ **Done** — see *Boxes and doors* and
*Vaults* above. What is still missing is Angband's **pits and nests**: a room
whose contents are a designed encounter rather than a scatter — sixteen sleeping
monsters of one theme, laid out symmetrically with the two deepest in the exact
centre. Generated rather than drawn, so it is a different thing from a vault and
wants the same placement pass. `docs/angband/16-dungeon-generation.md` §16.5;
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

~~**7. WFC, overlapping model.**~~ **Built, and removed.** See *The one that was
removed* above. It is not that it did not work — it is that a local constraint
system cannot say anything about a level above the scale of a few cells, so what
it produces is structure that happened rather than structure that was decided.

Two things that are **not** worth the trouble here: answer-set programming and
constraint solvers in general (the expressiveness is real, the dependency and
the solve times are not), and anything learned from data (there is no corpus of
Hexdelve levels to learn from, and there will not be one).

## Vaults

A vault is a room somebody **drew**, stamped into the level as-is. Everything
else here is made up by an algorithm; a vault is the only part of a dungeon that
is deliberate, and the reason a player recognises a place on their fifth run.

### Not an Angband file

Angband keeps these as ASCII in `vault.txt`, where `8` means "a monster forty
levels out of depth and a great object". That is a wonderfully compact notation
for a game whose content is finished and a bad one for a game whose content is
not: every symbol is a decision about loot tables and monster depths baked into
a character.

So a vault here is **data**. Terrain is a named union — `wall`, `floor`, `door`,
`outside` — and entities are a list of positions with a kind, so adding either
is a change the compiler reports everywhere instead of a symbol that silently
means nothing in half the vaults using it. The catalogue is *written* as
character art because a drawing has to be readable, but those characters are a
convenience of that one file: `parseVault` turns them into the typed data, and
the vault bench never sees them.

The five entity kinds — `monster`, `loot`, `trap`, `light`, `marker` — are
deliberately provisional. The game has no monsters that fight, no loot tables
and no traps, so anything more specific would be inventing a system to fit a
file format, which is backwards. `tier` is *levels out of depth* rather than an
absolute, so one vault reads sensibly across its whole depth range, and `tag` is
the escape hatch until those systems exist.

### Placed before anything carves

The pass runs on the solid draft, **before** any stack touches it, and that
ordering is the design. The alternative — each stack placing its own — is three
implementations of one idea; two of the three have no rectangle to offer a vault
by the time they have finished; and a vault stamped *over* a carve has just
deleted whatever was there, which is how a treasury ends up with a cave running
through the middle of it.

Placed first, a vault is simply terrain the carve has to respect. The cave stack
finds a built structure in its rock and flows around it. The boxes stack finds a
region it cannot put a room in. Neither needed to know what a vault is.

What makes that work is one flag: `DraftCell.fixed` means *this cell is
finished, and nothing downstream may change it*. Every stack checks it before
writing and the stitcher checks it before digging, so a vault's walls cannot be
carved open or tunnelled through, and its doors are the way in that was drawn.
Unlike `sealed` it says nothing about what the cell **is** — a fixed cell may be
floor — only that it is settled.

The boxes stack does one thing more, because it can: vaults go into its room
list first, as rooms that are already built, so they end up on the end of a real
corridor rather than left for the stitcher. Their `entrances` are their drawn
doors and nowhere else — which is the whole difference between a vault and a
generated room, expressed as a set of cells rather than a special case in the
corridor code.

### The bench

The editor's fifth view. Unlike the other three benches it **authors** rather
than previews, which is why it has no GPU viewport: a vault is a grid of cells
and the truthful picture of a grid is a grid. What the room will look like
standing in a dungeon is the level bench's job, one tab across.

It paints terrain and entities with a brush, checks the vault against the same
`vaultProblems` the placer runs (so what is red here is exactly what would have
made the vault silently never appear), and copies the result out as a
`VaultSpec` ready to paste into the catalogue. The browser keeps the working
copy; the repository keeps the vaults. That is not a limitation being worked
around — there is no server to save to, and a bench that pretended otherwise
would be one whose work quietly disappeared.

### What is still missing

Depth is a slider that only vault eligibility reads. That is the honest state of
affairs: depth is the axis a roguelike scales everything along, and this project
has exactly one thing that scales along it so far. `rating` is stored and not
yet spent on anything — it is the one property of a vault that is about the
*level* rather than the room, so it is what a difficulty budget would eventually
be built from.

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
