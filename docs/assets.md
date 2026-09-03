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
`locomotion.tree.yaml` drives the wanderer and the ghoul without being
duplicated or parameterised. A tree carrying its own clip paths would mean two
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

Three hosts have to read these files and they have almost nothing in common: a
browser tab, a Vite dev server, and an Electron window whose page is not served
over http at all. What they share is a path in and a string out, so that is the
whole of `AssetIO`, and every host difference lives in one small object.

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
| Electron | `fetch` over `app://` | none: the shell wraps the client, which authors nothing |
| `memory` | a map | the same map — a pack, or a test |

A file has one address, so a write is a PUT to the URL the GET came from rather
than a second endpoint: an editor that read from one place and wrote to another
would have two ways to be pointed at the wrong tree.

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

`test/assets.test.ts` loads every file and compares it against the module it
replaced — part for part, key for key, bone for bone. That is the whole
opportunity of doing this while both statements exist: a mesh file that drops a
prism, mirrors the wrong axis or reads a colour out of the wrong palette entry
fails there rather than being noticed later by somebody looking at a character
with one ear.

Numbers are compared to 1e-9 rather than exactly, and the reason is worth
knowing before anyone tightens it. `pi / 2 + 0.05` in a file and
`PI / 2 + 0.05` in TypeScript are the same double, but `deg(12)` is
`(12 * pi) / 180` where the source wrote `12 * (PI / 180)`, and a frame
composes a rotation through a quaternion where the sword's own helper
multiplied out a sine and a cosine by hand. Those differ in the last bit or two
of a double — a millionth of a millimetre.

## Still to do

The four preview benches still take their subjects from the TypeScript modules
rather than from the library. The files are proven equal to those modules and
the IO to reach them is in place, so switching over means the benches taking
their subjects from `library.index()` and the client loading its entities at
startup — at which point `models/`, `game/*rig.ts` and `game/clips.ts` become
the files that are deleted rather than the files that are duplicated.

Two things that would be worth having and are not here. There is no way to
create a new file from the editor, only to change one that exists — an entity
has to be added to `index.yaml` by hand. And nothing writes a **pack**: the
loader will read one out of `memoryIO`, so a build step that folds the tree
into a single JSON would give the distributed client its assets with no second
request, but nothing produces one yet.
