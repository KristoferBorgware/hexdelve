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

### F-010 — A creature that has fallen is still drawn standing

**Kind:** gap
**Milestone:** game
**Priority:** medium
**Effort:** medium
**Found:** 2026-09-04, closing the combat loop and finding a dead bat still biting
**Where:** the `Died` listener in `Simulation.listen`, `packages/client/src/game/bathunt.ts`

**What happens.** A character that runs out of hit points announces `Died`, and
the game takes it out of the turn order. That is the whole of what death does.
The body stays where it fell, hovering, in whatever pose the last frame left
it — the bat goes on flapping on the spot, because flapping is what its idle
looks like and nothing told it to stop.

Taking it out of the schedule was added in the same turn that found the
problem, because a dead bat that went on biting was not a shippable state. What
was NOT added is any of the rest.

**Why it matters.** It reads as a bug rather than as a body. A creature that
has been killed and looks exactly like a creature that has not is worse than no
death animation at all, because the player cannot tell whether the blow worked
— which is the one thing a fight has to communicate.

It is also the first thing anyone will notice. The combat chain is otherwise
finished end to end, so this is what stands between the yard and a fight that
reads properly.

**What would fix it.** A death is an animation, so it belongs where the other
animations are rather than in a rule. The shape that fits what is already here:
`Character` announces `Died`, and the actor's own behaviour takes it as the cue
to play a fall — a clip for the bat, a crumple for a man — and then to stop
drawing itself, or to leave a settled pose on the ground. `BatHunt` already has
a `reel` action that interrupts what it was doing, so the mechanism for "stop
and play this instead" exists and would be followed rather than invented.

The rules half is already done and should stay done: what a death COSTS is the
script's, and what it LOOKS like is the client's.

### F-011 — The dev server hands out the repository, not only the asset tree

**Kind:** risk
**Milestone:** unscheduled
**Priority:** low
**Effort:** small
**Found:** 2026-09-04, writing the dev-server tests and checking that a path cannot escape the asset directory
**Where:** `packages/client/vite.config.ts` and `packages/editor/vite.config.ts`, neither of which sets `server.fs`

**What happens.** The plugin's own guards hold. `/scripts/..%2f..%2fpackage.json`
and `/assets/..%2f..%2fpackage.json` are both declined, and the escape is
checked on what a path resolves to rather than on how it is spelt, so the
percent-encoded spellings are refused along with the plain ones.

What answers instead is Vite. `GET /package.json` returns the file, because a
Vite dev server serves what is under its root and the root here is the whole
repository. Anything a `fetch` normalises before sending — `../../package.json`
among them — arrives as a plain path and never reaches the plugin at all.

This is documented Vite behaviour rather than a hole in anything written here.
`server.fs.deny` covers `.env`, `.env.*`, `*.{crt,pem}` and `**/.git/**` by
default, and nothing else.

**Why it matters.** Nobody today. A dev server is bound to localhost unless
somebody passes `--host`, and the plugin's own header already says that is one
flag away — the day somebody demos the editor off a laptop on a conference
network, the asset tree is guarded and the source tree is not. There is nothing
secret in this repository, so the cost is currently zero and the shape is what
is worth recording: two different guards, one of them the plugin's and the
strict one, the other Vite's and the permissive one.

**What would fix it.** `server.fs.allow` in both configs, set to the directories
the apps actually read — `public`, the packages they build from, and
`node_modules`. Half an hour, and worth doing at the same moment somebody first
wants `--host`, since that is when it stops being theoretical. A `server.fs.deny`
list is the weaker alternative and would have to be guessed at rather than
derived.


### F-012 — The client uses `@hexdelve/scripting` without declaring that it does

**Kind:** risk
**Milestone:** scripting
**Priority:** medium
**Effort:** small
**Found:** 2026-09-04, adding a desktop shell for the editor and reading every package manifest to see which ones name each other
**Where:** `packages/client/package.json`, `packages/client/tsconfig.json`

**What happens.** Seven files under `packages/client/src` import
`@hexdelve/scripting` — `simulation.ts`, `components.ts`, `scripts.ts`,
`player.ts`, `bathunt.ts`, `events.ts` and `HexdelveClient.ts`. The client's
manifest lists two dependencies, `@hexdelve/engine` and `@hexdelve/shared`, and
its `tsconfig.json` references the same two. Neither names the scripting
package.

It works anyway, for two reasons that are both accidents of the layout. npm
hoists every workspace package into the root `node_modules`, so the import
resolves whether or not it was asked for; and the root's `build:libs` script
happens to list scripting before client, so its declarations are on disk by the
time `tsc` wants them.

**Why it matters.** Nobody yet. It costs the day somebody builds the client on
its own — `npm run build -w @hexdelve/client` in a clean checkout, or a package
list that grows and stops being in dependency order by luck — and gets an error
about a package that is right there in the repository. It also means
`tsc -b packages/client` does not rebuild scripting when scripting changes,
which is the whole point of a project reference: the client can be typechecked
against declarations that are one edit stale.

**What would fix it.** Two lines. `"@hexdelve/scripting": "*"` in the client's
dependencies, and `{ "path": "../scripting" }` in its tsconfig references.
Neither changes what is built today; both stop it from depending on the order
somebody wrote a script in.


### F-013 — A script saved in the editor does not reach the yard until the view is left and returned to

**Kind:** gap
**Milestone:** scripting
**Priority:** medium
**Effort:** medium
**Found:** 2026-09-04, writing the script view and working out what a save should do
**Where:** `App.tsx`, which renders one view at a time; `Scripts.tsx`;
`Viewport.tsx` and `watchScripts` in `packages/editor/src/scripts/reload.ts`

**What happens.** The editor shows one view at a time, so the yard's viewport is
unmounted while the script view is up — and the viewport is what holds the
client, the script host and the watcher that swaps a compiled bundle into it. A
save therefore writes the file and compiles it, and nothing else happens. The
change appears when the yard is selected again, because mounting the viewport
starts a fresh watcher which reads the directory and compiles it.

**Why it matters.** It is one click rather than none, and the click is not
obvious: the script view reports a successful compile, which reads as though
something took effect. The hot reload it is standing on is the feature the
whole scripting layer was built around — a save reaching a running world
without a rebuild — and the editor is the one place that shows it off least.

It matters more for the thing it makes impossible: watching a change take
effect on a creature that is mid-fight. Editing a number and seeing the
behaviour change while the world keeps running is exactly what a script host
with a reload is for, and it cannot be done from the view that edits scripts.

**What would fix it.** Two shapes, and the second is better. The cheap one is
to keep the client alive across a view change — mount the viewport once and
hide it rather than unmounting it — which is a change to how `App` renders and
would make every bench's client outlive its view too, for better and worse. The
one that fits what an editor is: put a small yard beside the code, so the
script view has a running world of its own to reload into. The viewport is
already a component that takes a canvas and a backend, and the host it hands
back is the one `watchScripts` wants; what is missing is a layout that gives
half the pane to each, and a decision about whether that world is the yard or a
bench.


### F-014 — `packages/client/dist-scripts` is committed output from an arrangement that no longer exists

**Kind:** cleanup
**Milestone:** unscheduled
**Priority:** low
**Effort:** small
**Found:** 2026-09-04, looking for everything that reads the script directory before pointing an editor at it
**Where:** `packages/client/dist-scripts/`

**What happens.** Eight generated files — `Spin.js`, `index.js`, their
declarations and four source maps — are tracked in git. They were emitted when
the scripts lived at `packages/client/src/scripts` and were compiled into the
client's own build. That arrangement is gone: the scripts moved to
`packages/client/scripts`, `tools/build-scripts.mjs` compiles them into one
bundle the client fetches, and nothing emits into `dist-scripts` any more.

They survive because `.gitignore` ignores `dist/`, which matches a directory
called exactly `dist` and not one called `dist-scripts`.

The contents are stale in a way that is worth naming: `index.js` describes a
table of scripts checked by `test/scripts.test.ts`, and there is no such test.

**Why it matters.** Nobody yet — nothing reads them. It costs whoever greps the
repository for a script name and finds two answers, one of them describing a
build step and a test that no longer exist. Generated files that nothing
generates are worse than generated files, because there is no way to tell from
looking whether they are current.

**What would fix it.** Delete the directory, and add `dist-scripts/` to
`.gitignore` beside `dist-app/` and `dist-lib/` so a stray rebuild of the old
shape does not put it back.

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

### F-008 — The case against decorators is written more broadly than it holds

**Kind:** bug
**Milestone:** scripting
**Priority:** medium
**Effort:** small
**Found:** 2026-09-04, explaining the difference between legacy and standard decorators
**Where:** `packages/scripting/src/parameters.ts`, the "Why this is not a decorator" header; the same paragraph in `docs/assets.md`
**Closed:** 2026-09-04, fixed — the paragraph now says the objection is about
fields, and `@on` in `packages/scripting/src/events.ts` takes the road it was
wrongly closing

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

### F-009 — A parameter's type is its default's literal type, not its kind

**Kind:** bug
**Milestone:** scripting
**Priority:** medium
**Effort:** small
**Found:** 2026-09-04, reading the declarations `tsc` emits for the script directory
**Where:** `param` in `packages/scripting/src/parameters.ts`; visible in every script that uses one, `packages/client/scripts/Character.ts` worst
**Closed:** 2026-09-04, fixed — `param` returns `Widen<T>`, so a parameter's
type is its kind rather than its default's literal type

**What happens.** `param` is declared
`param<T extends number | boolean | string>(value: T): T`, so `T` is inferred
from a literal argument as that literal. `faction = param('foe')` gives the
field the type `'foe'`, not `string`. `spread = param(1)` gives the type `1`,
not `number`. The declaration `tsc` emits says so in as many words:
`spread: 1`.

Assigning through the marker hides it inside the class, because the values are
only ever read. It shows the moment anything compares or assigns. In
`Character`, `faction` is typed `'foe'` while the wanderer's entity file sets it
to `player` — so the type says a value the game actually produces is
impossible, and `if (this.faction === 'player')` is a comparison TypeScript
would reject as having no overlap.

**Why it matters.** The whole argument for declaring a parameter by its value
rather than by a decorator was that it "stays typed". It does not: it is typed
as the one value it happened to start with, which is the least useful type it
could have. A script that branches on a string parameter — which is what a
faction is for, and phase 5 will want — cannot be written without a cast.

It is also a silent wrong answer rather than a loud one. Nothing fails today,
so the first person to hit it will be reading a comparison error that looks
like their mistake.

**What would fix it.** Widen the return type. A conditional does it in one
line and changes no runtime behaviour:

```ts
type Widen<T> = T extends number ? number : T extends boolean ? boolean : T extends string ? string : never;
export function param<T extends number | boolean | string>(value: T, options?: ParameterOptions): Widen<T>;
```

Worth a test that a string parameter can be compared against another string,
since that is the case the current signature rejects. The alternative, asking
authors to write `param<string>('foe')`, puts the burden on every script for
one signature's convenience and would be forgotten.

### F-004 — The README's test table describes a test that no longer exists

**Kind:** cleanup
**Milestone:** now
**Priority:** low
**Effort:** small
**Found:** 2026-09-03, adding the asset and yaml rows to the same table
**Closed:** 2026-09-04, fixed — the row is gone and the table now lists the
tests that exist, the new ones included
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
