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
