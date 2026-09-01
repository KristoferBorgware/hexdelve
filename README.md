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

Labs 02–07 share one rig and one animation system, labs 01 and 06–07 share one
cabin, and labs 06–07 share a world; see `labs/shared/` below.

## Layout

```
labs/           one folder per lab, each a standalone page
  shared/       the code the labs are built from
assets/
  audio/        ambience, and the scripts that synthesise it
```

`assets/audio` holds three generated loops plus the Node scripts that render
them from scratch — no samples, no dependencies:

```
node assets/audio/dungeon-crawl.js
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
| `clips.js` — hand-authored clips as plain data | `helmet.js` — a prop: one group, no bones |
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
fenced in, what a tap means, what the pointer is over.

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
