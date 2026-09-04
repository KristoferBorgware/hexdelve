# Findings

Things noticed while doing other work, that are not what was being built and are
not being fixed right now. Written down so they are not lost and not
rediscovered.

[`HOW-TO-WRITE-FINDINGS.md`](HOW-TO-WRITE-FINDINGS.md) says what belongs here
and how to write one. The open list stays in the order things were found.

---

## Open

### F-001 — The hellhound's trot carries it backwards

**Kind:** bug
**Milestone:** game
**Priority:** medium
**Effort:** small
**Found:** 2026-09-03, working out which contact schedule the hound's asset files should declare
**Where:** `leg()` in `packages/client/src/game/hellhoundpose.ts`

**What happens.** `leg()` writes the thigh swing as
`setSparse(out, bones[0], [swing, 0, stance])` where
`swing = swingAmp * amp * Math.sin(phase)`. The humanoid's `stridePose` writes
the same joint as `hipLx = -swing * sinT`, with a minus sign. Under the shared
convention — a limb hanging down `-Y` swings forward for `rot.x < 0` — the
hound's planted leg is at its rearmost at the phase where the knee is straight,
so the planted paw travels forward through the body's frame and the body
travels backwards.

Measured with the engine's own `measureGroundSpeed`, reading the back pair
(`backPawR` lands at phase 0.25, `backPawL` at 0.75, because `runPose` gives
`backL` the phase `theta + PI`):

> **[measured]** humanoid walk **+1.5580 m/s**; hellhound run **−2.1019 m/s**.

**Why it matters.** Nobody yet: the hound has no blend tree and nothing measures
its speed, because this was found before its asset files were written and they
were left without a contact schedule for exactly this reason. It matters the
moment the hound is given a gait axis, because a threshold measured through the
wrong sign is worse than an absent one. It is also visible now if anyone looks:
the animal moonwalks.

**What would fix it.** Negate `swing` in `leg()`, or state in the comment that
this rig's convention is inverted and mean it. The comment currently claims the
shape is "the humanoid's own ... carried over unchanged", which is what makes
this look like a transcription slip rather than a decision. Once the two agree,
`hellhound.entity.yaml` can declare `contacts: [0.25, 0.75]` on its `run`, the
rig's `feet: [backPawR, backPawL]` starts meaning something, and the hound can
have a blend tree in `public/assets/trees/` the way the bat does.


### F-002 — WebGPU loses its device in the editor under software rasterisation

**Kind:** risk
**Milestone:** unscheduled
**Priority:** low
**Effort:** medium
**Found:** 2026-09-04, checking the character bench after the asset switchover
**Where:** `packages/engine/src/renderer/webgpu/WebGPURenderer.ts`, `packages/editor/src/components/BenchViewport.tsx`

**What happens.** Opening the character bench in a headless Chromium driven with
`--use-angle=swiftshader --use-vulkan=swiftshader` puts the viewport into its
device-lost state within a few seconds: *"The renderer stopped. unknown: A valid
external Instance reference no longer exists."* The panels are fine — the bench
reports 62 prisms and 17 bones, so the subject built correctly — and switching
the toolbar to WebGL2 draws the character immediately. It happens on a single
view with no tab switching, so it is not the teardown path between benches.

**Why it matters.** Probably nobody: this is a software Vulkan stack in a
container, and the message names an ANGLE/SwiftShader instance rather than
anything the renderer allocates. It matters if it turns out to happen on real
hardware, because the bench is where a rig is looked at and losing the device
mid-session is the one failure the editor cannot hide. It also means every
screenshot check of the benches has to force WebGL2, which quietly stops the
WebGPU path from being looked at.

**What would fix it.** First, find out whether it reproduces on a machine with a
real GPU — that decides whether there is anything here at all. If it does, the
device-lost callback already stops the loop, so the work is recovery: dispose
and rebuild on a fresh canvas rather than showing a dead viewport with a
message. If it does not, the finding closes as an artefact of the container and
`HOW-TO-TAKE-A-FRAME`-style guidance should say to force WebGL2 when driving the
editor headlessly.


### F-003 — The prop catalogue nests a list item inside a list item

**Kind:** bug
**Milestone:** unscheduled
**Priority:** low
**Effort:** small
**Found:** 2026-09-04, reading the browser console while checking the benches load from the manifest
**Where:** `PropCatalogue` in `packages/editor/src/components/PropCatalogue.tsx`

**What happens.** Each catalogue group is a `<Box component="li">` wrapping a
`<ListSubheader>`, and MUI renders `ListSubheader` as an `<li>` too. React logs
`In HTML, <li> cannot be a descendant of <li>. This will cause a hydration
error.` once per group, every time the props bench is opened.

**Why it matters.** Nothing is drawn wrong and the editor is not server-rendered,
so the hydration warning cannot bite. It matters because it is noise in the one
console anybody watches while working on the editor, and a console with a
standing error in it is a console people stop reading.

**What would fix it.** Give the wrapper `component="li"` and the subheader
`component="div"` — `ListSubheader` takes a `component` prop for exactly this —
or drop the wrapper and let the subheader be the list item it already is.


### F-004 — The README's test table describes a test that no longer exists

**Kind:** cleanup
**Milestone:** now
**Priority:** low
**Effort:** small
**Found:** 2026-09-03, adding the asset and yaml rows to the same table
**Where:** the `## Tests` table in `README.md`

**What happens.** The table has a `tiles` row describing "every mistake
available in a WFC tileset". The WFC stack was dropped in `2963f80` and there is
no `test/tiles.test.ts`; what `test/` actually holds in its place is
`vaults.test.ts`, `levels.test.ts` and `largest-rectangle.test.ts`, none of
which the table mentions.

**Why it matters.** The table is how somebody decides which test to run and what
it would catch. A row for a test that cannot be run wastes the reader once; the
three real tests it omits are missed every time.

**What would fix it.** Replace the `tiles` row with rows for `vaults`, `levels`
and `largest-rectangle`, each saying what it would catch rather than what it
covers. Whoever wrote those tests knows the answer; reading them to guess it is
most of the effort.


### F-005 — Two directories are called `assets` and only one of them is served

**Kind:** cleanup
**Milestone:** unscheduled
**Priority:** low
**Effort:** small
**Found:** 2026-09-03, moving the game's asset files under `public/`
**Where:** `assets/audio/`, `public/assets/`

**What happens.** `public/assets/` holds the rigs, meshes, clips and trees, is
served by both apps at `/assets/` and is copied into both builds. `assets/` at
the repository root now holds only `audio/`, which is a directory of Node
scripts that synthesise `.wav` files and is served by nothing. The two are told
apart by their path and by nothing else.

**Why it matters.** Nobody has been caught by it yet. It costs whoever is caught
first about an hour, because both are plausible homes for a new asset and the
wrong guess produces a file that loads locally and 404s in the build — or does
not load at all and looks like a parser bug.

**What would fix it.** Move the audio generators to `tools/audio/`, which is what
`tools/` is for and what they are: they are run by hand to produce files that
are `.gitignore`d. It is nine files, one line in the README's layout tree and
one in the `.gitignore` comment, and nothing imports them. The alternative —
renaming `public/assets` — is worse, because `/assets/rigs/humanoid.rig.yaml` is
an address that appears inside the asset files themselves.

### F-006 — Picking something up is still two drawing paths, not a re-parent

**Kind:** cleanup
**Milestone:** scripting
**Priority:** medium
**Effort:** medium
**Found:** 2026-09-04, spawning the gear from its own prefabs
**Where:** `Item.emit` in `packages/client/src/game/items.ts`, `Simulation.emit`

**What happens.** An `Item` carries a `worn` flag and two ways of drawing
itself. Worn, it emits through the wearer's `WorldPose` with the actor's
position and yaw passed in; on the ground, it emits through one transform of
its own built from a lift and a tilt. `Simulation.emit` picks between them by
asking each item which it is.

Both paths predate the object model. The item is now a component on a game
object that has a transform and can have a parent, so being carried is
expressible as what it actually is: the object moves under the hand's, and one
drawing path serves both.

**Why it matters.** Nothing is drawn wrong today. It matters because the second
path is the reason a prop cannot be carried by anything except the one rig it
was authored against — `emit` takes a pose and a bone name, so a helmet on a
hellhound would need a `head` bone by that name and nothing checks. It also
means an object's transform is not the truth about where a worn prop is, which
is exactly the thing the object model was introduced to stop.

**What would fix it.** A component that writes its object's local transform
each frame from a named bone of the nearest actor above it — the shape the
prefab reader's comment already describes and deliberately did not build.
Equipping then becomes `hand.add(sword)`, dropping becomes `scene.root.add`,
and `Item.emit` collapses to `model.emitDetached` through `object.world`. The
ordering is the awkward part rather than the code: the bone follow has to run
after the actor has solved its pose and before the scene solves, and today the
simulation drives those two by hand.

### F-008 — The case against decorators is written more broadly than it holds

**Kind:** bug
**Milestone:** scripting
**Priority:** medium
**Effort:** small
**Found:** 2026-09-04, explaining the difference between legacy and standard decorators
**Where:** `packages/scripting/src/parameters.ts`, the "Why this is not a decorator" header; the same paragraph in `docs/assets.md`

**What happens.** The header says legacy decorators want
`useDefineForClassFields: false`, and gives that as the first of three reasons
the script format does not use them. It is stated as a property of legacy
decorators. It is a property of legacy decorators **on fields**.

A field declaration under ES2022 semantics is a `defineProperty` on the
instance, so an accessor a decorator installed on the prototype is shadowed and
never runs. A method lives on the prototype and has no such quarrel. Compiling
`@on('damage') hurt(n) {}` with esbuild and `useDefineForClassFields: true`
left the sibling field `hp = 10` an ordinary class field and emitted
`__decorateClass([on("damage")], Health.prototype, "hurt", 1)`, which is
correct.

**Why it matters.** The paragraph is the repository's own record of a design
decision, and it is the thing a reader will consult before considering
decorators again. As written it closes a road that is open. Event handlers are
the case it closes: `@on(Damage) takeDamage(payload)` is metadata about a
method, it needs no field semantics changed, and the alternative — subscribing
in `onLoad` and unsubscribing in `onDestroy` — puts every handler in two places
and makes hot-reload symmetry a discipline rather than a property. That is the
work phase 4 is about to do, so the paragraph will be read at exactly the wrong
moment.

Nothing is broken today. Nobody has written a decorator, and `param()` is still
the right answer for fields, where the objection does hold and where a legacy
decorator cannot see the initialiser it would need.

**What would fix it.** Split the paragraph. Say that the field objection is
about fields, and that method decorators are unaffected by
`useDefineForClassFields`. The second objection stands whichever kind is used:
vitest does not pass `oxc.transform.decorator.legacy` through to its own
transform, so a decorated script would compile in the client and fail in the
tests. Two ways out of that one, both unverified: a Vite plugin at
`enforce: 'pre'` that transforms `packages/client/src/scripts/**` with
`esbuild-wasm`, which is already a development dependency and does accept
`experimentalDecorators` through `tsconfigRaw`; or the build step in F-007,
which takes the scripts out of the oxc graph altogether and would settle this
as a side effect. The third objection — repeating the option in the editor's
compiler — is one line of `tsconfigRaw` in `packages/editor/src/scripts/compiler.ts`.

---

## Closed

### F-007 — A script with a syntax error stops the editor from booting

**Kind:** risk
**Milestone:** scripting
**Priority:** medium
**Effort:** medium
**Found:** 2026-09-04, checking that a broken script does not take the running game down with it
**Where:** `packages/client/src/scripts/`, `Simulation`'s import of `scripts/index.ts`, `packages/editor/src/scripts/reload.ts`
**Closed:** 2026-09-04, fixed — the scripts are compiled by
`tools/build-scripts.mjs` and fetched, and no application imports them

**What happens.** The hot-reload path handles a broken script exactly as
intended: the compile fails, the previous scripts keep running, the yard carries
on, and the inspector says what went wrong and that it is running the older
code. That much was checked in a browser with a real parse error.

Vite then complains as well, because the same file is in the client's module
graph — `Simulation` imports `scripts/index.ts` for its default provider, so
oxc transforms every script whether or not the editor is compiling them
separately. Its error overlay covers the page. That is noise while a session is
already running, since the module it needs is already loaded.

It is not noise across a refresh. A page load with a broken script in the
directory cannot transform the client at all, so the editor does not start —
and the one thing somebody is likely to do when an overlay appears is reload.

**Why it matters.** The whole argument for hot reload is that a half-typed file
does not cost you the running world. It holds until the moment the tab is
refreshed, and then a syntax error in one script is a blank editor with a stack
trace, which is a worse failure than the one this replaced. It also makes the
system's real behaviour hard to demonstrate, because the correct handling is
underneath an overlay that says the opposite.

**What would fix it.** Take the scripts out of the client's build graph. The
static table exists so a shipped client does not need a compiler, and it does
not have to be a hand-written module the bundler follows: a build step could
compile `src/scripts/*.ts` into one artefact the client loads the way it loads
a packed asset, which is the same shape `tools/build-assets.mjs` already has.
The client would then carry its scripts without importing them, a broken script
would fail that build step by name, and nothing about a page load would depend
on every script parsing. This is the work already sketched as compiling scripts
during the client build, and this finding is the reason to do it sooner.

A narrower fix that is not recommended: `server.hmr.overlay: false` in the
editor's Vite config hides the overlay and changes nothing about the refresh.

