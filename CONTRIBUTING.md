# Contributing to odon-core

Glad you're here. A few things make collaboration on this project work.

## Before you open a PR

1. Read `CLAUDE.md`. It captures the conventions and hard rules. If your change touches any of the "hard rules" in `SECURITY.md`, expect the PR to be held until we discuss.
2. Run the local checks:
   ```
   npm install
   npm run typecheck
   npm test
   npm audit --audit-level=high
   ```
   All four must be green before you push.
3. Add tests. The project ships with a small but real test suite. New behaviour should come with new tests. Bug fixes should come with a regression test that reproduces the bug.
4. Keep PRs focused. One concern per PR. A feature + an unrelated refactor in the same PR will get split before review.

## What to work on

We track work in GitHub issues. Anything labelled `good first issue` is small and self-contained. Anything labelled `help wanted` is bigger and has design discussion attached. Adapter ports (Discord, OpenClaw, etc.) are the highest-leverage contributions right now.

If you have an idea that's not in an existing issue, open one to discuss before sinking serious time into a PR.

## Style

- TypeScript strict mode. No `any`. Use `unknown` and narrow.
- Pure functions in `src/logic/`. No I/O, no LLM calls. Anything that needs I/O lives outside `src/logic`.
- Function-calling mode only for the LLM. Any code that uses `chat.sendMessage()` or a free-form text endpoint will be rejected.
- OAuth: `calendar.freebusy` is the default scope. Anything that requires broader scope must go through the `/autoadd` opt-in path.
- Don't add comments that restate what the code does. Only document non-obvious WHY.

## Developer Certificate of Origin (DCO)

Every commit must be signed off. Sign-off means you affirm the statement in the [Developer Certificate of Origin 1.1](https://developercertificate.org/) (the same one Linux and many other projects use). It's a one-line trailer added to your commit message:

```
Signed-off-by: Your Real Name <your.email@example.com>
```

The easiest way is `git commit -s`, which appends the trailer automatically using your `user.name` and `user.email`. Set these once per repo:

```
git config user.name "Your Real Name"
git config user.email "your.email@example.com"
```

We require sign-off because Odon is AGPL-3.0. The DCO line is your certification that you have the right to license your contribution under AGPL. It is not a contributor license agreement (CLA): you keep your copyright; we keep AGPL.

PRs without sign-off on every commit will be asked to amend the commits before review.

## Code of conduct

Be kind. Disagree about the code, not the person. We will remove people who can't manage that.

## What "ready to merge" looks like

- Typecheck passes (`npm run typecheck`)
- Tests pass (`npm test`)
- Audit passes (`npm audit --audit-level=high`)
- New behaviour has tests
- Every commit has a `Signed-off-by` trailer
- PR description explains the why, not just the what

That's it. Thanks for the work.
