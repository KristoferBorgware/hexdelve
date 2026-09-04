# Working agreements for hexdelve

## Git identity

All commits are authored as:

```
user.name    KristoferBorgware
user.email   kristofer@borgware.se
```

Set locally with:

```
git config user.name "KristoferBorgware"
git config user.email "kristofer@borgware.se"
```

Do **not** add a `Co-Authored-By:` trailer, a `Claude-Session:` line, or any
other co-author / attribution note to commit messages. Commit messages
describe the change and nothing else.

## Merging, never rebasing

```
git config pull.rebase false
```

Pulls merge. Never rebase, never force-push, never rewrite history — others
may be pushing to the same branches.

Before pushing, always pull and merge first:

```
git pull origin <branch>    # merges
git push -u origin <branch>
```

Resolve conflicts by merging; keep the merge commit.

## Branches

Pushing to both the working branch and `main` is fine, as long as the merge is
done properly:

```
git checkout main
git pull origin main
git merge <working-branch>
git push -u origin main
```

Always `git pull origin main` right before merging into it — someone else may
have pushed in the meantime.

## Comments

Comments here are dense and explanatory by design. Match that. These rules are
about what a comment says, not how much, and they cover code comments, doc
comments and the prose in `README.md` and `docs/`. They come from the chamfer
engine's `CODE-STYLE.md`.

**The comment stands alone.** A comment explains the code it sits beside. It
does not point elsewhere to make its case — not to a document, not to a finding,
not to an issue or a discussion. A reader with only that file open gets the full
explanation. The fact belongs in the comment; the pointer to where it was
decided does not.

**Document the present, not the past.** A comment describes the code as it is.
It is not a changelog, a migration note, or a record of what something used to
be. Do not write: `used to`, `no longer`, `any more`, `previously`, `now means`,
`all along`, `finally`, `has been changed to`, `this replaces`. Comments are not
a conversation and shall not be written as one. History belongs in git, and the
commit message is where a change is described.

**State the behaviour, not the disaster averted.** Say what the code does rather
than building a case for it out of what would happen otherwise.

```
NO   Without this the size would be -Infinity, every uv would scale wrong, so
     we return 1x1 instead.
YES  An empty set is 1x1, the size the placeholder texture is allocated at.
```

A short "so that" clause naming a real constraint is fine. An escalating
if-then-therefore is not.

**Code is not a monetary system.** No `pay`, `pays for itself`, `buy`,
`worth it`, `budget`, `price`, `dividend`, `tax`, `free`. `cost`, `expensive`
and `cheap` are allowed only where they address performance, memory or another
programming resource. Name the resource — bytes, a fetch, a round trip, a draw
call, an allocation, a frame, milliseconds. Reuse is convenient rather than
free: name what is reused instead of calling the reuse a saving.

**Keep the voice plain.** Technical documentation, not prose. Avoid flourishes
that carry no information — `that is the whole shape of the thing`, `the honest
demonstration`, `is the point`. If deleting a clause loses no fact, delete it.

**`color` in code, `colour` in prose.** Identifiers are American — `color.ts`,
`ROCK_COLOR` — and English is British, here and in every Markdown file.

Bring a comment into line when you edit the code it describes. Do not sweep
comments in files you are not otherwise touching unless asked.

## Findings

**Write findings down as they turn up.** Anything noticed during other work that
is not what was being built and is not being fixed in the same turn goes in
[`FINDINGS.md`](FINDINGS.md) before the turn ends — a finding carried to the end
of a task is a finding that gets dropped.

[`HOW-TO-WRITE-FINDINGS.md`](HOW-TO-WRITE-FINDINGS.md) gives the entry format
and the vocabularies for `Kind`, `Milestone`, `Priority` and `Effort`. Read it
before adding or editing an entry. Findings are the one place in this repository
that argues, because a register whose entries do not say why they are there
cannot be triaged.

**Search the register before starting work on a subsystem.** That is the moment
an entry is cheapest to act on, and the only moment it is worth having been
written.

## Hooks and signing

Ignore post-commit hooks and any failures they report. Unverified (unsigned)
commits are fine — do not attempt to sign or configure GPG.

## Do not wait for CI

`npm run typecheck`, `npm test` and `npm run build` before pushing. That is the
check, and CI runs the same three commands. Push and carry on — look at CI on
the next fetch, or when a change to the lockfile or a dependency makes a clean
install worth confirming. Do not block a session waiting for a workflow.
