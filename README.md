# Hexdelve

Hexagon experiments on a **flat plane** — a spin-off from
[chamfer](../chamfer)'s Goldberg-polyhedron planet. Here hexagons are freed
from the polyhedron entirely: any size, any orientation, which leaves more
room for experiments.

The game world is a flat plane of hexagon tiles, viewed with an isometric
camera from above.

**Live: <https://kristoferborgware.github.io/hexdelve/>** — every lab, published
from `main` on each push.

## Labs

Each lab is a self-contained page under `labs/`. **Open `index.html` directly —
no server needed.**

| # | Lab | What it tries |
|---|---|---|
| 01 | [Log cabin](labs/01-log-cabin/index.html) | Build the outside of a log cabin using only hexagonal prisms: horizontal hex logs with interlocked corners, a hexagon door and windows, hex-shingled roof, stacked-hex chimney with hex smoke. The construction lives in `labs/shared/cabin.js`; this is where it was worked out. |
| 02 | [Blacksmith rig](labs/02-hex-blacksmith/index.html) | A 17-bone humanoid skeleton rig (no fingers/toes) drives a low-poly blacksmith built from 40 hex prisms, with a **procedural** walk cycle — every joint angle is a function of one phase variable. Toggle character/skeleton; both at once gives an x-ray view. |
| 03 | [Keyframes](labs/03-keyframes/index.html) | A **keyframe player** written from scratch: a hammer strike, a swing, a run, a jump, a duck. The walk is *baked* from lab 02's procedural function so the two can be compared live. Crossfades, upper-body layer masks, clip events (sparks on impact), and a scrubbable timeline showing every key. |
| 04 | [Blend tree](labs/04-blend-tree/index.html) | An **idle → walk → run blend tree** driven by one speed parameter, with phase synchronisation, an additive turn-lean layer, and a calibration pass that measures what the blend really produces so the slider can be in true m/s. The tree diagram in the panel shows live weights. |
| 05 | [Inverse kinematics](labs/05-ik/index.html) | Analytic **two-bone IK** as a corrective pass. Feet plant on terraced hex tiles with a pelvis drop and a per-foot contact weight; the hammer strike targets the anvil *face*, so dragging the anvil up and down re-solves the blow to hit it — 0 cm error wherever the arm can reach, and an honest "out of reach" where it cannot. |
| 06 | [Click to move](labs/06-click-to-move/index.html) | The capstone. **Click** a hexagon and he walks there via A* over the terraces, **click again** and he runs, **click the anvil** and he walks to the tile beside it, *steps off the grid* into a stance measured from the swing itself, strikes once, and steps back. A smithy stands behind the anvil — log walls, shingled gable, lit forge and smoking chimney — with the log house from lab 01 further back. Both footprints are solid, so paths route around them. Navigation, the blend tree and IK are three separate systems that meet only through the pose. |

| 07 | [Player character](labs/07-player-character/index.html) | The same world, with the roles swapped. You drive the **wanderer** — a second character on the same rig, carrying nothing — while the blacksmith stands at his anvil and works on his own schedule, hammer aimed by IK, whether or not you are watching. A **helmet** lies in the yard: click it and he fetches it, stoops and puts it on. Picking it up is one re-parent onto the head bone, so every clip carries it from then on. |

| 08 | [The bat](labs/08-bat/index.html) | An enemy, on a rig that is nothing like the humanoid one. It sleeps folded on its hexagon; come within three tiles and it wakes, paths after you over the same grid you walk, and bites from whichever hexagon it lands on — never leaving the grid, because the reach comes out of the lunge rather than out of walking closer. Then it loses you at six and flies home. Its wings clear two terraces where you can only manage one. There is a helmet, a sword and a shield in the yard: pick them up and hit it back — click the bat, or the red-tinted hexagon it occupies, and he runs to a tile beside it and cuts. Neither can walk into a cell the other is standing in. |

| 09 | [Free movement](labs/09-free-movement/index.html) | The same yard, off the grid. **W A S D** moves and **the mouse** faces, and for the first time those are two different numbers. **W** and **S** are his — forward is wherever you are pointing — while **A** and **D** are the screen's, so you can hold **A**, keep the mouse on the anvil and walk a straight line round it while he watches it. There is no path and nothing to click — a heading, a throttle, and the tile test used as a wall instead of a route. The helmet, sword and shield are lying in the grass again; walk over one to pick it up, and **the bat** is asleep out past the anvil — it hunts you across hexagons you are no longer standing on. Armed, **click** to cut: nothing aims it for you, so back off with **S** and come round it with **A** and **D** and put it in the arc yourself. His gait is not a clip but a function of the direction of travel, and how fast it carries him is read off the pose every frame. |

Labs 02–09 share one rig and one animation system (lab 08 adds a second rig for
the bat), and labs 06–09 share one world; see `labs/shared/` below.

## Documentation

- [The Angband Bible](docs/angband/README.md) — a 21-chapter mechanics
  reference for Angband 4.2.6 derived from its source code: energy and
  speed, combat, magic, resistances, monsters and their AI, objects, dungeon
  generation, traps, stores, scoring, and every gamedata file. Written as
  background reading for the dungeon-crawl side of these experiments.

## Layout

Two halves that share a subject and nothing else. The **labs** are plain HTML
and JavaScript with no build step, opened straight from disk, and they stay
that way. The **packages** are a TypeScript monorepo built with Vite — the
engine, the client and the editor — where the ideas the labs worked out get
built properly.

```
packages/
  shared/       maths, hex coordinates, seeded random — no dependencies at all
  engine/       WebGPU and WebGL2 rendering, camera, frame loop, the scene graph
  scripting/    what game behaviour is written as, and the host that swaps it
  client/       the game itself; the package built for external distribution
    scripts/    the game's behaviour, in no application's module graph: compiled
                on its own and fetched, so a broken one cannot stop a build
  editor/       React and Material UI shell: the client in a viewport, benches
                for one rig, one piece of gear, one generated level and one
                hand-drawn vault, and Monaco over the asset files and the
                scripts
  desktop/      Electron wrapper around the client's build
  editor-desktop/
                Electron wrapper around the editor's build, and the only host
                besides a dev server that can write a file
labs/           one folder per lab, each a standalone page
  shared/       the code the labs are built from
public/assets/   served as themselves by both apps, and copied into both builds
  index.yaml    every entity the game has, in catalogue order
  entities/     the root file per asset: what rig, body, clips and trees belong
                together, and the object it is when it stands in the world —
                props are entities too, with no rig
  systems/      prefabs there is exactly one of, spawned before the cast
  rigs/         bones, tips, blend masks, metrics
  meshes/       hex prisms bound to bones
  clips/        keyframes, pose-major
  trees/        blend trees over animations the entity names
assets/
  audio/        ambience, and the scripts that synthesise it — generators, not
                served files, which is why they are not under public/
docs/
  angband/      Angband's rules, read out of its source as a reference
  assets.md     the asset file format, and what is deliberately still code
  levelgen.md   the level generation stacks, what they measured, what is next
tools/          the landing-page generator and the Pages staging script
```

`assets/audio` holds three generated loops plus the Node scripts that render
them from scratch — no samples, no dependencies:

```
node assets/audio/dungeon-crawl.js
```

## The packages

```
npm install
npm run dev:editor      # the editor: the yard, and the two benches
npm run dev:client      # the client on its own
npm run dev:editor-desktop   # the editor in Electron, which can write files
npm run build           # every package
npm run typecheck       # every package, no output
npm run build:pages     # build, then stage the whole site in dist/pages
npm test                # every test in test/, once
npm run assets          # pack public/assets into dist/assets.json, and check it
npm run test:watch      # and again on every save
```

npm workspaces, so one `npm install` at the root wires the seven packages
together. Every package is `strict` TypeScript against one `tsconfig.base.json`,
and they are joined by project references, so `tsc -b` builds them in
dependency order and typechecking one typechecks what it stands on.

**`@hexdelve/shared`** is the floor: 4x4 matrices, three-component vectors, the
axial hex coordinates the labs already use, a seeded RNG. It touches no GPU, no
DOM and no framework, and it has no dependencies.

**`@hexdelve/engine`** draws. One shape — the unit hexagonal prism, radius 1,
height 1, a vertex on +Z — instanced, with twelve floats per instance for
position, yaw, scale and colour. Two backends implement one `Renderer`
interface, and the interface is the point: nothing above it can tell them
apart. Two things leak through on purpose. `depthRange`, because WebGL clips
depth to [-1, 1] and WebGPU to [0, 1], and a projection built for the wrong one
loses the near half of the scene; and `info`, because a user is entitled to
know which backend they got.

**`@hexdelve/client`** is the game, and the package this is all ultimately for.
Hand it a canvas, get a running world. Its whole dependency list is the engine
and the shared maths — no framework, no bundler runtime, no CDN script — which
is what makes it distributable: `npm run build -w @hexdelve/client` emits an ES
module and a UMD bundle of about 25 kB, engine included.

It is **turn-based**, which is where it and the labs part company. Click a
hexagon and he walks there one hexagon per turn; the bat hunts over the same
grid on the same clock. The labs stay as they were — lab 09 is still the
free-movement experiment, and rewriting it would falsify the record — but the
game itself went back to the grid, and gained a clock made of the energy table
rather than of frames. See *Turns are a table, not a timer* below.

**`@hexdelve/editor`** is React and Material UI around `createClient`. The
renderer toggle is in the toolbar rather than a settings dialog, because two
backends meant to draw the same picture only stay that way if switching is one
click during ordinary work.

It has seven views. The **yard** is the client, in a box: no editor renderer and
no editor scene, so whatever the editor can do to the world an embedder can do
too. The four **benches** are the exception, and say why in their own name — a
bench is one subject, alone, held still, which is exactly what a running world
will not give you. Three of them preview; the vault bench authors, which is why
it is the one with no viewport in it. They have scenes of their own for that reason and no other,
and they build nothing of their own: the skeletons, the bodies, the clips and
the gear all come out of the client, so what reads well on a bench is what the
game draws.

The **assets view** is the odd one out: every other view previews something the
code decided, and that one edits the decision. It lists the YAML under
`public/assets`, shows which IO backend it reached them through and whether that
backend can write, and saves a changed file back through it. See
[docs/assets.md](docs/assets.md).

The **script view** is the newest, and it is that argument one step further:
what it edits is not data but the client's own behaviour — the TypeScript in
`packages/client/scripts`, in Monaco, saved back to the same URLs the hot-reload
watcher reads. It is a language service rather than a text box because a script
is code: the declarations of `@hexdelve/scripting` and everything it stands on
are handed to the editor as though they were installed, so `this.transform.`
completes and a misspelt field is underlined where it is written; the whole
directory is given to the service rather than the open file, because a script
imports its neighbour. Saving compiles through the same call the watcher makes,
so a file that will not build says so with the error on its own line.

Beside the code is a **world** — the client again, the same component the yard
view mounts — and every successful compile is swapped into it with
`host.reload`, which rebuilds each instance behind its id and keeps the
parameters somebody set. So a change to a number takes effect on a creature
that is mid-fight rather than on a fresh one that has forgotten the fight, and
the transport in the toolbar drives it. It reloads on a COMPILE rather than on
a save, which is the useful order — try the change, then keep it — and the
status line says when the world is running edits that are not on disk yet.

**`@hexdelve/editor-desktop`** is that editor in an Electron window, and it
exists for one reason: an editor that cannot write to a disk is a viewer.
Reading is unchanged — the window serves its page from a real `app://` origin,
so `fetch` reaches the files as it does over http — and the difference is that
the two trees the editor authors are served from a PROJECT DIRECTORY rather
than from inside the application, and a bridge in the preload can write to
them. The project is `HEXDELVE_PROJECT`, or the one picked last time, or the
checkout the shell was built in, or asked for; File → Open Project changes it,
and the window title is the directory, because what a person needs to know from
a window that writes to a disk is which disk.

The **character bench** puts a rig on a stand with a clock. Pick a subject, pick
an animation, play it, scrub it, slow it down, ghost the body to see the rig
through it, mark a bone and read where the pose put it. What it is built around
is the smallest thing every animation in this project has in common — a
duration, and a function from a time to a pose. A keyframed clip is one of
those; so is the procedural stride, which has no keys at all; and so is a blend
tree, which is a function of its parameters. Gaining trees did not change the
transport, only what is underneath it.

### Blend trees

`@hexdelve/engine` carries the tree itself, next to the poses and clips it is
made of, because nothing in it knows what a renderer is. Three operations:

| | |
|---|---|
| `blend1d` | the two children bracketing a parameter, weighted by where it falls between their thresholds |
| `additive` | a subtree laid **on top of** another. A sum, because every value here is already a delta from rest, so the same lean composes with every gait instead of being authored once per gait |
| `layer` | a subtree blended in through a per-bone **mask** — how this game carries a shield while walking: the arms hold a stance and the hips go on with the stride |

A leaf is not a clip. It is anything that can answer "the pose at *t*", which
here means a keyframed clip **or** a pose function — half the animation in this
project is a function of an angle and has no keys at all.

The interesting part is not the weighting, it is **phase synchronisation**. Two
cycles of different lengths, run on their own clocks and mixed, put a
character's legs in two places at once, and the average of a foot planting and
a foot lifting is a foot skating. So the synced leaves share one normalised
phase, are stretched onto the weighted blend of their own cycle lengths, and are
each offset by their own contact phase so the footfalls land together. The
bench has a toggle to take that away, and a readout that says what it cost.

Thresholds on the speed axis are metres per second, and they are **measured**
rather than typed: `measureGroundSpeed` asks the pose where the planted foot is
at the two contact keys, which is the same argument the stride's own velocity
rests on and now the same code. So the bench can show the asked-for speed
against the delivered one, and the gap in between two thresholds is the honest
error a calibration pass would remove. A bench should show that, not hide it.

### Calibration, so the slider means what it says

Put a walk at 1.56 m/s and a run at 2.94 on a `blend1d` and both ends are
honest: ask for either and you get exactly it. Everything in between is not,
and it looks like it ought to be.

Halfway along, the tree blends the *stride* and the *cycle length* separately —
the legs land between the two shapes, the cadence lands between the two periods
— and speed is one divided by the other. The quotient of two averages is not
the average of the quotients, so a slider reading 2.25 delivered about 2.14, and
the difference came out of the one place it could: the feet, sliding.

There is no formula for that error; it depends on what the poses do. So
`calibrateSpeed` measures it — sweeps the axis once at startup, asks
`measureGroundSpeed` what each value really produces, and hands back the
inverse. The bench's slider is then in true metres per second all the way
across, and the "asks / carries" readout stops being a confession and starts
being the proof. Turn phase sync off and it goes back to being a confession,
which is the point of leaving it on screen.

The **prop bench** is the catalogue: every piece of gear in the game in one
list, and three ways of looking at the one you pick, which are the three
transforms a prop is ever drawn through. *Stand* is the model as authored,
centred on the pad. *Ground* is its own lift and tilt — how it lies in the
grass. *Worn* hangs it on its bone on a ghosted wanderer, which is the view that
catches mistakes: a prop is modelled around the origin of the bone it belongs
to, so equipping it is a change of parent and nothing else, and the only way to
know the modelling is right is to see it on the man it was measured against.
Alongside those are the numbers. The measured ones are read off the mesh — every
corner of every prism through the transform it is drawn under, so a dimension is
a dimension. The rest are a **mock**: props in this game are meshes and have no
stats at all yet, and the panel says so. It is a form, generated from a table of
field descriptions rather than written out, so adding a stat is one line and
adding an item system later replaces the table and not the panel. Nothing is
saved; edits survive a renderer switch and a walk through the catalogue, and a
reload starts over.

The **level bench** is the third, and the one with no clock at all — which is why
the transport is disabled while it is up rather than left there doing nothing. A
level does not move; it is redrawn when something about it changes. What it is
for is a different problem from the other two: a generator is a function from a
seed to a shape, and the only way to know whether the shape is any good is to
look at a lot of them quickly with the knobs in reach. It draws a `Level` and
knows nothing about how one is made, which is what makes the comparison worth
trusting — two algorithms cannot look different because one of them got nicer
drawing code.

Three stacks are in it so far. The **cave** stack is chamfer's own noise-band
carve, ported down to the hash and the octave order and read on the ground
plane. chamfer's note on that function says the band round a zero set in three
dimensions is a slab, which is why its caves are one wide folded sheet; on a
plane the zero set is a set of curves and the band round one is a ribbon, which
is a corridor — the thing that world works around is the thing this wants.

The **rooms** stack builds a level out of *places*: it scatters room sites,
grows each into a blob of whole hexes with a noise-pushed edge, then decides
which rooms are joined with a minimum spanning tree for the guarantee and a
Gabriel or relative-neighbourhood graph for the loops on top, and digs one-hex
corridors along the result.

The **boxes** stack builds rather than carves. Room sites get a random box each,
the boxes are allowed to overlap, and then a room is not the box it was given —
it is the largest rectangle that actually fits inside it given everything placed
so far, asked twice, which is where the L and cross shapes come from. Rooms are
joined by straight runs between edges that face each other, and any run that
would cross a third room is rejected: that one rule is why the output reads as
rooms with doors rather than as connected space, because a pathfinder that
enters a third room on the way has just merged two rooms into one.

A fourth lived here — a wave function collapse, first tiled and then
overlapping. Both worked; both were removed. A local constraint system has no
way to say anything about a level above the scale of a few cells, so everything
it produced was structure that *happened* rather than structure that was
decided, which is fine for a texture and is not what a dungeon is.

**Vaults** are the part of a level that is deliberate: rooms drawn by hand and
stamped in *before* anything carves, so a carve finds one as terrain it has to
respect rather than something to draw over. One flag carries it — a cell marked
`fixed` is finished, and no stack may write to it and no tunnel may be cut
through it — which is why vaults work in all three stacks without any of them
knowing what a vault is. They are not an Angband file: terrain is a named union
and entities are typed, so adding either is a change the compiler reports rather
than a symbol that silently means nothing. They are drawn in the editor's
**vault bench**, checked against the same rules the placer uses, and copied out
as source — the browser keeps the working copy, the repository keeps the vaults.

Where the stairs go is a setting rather than an accident. Left alone, the exit
is the far end of the floor graph and lands in a vault between 30% and 54% of
the time depending on the stack — a coin flip, which is worse than either rule
because the player cannot learn it. So the exit can be pinned to the back of the
highest-rated vault on the level, or kept out of vaults entirely; both hold over
200 seeds a stack.

**Connectivity is not a property the cave or the rooms carve can state**, so it is not
asked of them. The finish every stack shares runs Prim's algorithm over the
graph of pieces, digging the shortest tunnel it can find from everything joined
so far to anything that is not, until the level is one piece — which it always
is, over 240 levels of both carving stacks. It will not dig through the rim, because a
stitcher free to route round the outside joins the level up by removing the
thing that made it a place. `docs/levelgen.md` has the measurements and what is
worth trying next.

**`@hexdelve/desktop`** opens an Electron window on the client's own web build.
No desktop-only rendering path and no desktop-only game code, so what ships on
the web ships there.

### Assets are files, not modules

Every rig, body, clip and tree in this project was a TypeScript module first.
Adding the hellhound touched five files and not one of them was about a
hellhound: a rig module, a mesh module, a pose module, an export block, and an
entry in the editor's bench. The data was never code — it was only *stored* as
code — and seven entities is where a catalogue starts being worth having and a
compiler stops being the right place to keep one.

So `assets/` holds it, `@hexdelve/engine` reads it, and the entity file is the
root that ties one asset together:

```yaml
id: wanderer
kind: character
rig: ../rigs/humanoid.rig.yaml
mesh: ../meshes/wanderer.mesh.yaml
animations:
  walk: { procedural: stride, args: { amp: 1, gait: 0 }, sync: true }
  guard: ../clips/guard.clip.yaml
blendTrees:
  locomotion: ../trees/locomotion.tree.yaml
```

Blend trees link *animations*, and the entity is what says an animation is. A
tree refers to `walk` and carries no path, so exactly one file names files —
which is why one `locomotion.tree.yaml` drives the wanderer and the ghoul
unchanged. A prop is the same file with less in it: a helmet has a mesh, an
`attach` bone and the two numbers that put it down in the grass, and the loader
*refuses* a rig or an animation on one.

Three things kept the files from being worse than the code they replace. Any
scalar may be arithmetic (`pi / 2 + 0.05`, `cos(mount) * out`, `tau / 1.8`),
because a cheek plate is not tilted by 1.6207963267948965 radians. A mesh keeps
the `for (const side of ['L', 'R'])` loop as a sided group, so sixty readable
parts do not become a hundred and twenty unreadable ones. And a blend
threshold may be `{ speedOf: walk }`, which measures the walk's own feet
exactly as `strideVelocity` did — a tree that stated 1.53 would be wrong the
first time anyone re-tuned the stride.

Half the animation stays code, and that is the right answer rather than a gap:
the stride is a function of one phase angle and a heading, so it covers the
whole circle of directions where a blend space over clips covers four. An
animation may therefore name a registered *pose function* and hand it
arguments — the file carries the tuning, the code carries the curve.

The reader is about four hundred lines in `@hexdelve/shared` with no
dependencies, for the same reason there is a quaternion in that package rather
than gl-matrix. It reads the subset the asset files use and refuses the rest by
name and line number — anchors, tags, a second document, a duplicate key, a tab
used as indentation — because every one of those has a silent mis-reading
available to it.

`test/assets.test.ts` is the part worth keeping: it loads every file and
compares it against the module it replaced, part for part and key for key. Both
statements of what a wanderer is still exist, so they can be checked against
each other, and a mesh that mirrors the wrong axis fails there rather than
being noticed later by somebody looking at a character with one ear.

### One IO model for every host

The files are fetched, which raises the question Electron usually answers
badly. Loaded with `loadFile` its window would be a `file://` document with an
opaque origin, and a relative fetch from one is refused. The usual answer is a
desktop-only read path over IPC — which works, and costs the sentence that the
desktop build is a shell and nothing more, because the client would then carry
a branch only that build takes. So the shell registers a standard, secure
`app://hexdelve/` scheme served out of the client's build instead, and every
URL under it resolves exactly as it does over http. Reading is `fetch`
everywhere, including there.

Writing is where the hosts genuinely differ, so it is a capability rather than
a method — `io.writer` is null when a host cannot write, which makes "this
editor cannot save here" something the type system knows and the UI shows.

| host | reads | writes |
|---|---|---|
| dev server | `fetch` | a `PUT` back to the same URL, into `public/assets` |
| a built page | `fetch` | none — a static page has nowhere to put a file |
| the client's Electron shell | `fetch` over `app://` | none — that shell wraps the client, which authors nothing |
| the editor's Electron shell | `fetch` over `app://` | an IPC call to the main process, into the project directory |
| memory | a map | the same map: a pack, or a test |

The last row is the one exception to "a file has one address", and it is forced
rather than chosen: `app://` is answered by a handler inside the main process,
not by a server, so there is nothing for a PUT to arrive at. What crosses the
bridge is a scope and a name inside it — never a path — so the page can ask for
"the script called `Spin.ts`" and cannot ask for `/etc`, because it does not
know where the scripts are. The main process does, and checks that what it
resolved is still inside the tree it meant.

The editor's **Assets** view is the file list, the file, and a save button. It
edits the actual bytes rather than offering a form, because these documents
carry the comments explaining why a cheek plate sits where it does and a form
would throw all of that away the first time it round-tripped one. What it adds
is validating before writing — a document that could not be read back is never
saved, since turning an unsaved change into a broken asset is strictly worse
than refusing — and invalidating everything derived from what changed, because
a rig's hip height moves every mesh hung on it.

### The switchover, and what stayed

Nothing builds a body, a rig or a clip in TypeScript any more. `models/`,
`game/skeleton.ts`, `game/batrig.ts`, `game/hellhoundrig.ts` and
`game/clips.ts` are gone; the client loads its cast from the manifest at
startup and the benches take their subjects from the same place. Adding a
creature used to touch five files and an export block. It is now a file in
`public/assets/entities` and a line in `index.yaml`.

Three things stayed in code, each a deliberate line. The **pose functions** —
the stride is a function of one phase angle and a heading, which covers the
whole circle of directions where a blend space over clips covers four; the
entity files name them and hand them their tuning. What those functions were
**tuned against** — `stridePose` says `hipL` outright and was solved for a leg
of a given length, so it carries that number rather than being handed a rig,
and the copy is pinned to the rig file by a test. And the **calibration**, since
correcting a speed axis needs the built tree swept and a file can only state
the request.

The guarantee moved with the code. While both statements of what a wanderer is
existed, a test compared them part for part; they agreed, so the modules went.
What guards the files now is the picture: the yard drawn from YAML is
pixel-identical to the reference PNG taken when every character was built in
TypeScript, which covers the rigs, the bodies, the palettes, the clips, the
trees and the way all of them compose, in one number.

`node tools/build-assets.mjs` folds the tree into one JSON — one request
instead of thirty — and, more usefully, **checks it**: every entity is loaded
through the same readers the game uses, so a mesh naming a bone its rig does
not have fails the build rather than the editor. A YAML file has no compiler;
that is the nearest thing it gets. See [docs/assets.md](docs/assets.md).

### Versions

Nothing here is published to npm. Every package is `"private": true`, and the
internal dependencies are `*`:

```json
"dependencies": {
  "@hexdelve/engine": "*",
  "@hexdelve/shared": "*"
}
```

`*` is satisfied by whatever version is in the workspace, so npm symlinks the
local folder — `node_modules/@hexdelve/engine -> ../../packages/engine`, and
`"link": true` in the lockfile — and never asks a registry for anything. The
version fields are then free to mean whatever you want, independently, because
nothing reads them.

A real range would have to be maintained instead of meaning anything. Pin
`"0.1.0"` and bumping one package sends npm to the registry for the old version
of a package that was never published there, so `npm install` dies on a 404
until all seven numbers are edited together; `npm version --workspaces` does not
help, because it bumps the version fields and leaves the sibling specs behind.

`*` is only wrong for a package that gets published, where it would mean "any
version, ever". `"private": true` is what keeps that from being possible —
`npm publish` skips these — and it does not affect the client's distributable
bundle, which Vite builds regardless. If one of these ever should be published,
that is the field to flip, and a real range to add at the same time.

The `workspace:*` protocol would say all this more precisely, but it is a pnpm
and yarn feature: npm answers `EUNSUPPORTEDPROTOCOL` to both `install` and `ci`.

## Tests

`npm test` runs everything in `test/`, under Vitest. Tests import the workspace
packages by name and get their **source**, through the same aliases the client
and the editor build with — so a fresh clone can run them with nothing built,
and a broken build never looks like a broken test.

Two kinds are the exception. The browser-driven ones check a property of the
*built* client, so they load `packages/client/dist-lib` and skip themselves when
it is not there or when there is no browser driver installed. And `devserver`
boots a real Vite dev server on a port the operating system picks, because what
it checks is how the middleware sits together rather than what any one handler
does.

| | |
|---|---|
| `picking` | A screen point has to map back to the ground drawn there. A camera basis derived twice is a sign waiting to be got wrong, and nothing throws when it is — the original bug tracked the cursor correctly sideways and moved the aim a third as far up and down. |
| `blend-tree` | A tree out of phase still produces sensible weights and a valid pose; the only symptom is a character who skates. Pins the thresholds, the calibration, the sync, the additive gain and the mask. |
| `assets` | That the files load to the shapes the game expects, that the loaders refuse what they should, and that the pose functions still agree with the rigs they were tuned against — `stridePose` carries a copy of the humanoid's leg length, and a copy can drift from the file it came from. The part-for-part comparison against the TypeScript modules lived here until those modules were deleted; `render` is what guards the files now. |
| `yaml` | The reader's **refusals**, mostly. A tab used as indentation, an anchor, a tag, a second document, a duplicate key — each has a silent mis-reading available to it, and a parser you wrote yourself is only worth having if it is loud. Also pins that `pi / 2 + 0.05` in a file is the same double as `PI / 2 + 0.05` in TypeScript. |
| `levels` | A generator is a function from a seed to a shape, and looking at six of them says nothing about the seventh. Every property that has to hold for **every** seed, each of which fails silently: a one-way door, a route that steps through a wall, an exit stranded across the map. All of them draw perfectly well. |
| `vaults` | A broken vault is not a crash and not a bad picture — the placer skips anything it complains about, so it is a room that simply never appears, for months, until somebody wonders where the shrine went. |
| `turns` | The one part of this project whose correctness is a claim about arithmetic rather than about a picture — the energy table against Angband's own anchors, the tie-break, and the wall clock. Also drives the real `Simulation` with no canvas and no GPU, which is only possible because the rules and the drawing were kept apart. |
| `largest-rectangle` | Checkable against the truth rather than against a property: the naive answer exists, is definitionally right, and is unusable at the size a level wants. The fast one is checked against it on bitmaps small enough for both. |
| `scene` | The object model's **orderings**: what a transform composes to, which components run before which, and what a teardown fires in what order. `destroy` unparenting a child before its hooks ran was found here on the first run. |
| `prefab` | That a prefab file reads to the tree it describes, that a component type nobody registered is refused by name, and that the entities which actually ship carry what they claim to. |
| `scripting` | The four promises the host makes: an id keeps meaning the same script, a parameter somebody set survives a reload, a file that will not compile does not take the running game down, and a script throwing sixty times a second is muted rather than shouted. Also compiles the real script directory the real way, which is the only place `@on` as syntax is exercised. |
| `combat` | A blow all the way through, on the real simulation: the entity files, the system prefab, the swing, the rule and the hit points. Five pieces have to agree, and none of the tests above would catch a script name misspelt in a YAML file. |
| `devserver` | Boots a real dev server with the real plugins in the real order, because the one bug this has caught was not in a handler but in how two of them sat next to each other: the source route was answering for `/scripts.js`, so `npm run dev` ran with no behaviour in it at all. It also covers what the editor saves through — a PUT and a DELETE for an asset and for a script, each refusing a name that is not one and a path that leads out of its tree — and the declarations the code editor is handed. |
| `shaders` | WebGPU marks a bad pipeline invalid rather than throwing, so a broken shader reaches a browser looking healthy and only fails on the first draw. |
| `render` | None of the above would notice a sign flip that put every shadow on the wrong side of every building, so a picture lives in `test/reference/` and is compared against. |
| `backends` | The two shader sets are written twice on purpose; this is what stops them drifting apart. Needs a working WebGPU device and usually skips for want of one. |

The reference picture is regenerated deliberately, not automatically:

```
npm run build && UPDATE_REFERENCE=1 npm test -- render
```

Look at it before committing it. A reference nobody looked at is a reference
that certifies whatever bug was present when it was made. `WRITE_IMAGES=1`
writes the actual, reference and diff images to `/tmp` on a pass as well as a
failure, which is how you find out *what* moved.

`test/harness/` is the machinery the picture tests share — a Playwright
fixture, just enough PNG, and an image diff that can tell a different
rasteriser from a moved sun. It is plain `.mjs`, and stays that way: nothing in
it gains from being typed and rewriting it would put the one check that guards
every picture at risk to no purpose.

## WebGPU first, WebGL2 always

`createRenderer` prefers WebGPU and falls back to WebGL2. "Prefers" is not a
feature detect: `navigator.gpu` exists in browsers where `requestAdapter` still
answers null, and a device request can fail on a machine that has the API — so
the only honest test is to try, and fall back on any failure. A caller who names
a backend gets that one or an error; only `auto` falls back, and `info.fellBack`
says when it did.

A device can also go away long after it was handed over — a driver reset, a GPU
switch, an adapter that only ever claimed to work. Nothing throws when that
happens; the picture simply stops changing. Both backends watch for it
(`device.lost`, `webglcontextlost`), stop drawing, and report it, because a
frozen frame and a working one look identical.

The two shaders are written twice rather than generated from one source, so a
change to the lighting has to be made in both places and the two pictures
cannot quietly drift apart.

## What is published

`main` deploys to <https://kristoferborgware.github.io/hexdelve/>:

```
/               the landing page, generated from the labs themselves
/labs/          labs 01-09, exactly as they are in the repo
/editor/        the editor
/client/        the standalone client build
```

## The engine boundary

`labs/shared/` is split down the middle on purpose:

| Engine-free — no renderer types at all | Presentation — Three.js lives here |
|---|---|
| `anim.js` — clips, sampling, crossfades, layer masks, events, baking, key reduction, FK, quaternions | `hex.js` — the unit hex prism, instanced fields |
| `blendtree.js` — blend nodes, phase sync, speed calibration | `rigview.js` — builds bone objects, draws the skeleton, applies a pose |
| `ik.js` — analytic two-bone IK, tool chains, foot levelling | |
| `hexgrid.js` — axial coordinates, hex distance, A* | `cabin.js` — the log cabin construction |
| `skeleton.js` — the humanoid rig as plain data | `blacksmith.js` — the smith's prisms, hung on bones |
| `walk.js` — the procedural walk as a pose function | `wanderer.js` — the player character, same bones, no tool |
| `stride.js` — the same walk, with the direction of travel as an argument | |
| `clips.js` — hand-authored clips as plain data | `helmet.js` — a prop: one group, no bones |
| `batrig.js` — a second skeleton, four bones to a wing | `bat.js` — the creature's prisms, spars and membrane |
| `batpose.js` — perch, flap and lunge as pure functions | `world.js` — the yard labs 06–09 all stand in |
| | `props.js` — a thing on the ground, or on a bone |
| | `sword.js` / `shield.js` — gear, built round the bone that holds it |
| | `ui.js` / `ui.css` — the panel and the camera gestures |

Nothing in the left column imports or mentions Three.js. Poses are plain data
(`{ bone: { rot, pos } }`, deltas from rest), so the same clips and the same
player would drive a canvas2d stick figure or a server-side simulation. Three
is asked for exactly one thing: draw the meshes where the pose says.

## Why plain scripts and not ES modules

Each lab loads `../shared/*.js` with ordinary `<script>` tags, and each file
attaches itself to a `Hexdelve` namespace. That is deliberate: `<script type="module">`
cannot be used from a `file://` URL, because every `file:` URL is treated as its
own opaque origin and each `import` is refused as cross-origin. Plain scripts
mean a lab can be opened by double-clicking it, with no build step and no server.

They are also all online at <https://kristoferborgware.github.io/hexdelve/>, so
there is nothing to clone if you only want to look.

Serving the folder works too, if you prefer it:

```
npx http-server -p 5188 -c-1 .
```

Each lab also reads its initial state from the query string, which is handy for
sharing a particular view — e.g.
`labs/04-blend-tree/index.html?speed=1.4&drive=0&skel=1`.

## The grid is for navigation, not for reach

Neighbouring tile centres are √3 ≈ 1.73 m apart; his arm plus the haft spans
about 1 m from the shoulder. A character locked to tile centres therefore
swings at nothing. Lab 06 keeps pathfinding on the grid but gives the
interaction its own free-space stance, derived by playing the strike to its
impact key and asking where the hammer head ends up — so the spot he steps to
is a property of the animation, not a tuned constant, and re-timing the swing
moves it automatically.

The client cannot borrow that answer, and the reason is worth stating: it is
turn-based, so the hexagon *is* the position, and a fighter standing halfway
between two of them is not on the board. So the difference comes out of the
body instead. The sword's reach is measured off the clip as before — 1.49 m
across 115° of his front — and the shortfall against the grid, 24 cm, goes in
as root translation along his facing, out and back across the blow. He leans
into it and never leaves his hexagon. The bat does the same with 17 cm, since
its lunge measures 1.56 m.

Both numbers are measured, so `REACH.distance + LEAN_IN` is exactly the hex
spacing by construction rather than by coincidence, and `turns.test.ts` asserts
it — re-time either attack and the two halves move together.

## Turns are a table, not a timer

Every lab in this project runs on real time: a frame arrives, everything gets a
slice of it, and how far anything moves is its speed times that slice. That is
the only clock a game needs right up until two creatures have to take turns,
and then it is the wrong one — because "twice as fast" has to mean "acts twice
as often", not "slides twice as far per frame".

So the client keeps Angband's clock instead, from
[the energy chapter](docs/angband/02-time-energy-speed.md): a game-turn
counter, and every game turn each creature gains energy at a rate set by its
speed, acting when its reservoir reaches 100 and paying 100 to do it. Speed is
a **rate**, not a turn order. The bat is +10, which in `extract_energy` is
exactly 20 against a man's 10, and it takes two hexagons for every one of yours
because of that row and nothing else. Three tuned constants went with it:

| lab 08–09 | the client |
|---|---|
| a cruise speed in m/s | one row of the energy table |
| a bite cooldown in seconds | the 100 energy a bite costs, like anything else |
| a waypoint advance radius | nothing — a step is one hexagon, so there is no line between waypoints to be circled |

That last one is the interesting deletion. Lab 09 needed a keep-apart radius
because A\* would not route the bat *through* the man's hexagon, but the flight
between two corners of the path went clean through him anyway. On a turn clock
there is no between: a move ends on a cell or does not happen, one creature is
ever mid-action, and two cannot occupy one cell. The whole class of problem is
gone, and so is the constant that patched it.

### The world waits for you

One getter does that — `player.hasOrders`. The simulation hands out turns only
while nobody is mid-action *and* the man has asked for something, so with no
order standing nothing gains energy, the bat is frozen mid-hunt with its wings
out, and the yard holds still until you decide. It is a question about his
orders rather than a pause flag, so there is no state to get out of step with
what he is actually doing. `turns.test.ts` runs four seconds of frames and
asserts the game-turn counter is still zero.

The wings still beat, though, and the smoke still rises. Those run on the wall
clock, because a world that stops *drawing* between turns looks broken rather
than patient.

### The energy table becomes a gait

A turn has no length, but a step has to be watched, and how long it takes on
screen cannot be a number somebody liked the feel of — then a creature's speed
and the speed it appears to move at would be two unrelated facts, and the
readout would be lying about the fight. So one game turn is given a length, and
it is taken from the walk: a normal-speed step is ten game turns, and those ten
turns are set to exactly as long as his legs take to walk 1.73 m. Everything
else falls out. The bat's step is five game turns, so it crosses a hexagon in
half the time, and it looks twice as fast because it is.

Which leaves the calibration running backwards from lab 09. There the pose was
asked how fast a throttle and a gait were worth; here the speed is not his to
choose — one action is one hexagon in a time the table fixes — so what has to
be solved for is the walk that covers exactly that ground. `strideFor` bisects
one monotone line: below a walk it shortens the stride, above one it blends
towards the run, because that is what anybody does. You do not walk to the
shops in slow motion, you take smaller steps.

At normal speed it solves to `gait 0, amp 1` — a plain full-length walk, zero
foot slip, which is the honest answer and also the reassuring one. Its point is
what happens when the table changes: open the client with `?speed=120` and he
must cover a hexagon in half the time, so the solver puts him into a run. A row
of `extract_energy` is visible as a gait, and nothing tabulated the connection.

## One rig, two characters, and a prop

`blacksmith.js` and `wanderer.js` are the same exercise twice: forty-odd hex
prisms parented to the seventeen bones of `skeleton.js`. Nothing about a clip,
the blend tree or the IK knows which of them it is driving — lab 07 runs both
at once through one `makeActor`, one pose buffer each, and the same solver.

`helmet.js` is the other case: a prop has no bones, so it is one group modelled
around the *head bone's origin*. Worn, its transform is the identity; on the
ground it is the same group lifted by `GROUND_LIFT`. Picking it up is therefore
a re-parent and nothing else — no second model, no offsets to keep in step, and
every clip carries it for free.

## A rig is a list, which is why the bat cost nothing

`batrig.js` is twenty bones in the same shape of data as the humanoid — a name,
a parent, an offset — and that was the whole integration. `buildRig` wires it,
`buildSkeletonView` draws it, `solveWorld` measures it, A* moves it. Nothing
downstream had ever asked what shape the animal was, so nothing downstream
changed.

What is different is the anatomy. Its arms *are* its wings, running out along
±X instead of down; the three folds outboard of each shoulder are what let two
and a half metres of wing collapse small enough to sit on one hexagon, which is
the perch pose. Each membrane patch is parented to the bone it hangs from, so
folding the bones folds the wing — there is no cloth simulation anywhere.

The flap is four bones beating a fixed slice of the cycle apart. Beat them in
phase and you get an oar; beat them a beat apart and the stroke travels out
along the wing as a wave, which is the difference between a bat and a doorway.

And the bite is lab 06's measurement on a different animal: play the lunge to
the moment the jaws arrive, ask where they end up, and stand so that point
lands on the man. Re-time the strike and the stance follows.

## Gear is the same trick as the helmet

A prop has no bones. It is one group, and equipping it is which node that group
hangs from — the scene, or a bone. So each is modelled around the origin of the
bone it belongs to: the helmet around the head, the sword around the fist, the
shield around the forearm. Worn, its transform is the identity. There is no
second model for the held version, no offsets to keep in step, and every clip
carries it afterwards without knowing it exists.

`props.js` is the forty lines that hold the other half — where it rests on the
ground, and how it lies there, since a helmet stands up and a sword does not.

The cut is `SLASH`, and it is a cut rather than a thrust because of where the
blade travels, not how fast the arm moves. Poking is what happens when the arm
extends along the line the blade already points down — so it never does that.
The sword is drawn across the body first, inside the shield, and the strike
sweeps it back out to his right with the edge leading; the point is not aimed at
anything at any moment. The hips and spine turn first and drag the arm round
after them, the elbow extends through contact so the speed is at the tip rather
than the fist, and the shield arm is thrown back and straight — both the
counterweight and the only reason the shoulders can come round that fast.
Between the wind-up and contact the chest travels about ninety degrees.

The arm holding it is worth a note, because the first version of this got it
wrong in a way that is easy to get wrong. The blade is modelled down the line of
the hand, so to raise it you can either fold the elbow until the hand is at the
shoulder, or carry the hand up with the shoulder and set the blade's angle at
the *wrist*. The rig has a wrist — `armR → forearmR → handR`, the hand bone is
it — and the first pass used none of it: 143° of elbow flexion, which is the
human limit, and zero wrist pitch in every key. It now sits at 115° of elbow and
57° of wrist, both well inside range, and the wrist is cocked at the wind-up and
unloads through contact, which is where the last of the tip speed comes from.

`GUARD` is the other half: armed, he stands and walks on guard, and that pose is
laid over the locomotion through the `UPPER_BODY` mask in `skeleton.js` — so the
stance belongs to his arms and the gait still belongs to his hips. Unmasked it
would freeze him to the spot, which is what that mask was written for.

Reach is not a tuned constant, and neither is the arc. Asking the pose one
question at the contact key turned out not to be enough — a cut sweeps. The
blade is sampled right through the strike instead, and what comes back is how
far it reaches and between which bearings it passes: 1.49 m across 115° of his
front, with the follow-through behind his shoulder discarded, since a sword
finishing its arc back there is not cutting anything he is fighting. That is
also what lets him square up to what he is fighting rather than standing
side-on to aim the arc at it.

## Facing and travel come apart

Everything up to lab 08 walked where it was looking. That is one number, and it
is why a single forward cycle was enough for all of them: the blend tree picks a
speed, the path picks a heading, and the heading is also the face.

Lab 09 hands the facing to the mouse and the travel to `WASD`, and they are now
two numbers that need not agree — backing away from something while watching it,
or side-stepping round it. No clip in `clips.js` says anything about that. The
usual answer is three more clips (back, left, right) and a blend space over
them, and it is not the answer here, because the walk was never a clip: it is a
function of one phase angle, so the direction of travel is simply another
argument to it. `stride.js` is `walk.js` with that argument added — the stride
turns, and one cycle covers the whole circle of headings.

What the stride will not do is turn evenly, and that is the interesting part. A
leg swinging forward has the whole world in front of it; a leg swinging sideways
has the other leg. So the step is written in metres of foot travel rather than in
joint angles — 0.36 m down the line of the body, 0.26 m backwards, 0.15 m across
it — and a heading is asked for the radius of that ellipse in its own direction.
A side-step therefore comes out at about half a walk. Nobody typed that in; it is
the room the other leg leaves, and widening the stance (which is what anybody
does to shuffle) is what keeps the ankles from passing inside a boot's width of
each other on the diagonals.

The pelvis then opens up to 35° towards where he is going and the spine and chest
take exactly that much back out, so his shoulders stay square to the mouse while
his legs take their own heading. That is lab 08's upper-body mask argued the
other way round: there the arms held a stance while the hips walked; here the
hips take a heading while the chest holds the aim. It is also worth speed, since
it converts part of a side-step into the swing that has room to be long.

How fast any of it carries him is measured, not tuned — every frame, from the
pose itself. The planted foot is asked where it is at the two contact keys, and
whatever ground it covers between them, the body covers the other way in half a
stride pair. Two solves of a seventeen-bone rig, and the feet do not slide at any
bearing or any throttle.

The keyboard itself ends up read in two frames, which is worth saying out loud.
`W` and `S` are his — they are a heading in his own frame, and swinging the mouse
curves him round. `A` and `D` are the screen's — left is left on the monitor
whatever he is facing — because a key that never turns should not mean something
different every time you press it, and circling a thing while watching it is the
move this lab exists for. The cost is that the two axes can cancel: point him
down the screen's own left-right line and `W` and `A` pull opposite ways on it.
The `Screen strafe` toggle puts all four keys back on his hips for anyone who
would rather have that.

That whole argument is a lab result, and it is worth being clear that the game
did not keep it. The client went back to the grid, where he walks where he
faces and the two numbers are one again — so `stride.ts` there is asked for one
direction, forward, and the machinery that turned it is left standing for
whatever wants it next. What the client took instead was the measurement: how
fast a stride carries him, read off the pose, which is the part the turn clock
is built on.

The bat came across from lab 08 whole, and that is the other half of the point.
It still paths over the hexagons, still bites from whichever one it is standing
on, still wakes at three tiles and loses you at six — while the man it is hunting
is no longer on that grid at all. The only line in it that ever noticed is the
one asking which cell he is in, and that was never the same thing as "the tile he
is walking to". What did change is your half of the fight: in lab 08 the
pathfinder walked you into range and held you facing it, and here nothing aims
for you. The blade's reach and the bearings its arc sweeps between are still
measured off the clip — 1.49 m across 115° of his front — so a cut thrown at
where the thing *was* misses, and backing off on **S** while keeping it under the
mouse is a real thing to do rather than a demonstration.

## Every lab works on a phone

The labs share a camera model — `view = { azimuth, target, zoom, zoomGoal }` —
and each used to carry its own copy of the pointer handling that drives it.
That was survivable while the only input was a mouse. Touch is what made it
untenable: a phone has no right button, no wheel and no hover, so the same
three gestures have to be built out of one finger and two, and doing that seven
times over is how six of them drift apart.

So `ui.js` owns the shell. One finger orbits, or taps; a second finger is the
phone's right button and wheel at once — pinch to zoom, drag to pan — and it
cancels whatever the first finger was doing, so a pinch is never also a tap.
Each lab passes in only what is its own: the zoom limits, whether the camera is
fenced in, what a tap means, what the pointer is over. Lab 09 is the one that
wants the finger for itself — `WASD` and a mouse do not exist on a phone, so one
finger is a thumbstick there and the camera makes do with the second one.

`ui.css` carries the other half. The notes panel is a disclosure, collapsed on
load (`?panel=1` opens it), because on a phone it would otherwise cover the
scene it describes; the canvas takes `touch-action: none`, since it handles its
own gestures; and dragging to orbit no longer starts a text selection. The
orthographic frustum is sized from the viewport height, so in portrait the
opening zoom follows the aspect ratio down rather than framing two hexagons.

## Known limits

Labs 02–04 play joint angles only, so contact there is as accurate as the
numbers in the clip and no more: feet slide, and the hammer lands where the
authored angles put it. Lab 05 fixes contact with IK, but only for two-bone
chains — the spine is never involved, so an anvil below about 0.9 m is simply
out of the arm's reach and the solver says so instead of bending him over it.
Reaching further would need the spine in the chain (full-body IK).

Labs 03–08 take their locomotion speed from `measureGroundSpeed`, which finds the
contact interval by watching the feet drop. On this rig it under-reports: at the
end of a swing the knee is nearly straight, so the foot is already inside the
contact band while it is still travelling forwards, and that stretch cancels part
of the stance it is averaged with. The walk measures 0.62 m/s that way and 1.58
m/s between its two contact keys, which is what the stride is actually worth — so
the men in those labs travel at about two fifths of what their legs are doing,
and their feet slide the rest of it.
Lab 09 measures the second way and travels at the speed its stride makes, which
is why the same character is quicker there. The older labs are left as they are:
changing the measurement would move every speed in six of them.

The packages only ever measure the second way. `measureGroundSpeed` in
`@hexdelve/engine` shares the labs' name and none of its method: it is given the
contact schedule rather than hunting for contact by height, which is what the
stride's own velocity has always done and now the only copy of that argument.
Blend-tree thresholds are read off it, so a threshold in the editor's bench is a
real metre per second.

The turn clock has two limits of its own, and both are the honest kind — the
code reports them rather than hiding them.

A hasted man outruns his own legs. A full run measures 2.94 m/s, and a hexagon
in half a normal step is 3.12 m/s, so anything above about +9 in the energy
table asks for ground the rig has not got. `strideFor` returns the shortfall as
`slip` instead of pretending, and the readout shows it in cm/s — so `?speed=120`
is a real demonstration of a run with 18 cm/s of foot slide, not a clean one.
Above +9 the honest fix is a longer stride or a third gait, not a faster cycle.

And melee on a grid always connects. Adjacency is the whole of reach, nothing
moves while anything is mid-action, and there is no to-hit roll yet — so a cut
at an occupied neighbouring hexagon lands, every time. Lab 09's whiff, where a
blade thrown at where the bat *was* cut air, is gone on purpose: aiming stopped
being the player's job when the grid came back. What is counted as a miss is the
one case left, a blow at a hexagon that turns out to be empty. Hit points, to-hit
rolls and damage are the next thing this wants, and the energy chapter's melee
section is already the plan for them.
