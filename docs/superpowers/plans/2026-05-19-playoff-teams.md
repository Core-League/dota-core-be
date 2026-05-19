# Playoff Teams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four endpoints to manage which teams play the playoff for a given tournament, backed by a dedicated `tournament_playoff_team` join table.

**Architecture:** New `TournamentPlayoffTeam` entity + repository in the `tournaments` module. Four methods added to `TournamentsService`. Four endpoints added to `TournamentsController`. Validation checks that teams have at least one verified `QualificationMatch` (`winner IS NOT NULL`) in the tournament before allowing them into the playoff roster.

**Tech Stack:** NestJS 11, TypeORM 0.3, PostgreSQL 16, class-validator

---

## File Map

| Action | File |
|---|---|
| Create | `src/tournaments/tournament-playoff-team.entity.ts` |
| Create | `src/migrations/1746800000000-AddTournamentPlayoffTeam.ts` |
| Create | `src/tournaments/dto/playoff-teams.dto.ts` |
| Create | `src/tournaments/tournament-playoff-team.repository.ts` |
| Modify | `src/tournaments/tournaments.module.ts` |
| Modify | `src/tournaments/tournaments.service.ts` |
| Modify | `src/tournaments/tournaments.controller.ts` |

---

## Task 1: Entity

**Files:**
- Create: `src/tournaments/tournament-playoff-team.entity.ts`

- [ ] **Step 1: Create the entity file**

```typescript
// src/tournaments/tournament-playoff-team.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Tournament } from './tournaments.entity';
import { Team } from '../teams/team.entity';

@Entity('tournament_playoff_team')
@Unique(['tournamentId', 'teamId'])
export class TournamentPlayoffTeam {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tournamentId: string;

  @ManyToOne(() => Tournament, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tournamentId' })
  tournament: Tournament;

  @Column({ type: 'uuid' })
  teamId: string;

  @ManyToOne(() => Team, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'teamId' })
  team: Team;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build
```

Expected: exits with code 0 (or only pre-existing errors if any).

- [ ] **Step 3: Commit**

```bash
git add src/tournaments/tournament-playoff-team.entity.ts
git commit -m "feat: add TournamentPlayoffTeam entity"
```

---

## Task 2: Migration

**Files:**
- Create: `src/migrations/1746800000000-AddTournamentPlayoffTeam.ts`

- [ ] **Step 1: Create the migration file**

```typescript
// src/migrations/1746800000000-AddTournamentPlayoffTeam.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTournamentPlayoffTeam1746800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE tournament_playoff_team (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "tournamentId" UUID NOT NULL REFERENCES tournament(id) ON DELETE CASCADE,
        "teamId" UUID NOT NULL REFERENCES team(id) ON DELETE CASCADE,
        CONSTRAINT uq_tournament_playoff_team UNIQUE ("tournamentId", "teamId")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS tournament_playoff_team`);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build
```

Expected: exits with code 0.

- [ ] **Step 3: Commit**

```bash
git add src/migrations/1746800000000-AddTournamentPlayoffTeam.ts
git commit -m "feat: add migration for tournament_playoff_team table"
```

---

## Task 3: DTO

**Files:**
- Create: `src/tournaments/dto/playoff-teams.dto.ts`

- [ ] **Step 1: Create the DTO file**

```typescript
// src/tournaments/dto/playoff-teams.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsUUID } from 'class-validator';

export class PlayoffTeamsDto {
  @ApiProperty({ type: [String], format: 'uuid', example: ['uuid-1', 'uuid-2'] })
  @IsArray()
  @IsUUID('all', { each: true })
  teamIds: string[];
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build
```

Expected: exits with code 0.

- [ ] **Step 3: Commit**

```bash
git add src/tournaments/dto/playoff-teams.dto.ts
git commit -m "feat: add PlayoffTeamsDto"
```

---

## Task 4: Repository

**Files:**
- Create: `src/tournaments/tournament-playoff-team.repository.ts`

- [ ] **Step 1: Create the repository file**

```typescript
// src/tournaments/tournament-playoff-team.repository.ts
import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { TournamentPlayoffTeam } from './tournament-playoff-team.entity';
import { Team } from '../teams/team.entity';

const TEAM_RELATIONS = [
  'captain',
  'captain.roles',
  'coach',
  'coach.roles',
  'mainPlayers',
  'mainPlayers.roles',
  'reservedPlayers',
  'reservedPlayers.roles',
  'tournament',
];

@Injectable()
export class TournamentPlayoffTeamRepository {
  private readonly repo: Repository<TournamentPlayoffTeam>;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    this.repo = dataSource.getRepository(TournamentPlayoffTeam);
  }

  findByTournamentId(tournamentId: string): Promise<TournamentPlayoffTeam[]> {
    return this.repo.find({
      where: { tournamentId },
      relations: TEAM_RELATIONS.map((r) => `team.${r}`).concat(['team']),
    });
  }

  /** Returns team IDs that appear in at least one verified match (winner IS NOT NULL). */
  async findVerifiedQualificationTeamIds(tournamentId: string): Promise<string[]> {
    const rows: Array<{ team_id: string }> = await this.dataSource.query(
      `SELECT DISTINCT team_id FROM (
         SELECT qm."teamAId" AS team_id
         FROM qualification_match qm
         INNER JOIN qualification q ON q.id = qm."qualificationId"
         WHERE q."tournamentId" = $1 AND qm."winnerId" IS NOT NULL
         UNION
         SELECT qm."teamBId" AS team_id
         FROM qualification_match qm
         INNER JOIN qualification q ON q.id = qm."qualificationId"
         WHERE q."tournamentId" = $1 AND qm."winnerId" IS NOT NULL
       ) t`,
      [tournamentId],
    );
    return rows.map((r) => r.team_id);
  }

  /** Returns full Team entities for teams with at least one verified qualification match. */
  async findQualificationTeams(tournamentId: string): Promise<Team[]> {
    const ids = await this.findVerifiedQualificationTeamIds(tournamentId);
    if (!ids.length) return [];
    return this.dataSource.getRepository(Team).find({
      where: { id: In(ids) },
      relations: TEAM_RELATIONS,
    });
  }

  /** Inserts rows; silently ignores teams already in the playoff list. */
  async addTeams(tournamentId: string, teamIds: string[]): Promise<void> {
    if (!teamIds.length) return;
    await this.repo
      .createQueryBuilder()
      .insert()
      .into(TournamentPlayoffTeam)
      .values(teamIds.map((teamId) => ({ tournamentId, teamId })))
      .orIgnore()
      .execute();
  }

  /** Removes matching rows; silently ignores IDs not present. */
  async removeTeams(tournamentId: string, teamIds: string[]): Promise<void> {
    if (!teamIds.length) return;
    await this.repo.delete({ tournamentId, teamId: In(teamIds) });
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build
```

Expected: exits with code 0.

- [ ] **Step 3: Commit**

```bash
git add src/tournaments/tournament-playoff-team.repository.ts
git commit -m "feat: add TournamentPlayoffTeamRepository"
```

---

## Task 5: Module wiring

**Files:**
- Modify: `src/tournaments/tournaments.module.ts`

- [ ] **Step 1: Register entity and repository in the module**

Replace the entire file with:

```typescript
// src/tournaments/tournaments.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Dota2Module } from '../dota2/dota2.module';
import { QualificationModule } from '../qualification/qualification.module';
import { TournamentsService } from './tournaments.service';
import { TournamentsController } from './tournaments.controller';
import { Tournament } from './tournaments.entity';
import { TournamentPlayoffTeam } from './tournament-playoff-team.entity';
import { Team } from '../teams/team.entity';
import { UserRoles } from '../user-roles/user-roles.entity';
import { TournamentsRepository } from './tournaments.repository';
import { TournamentPlayoffTeamRepository } from './tournament-playoff-team.repository';
import { UploadsModule } from '../uploads/uploads.module';
import { TeamsModule } from '../teams/teams.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Tournament, TournamentPlayoffTeam, Team, UserRoles]),
    AuthModule,
    UploadsModule,
    Dota2Module,
    QualificationModule,
    TeamsModule,
  ],
  providers: [TournamentsService, TournamentsRepository, TournamentPlayoffTeamRepository],
  controllers: [TournamentsController],
})
export class TournamentsModule {}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build
```

Expected: exits with code 0.

- [ ] **Step 3: Commit**

```bash
git add src/tournaments/tournaments.module.ts
git commit -m "feat: register TournamentPlayoffTeam in tournaments module"
```

---

## Task 6: Service methods

**Files:**
- Modify: `src/tournaments/tournaments.service.ts`

- [ ] **Step 1: Inject TournamentPlayoffTeamRepository and add the four new methods**

Replace the entire file with:

```typescript
// src/tournaments/tournaments.service.ts
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Dota2Service } from '../dota2/dota2.service';
import { QualificationService } from '../qualification/qualification.service';
import { Tournament } from './tournaments.entity';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { TournamentsRepository } from './tournaments.repository';
import { TournamentPlayoffTeamRepository } from './tournament-playoff-team.repository';
import { TeamsService } from '../teams/teams.service';
import { TeamResponseDto } from '../teams/dto/team-response.dto';

@Injectable()
export class TournamentsService {
  private readonly logger = new Logger(TournamentsService.name);

  constructor(
    private readonly tournamentsRepo: TournamentsRepository,
    private readonly playoffTeamRepo: TournamentPlayoffTeamRepository,
    private readonly dota2: Dota2Service,
    private readonly qualificationService: QualificationService,
    private readonly teamsService: TeamsService,
  ) {}

  async create(dto: CreateTournamentDto): Promise<Tournament> {
    const entity = this.tournamentsRepo.create({
      ...dto,
      registrationStartsAt: new Date(dto.registrationStartsAt),
      registrationEndsAt: new Date(dto.registrationEndsAt),
      tournamentStartsAt: new Date(dto.tournamentStartsAt),
      tournamentEndsAt: new Date(dto.tournamentEndsAt),
    });
    const tournament = await this.tournamentsRepo.save(entity);

    this.logger.log(
      `Tournament ${tournament.id}: calling addNodeGroup for qualification stage`,
    );
    await this.dota2.addNodeGroup({
      nodeGroupId: '',
      nodeGroupType: 1,
      teamCount: 0,
      containingNodeGroupId: '0',
      phase: 2,
      defaultNodeType: 0,
    });
    const nodeGroupId = await this.dota2.resolveOrganizationalNodeGroupId();
    this.logger.log(
      `Qualification stage nodeGroupId=${nodeGroupId} (parsed from Dota2 page)`,
    );
    await this.qualificationService.createForTournament(
      tournament,
      nodeGroupId,
    );

    return tournament;
  }

  findAll(): Promise<Tournament[]> {
    return this.tournamentsRepo.findAll();
  }

  private async findOneEntity(id: string): Promise<Tournament> {
    const tournament = await this.tournamentsRepo.findOneById(id);
    if (!tournament) {
      throw new NotFoundException('Турнір не знайдено');
    }
    return tournament;
  }

  async findOne(id: string) {
    const tournament = await this.findOneEntity(id);
    return {
      ...tournament,
      teams: (tournament.teams ?? []).map((t) =>
        this.teamsService.toTeamResponse(t),
      ),
    };
  }

  async update(id: string, payload: Partial<Tournament>): Promise<Tournament> {
    const tournament = await this.findOneEntity(id);
    Object.assign(tournament, payload);
    return this.tournamentsRepo.save(tournament);
  }

  async remove(id: string): Promise<void> {
    const tournament = await this.findOneEntity(id);

    try {
      const qualification =
        await this.qualificationService.getByTournamentId(id);

      for (const match of qualification.matches ?? []) {
        this.logger.log(`Removing Dota2 match node group ${match.nodeGroupId}`);
        await this.dota2.removeNodeGroup(match.nodeGroupId);
      }

      this.logger.log(
        `Removing Dota2 qualification node group ${qualification.nodeGroupId} for tournament ${id}`,
      );
      await this.dota2.removeNodeGroup(qualification.nodeGroupId);
    } catch {
      this.logger.warn(
        `No qualification found for tournament ${id} — skipping Dota2 node group removal`,
      );
    }

    await this.tournamentsRepo.remove(tournament);
  }

  async getQualificationTeams(tournamentId: string): Promise<TeamResponseDto[]> {
    await this.findOneEntity(tournamentId);
    const teams = await this.playoffTeamRepo.findQualificationTeams(tournamentId);
    return teams.map((t) => this.teamsService.toTeamResponse(t));
  }

  async getPlayoffTeams(tournamentId: string): Promise<TeamResponseDto[]> {
    await this.findOneEntity(tournamentId);
    const rows = await this.playoffTeamRepo.findByTournamentId(tournamentId);
    return rows.map((row) => this.teamsService.toTeamResponse(row.team));
  }

  async addPlayoffTeams(tournamentId: string, teamIds: string[]): Promise<TeamResponseDto[]> {
    await this.findOneEntity(tournamentId);

    const eligibleIds = await this.playoffTeamRepo.findVerifiedQualificationTeamIds(tournamentId);
    const eligibleSet = new Set(eligibleIds);
    const invalid = teamIds.filter((id) => !eligibleSet.has(id));
    if (invalid.length) {
      throw new BadRequestException(
        `Teams have no verified qualification matches in this tournament: ${invalid.join(', ')}`,
      );
    }

    await this.playoffTeamRepo.addTeams(tournamentId, teamIds);
    return this.getPlayoffTeams(tournamentId);
  }

  async removePlayoffTeams(tournamentId: string, teamIds: string[]): Promise<TeamResponseDto[]> {
    await this.findOneEntity(tournamentId);
    await this.playoffTeamRepo.removeTeams(tournamentId, teamIds);
    return this.getPlayoffTeams(tournamentId);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build
```

Expected: exits with code 0.

- [ ] **Step 3: Commit**

```bash
git add src/tournaments/tournaments.service.ts
git commit -m "feat: add playoff and qualification team service methods"
```

---

## Task 7: Controller endpoints

**Files:**
- Modify: `src/tournaments/tournaments.controller.ts`

- [ ] **Step 1: Add the four new endpoints**

Add these four methods to `TournamentsController`, before the banner upload endpoints (after the `submitMatch` handler at line ~162):

```typescript
  @Get(':id/qualification/teams')
  @ApiOkResponse({ type: [TeamResponseDto] })
  getQualificationTeams(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.tournamentsService.getQualificationTeams(id);
  }

  @Get(':id/playoff/teams')
  @ApiOkResponse({ type: [TeamResponseDto] })
  getPlayoffTeams(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.tournamentsService.getPlayoffTeams(id);
  }

  @Post(':id/playoff/teams')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: [TeamResponseDto] })
  addPlayoffTeams(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: PlayoffTeamsDto,
  ) {
    return this.tournamentsService.addPlayoffTeams(id, body.teamIds);
  }

  @Delete(':id/playoff/teams')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: [TeamResponseDto] })
  removePlayoffTeams(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: PlayoffTeamsDto,
  ) {
    return this.tournamentsService.removePlayoffTeams(id, body.teamIds);
  }
```

Also add the following imports at the top of the controller file (merge with existing imports):

```typescript
import { TeamResponseDto } from '../teams/dto/team-response.dto';
import { PlayoffTeamsDto } from './dto/playoff-teams.dto';
```

- [ ] **Step 2: Verify TypeScript compiles with no errors**

```bash
npm run build
```

Expected: exits with code 0.

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/tournaments/tournaments.controller.ts
git commit -m "feat: add playoff and qualification team endpoints"
```

---

## Task 8: Final verification

- [ ] **Step 1: Run full build**

```bash
npm run build
```

Expected: exits with code 0.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 3: Confirm Swagger shows four new routes**

Start the dev server and open `/api` in a browser:

```bash
npm run start:dev
```

Verify these four routes appear under the `tournaments` tag:
- `GET /tournaments/{id}/qualification/teams`
- `GET /tournaments/{id}/playoff/teams`
- `POST /tournaments/{id}/playoff/teams`
- `DELETE /tournaments/{id}/playoff/teams`

Stop the server when done.

- [ ] **Step 4: Apply migration to local DB (if running locally)**

```bash
npm run migration:run
```

Expected: `AddTournamentPlayoffTeam1746800000000` appears in the output as executed.
