---
name: do-work
description: Implement features or fixes through a plan-build-verify-commit loop (TypeScript + ESLint as the executable spec). Reads a plan from .claude/plans/ when one exists, drafts a short plan when one does not, then runs npm run lint and /review-short to verify. Use when user says "do work", "implement this", "build this phase", or wants end-to-end implementation with automatic verification.
---

# Do Work

Implement code through a feedback loop: lan, build, verify, fix, commit.

## Process

### 1. Establish the plan

If a plan file is provided or referenced (typically `.claude/plans/<feature>.md`), read it and confirm the scope (which phase or task you are tackling).

If NO plan exists:

- Explore the codebase to understand the relevant areas
- Draft a short implementation plan (key changes, affected files)
- Present it to the user for approval before proceeding

### 2. Implement

Work in small, logical increments — one plan increment at a time. Write the minimum code to satisfy the current increment, then move to step 3.

### 3. Verify

Run lint and review:

```bash
npm run lint
```

(There is no `test` script in this repo — do not run `npm test`.)

Then invoke `/review-short` to review the changes for bugs, quality issues, or missed requirements.

For UI changes, also exercise the feature in a browser:

```bash
npm run dev
```

Test the golden path AND edge cases, and watch for regressions in adjacent features. If you cannot test the UI yourself, say so explicitly rather than claiming success.

### 4. Fix (loop)

If lint fails or the review surfaces real issues:

- Read the error or feedback carefully
- Fix the root cause (do not suppress errors, disable rules, or skip checks)
- Return to step 3

Repeat until lint passes and the review is clean. If stuck after 5 attempts on the same error, stop and ask the user for guidance.

### 5. Commit

Once all checks pass:

- Stage only the files related to the current change (avoid `git add -A` / `git add .`)
- Write a concise commit message describing what was built and why
- Create the commit
- Never use `--no-verify`

Only commit when the user has asked you to. If unclear, ask first.

### 6. Repeat

If the plan has more work, return to step 2 for the next increment. After all work is done, give the user a brief summary of what was committed.

## Rules

- Never disable lint rules or `// @ts-ignore` away type errors — fix the root cause
- Never use `--no-verify` on commits
- Keep commits focused — one logical change per commit
- If a code change affects a documented topic in `.claude/docs/`, suggest updating the doc
