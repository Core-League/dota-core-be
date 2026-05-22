---
name: review
description: Review git changes, explain what was changed and why, and identify critical bugs
allowed-tools: Bash(git *), Read, Grep, Glob
---

# Code Review Task

Review the pending changes on the current branch and provide **concise, focused feedback**.

**Keep it brief** - only mention what's important, skip trivial changes.

## Step 1: Get the changes

Run these commands to understand what changed:
- `git diff master...HEAD --name-status` - List all changed files
- `git diff master...HEAD` - Get full diff of changes

## Step 2: Read and analyze the changed files

Read each changed file to understand:
- What functionality was added/modified
- The purpose and intent of the changes
- How the changes fit into the existing codebase

## Step 3: Provide comprehensive feedback

Your review should include:

### 1. Overview
- Summarize what was changed in 2-3 sentences
- Explain the purpose/goal of these changes

### 2. Key Changes
Briefly highlight only the most important changes:
- Major logic changes or new functionality
- Significant refactoring or architectural changes
- Important deletions or modifications
- Skip minor changes, styling, or self-explanatory code

### 3. Critical Issues Check
**Focus only on obvious, critical problems:**
- Logic errors that would cause bugs
- Type mismatches (arrays vs objects, wrong data types)
- Missing error handling in critical paths
- Obvious security vulnerabilities
- Breaking changes that affect other code
- Performance issues that are clearly problematic

**DO NOT focus on:**
- Code style nitpicks
- Minor optimizations
- Subjective improvements
- Documentation or comments

### 4. Summary
- Quick verdict: Does this look good to merge?
- Any blockers that must be fixed?
- Optional improvements (if any)

## Important Guidelines
- Be concise - focus on what matters
- Skip obvious or trivial changes
- Use file paths with line numbers only for critical issues
- If code looks good, say so quickly - don't invent issues
- Stay positive and constructive
- Avoid verbose explanations for every file