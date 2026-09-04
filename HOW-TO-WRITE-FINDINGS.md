# How to write findings

[`FINDINGS.md`](FINDINGS.md) is the register of things noticed during other
work. This page says what belongs in it, what a good entry looks like, and when
one comes back out.

Read this before adding to the register or editing it.

---

## What a finding is

A finding is something true about the project that nobody asked about, that came
to light while doing something else, and that is not being fixed right now.

Four things make one worth writing down:

1. It was **noticed while doing other work**. Nobody set out to look for it.
2. It is **not the work in hand**. A finding is what turned up beside it.
3. It is **not being fixed in the current turn**. Anything fixed on the spot is
   a commit, not a finding.
4. It is **specific enough to act on later** without rediscovering it.

## What a finding is not

- **Not a task list.** A finding may become a task, and until someone decides
  that, it stays a finding.
- **Not a bug tracker in miniature.** A finding that is being worked on leaves
  the register.
- **Not a place to record an opinion about style.** Those go in
  [`CLAUDE.md`](CLAUDE.md) as a rule, or nowhere.
- **Not a diary.** No entry says what a session did or how it felt about it.

---

## The shape of an entry

Every entry carries a number, a one-line title, six labelled fields, and three
short sections. Nothing is optional. An entry that cannot fill a field is not
ready to be written down.

```markdown
### F-013 — The status readout hides the seed on a narrow window

**Kind:** bug
**Milestone:** 0.5.0
**Priority:** low
**Effort:** small
**Found:** 2026-08-17, while adding the frame budget line
**Where:** `packages/client/src/planet.css`

**What happens.** The readout is a fixed 320 px wide. Below about 400 px of
window the seed line wraps behind the canvas edge and the first two characters
are cut off.

**Why it matters.** The seed is how someone returns to a world they liked. A
player on a phone cannot read it back, and there is no other place it is shown.

**What would fix it.** Give the readout a `max-width` in percent rather than
pixels, and let the lines wrap. Half an hour, no engine change.
```

### The title

One line, plain, saying what is true. Not what to do about it.

- Good: *The residency loop never cancels work it no longer wants.*
- Bad: *Fix chunk cancellation.* That is a task, and it hides what is wrong.

### The number

`F-001` onwards, assigned in order, **never reused**. A finding that is fixed or
dropped keeps its number and moves to the closed list, so a commit message or a
conversation can point at `F-007` and still mean something a year later.

---

## The six fields

### Kind

| Value | Means |
|---|---|
| `bug` | The code does something other than what it should |
| `gap` | Something is missing that ought to exist |
| `cleanup` | The code works and is untidy, dead, or duplicated |
| `risk` | Nothing is wrong yet, and something is unverified or fragile |
| `idea` | A way the project could be better that nobody has decided on |
| `question` | Something nobody knows the answer to |

### Milestone

When this should be looked at. This repository has no release document, so the
vocabulary is the work rather than a version.

| Value | Means |
|---|---|
| `now` | Blocks what is being built, or is cheap enough to take alongside it |
| `scripting` | The prefab, component and script work |
| `game` | Rules, combat, levels — the game the engine is for |
| `unscheduled` | Real, and nobody has decided when |

### Priority

Within a milestone, in what order.

| Value | Means |
|---|---|
| `high` | The milestone is not finished while this stands |
| `medium` | Someone will hit this and be annoyed |
| `low` | Worth doing when the surrounding code is open anyway |

### Effort

A guess at the work, stated in time so it can be argued with.

| Value | Means |
|---|---|
| `small` | Under an hour, one or two files, no design |
| `medium` | A day, several files, a decision or two |
| `large` | More than a day, or it needs a design first |

### Found

The date, and one clause on what was being done at the time. That clause is the
useful part: it says where to look and what was on screen.

### Where

The files or the subsystem, by path. Name the function when there is one.

---

## The three sections

### What happens

The behaviour, plainly, as a reader could reproduce it. Numbers where they are
known — how many chunks, how many milliseconds, how many pixels.

### Why it matters

Who is hurt and how. **This section may argue**, which is the one place in the
repository outside `docs/` where that is true: a register whose entries do not
say why they are there cannot be triaged.

Say plainly when the answer is "nobody yet". A finding that costs nothing today
is still worth recording, and pretending otherwise wastes the next reader's
time.

### What would fix it

The shape of the fix, not the patch. Enough that someone picking it up knows
whether the `Effort` field is honest. Where two fixes are possible, name both
and say which is preferred.

---

## Language

The register is read by whoever picks the work up, which may be months later and
may not be the person who wrote it.

- **Short sentences. Ordinary words.** No shorthand that only makes sense to
  whoever was in the code that day.
- **Do not compress.** Three clear sentences beat one dense one. The rest of the
  repository is terse on purpose; this file is not.
- **Name things by their real names** — the file, the function, the field.
- **`colour`, never `color`**, as everywhere else in this repository — the one
  place the chamfer engine's rule is inverted, because the prose here is
  British and its palettes are not.
- No comparison to other games, nothing is described as free, and no trace of
  how the entry was written.

---

## Adding one

Append to the open list, in number order. Do not group, sort or renumber the
open list — it stays in the order things were found, so a reader can see what a
piece of work turned up together.

Add a finding **as soon as it is noticed**, in the same session. A finding
carried in someone's head to the end of a task is a finding that gets dropped.

## Closing one

When a finding is fixed, or decided against, move the whole entry to the closed
list at the bottom and add one more field:

```markdown
**Closed:** 2026-09-02, fixed in `a1b2c3d`
```

or

```markdown
**Closed:** 2026-09-02, declined — the cost is 3 ms a frame and the fix is a
second renderer
```

Keep the entry as it stood. The closed list is the answer to "did anyone ever
look at this", and an entry rewritten to match the fix cannot answer it.

## Finding one again

The register earns its keep at the moment somebody opens the code an entry
describes. **Search it before starting work on a subsystem**, and write every
entry as if someone will find it while standing in that code — name the files,
name the functions, and say what the fix would touch. An entry that cannot be
matched to a subsystem will not be found at the moment it is cheapest to act
on, which is the only moment that matters.
