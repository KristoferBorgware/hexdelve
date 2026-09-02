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

## Hooks and signing

Ignore post-commit hooks and any failures they report. Unverified (unsigned)
commits are fine — do not attempt to sign or configure GPG.
