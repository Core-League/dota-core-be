# BO3 Game Tracking Design

**Date:** 2026-05-24
**Status:** Approved

## Problem

BO3 playoff matches produce multiple individual games, but `PlayoffMatch` has no game number and no verified flag. This makes it impossible to verify or correct individual game results within a series.

## Goal

- Each game in a BO3 series is independently numbered, verifiable, and editable.
- BO1 matches are unaffected (they just always have `gameNumber = 1`).
- Challonge reporting logic is unchanged.

## Data Model

Add two columns to `playoff_match`:

| Column | Type | Default |
|---|---|---|
| `game_number` | `int` | `1` |
| `is_verified` | `boolean` | `false` |

`game_number` is assigned at submit time: count existing `PlayoffMatch` rows with the same `challongeMatchId`, add 1. First game submitted = 1, second = 2, third = 3.

**Migration:** backfill existing records by ordering within each `challongeMatchId` group by `created_at`, assign `game_number` 1/2/3; set `is_verified = false` for all.

## Submit Flow

In `PlayoffService.submitMatch`, before inserting the new `PlayoffMatch`, query the count of existing rows with the same `challongeMatchId` and assign `gameNumber = count + 1`.

No other changes to the submit path (win tally, Challonge reporting, Dota fixture sync are unchanged).

## Verify Flow

The existing verify endpoint targets a `PlayoffMatch` by ID. Since each game is its own row, verify works per-game with no endpoint signature change. Sets `isVerified = true`.

## Admin Result Override

The existing admin override targets a `PlayoffMatch` by ID — same story. When a game's `winnerId` is changed, `isVerified` is reset to `false` so the corrected result requires re-verification.

## Queries

Any query that loads playoff match results for a series should `ORDER BY game_number ASC`. A 1-1 tie is detectable by: two games with the same `challongeMatchId`, each with a different `winnerId`.

## Out of Scope

- Pre-creating game records before games are played
- Series-level status field (derived from game records)
- Changes to Challonge reporting
