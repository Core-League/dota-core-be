---
name: make-a-plan
description: Turn any requirement (a sentence, ticket, bug report, feature idea, or PRD) into a multi-phase implementation plan using tracer-bullet vertical slices, saved as a Markdown file in .claude/plans/. Uses the grill-me skill to interrogate the requirement before slicing. Use when the user wants to plan work from a loose requirement, mentions "make a plan", "plan this", "break this down", or "tracer bullets" — and a formal PRD is NOT required.
---

# Make a Plan

Take any requirement — short or long, formal or informal — and produce a phased implementation plan in `.claude/plans/`. Unlike `prd-to-plan`, this skill does not require a PRD: it accepts a one-line ask, a bug report, a screenshot description, or anything in between.

## Process

### 1. Capture the requirement

The requirement should already be in the conversation. If it's vague (one sentence, a link, "fix this thing"), do NOT start slicing yet. Ask the user to paste, link, or describe it more fully if needed. Note any source file paths (tickets, screenshots, prior plans) so they can be linked from the plan.

### 2. Explore the codebase

Read the areas the requirement touches. Confirm the user's assumptions, find the existing patterns, and identify integration layers (route, component, store, API, service).

### 3. Grill the user

**Invoke the `grill-me` skill** to interrogate the requirement and reach shared understanding. Walk the decision tree one branch at a time, asking one question at a time, providing your recommended answer for each. Do NOT skip this step — even short requirements have hidden branches (edge cases, error states, permissions, mobile vs desktop, empty states).

If a question can be answered by exploring the codebase, explore instead of asking.

Stop grilling when the user signals "enough" or when no open branches remain.

### 4. Identify durable architectural decisions

Before slicing, list decisions unlikely to change during implementation:

- Route paths / URL patterns
- Schema or store shape
- Key data models / API contracts
- Auth / permission approach
- Third-party boundaries

These go in the plan header and are referenced by every phase.

### 5. Draft vertical slices

Break the work into **tracer-bullet** phases. Each phase is a thin vertical slice that cuts through every relevant layer end-to-end.

<vertical-slice-rules>
- Each slice delivers a narrow but COMPLETE path through every layer (store, API, UI, etc.)
- A completed slice is demoable or verifiable on its own
- Prefer many thin slices over few thick ones
- Do NOT include specific file names, function names, or other details likely to change
- DO include durable decisions: route paths, schema shapes, model names
</vertical-slice-rules>

If the requirement is small (single bug, one-screen tweak), a single phase is fine — say so explicitly rather than padding.

### 6. Confirm the breakdown

Present the proposed phases as a numbered list. For each phase show:

- **Title** — short descriptive name
- **What it covers** — one-line scope

Ask: does the granularity feel right? Should anything be merged or split? Iterate until the user approves.

### 7. Write the plan file

Create `.claude/plans/` if it doesn't exist. Write the plan as a Markdown file named after the feature (e.g. `.claude/plans/punching-rules-multi-ip.md`). Use the template below.

<plan-template>
# Plan: <Feature Name>

> Source: <link or short description of the requirement — ticket URL, PRD path, or inline summary>

## Architectural decisions

Durable decisions that apply across all phases:

- **Routes**: ...
- **Schema / store**: ...
- **Key models**: ...
- (add/remove sections as appropriate)

---

## Phase 1: <Title>

**Scope**: <one-line description>

### What to build

End-to-end behavior of this vertical slice. Describe the demoable outcome, not layer-by-layer implementation.

### Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

---

## Phase 2: <Title>

**Scope**: ...

### What to build

...

### Acceptance criteria

- [ ] ...

<!-- Repeat for each phase -->
</plan-template>

## Notes

- This skill is the entry point when there is no PRD. If the user already has a PRD, prefer `prd-to-plan`.
- The output plan is the input expected by `do-work`.
