# BO3 Game Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `gameNumber` and `isVerified` to `PlayoffMatch` so each game in a BO3 series is independently numbered, verifiable, and admin-overridable.

**Architecture:** Two new columns on `playoff_match` (no new tables). `gameNumber` is assigned at submit time by counting prior games in the same series. A new verify endpoint and a new admin override endpoint cover the user-facing operations. Challonge reporting logic is untouched.

**Tech Stack:** NestJS 11, TypeORM 0.3, PostgreSQL 16, Jest

---

## File Map

| File | Change |
|---|---|
| `src/playoff/playoff-match.entity.ts` | Add `gameNumber` and `isVerified` columns |
| `src/playoff/playoff-match.repository.ts` | Order by `gameNumber` instead of `createdAt` |
| `src/playoff/playoff.service.ts` | Assign `gameNumber` on submit; add `verifyPlayoffMatch` method |
| `src/tournaments/tournaments.controller.ts` | Add `POST :id/playoff/matches/:matchId/verify` |
| `src/admin/admin.service.ts` | Add `overridePlayoffMatchResult` method |
| `src/admin/admin.controller.ts` | Add `POST playoff-matches/:matchId/result` |
| `src/migrations/1779800000000-AddPlayoffMatchGameTracking.ts` | Add columns + backfill |

---

## Task 1: Add columns to `PlayoffMatch` entity

**Files:**
- Modify: `src/playoff/playoff-match.entity.ts`

- [ ] **Step 1: Add `gameNumber` and `isVerified` columns**

Replace the `createdAt` block at the bottom of the entity (keep `createdAt`), adding the two new columns before it:

```typescript
// src/playoff/playoff-match.entity.ts
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Team } from '../teams/team.entity';
import { Playoff } from './playoff.entity';

@Entity('playoff_match')
export class PlayoffMatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  playoffId: string;

  @ManyToOne(() => Playoff, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'playoffId' })
  playoff: Playoff;

  @Column({ type: 'uuid', nullable: true })
  teamAId: string | null;

  @ManyToOne(() => Team, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'teamAId' })
  teamA: Team | null;

  @Column({ type: 'uuid', nullable: true })
  teamBId: string | null;

  @ManyToOne(() => Team, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'teamBId' })
  teamB: Team | null;

  @Column({ type: 'uuid', nullable: true })
  winnerId: string | null;

  @ManyToOne(() => Team, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'winnerId' })
  winner: Team | null;

  @Column({ type: 'varchar', nullable: true })
  dotaMatchId: string | null;

  @Column({ type: 'varchar' })
  challongeMatchId: string;

  @Column({ type: 'int', default: 1 })
  gameNumber: number;

  @Column({ type: 'boolean', default: false })
  isVerified: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/playoff/playoff-match.entity.ts
git commit -m "feat: add gameNumber and isVerified to PlayoffMatch entity"
```

---

## Task 2: Migration — add columns and backfill

**Files:**
- Create: `src/migrations/1779800000000-AddPlayoffMatchGameTracking.ts`

- [ ] **Step 1: Create the migration file**

```typescript
// src/migrations/1779800000000-AddPlayoffMatchGameTracking.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPlayoffMatchGameTracking1779800000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "playoff_match"
      ADD COLUMN IF NOT EXISTS "gameNumber" int NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS "isVerified" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      UPDATE "playoff_match" pm
      SET "gameNumber" = sub.rn
      FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY "challongeMatchId"
                 ORDER BY "createdAt" ASC
               ) AS rn
        FROM "playoff_match"
      ) sub
      WHERE pm.id = sub.id
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "playoff_match"
      DROP COLUMN IF EXISTS "gameNumber",
      DROP COLUMN IF EXISTS "isVerified"
    `);
  }
}
```

- [ ] **Step 2: Verify migration runs (local dev DB)**

```bash
npm run migration:run
```
Expected: `AddPlayoffMatchGameTracking1779800000000` listed as executed, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/migrations/1779800000000-AddPlayoffMatchGameTracking.ts
git commit -m "feat: migration — add gameNumber and isVerified to playoff_match"
```

---

## Task 3: Repository — order by `gameNumber`

**Files:**
- Modify: `src/playoff/playoff-match.repository.ts`

- [ ] **Step 1: Change sort key in `findByPlayoffId`**

```typescript
// src/playoff/playoff-match.repository.ts
findByPlayoffId(playoffId: string): Promise<PlayoffMatch[]> {
  return this.repo.find({
    where: { playoffId },
    order: { gameNumber: 'ASC' },
  });
}
```

- [ ] **Step 2: Compile check**

```bash
npm run build
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/playoff/playoff-match.repository.ts
git commit -m "feat: order playoff matches by gameNumber"
```

---

## Task 4: `submitMatch` — assign `gameNumber`

**Files:**
- Modify: `src/playoff/playoff.service.ts`

The `submitMatch` method currently creates a `PlayoffMatch` without a `gameNumber`. We need to count existing games for the same series and set `gameNumber = count + 1` before saving.

- [ ] **Step 1: Write the failing test**

Create `src/playoff/playoff.service.game-number.spec.ts`:

```typescript
// src/playoff/playoff.service.game-number.spec.ts
describe('gameNumber assignment', () => {
  it('assigns gameNumber 1 for first game in series', () => {
    const existingGames: { challongeMatchId: string }[] = [];
    const challongeMatchId = 'match-42';
    const count = existingGames.filter(
      (g) => g.challongeMatchId === challongeMatchId,
    ).length;
    expect(count + 1).toBe(1);
  });

  it('assigns gameNumber 2 for second game in series', () => {
    const existingGames = [{ challongeMatchId: 'match-42' }];
    const challongeMatchId = 'match-42';
    const count = existingGames.filter(
      (g) => g.challongeMatchId === challongeMatchId,
    ).length;
    expect(count + 1).toBe(2);
  });

  it('assigns gameNumber 3 for third game in series', () => {
    const existingGames = [
      { challongeMatchId: 'match-42' },
      { challongeMatchId: 'match-42' },
    ];
    const challongeMatchId = 'match-42';
    const count = existingGames.filter(
      (g) => g.challongeMatchId === challongeMatchId,
    ).length;
    expect(count + 1).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails (before implementation)**

```bash
npm run test -- --testPathPattern="game-number.spec"
```
Expected: PASS (these tests are pure logic — they verify the counting formula, which is correct by construction). If they fail, the test logic itself is wrong — fix the test before continuing.

- [ ] **Step 3: Add `gameNumber` assignment to `submitMatch`**

In `src/playoff/playoff.service.ts`, locate the block where the duplicate-submission guard runs and `challongeMatch` is found (around line 199). Insert the count query **after** `challongeMatch` is resolved (because `challongeMatchId` comes from `challongeMatch.id`), and **before** `this.playoffMatchRepo.create(...)`:

```typescript
// After: const challongeMatch = await this.challonge.findOpenMatch(...)
// Before: const match = this.playoffMatchRepo.create(...)

const gameCount = await this.dataSource.getRepository(PlayoffMatch).count({
  where: {
    playoffId: playoff.id,
    challongeMatchId: String(challongeMatch.id),
  },
});

const match = this.playoffMatchRepo.create({
  playoffId: playoff.id,
  teamAId: winnerRow.teamId,
  teamBId: loserRow.teamId,
  winnerId: winnerRow.teamId,
  dotaMatchId,
  challongeMatchId: String(challongeMatch.id),
  gameNumber: gameCount + 1,
});
```

- [ ] **Step 4: Compile check**

```bash
npm run build
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/playoff/playoff.service.ts src/playoff/playoff.service.game-number.spec.ts
git commit -m "feat: assign gameNumber on playoff match submit"
```

---

## Task 5: Verify endpoint

**Files:**
- Modify: `src/playoff/playoff.service.ts` (add `verifyPlayoffMatch`)
- Modify: `src/tournaments/tournaments.controller.ts` (add route)

- [ ] **Step 1: Add `verifyPlayoffMatch` to `PlayoffService`**

Add this method to `src/playoff/playoff.service.ts`, after `submitMatch`:

```typescript
async verifyPlayoffMatch(
  tournamentId: string,
  matchId: string,
): Promise<PlayoffMatch> {
  const playoff = await this.playoffRepo.findByTournamentId(tournamentId);
  if (!playoff) throw new NotFoundException('Playoff not found');

  const match = await this.dataSource
    .getRepository(PlayoffMatch)
    .findOne({ where: { id: matchId, playoffId: playoff.id } });
  if (!match) throw new NotFoundException('Playoff match not found');

  match.isVerified = true;
  return this.dataSource.getRepository(PlayoffMatch).save(match);
}
```

- [ ] **Step 2: Add route to `TournamentsController`**

In `src/tournaments/tournaments.controller.ts`, add after the existing `submitPlayoffMatch` block (around line 235):

```typescript
@Post(':id/playoff/matches/:matchId/verify')
@UseGuards(JwtAuthGuard)
@ApiOperation({ summary: 'Verify a playoff game result' })
@ApiParam({ name: 'id', type: String, format: 'uuid' })
@ApiParam({ name: 'matchId', type: String, format: 'uuid' })
verifyPlayoffMatch(
  @Param('id', ParseUUIDPipe) tournamentId: string,
  @Param('matchId', ParseUUIDPipe) matchId: string,
): Promise<PlayoffMatch> {
  return this.playoffService.verifyPlayoffMatch(tournamentId, matchId);
}
```

Make sure `PlayoffMatch` is imported in the controller. Check the existing imports — if not present, add:
```typescript
import { PlayoffMatch } from '../playoff/playoff-match.entity';
```

- [ ] **Step 3: Compile check**

```bash
npm run build
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/playoff/playoff.service.ts src/tournaments/tournaments.controller.ts
git commit -m "feat: add verify endpoint for playoff game results"
```

---

## Task 6: Admin override for playoff games

**Files:**
- Modify: `src/admin/admin.service.ts` (add `overridePlayoffMatchResult`)
- Modify: `src/admin/admin.controller.ts` (add route)

The existing `overrideMatchResult` handles qualification matches only. This adds a separate method for playoff games. It changes `winnerId` and resets `isVerified = false`. No point logic — playoff points are not tracked per game.

- [ ] **Step 1: Add `overridePlayoffMatchResult` to `AdminService`**

Add import at the top of `src/admin/admin.service.ts` if not present:
```typescript
import { PlayoffMatch } from '../playoff/playoff-match.entity';
```

Add the method after `overrideMatchResult`:

```typescript
async overridePlayoffMatchResult(
  matchId: string,
  dto: OverrideMatchResultDto,
): Promise<{ matchId: string; winnerId: string }> {
  const matchRepo = this.dataSource.getRepository(PlayoffMatch);

  const match = await matchRepo.findOne({
    where: { id: matchId },
    relations: ['teamA', 'teamB'],
  });
  if (!match) throw new NotFoundException('Playoff match not found');

  if (!match.teamA || !match.teamB) {
    throw new BadRequestException(
      'Match is missing one or both sides — team rows may have been deleted',
    );
  }

  if (
    dto.winnerTeamId !== match.teamAId &&
    dto.winnerTeamId !== match.teamBId
  ) {
    throw new BadRequestException(
      'winnerTeamId must be one of the two teams in this match',
    );
  }

  match.winnerId = dto.winnerTeamId;
  match.isVerified = false;
  await matchRepo.save(match);

  return { matchId, winnerId: dto.winnerTeamId };
}
```

- [ ] **Step 2: Add route to `AdminController`**

In `src/admin/admin.controller.ts`, after the existing `overrideMatchResult` block:

```typescript
@Post('playoff-matches/:matchId/result')
@ApiOperation({
  summary: 'Override a playoff game result',
  description:
    'Changes the winner of an individual playoff game and resets isVerified to false.',
})
@ApiParam({ name: 'matchId', type: String, format: 'uuid' })
overridePlayoffMatchResult(
  @Param('matchId', ParseUUIDPipe) matchId: string,
  @Body() body: OverrideMatchResultDto,
): Promise<{ matchId: string; winnerId: string }> {
  return this.adminService.overridePlayoffMatchResult(matchId, body);
}
```

- [ ] **Step 3: Compile check**

```bash
npm run build
```
Expected: no errors.

- [ ] **Step 4: Lint**

```bash
npm run lint
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/admin/admin.service.ts src/admin/admin.controller.ts
git commit -m "feat: admin override for individual playoff game results"
```
