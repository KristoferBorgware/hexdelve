# Assets as files

Every rig, body, clip and blend tree in this project used to be a TypeScript
module. This is the file format that replaced them, why it is shaped the way it
is, and what is deliberately still code.

## Why

Adding the hellhound touched five files, and not one of them was about a
hellhound: a rig module, a mesh module, a pose module, an export block in
`packages/client/src/index.ts`, and an entry in the editor's bench. The data was
never code — it was only *stored* as code — and at three rigs, four bodies and
three props that stopped being free. Seven entities is where a catalogue starts
being worth having and a compiler stops being the right place to keep one.

So the data moved into `assets/`, and the readers into `@hexdelve/engine`
alongside the poses and clips they produce, because nothing in them knows what
a renderer is.

## The tree

```
public/assets/
  index.yaml              every entity, in the order a catalogue lists them
  entities/*.entity.yaml  the root file: what belongs to what
  rigs/*.rig.yaml         bones, tips, masks, groups, metrics
  meshes/*.mesh.yaml      prisms bound to bones
  clips/*.clip.yaml       keyframes, pose-major
  trees/*.tree.yaml       blend trees over named animations
```

`public/` because these are files a browser fetches, and Vite's `publicDir`
is how a file gets served as itself rather than bundled. One tree at the
repository root rather than one per app: the client and the editor read the
same rigs, they live in different directories, and a copy in each would be the
same YAML twice, drifting — which is the thing moving assets out of TypeScript
was meant to stop. `vite.assets.mts` points both apps at it, and both builds
carry it.

One consequence worth knowing: Vite emits its own chunks into `assetsDir`,
which defaults to `assets` and would collide. Both apps move the **bundle**
aside to `bundle/` rather than moving the data, because
`/assets/rigs/humanoid.rig.yaml` is an address that appears in the asset files
themselves and in this document, and `/bundle/index-a1b2c3.js` is an address
nobody ever types.

Paths inside a file are relative to that file. A leading `/` is from the asset
root instead, for a tree deep enough that the alternative is all dots.

## The entity file is the root

An entity file is the only file in the set that names paths. Everything under
it either describes one thing or, in a tree's case, is an arrangement over
names the entity defines.

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

**Blend trees link animations, and the entity says what an animation is.** A
tree refers to `walk`; it does not carry a path. That way exactly one file
names files, and a tree is a pure arrangement over named leaves — so
`locomotion.tree.yaml` reads on any entity that names its leaves, without
being duplicated or parameterised. A tree carrying its own clip paths would mean two
files both naming files and both able to disagree about which walk was meant.

### A prop is an entity with less in it

A helmet is a thing in the world with a mesh, so it is an entity. It has no
rig, no animations and no blend trees, because the whole of wearing one is
which transform its parts are drawn through — its own, or a bone's.

```yaml
id: helmet
kind: prop
mesh: ../meshes/helmet.mesh.yaml
attach: { rig: ../rigs/humanoid.rig.yaml, bone: head }
ground: { lift: 0.2, tilt: 0 }
```

`attach` names the rig it was modelled against and the bone it hangs from;
`ground` is how it lies when put down. The loader **refuses** `rig`,
`animations` or `blendTrees` on a prop, and `attach` or `ground` on a
character. "Props have no rig" stops being a convention somebody remembers and
becomes a thing the loader says.

## The object half: prefabs

An entity file says what a thing is made of. Its `object:` section says what it
is when it is standing in the world — a game object, what is attached to it,
and what hangs underneath it.

```yaml
object:
  name: wanderer
  components:
    - { type: actor }
  children:
    - name: grip
      at: [0, 0, 0]
```

Two files would be worse than one. An entity and its prefab can only ever
disagree, and there is no such thing as a wanderer's mesh that belongs to a
different wanderer — so the object tree lives in the file that already names
the rig and the mesh it is made of. A file with no `object:` still spawns: it
gets one object named after the entity with nothing on it, because "a thing
with no components" is a real answer where an absent prefab is not.

**A component record is a `type` and a bag of fields.** The reader does not
know what an `item` is and must not — `@hexdelve/engine` has never heard of a
bat, and a format that had to be taught each component would be a format the
client could not add to. A `ComponentRegistry` maps the type to whoever claimed
it. `script` is claimed by the engine itself — `Script` and `ScriptHost` live
there, so there is nothing for a game to decide about what building one means —
and `packages/client/src/game/components.ts` is where the game adds its own,
`actor` and `item`, on top of that. An unknown type fails by name and lists
what there was.

What a factory cannot read from the record it takes off the entity being
spawned. `{ type: actor }` is bare because an actor on a wanderer is the
wanderer's rig and the wanderer's mesh by definition — a file that let those be
given separately could put a bat's body on a man's bones.

### Order is what the file order means

Objects, then their components, then their children — which is the order
`GameObject.destroy` runs backwards. A factory can reach anything above it and
nothing below it, so a child's component can find its parent's actor and a
parent's cannot find its children's.

### Systems are prefabs there is one of

`public/assets/systems/*.system.yaml` is an entity's `object:` section and
nothing else. A wanderer is spawned when a wanderer is wanted and there can be
two; a register of characters cannot be either of those things, because the
whole of what makes it useful is that everything looking for a character looks
in the same place. So it is instantiated once, at start, **before the cast** —
a register has to exist before the first thing that registers with it.

A system is not a special kind of thing. It is an ordinary object with ordinary
components that happens to be spawned once, which is what will let a script
attached to one be written exactly like a script attached to a character.

### What a component exposes

A component decides which of its fields anybody else may set, by declaring
them:

```ts
export class BoneFollow extends Component {
  bone = param('', { label: 'Bone', hint: "The bone in the wearer's rig" });
}
```

That is the whole of the opt-in, and it is the same for a script and for
everything else — `Script` derives from `Component`, so a behaviour and a prop's
bone are declared and read the same way. `GameObject.attachComponent` resolves
the declarations into their defaults before the component's first hook runs and
applies whatever the prefab named; a name the class never declared throws,
listing what it does have.

An editor reads them back off the instance. `component.parameters()` gives each
field with its type, its default, its hints and the value it holds right now,
and `inspectObject(object)` does that for a whole subtree — a row per object, a
block per component, a control per field. Writing goes through
`component.setParameter(key, value)`, which a script overrides so the host
remembers the value and applies it again to the instance the next hot reload
builds.

Unity draws the line by a rule where this draws it by a marker. There, a public
instance **field** of a serialisable type is in the inspector, as is a private
one marked `[SerializeField]`; a property is not a field, so `public float
CurrentHealth { get; set; }` is not in it, a method is not a field, so
`CanPickup()` is not, and `public UnityAction<float, GameObject> OnDamaged`
holds functions rather than data, so neither is that. `[Tooltip("...")]` labels
a field that is already exposed rather than exposing one, which is what `hint`
is here. The line ends up in the same place; declaring it per field rather than
per type is what saves keeping a list of the types a rule would accept.

## Arithmetic, because the numbers were never flat

Any scalar may be a string holding arithmetic:

```yaml
euler: [pi / 2 + 0.05, 0, 0]
at: [cos(mount) * out, 0.03, sin(mount) * out]
size: [radius * 1.07, 0.032, radius * 1.07]
duration: tau / 1.8
```

A helmet's cheek plate is not tilted by 1.6207963267948965 radians, it is
tilted by `PI / 2 + 0.05`, and those are the same number only until somebody
has to change it. Names come from the file's own `constants` (or a rig's
`metrics`); the built-ins are `pi`, `tau`, `e`, and the functions `sin`, `cos`,
`tan`, `sqrt`, `abs`, `sign` and `deg`. Evaluation is left-to-right within a
precedence level, which is what JavaScript does — so an expression lifted out
of the TypeScript it replaces gives bit-for-bit the same double.

It is not a scripting language: numbers, four operators, brackets, those
functions, and names looked up in a scope the file declares. No state, no
calls out.

## Meshes keep the loop

`buildWanderer` was a list of prisms with a `for (const side of ['L', 'R'])`
loop through the middle. Flattening that would turn sixty readable parts into a
hundred and twenty unreadable ones and let the two halves of a symmetric body
drift apart, so four things came across with the data:

| | |
|---|---|
| `sides: [L, R]` | a **group** emitted once per side, `*` in a bone name standing for the side letter |
| `mirror: true` | on every side after the first, x negated and the y and z of a rotation with it — the `const s = side === 'L' ? 1 : -1` that goes with the loop |
| `frames` | an authoring frame: a bone, an offset and a rotation the parts inside it are written against |
| `anchors` | a named point in such a frame |

Groups carry the sides rather than single parts, so the prisms come out in the
order the loop put them in — all of the left wing and then all of the right,
not spar-left, spar-right, membrane-left.

A vector may be `[x, y, z]` or `{ bone: foreL }`, meaning that bone's rest
offset. That is how a wing spar spans its own bone exactly and goes on doing so
when the bone is re-tuned. A bone-resolved vector is never mirrored — it
resolves against the mirrored bone's own name, so negating it would send the
spar back through the animal.

A part is a prism if it has `size` and a strut if it has `radius`. A strut takes
`from` plus either `to` or `along` and `length` — a claw is a direction out of a
knuckle and a distance, and the direction need not be unit, which is what lets a
fan of three be uneven rather than combed.

Frames are what keep the sword's numbers reading as "how far down the blade"
and the shield's as "on the face of the shield":

```yaml
frames:
  blade: { bone: handR, euler: [lean, 0, 0] }
parts:
  - frame: blade
    parts:
      - { at: [0, -0.44, 0], size: [0.046, 0.6, 0.021], color: steel }
anchors:
  tip: { frame: blade, at: [0, bladeEnd, 0] }
```

`anchors.tip` is where the point actually ends up in the hand bone's space, so
re-leaning the sword moves the game's measured reach with it. A **strut cannot
sit in a frame**: its rotation comes from its own two ends, so a frame would
have to invent a roll for it, and the loader says so rather than guessing.

## Blend trees measure their own thresholds

A threshold on a speed axis may be `{ speedOf: walk }`, which asks the named
animation where its planted foot is at the two contact keys — exactly what
`strideVelocity` did in the code. So idle, walk and run sit at their own true
speeds and re-tuning the stride moves the thresholds with it.

What a file cannot hold is the **calibration**. A blend halfway between a walk
and a run does not travel at the average of their speeds — the stride and the
cadence blend separately and speed is one over the other — and correcting for
that needs the built tree swept. A parameter therefore carries
`calibrated: true`, which is the request; `calibrateSpeed` is the answer, and
it stays with whoever drives the tree.

## What is still code, and why that is right

Half the animation here has no keys and cannot have any. The stride is a
handful of harmonics of one phase angle and a direction of travel; the wing
beat is four bones lagging each other round a cycle. That is not a gap in the
format — a function of a heading covers the whole circle of directions where a
blend space over clips covers four of them.

So an animation may name a **pose function** instead of a clip, and the file
carries the tuning while the code carries the curve:

```yaml
walk: { procedural: stride, args: { amp: 1, gait: 0 } }
run:  { procedural: stride, args: { amp: 1, gait: 1 } }
```

`packages/client/src/assets/poseFunctions.ts` registers them, because the
engine owns the mechanism and knows nothing about a character while the client
owns the characters. A file naming one that was never registered gets an error
listing what *was*.

## Reading them

```ts
import { openAssets } from '@hexdelve/client';

const library = openAssets();                  // assets/, relative to the page
const wanderer = await library.entity('entities/wanderer.entity.yaml');

wanderer.mesh.model();                         // the prisms
wanderer.blendTrees.get('locomotion')!.tree(); // a tree of its own
await library.index();                         // every entity, in order
```

`HexdelveClient` opens one for you as `client.assets`, so an embedder that
wants an entity need not construct a second library and get the pose functions
right by hand.

`tree()` returns a **fresh** tree each call on purpose: a tree owns a playhead
and a set of scratch buffers, so two subjects sharing one would fight over both
the moment either was being looked at.

## The IO model

Four hosts have to read these files and they have almost nothing in common: a
browser tab, a Vite dev server, and two Electron windows whose pages are not
served over http at all. What they share is a path in and a string out, so that
is the whole of `AssetIO`, and every host difference lives in one small
object.

**Reading is `fetch` everywhere, Electron included.** That is the part worth
arguing for. Loaded with `loadFile`, the desktop window's page would be a
`file://` document with an opaque origin, and a relative fetch from one is
refused by Chromium. The usual answer is to give Electron its own read path
over IPC — which works, and costs the desktop shell's whole claim that whatever
ships on the web ships there, because the client would then contain a branch
only the desktop build takes. So the window gets a real origin instead:
`packages/desktop/src/main.ts` registers a standard, secure `app://hexdelve/`
scheme served straight out of the client's build, and every URL under it
resolves exactly as it does over http. The client knows nothing about any of
it, which is the point.

**Writing is a capability, not a method.** `io.writer` is null on a backend
that cannot write, which makes "this editor cannot save here" something the
type system knows and the UI can show, rather than an error somebody discovers
by pressing a button.

| host | reads | writes |
|---|---|---|
| `dev-server` | `fetch` | a `PUT` to the same URL, handled by `vite.assets.mts` |
| `fetch` — a built page | `fetch` | none: a static page has nowhere to put a file |
| `fetch` — the client's Electron shell | `fetch` over `app://` | none: that shell wraps the client, which authors nothing |
| `desktop` — the editor's Electron shell | `fetch` over `app://` | an IPC call to the main process, which owns the project directory |
| `memory` | a map | the same map — a pack, or a test |

A file has one address, so a write is a PUT to the URL the GET came from rather
than a second endpoint: an editor that read from one place and wrote to another
would have two ways to be pointed at the wrong tree.

The `desktop` row is the one exception, and it is forced rather than chosen.
`app://` is answered by a handler inside the main process, not by a server, so
there is nothing for a PUT to arrive at — the write has to be an IPC call. What
crosses it is a SCOPE and a name inside it, never a path: the page can say "the
asset called `rigs/humanoid.rig.yaml`" and cannot say `/etc`, because it does
not know where the asset tree is. The main process does, and checks that what
it resolved is still inside it. See `packages/editor-desktop/src/files.ts`, and
`desktop.ts` in the client for the page's half.

The dev plugin is `apply: 'serve'` and therefore cannot exist in a build. It
refuses anything but `.yaml`, caps a body at a megabyte, and resolves each path
and then checks where it actually **leads** rather than scanning its text for
`..` — a check on the text of a path is a check on one spelling of it, and
`%2e%2e` is another. A dev server is usually on localhost but `--host` is one
flag away.

It also answers **404** for a missing asset. Vite treats both apps as
single-page apps, so a path it cannot serve falls back to `index.html` with a
200 on it, and a mistyped rig path would reach the YAML reader as a page of
HTML — the error would be about an unexpected `<` on line one rather than about
a file that is not there.

A tool or a test wanting the disk writes a dozen lines around `readFile` and
`writeFile` and hands them over; `test/assets.test.ts` has exactly that.
Nothing in `@hexdelve/engine` imports `node:fs`, and nothing has to.

## Writing them

The editor's **Assets** view is the file list, the file, and a save button.

What is in the pane is the actual bytes of the actual document — no form, no
schema-driven widgets — and that is a choice rather than a shortcut. These
files are written to be read: they carry the comments explaining why a cheek
plate sits where it does, and a form would throw all of that away the first
time it round-tripped one.

What the editor adds is the two things a text box cannot do on its own.

It **validates before writing**. `library.save` parses the document and refuses
to send one it could not read back, because turning an unsaved change into a
broken asset is strictly worse than refusing — the error is the reader's own,
naming the file and the line.

It **invalidates the whole derived side**. Saving a rig changes every mesh hung
on it and every clip checked against it, so a write drops all of it rather than
working out what it touched. These are small files read in milliseconds; a
clever invalidation would buy nothing and be wrong the first time somebody
added a link between two kinds.

When the host cannot write, the view says so and leaves the text read-only. The
published editor is that host. An editor offering a save that silently does
nothing is worse than one that admits what it is.

The pane itself is Monaco, which arrived with the script view and is used here
for the same reason a rig file is four hundred lines long: line numbers, a find
box and matched brackets are worth having in a document that size. It is still
the actual bytes.

## The reader

`packages/shared/src/data/yaml.ts`, about four hundred lines, no dependencies —
for the same reason there is a quaternion in that package rather than
gl-matrix. It reads block and flow mappings and sequences, the three scalar
quotings, `|` and `>` block scalars, `0x` integers so a colour stays written
the way it was authored, comments, and one leading `---`.

It **refuses**, by name and line number: anchors and aliases, tags,
directives, a second document, a duplicate key, and a tab used as
indentation — which YAML forbids and which an editor configured for this
repository's tab-indented TypeScript will cheerfully insert if nobody says
otherwise. (`.editorconfig` now says otherwise.) Every refusal has a silent
mis-reading available to it, and a silent mis-reading in an asset file is a
character drawn slightly wrong with nothing to point at.

## The guarantee

While both statements of what a wanderer is existed, `test/assets.test.ts`
compared them part for part and key for key. They agreed, so the modules went,
and the comparison went with them.

What guards the files now is **the picture**. `test/render.test.ts` draws the
yard and compares it against a reference PNG taken when every character was
built in TypeScript. The yard drawn from these files is pixel-identical to it,
which is a stronger statement than the equivalence test ever made: it covers
the rigs, the bodies, the palettes, the clips, the blend trees and the way all
of them compose, in one number.

`test/assets.test.ts` keeps the three things that outlive the migration — that
the files load to the shapes the game expects, that the loaders refuse what
they should, and that the pose functions still agree with the rigs they were
tuned against. `test/blend-tree.test.ts` now drives the wanderer's real
locomotion tree rather than a replica assembled in the test.

## Packing

`node tools/build-assets.mjs` folds the tree into one JSON object of path to
text and writes `dist/assets.json`. `npm run assets` builds the libraries first
and then does it; CI runs it after the build.

It also checks every prefab against the components this build actually has, so
a prefab naming a type nobody registered fails the build rather than spawning
an object quietly missing its behaviour — the kind of thing that is noticed a
week later as "the bat does not attack any more".

It is one request instead of thirty — the client otherwise fetches the
manifest, then an entity, then its rig, its mesh, its clips and its trees, and
each is a round trip. `memoryIO` reads exactly that shape, so nothing
downstream can tell the difference:

```ts
import { openPackedAssets } from '@hexdelve/client';
const library = await openPackedAssets('assets.json');
```

The second reason is the important one. **It is a check.** Every entity in the
manifest is loaded on the way past, through the same readers the game uses, so
a mesh naming a bone its rig does not have or a tree naming an animation its
entity never declared fails the build:

```
meshes/sword.mesh.yaml: frames.blade.bone: no bone called 'handZ' in rig 'humanoid'
```

A YAML file has no compiler. This is the nearest thing it gets, and it runs
before anything is published rather than when somebody opens the editor and
finds a character with no arms. It also reports any file the manifest does not
reach, which is how a rig nothing uses stops being invisible.

## Scripts

A prefab can name a behaviour:

```yaml
components:
  - { type: script, script: Spin, speed: 0.5 }
```

The class lives in `packages/client/scripts/`, derives from `Script`, and
gets `onLoad` / `tick(dt)` / `onDestroy`. Every field beyond `type` and
`script` in the record is a parameter, checked against what the class declared
and named if it is not one.

A parameter declares itself by its value:

```ts
export class Spin extends Script {
  speed = param(1, { min: -6, max: 6, hint: 'Radians a second' });
}
```

`@serialize() speed = 1` is the obvious spelling, and the reason it is not used
is specific to *fields*. A field declaration under ES2022 semantics is a
`defineProperty` on the instance, so an accessor a legacy decorator installed on
the prototype is shadowed and never runs — which is what `useDefineForClassFields:
false` exists to undo. Worse, a legacy field decorator is handed the prototype
and the name and nothing else: it cannot see `= 1`, so the default would have to
be written twice, in the decorator and in the initialiser, and the two would
drift. Declaring by value asks nothing of any compiler, keeps the default in one
place, and stays typed — `param(1)` is a number everywhere in the script.

None of that applies to a method, which is already on the prototype and carries
no value to lose. See **Events** below, where a decorator is the right tool and
is used.

### The scripts are not in the module graph

Nothing imports `packages/client/scripts/`. `tools/build-scripts.mjs` compiles
the directory into one self-contained CommonJS bundle; the client fetches
`scripts.js` beside the page and evaluates it, the way it fetches an asset. In
development the Vite plugin compiles the same directory on request, so a running
page has whatever is on disk now and there is no build step to forget.

Three things follow, and each is a reason for it.

**A broken script is a failure of the script step, named.** It used to be a page
that would not load: the client imported its own script table, so every
application build parsed every script, and a half-typed file stopped the editor
from starting.

**There is no table to keep in step.** The directory is the list. Adding a file
ships a script.

**The scripts answer to one compiler.** esbuild does it in the tool and again in
the editor; Vite and vitest never see them. That is what lets a script use
syntax the applications do not — decorators, in particular — without every build
tool in the repository having to agree about it first. `packages/client/scripts/tsconfig.json`
is where that syntax is declared, and `npm run typecheck` covers it.

### A script is a component

Not a component holding one, and not a component with a script inside it: a
`Script` derives from `Component` and sits in its object's list beside a
`Model`. `object.getComponent(Combat)` finds it, `getComponentInParent` walks up
to it, `scene.getComponent` finds the one system there is — the same calls that
find everything else, because there is nothing else to find.

A script reaches the object model directly, too. `this.object` is the
`GameObject` and `this.scene` is the `Scene`; there are no wrappers between
them. There were for a while, on the argument that a smaller surface could be
promised to scripts while the engine changed underneath, and it cost more than
it bought: every capability had to be re-exported by hand, `this.transform`
allocated a wrapper on every read, and two scripts on one object held handles
that were not `===` to each other — so the obvious comparison, "is this the
thing I hit", was quietly false.

What the host keeps is what a component cannot: which class a NAME means, and
how to build a new instance in the old one's place when that class is replaced
while the game runs. The registration outlives the instance, and it outlives no
instance at all — a prefab may name a script whose file has not compiled yet,
and the registration is what remembers to build it when the file appears.

**A reload replaces the instance.** It is built from the new class and put where
the old one stood — same object, same place in the list, same parameters
somebody set — so the object is not reordered and nothing that points at the
OBJECT notices. Anything that cached the SCRIPT is holding a corpse. Scripts are
safe by construction, since `onLoad` runs again on the new instance and a lookup
cached there is refreshed; code that a reload does not rebuild — the game's own
components, the simulation, a listener — must look a script up when it needs one
rather than hold it.

Three failure rules, each because the alternative is worse than the bug. A
script that throws in `tick` is **muted** until the next reload, since left
running it throws sixty times a second and killed outright it cannot be fixed
by saving the file. A script whose class is missing stays **registered** with no
instance, because its file may be half-written — and a build with NO classes at
all says nothing, because that is not a missing script, it is a world the editor
has just made and has yet to compile for. And a value somebody set survives a
reload where a value nobody set does not — otherwise editing a default in the
source would never take effect.

### Two providers, one host

| | classes from | reloads |
|---|---|---|
| the client | `scripts.js`, fetched and evaluated | no |
| the editor | esbuild-wasm, in the browser | yes |

The editor fetches no bundle at all: it creates its clients with
`scripts: false`, so an editor-hosted world starts with no behaviour on it and
everything it ends up running was compiled by the page it is in, from the files
that page is showing. The default — fetching `scripts.js` — is right for a
shipped client and wrong there twice: on a dev server it is a compile of the
same directory the page is about to compile again, and in a BUILT editor it
would be a bundle frozen when the editor was built, which has nothing to do
with the project a window is later opened on. The editor's Vite config leaves
`scriptBundle` out for the same reason.

Only the editor carries the compiler. The client's whole promise is one ES
module with nothing to install, and a multi-megabyte WebAssembly toolchain
nobody playing the game will run has no business inside it. Both run what they
end up with through the same `scriptsFromBundle`, so only the compiling
differs.

A client that cannot read its bundle runs without behaviour and says so, rather
than failing to start. That is the same discipline as the rules below: one
absent script must not take out a scene.

The editor reads the same files the client ships — the dev server serves
`packages/client/scripts` as text at `/scripts/` — so what is hot-reloaded
is what is shipped, rather than a copy that can drift. Saving a file recompiles
and swaps; a compile error leaves the previous scripts running and says so.

**esbuild strips types without checking them.** A script with a type error
compiles and runs in the editor, and only `tsc` objects. That is what makes the
reload fast, and it is why `npm run typecheck` covers the scripts directory.

### Writing one in the editor

The **Scripts** view is that directory, in Monaco, with a save button. It reads
and writes through the same URLs the watcher reads — `PUT /scripts/Spin.ts` on
a dev server, an IPC call in the desktop editor, nothing at all on a built page,
which says so — so a script edited here is the file on disk and not a copy.

Three things make it more than a text box, and only the first is Monaco's:

**The language service knows the SDK.** `/script-types.json` hands over the
`dist/*.d.ts` of `@hexdelve/shared`, `@hexdelve/engine` and
`@hexdelve/engine`, named as though they were installed under
`node_modules`, so `import { Script } from '@hexdelve/engine'` resolves by
ordinary node resolution and `this.transform.` completes. They are the same
declarations `npm run typecheck` uses, and a tree that has never been built
says which package is missing rather than quietly offering nothing. The service
is given the whole script directory rather than the open file, because a script
imports its neighbour and a service with one file would report that line as an
error in code that compiles.

**Saving compiles.** Through `compileScripts`, which is the call the watcher
makes, so a file that will not build says so here — with esbuild's own position,
as a marker on the line rather than a sentence about a bundle.

**A compile reaches a running world.** The view has one beside it — the client,
the same component the yard mounts — and a successful compile is swapped in
with `host.reload`, so every instance is rebuilt behind its id with the
parameters somebody set kept. Nothing is restarted: a change to a number takes
effect on a creature that is mid-fight.

It swaps on a compile rather than on a save, so the world can be running what
the buffers say before any of it is on disk. That is the useful order — try the
change, then keep it — and it is the one place this view knowingly runs
something that is not a file, which is why the status line says so. The pane's
own watcher is off: what belongs in that host is what these buffers compiled
to, and a watcher reading the directory would put the disk back a moment
later.

### Events

Scripts talk to each other by announcing things, not by calling each other.

```ts
export const Damage = defineEvent<{ amount: number; from: string }>('damage');

export class Character extends Script {
  @on(Damage)
  hurt(blow: Blow): void { ... }
}
```

`this.send(target, Damage, { amount: 3, from: 'wanderer' })` reaches the scripts
on one object; `this.emit(Died, { who })` reaches every script in the scene that
declared it. Events are matched by their **name**, not by token identity, so a
hot reload — which rebuilds every token in the bundle — does not lose them.

A script puts a new object in the world with `this.spawn(id, { at, yaw, parent })`,
where `id` names an entity the game loaded. It comes back built — prefab read,
components attached, its own scripts running — so the caller reads a component
off it and sets what it needs. The host cannot do this itself: an id names an
entity, an entity carries a prefab, and a prefab is read against the component
factories the game owns, so the game hands the host a spawner. The entity has
to be loaded already, since a tick cannot wait for a fetch — `CastOptions`
takes a `spawnable` list for entities that are loaded and not placed.

For a question rather than an announcement, look the script up as the component
it is: `scene.getComponent(CharacterRegistry)` for the one system there is,
`object.getComponent(Character)` for the thing in front of you. An event is
fire-and-forget and cannot hand anything back.

The swing in the yard is the shape this exists for, and it is what actually
runs — `test/combat.test.ts` drives the real simulation through it.

| | |
|---|---|
| `Player` / `BatHunt` | `emit(Swing, { at, facing, reach, amount })` |
| `Combat` | `@on(Swing)` → asks the registry what is in front → `target.send(Damage)` |
| `Character` | `@on(Damage)` → takes the hit points off, announces `Died` |
| the game | `host.on(Damage)` → motes, a flinch, the readout |

None of the first three knows the other two, so a trap or a falling rock is a
fourth script and no change to the rest.

**The reach travels with the swing.** How far the blade got and which arc it
swept are measured off the animation clip as it plays, so a rule carrying its
own numbers would disagree with what the picture shows — and the disagreement
would be invisible, a blow that looked like it connected and did not.

**`host.on(event, handler)` is for code that is not a script.** A blow that
lands is hit points in a script and a shower of motes in the renderer, and the
second is not a rule's business. It returns the function that stops listening;
unlike `@on`, nothing takes it back for you, because there is no class for the
host to read it off.

### The events are declared twice

`packages/client/scripts/events.ts` and `packages/client/src/game/events.ts`
declare the same names. They must: the scripts are compiled apart from every
module graph, so neither side can import the other, and the alternative is a
shared package that would put the scripts back inside a build every application
performs.

They agree because the host matches an event **by name**, which is also why a
hot reload — which rebuilds every token in the bundle — does not lose a
subscription. `test/scripting.test.ts` reads both files and fails if a name on
one side has no counterpart on the other, because nothing else about this fails
loudly: a renamed string is a blow announced and never heard, which looks like a
combat bug rather than a typo.

**This one is a decorator, and a parameter is not.** A handler carries no value
and lives on the prototype, so nothing is shadowed and nothing is written twice.
What it buys is that the host can *enumerate* what a script subscribed to, and
therefore always take back exactly what it put in. The alternative is
`bus.on(...)` in `onLoad` and `bus.off(...)` in `onDestroy` — every handler in
two places, the second of which gets forgotten, and a forgotten one doubles on
every hot reload. Hot-reload symmetry stops being a discipline and becomes a
property.

Legacy decorators are what esbuild implements, and the scripts are compiled by
esbuild alone. That is the other half of taking them out of the module graph:
`@on` never reaches oxc or vitest, so no application build has to agree about
it. Tests in `test/` apply the decorator by hand for the same reason, and the
syntax itself is covered against the real compiled directory.

### The systems

`public/assets/systems/game.system.yaml` is instantiated once, before anything
else, and it carries the things there is exactly one of.

| object | script | what it is for |
|---|---|---|
| `characters` | `CharacterRegistry` | who is in the world; a character joins it in `onLoad` |
| `combat` | `Combat` | the one place that knows what a swing hits |

A character joining the register is written out by hand, `onLoad` against
`onDestroy`, because the register is somebody else's data structure. Only the
handlers get the host's help.

## What is left in code, and why

The switchover is done: nothing builds a body, a rig or a clip in TypeScript
any more. `models/`, `game/skeleton.ts`, `game/batrig.ts`,
`game/hellhoundrig.ts` and `game/clips.ts` are gone, and what stands in their
place is `public/assets` plus about a page of adapters.

Three things stayed, and each is a deliberate line rather than a leftover.

**The pose functions.** The stride is a handful of harmonics of one phase angle
and a direction of travel; the wing beat is four bones lagging each other round
a cycle. A function of a heading covers the whole circle of directions where a
blend space over clips covers four of them. The entity files name them and hand
them their tuning — `{ procedural: stride, args: { gait: 1 } }` — so the curve
is code and everything about which curve, how fast and how far is data.

**What those functions were tuned against.** `stridePose` names `hipL` and
`shinR` outright and its arcs were solved against a leg of a given length, so
it is not rig-agnostic and never pretended to be. It carries the few numbers it
needs (see `game/humanoid.ts`) rather than being handed a rig, which is what
keeps it a pure function of an angle — and the copies are pinned to the rig
files by `test/assets.test.ts`, so drift is a failing test rather than a man
whose feet slide.

**The calibration.** A blend halfway between a walk and a run does not travel
at the average of their speeds, and correcting for that needs the built tree
swept. The file states the request (`calibrated: true`); `bench/trees.ts` is
the answer.

## Still to do

There is no way to create a new file from the editor, only to change one that
exists — a new entity has to be added to `index.yaml` by hand. The IO layer can
write anywhere under the tree, so this is a question of what the editor should
offer rather than of what it can do.

The distributed client still fetches file by file; `openPackedAssets` exists
and nothing calls it by default. Which of the two should be the default is a
deployment question — a pack is faster to load and staler to change — and
worth deciding once there is a deployment that cares.
