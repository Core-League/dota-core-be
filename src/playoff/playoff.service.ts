// src/playoff/playoff.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import { ChallongeService } from '../challonge/challonge.service';
import { Dota2Service } from '../dota2/dota2.service';
import { Team } from '../teams/team.entity';
import { TeamsService } from '../teams/teams.service';
import { PlayerTournamentPoints } from '../tournaments/player-tournament-points.entity';
import { Tournament } from '../tournaments/tournaments.entity';
import { TournamentPlayoffTeam } from '../tournaments/tournament-playoff-team.entity';
import { TournamentStatus } from '../tournaments/tournaments.model';
import { PlayoffMatch } from './playoff-match.entity';
import { PlayoffMatchRepository } from './playoff-match.repository';
import { PlayoffRepository } from './playoff.repository';
import { PlayoffResponseDto } from './dto/playoff-response.dto';
import { TechLossPlayoffDto } from './dto/tech-loss-playoff.dto';
import { OpenPlayoffMatchDto } from './dto/open-playoff-match.dto';
import { Playoff } from './playoff.entity';

@Injectable()
export class PlayoffService {
  private readonly logger = new Logger(PlayoffService.name);

  constructor(
    private readonly playoffRepo: PlayoffRepository,
    private readonly playoffMatchRepo: PlayoffMatchRepository,
    private readonly challonge: ChallongeService,
    private readonly dota2: Dota2Service,
    private readonly teamsService: TeamsService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async startPlayoff(
    tournamentId: string,
    teamIds: string[],
  ): Promise<PlayoffResponseDto> {
    const tournament = await this.dataSource
      .getRepository(Tournament)
      .findOne({ where: { id: tournamentId } });
    if (!tournament) throw new NotFoundException('Tournament not found');

    const existing = await this.playoffRepo.findByTournamentId(tournamentId);
    if (existing) throw new ConflictException('Playoff already started');

    const verifiedTeamIds =
      await this.findVerifiedQualificationTeamIds(tournamentId);
    const invalidIds = teamIds.filter((id) => !verifiedTeamIds.includes(id));
    if (invalidIds.length) {
      throw new BadRequestException(
        `These teams have no verified qualification matches: ${invalidIds.join(', ')}`,
      );
    }

    const seeds = await this.computeSeeds(tournamentId, teamIds);

    const slug = `core_${tournamentId.replace(/-/g, '').slice(0, 8)}_${Date.now().toString(36)}`;
    const { id: challongeTournamentId, url: challongeUrl } =
      await this.challonge.createTournament(tournament.name, slug);

    const teamRepo = this.dataSource.getRepository(Team);
    const teams = await teamRepo.find({ where: { id: In(teamIds) } });
    const teamMap = new Map(teams.map((t) => [t.id, t]));

    const participants = seeds.map((s) => ({
      name: teamMap.get(s.teamId)!.name,
      seed: s.seed,
    }));

    const createdParticipants = await this.challonge.bulkAddParticipants(
      challongeUrl,
      participants,
    );

    const tptRepo = this.dataSource.getRepository(TournamentPlayoffTeam);

    // Insert TournamentPlayoffTeam rows (idempotent — orIgnore if pre-staged)
    if (teamIds.length > 0) {
      await tptRepo
        .createQueryBuilder()
        .insert()
        .orIgnore()
        .values(teamIds.map((teamId) => ({ tournamentId, teamId })))
        .execute();
    }

    // Use index-based matching: bulkAddParticipants returns participants in the
    // same order as the input array, so createdParticipants[i] corresponds to seeds[i].
    for (let i = 0; i < createdParticipants.length; i++) {
      const seed = seeds[i];
      if (!seed) continue;
      await tptRepo.update(
        { tournamentId, teamId: seed.teamId },
        { challongeParticipantId: String(createdParticipants[i].id) },
      );
    }

    // Save Playoff entity early so the idempotency guard fires on retry
    const embedUrl = `https://challonge.com/${challongeUrl}/module`;
    const playoff = this.playoffRepo.create({
      tournamentId,
      challongeTournamentId: String(challongeTournamentId),
      challongeUrl,
      challongeEmbedUrl: embedUrl,
    });
    await this.playoffRepo.save(playoff);

    await this.challonge.startTournament(challongeUrl);

    await this.dataSource
      .getRepository(Tournament)
      .update(
        { id: tournamentId },
        { tournamentStatus: TournamentStatus.PLAYOFF },
      );

    return this.buildPlayoffResponse(embedUrl, tournamentId);
  }

  async submitMatch(
    tournamentId: string,
    dotaMatchId: string,
  ): Promise<PlayoffMatch> {
    const playoff = await this.playoffRepo.findByTournamentId(tournamentId);
    if (!playoff) throw new NotFoundException('Playoff not found');

    // Guard against duplicate submission
    const existingMatch = await this.dataSource
      .getRepository(PlayoffMatch)
      .findOne({ where: { playoffId: playoff.id, dotaMatchId } });
    if (existingMatch) {
      throw new BadRequestException(
        `Match ${dotaMatchId} has already been submitted`,
      );
    }

    const matchData = await this.dota2.getOpenDotaMatch(dotaMatchId);

    const radiantTeamId = matchData.radiant_team_id
      ? String(matchData.radiant_team_id)
      : String(matchData.radiant_team?.team_id ?? '');
    const direTeamId = matchData.dire_team_id
      ? String(matchData.dire_team_id)
      : String(matchData.dire_team?.team_id ?? '');
    const radiantWon = matchData.radiant_win;

    const winnerDotaTeamId = radiantWon ? radiantTeamId : direTeamId;
    const loserDotaTeamId = radiantWon ? direTeamId : radiantTeamId;

    const tptRepo = this.dataSource.getRepository(TournamentPlayoffTeam);
    const allRows = await tptRepo.find({
      where: { tournamentId, isDisqualified: false },
      relations: ['team'],
    });

    const winnerRow = allRows.find(
      (r) => r.team.dotaTeamId === winnerDotaTeamId,
    );
    const loserRow = allRows.find((r) => r.team.dotaTeamId === loserDotaTeamId);

    if (!winnerRow || !loserRow) {
      throw new BadRequestException(
        'Could not find both teams as active playoff participants',
      );
    }

    const challongeMatch = await this.challonge.findOpenMatch(
      playoff.challongeUrl,
      Number(winnerRow.challongeParticipantId),
      Number(loserRow.challongeParticipantId),
    );

    const match = this.playoffMatchRepo.create({
      playoffId: playoff.id,
      teamAId: winnerRow.teamId,
      teamBId: loserRow.teamId,
      winnerId: winnerRow.teamId,
      dotaMatchId,
      challongeMatchId: String(challongeMatch.id),
    });
    await this.playoffMatchRepo.save(match);

    const bo3Rounds = await this.challonge.getBO3Rounds(playoff.challongeUrl);

    if (!bo3Rounds.has(challongeMatch.round)) {
      // BO1 — report immediately
      await this.challonge.reportMatchResult(
        playoff.challongeUrl,
        challongeMatch.id,
        Number(winnerRow.challongeParticipantId),
        challongeMatch.player1_id,
        challongeMatch.player2_id,
      );
    } else {
      // BO3 — tally series wins and report only when someone reaches 2
      const allGames = await this.dataSource.getRepository(PlayoffMatch).find({
        where: {
          playoffId: playoff.id,
          challongeMatchId: String(challongeMatch.id),
        },
      });

      const wins = new Map<string, number>();
      for (const g of allGames) {
        if (g.winnerId) wins.set(g.winnerId, (wins.get(g.winnerId) ?? 0) + 1);
      }

      const seriesWinnerId = [...wins.entries()].find(([, w]) => w >= 2)?.[0];
      if (seriesWinnerId) {
        const seriesWinnerRow =
          seriesWinnerId === winnerRow.teamId ? winnerRow : loserRow;
        const seriesLoserRow =
          seriesWinnerId === winnerRow.teamId ? loserRow : winnerRow;
        const seriesWinnerWins = wins.get(seriesWinnerId) ?? 0;
        const seriesLoserWins = wins.get(seriesLoserRow.teamId) ?? 0;

        await this.challonge.reportMatchResult(
          playoff.challongeUrl,
          challongeMatch.id,
          Number(seriesWinnerRow.challongeParticipantId),
          challongeMatch.player1_id,
          challongeMatch.player2_id,
          seriesWinnerWins,
          seriesLoserWins,
        );
      }
    }

    return match;
  }

  async disqualifyTeam(
    tournamentId: string,
    teamId: string,
  ): Promise<PlayoffResponseDto> {
    const playoff = await this.playoffRepo.findByTournamentId(tournamentId);
    if (!playoff) throw new NotFoundException('Playoff not found');

    const tptRepo = this.dataSource.getRepository(TournamentPlayoffTeam);
    const teamRow = await tptRepo.findOne({
      where: { tournamentId, teamId },
      relations: ['team'],
    });
    if (!teamRow)
      throw new NotFoundException('Team is not a playoff participant');
    if (teamRow.isDisqualified) {
      throw new BadRequestException('Team is already disqualified');
    }

    const oldChallongeUrl = playoff.challongeUrl;

    await tptRepo.update({ tournamentId, teamId }, { isDisqualified: true });
    await this.playoffMatchRepo.deleteByTeamId(teamId);

    const tournament = await this.dataSource
      .getRepository(Tournament)
      .findOne({ where: { id: tournamentId } });
    if (!tournament) throw new NotFoundException('Tournament not found');

    const newSlug = `core_${tournamentId.replace(/-/g, '').slice(0, 8)}_${Date.now().toString(36)}`;
    const { id: newChallongeTournamentId, url: newChallongeUrl } =
      await this.challonge.createTournament(tournament.name, newSlug);

    const activeRows = await tptRepo.find({
      where: { tournamentId, isDisqualified: false },
      relations: ['team'],
    });

    const seeds = await this.computeSeeds(
      tournamentId,
      activeRows.map((r) => r.teamId),
    );

    const participants = seeds.map((s) => {
      const row = activeRows.find((r) => r.teamId === s.teamId)!;
      return { name: row.team.name, seed: s.seed };
    });

    const createdParticipants = await this.challonge.bulkAddParticipants(
      newChallongeUrl,
      participants,
    );

    // Index-based: createdParticipants[i] corresponds to seeds[i] (same order).
    for (let i = 0; i < createdParticipants.length; i++) {
      const seed = seeds[i];
      if (!seed) continue;
      await tptRepo.update(
        { tournamentId, teamId: seed.teamId },
        { challongeParticipantId: String(createdParticipants[i].id) },
      );
    }

    await this.challonge.startTournament(newChallongeUrl);

    const refreshedRows = await tptRepo.find({
      where: { tournamentId, isDisqualified: false },
      relations: ['team'],
    });
    const idMap = new Map(refreshedRows.map((r) => [r.teamId, r]));

    const remainingMatches = await this.playoffMatchRepo.findByPlayoffId(
      playoff.id,
    );
    for (const m of remainingMatches) {
      const rowA = idMap.get(m.teamAId);
      const rowB = idMap.get(m.teamBId);
      const winnerRow = idMap.get(m.winnerId ?? '');
      if (!rowA || !rowB || !winnerRow) continue;

      const challongeMatch = await this.challonge.findOpenMatch(
        newChallongeUrl,
        Number(rowA.challongeParticipantId),
        Number(rowB.challongeParticipantId),
      );
      await this.challonge.reportMatchResult(
        newChallongeUrl,
        challongeMatch.id,
        Number(winnerRow.challongeParticipantId),
        challongeMatch.player1_id,
        challongeMatch.player2_id,
      );
    }

    const newEmbedUrl = `https://challonge.com/${newChallongeUrl}/module`;
    playoff.challongeTournamentId = String(newChallongeTournamentId);
    playoff.challongeUrl = newChallongeUrl;
    playoff.challongeEmbedUrl = newEmbedUrl;

    // Save new bracket to DB first, then clean up old Challonge tournament
    await this.playoffRepo.save(playoff);

    // Delete old bracket after new one is safely persisted (best-effort)
    try {
      await this.challonge.deleteTournament(oldChallongeUrl);
    } catch (err) {
      this.logger.warn(
        'Failed to delete old Challonge tournament (cleanup)',
        err,
      );
    }

    return this.buildPlayoffResponse(newEmbedUrl, tournamentId);
  }

  async getOpenMatches(tournamentId: string): Promise<OpenPlayoffMatchDto[]> {
    const playoff = await this.playoffRepo.findByTournamentId(tournamentId);
    if (!playoff) throw new NotFoundException('Playoff not found');

    const tptRepo = this.dataSource.getRepository(TournamentPlayoffTeam);
    const activeRows = await tptRepo.find({
      where: { tournamentId, isDisqualified: false },
      relations: ['team'],
    });

    // Fetch actual Challonge participants to build the ID→team map.
    // This bypasses potential null challongeParticipantId in DB caused by
    // name-based matching failing on startup.
    const challongeParticipants = await this.challonge.listParticipants(
      playoff.challongeUrl,
    );
    const nameToChallongeId = new Map(
      challongeParticipants.map((p) => [p.name, String(p.id)]),
    );

    const challongeIdToTeam = new Map<
      string,
      { id: string; name: string; logoUrl: string | null }
    >();
    for (const row of activeRows) {
      const cid = nameToChallongeId.get(row.team.name);
      if (!cid) continue;
      challongeIdToTeam.set(cid, {
        id: row.teamId,
        name: row.team.name,
        logoUrl: row.team.logoUrl ?? null,
      });
      // Lazily repair missing challongeParticipantId in DB.
      if (!row.challongeParticipantId) {
        await tptRepo.update(
          { tournamentId, teamId: row.teamId },
          {
            challongeParticipantId: cid,
          },
        );
      }
    }

    // Return ALL matches where both participants are determined (open + complete).
    const allMatches = await this.challonge.listAllMatchesWithBothParticipants(
      playoff.challongeUrl,
    );

    return allMatches.flatMap((m) => {
      const teamA = challongeIdToTeam.get(String(m.participant1Id));
      const teamB = challongeIdToTeam.get(String(m.participant2Id));
      if (!teamA || !teamB) return [];
      return [
        {
          challongeMatchId: m.id,
          round: m.round,
          state: m.state,
          teamA,
          teamB,
        },
      ];
    });
  }

  async techLossMatch(
    tournamentId: string,
    dto: TechLossPlayoffDto,
  ): Promise<PlayoffResponseDto> {
    const { winnerTeamId, loserTeamId } = dto;

    if (winnerTeamId === loserTeamId) {
      throw new BadRequestException('Winner and loser must be different teams');
    }

    const playoff = await this.playoffRepo.findByTournamentId(tournamentId);
    if (!playoff) throw new NotFoundException('Playoff not found');

    const tptRepo = this.dataSource.getRepository(TournamentPlayoffTeam);
    const [winnerRow, loserRow] = await Promise.all([
      tptRepo.findOne({
        where: { tournamentId, teamId: winnerTeamId, isDisqualified: false },
        relations: ['team'],
      }),
      tptRepo.findOne({
        where: { tournamentId, teamId: loserTeamId, isDisqualified: false },
        relations: ['team'],
      }),
    ]);

    if (!winnerRow)
      throw new NotFoundException(
        'Winner team is not an active playoff participant',
      );
    if (!loserRow)
      throw new NotFoundException(
        'Loser team is not an active playoff participant',
      );

    const pmRepo = this.dataSource.getRepository(PlayoffMatch);

    // Check if a match exists where the loser team incorrectly won
    const existingIncorrectMatch = await pmRepo.findOne({
      where: [
        {
          playoffId: playoff.id,
          teamAId: winnerTeamId,
          teamBId: loserTeamId,
          winnerId: loserTeamId,
        },
        {
          playoffId: playoff.id,
          teamAId: loserTeamId,
          teamBId: winnerTeamId,
          winnerId: loserTeamId,
        },
      ],
    });

    if (existingIncorrectMatch) {
      return this.techLossWithRebuild(
        playoff,
        tournamentId,
        existingIncorrectMatch,
        winnerRow,
        loserRow,
        winnerTeamId,
        loserTeamId,
      );
    }

    return this.techLossOpenMatch(
      playoff,
      tournamentId,
      winnerRow,
      loserRow,
      winnerTeamId,
      loserTeamId,
    );
  }

  private async techLossOpenMatch(
    playoff: Playoff,
    tournamentId: string,
    winnerRow: TournamentPlayoffTeam,
    loserRow: TournamentPlayoffTeam,
    winnerTeamId: string,
    loserTeamId: string,
  ): Promise<PlayoffResponseDto> {
    const challongeMatch = await this.challonge.findOpenMatch(
      playoff.challongeUrl,
      Number(winnerRow.challongeParticipantId),
      Number(loserRow.challongeParticipantId),
    );

    const bo3Rounds = await this.challonge.getBO3Rounds(playoff.challongeUrl);
    const isBO3 = bo3Rounds.has(challongeMatch.round);

    await this.challonge.reportMatchResult(
      playoff.challongeUrl,
      challongeMatch.id,
      Number(winnerRow.challongeParticipantId),
      challongeMatch.player1_id,
      challongeMatch.player2_id,
      isBO3 ? 2 : 1,
      0,
    );

    const match = this.playoffMatchRepo.create({
      playoffId: playoff.id,
      teamAId: winnerTeamId,
      teamBId: loserTeamId,
      winnerId: winnerTeamId,
      dotaMatchId: `tech_loss_${Date.now()}`,
      challongeMatchId: String(challongeMatch.id),
    });
    await this.playoffMatchRepo.save(match);

    return this.buildPlayoffResponse(playoff.challongeEmbedUrl, tournamentId);
  }

  private async techLossWithRebuild(
    playoff: Playoff,
    tournamentId: string,
    incorrectMatch: PlayoffMatch,
    winnerRow: TournamentPlayoffTeam,
    loserRow: TournamentPlayoffTeam,
    winnerTeamId: string,
    loserTeamId: string,
  ): Promise<PlayoffResponseDto> {
    const pmRepo = this.dataSource.getRepository(PlayoffMatch);

    // Delete matches where the wrong team advanced after this incorrect result
    await pmRepo
      .createQueryBuilder()
      .delete()
      .where(
        '"playoffId" = :playoffId AND "winnerId" = :loserTeamId AND "createdAt" > :cutoff',
        {
          playoffId: playoff.id,
          loserTeamId,
          cutoff: incorrectMatch.createdAt,
        },
      )
      .execute();

    // Correct the match record
    await pmRepo.update(
      { id: incorrectMatch.id },
      { winnerId: winnerTeamId, dotaMatchId: `tech_loss_${Date.now()}` },
    );

    return this.rebuildChallongeBracket(playoff, tournamentId);
  }

  private async rebuildChallongeBracket(
    playoff: Playoff,
    tournamentId: string,
  ): Promise<PlayoffResponseDto> {
    const oldChallongeUrl = playoff.challongeUrl;
    const tptRepo = this.dataSource.getRepository(TournamentPlayoffTeam);

    const tournament = await this.dataSource
      .getRepository(Tournament)
      .findOne({ where: { id: tournamentId } });
    if (!tournament) throw new NotFoundException('Tournament not found');

    const activeRows = await tptRepo.find({
      where: { tournamentId, isDisqualified: false },
      relations: ['team'],
    });

    if (activeRows.length < 2) {
      throw new BadRequestException(
        'Cannot rebuild bracket: fewer than 2 active playoff participants',
      );
    }

    const newSlug = `core_${tournamentId.replace(/-/g, '').slice(0, 8)}_${Date.now().toString(36)}`;
    const { id: newChallongeTournamentId, url: newChallongeUrl } =
      await this.challonge.createTournament(tournament.name, newSlug);

    const seeds = await this.computeSeeds(
      tournamentId,
      activeRows.map((r) => r.teamId),
    );

    const participants = seeds.map((s) => {
      const row = activeRows.find((r) => r.teamId === s.teamId)!;
      return { name: row.team.name, seed: s.seed };
    });

    const createdParticipants = await this.challonge.bulkAddParticipants(
      newChallongeUrl,
      participants,
    );

    // Build participant ID updates in memory before persisting.
    // Index-based: createdParticipants[i] corresponds to seeds[i] (same order).
    const participantUpdates: Array<{
      teamId: string;
      challongeParticipantId: string;
    }> = [];
    for (let i = 0; i < createdParticipants.length; i++) {
      const seed = seeds[i];
      if (!seed) continue;
      participantUpdates.push({
        teamId: seed.teamId,
        challongeParticipantId: String(createdParticipants[i].id),
      });
    }

    await this.challonge.startTournament(newChallongeUrl);

    // Build idMap from in-memory updates — avoids an extra DB round-trip
    const idMap = new Map(
      activeRows.map((r) => {
        const update = participantUpdates.find((u) => u.teamId === r.teamId);
        return [
          r.teamId,
          {
            ...r,
            challongeParticipantId:
              update?.challongeParticipantId ?? r.challongeParticipantId,
          },
        ];
      }),
    );

    const remainingMatches = await this.playoffMatchRepo.findByPlayoffId(
      playoff.id,
    );

    const matchIdUpdates: Array<{ id: string; challongeMatchId: string }> = [];

    for (const m of remainingMatches) {
      const rowA = idMap.get(m.teamAId);
      const rowB = idMap.get(m.teamBId);
      const winRow = idMap.get(m.winnerId ?? '');
      if (!rowA || !rowB || !winRow) continue;

      try {
        const challongeMatch = await this.challonge.findOpenMatch(
          newChallongeUrl,
          Number(rowA.challongeParticipantId),
          Number(rowB.challongeParticipantId),
        );
        await this.challonge.reportMatchResult(
          newChallongeUrl,
          challongeMatch.id,
          Number(winRow.challongeParticipantId),
          challongeMatch.player1_id,
          challongeMatch.player2_id,
        );
        matchIdUpdates.push({
          id: m.id,
          challongeMatchId: String(challongeMatch.id),
        });
      } catch (err) {
        this.logger.warn(
          `rebuildChallongeBracket: skipping match ${m.id} (${m.teamAId} vs ${m.teamBId}) — match not open yet in new bracket`,
          err,
        );
      }
    }

    const newEmbedUrl = `https://challonge.com/${newChallongeUrl}/module`;

    // Persist all DB state atomically after Challonge is fully rebuilt
    await this.dataSource.transaction(async (manager) => {
      for (const { teamId, challongeParticipantId } of participantUpdates) {
        await manager
          .getRepository(TournamentPlayoffTeam)
          .update({ tournamentId, teamId }, { challongeParticipantId });
      }
      for (const { id, challongeMatchId } of matchIdUpdates) {
        await manager
          .getRepository(PlayoffMatch)
          .update({ id }, { challongeMatchId });
      }
      playoff.challongeTournamentId = String(newChallongeTournamentId);
      playoff.challongeUrl = newChallongeUrl;
      playoff.challongeEmbedUrl = newEmbedUrl;
      await manager.getRepository(Playoff).save(playoff);
    });

    try {
      await this.challonge.deleteTournament(oldChallongeUrl);
    } catch (err) {
      this.logger.warn(
        `Failed to delete old Challonge tournament ${oldChallongeUrl} — clean up manually`,
        err,
      );
    }

    return this.buildPlayoffResponse(newEmbedUrl, tournamentId);
  }

  async getPlayoff(tournamentId: string): Promise<PlayoffResponseDto> {
    const playoff = await this.playoffRepo.findByTournamentId(tournamentId);
    if (!playoff) throw new NotFoundException('Playoff not started');
    return this.buildPlayoffResponse(playoff.challongeEmbedUrl, tournamentId);
  }

  private async buildPlayoffResponse(
    embedUrl: string,
    tournamentId: string,
  ): Promise<PlayoffResponseDto> {
    const tptRepo = this.dataSource.getRepository(TournamentPlayoffTeam);
    const rows = await tptRepo.find({
      where: { tournamentId, isDisqualified: false },
      relations: [
        'team',
        'team.captain',
        'team.captain.roles',
        'team.coach',
        'team.coach.roles',
        'team.mainPlayers',
        'team.mainPlayers.roles',
        'team.reservedPlayers',
        'team.reservedPlayers.roles',
        'team.tournaments',
      ],
    });
    const teams = rows.map((r) => this.teamsService.toTeamResponse(r.team));
    return { embedUrl, teams };
  }

  private async findVerifiedQualificationTeamIds(
    tournamentId: string,
  ): Promise<string[]> {
    const result: { teamId: string }[] = await this.dataSource.query(
      `
      SELECT DISTINCT qm."teamAId" AS "teamId"
      FROM qualification_match qm
      JOIN qualification q ON q.id = qm."qualificationId"
      WHERE q."tournamentId" = $1 AND qm."winnerId" IS NOT NULL
      UNION
      SELECT DISTINCT qm."teamBId"
      FROM qualification_match qm
      JOIN qualification q ON q.id = qm."qualificationId"
      WHERE q."tournamentId" = $1 AND qm."winnerId" IS NOT NULL
      `,
      [tournamentId],
    );
    return result.map((r) => r.teamId);
  }

  private async computeSeeds(
    tournamentId: string,
    teamIds: string[],
  ): Promise<{ teamId: string; seed: number }[]> {
    const teamRepo = this.dataSource.getRepository(Team);
    const pointsRepo = this.dataSource.getRepository(PlayerTournamentPoints);

    const teams = await teamRepo.find({
      where: { id: In(teamIds) },
      relations: ['captain'],
    });

    const teamsWithPoints = await Promise.all(
      teams.map(async (team) => {
        let points = 0;
        if (team.captain) {
          const row = await pointsRepo.findOne({
            where: { playerId: team.captain.id, tournamentId },
          });
          points = row?.points ?? 0;
        }
        return { teamId: team.id, points };
      }),
    );

    teamsWithPoints.sort((a, b) => b.points - a.points);

    return teamsWithPoints.map((t, i) => ({ teamId: t.teamId, seed: i + 1 }));
  }
}
