// src/playoff/playoff.service.ts
import { randomUUID } from 'node:crypto';
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
import { findEligibleQualificationTeamIds } from '../tournaments/tournament-playoff-team.eligibility';
import { TechLossPlayoffDto } from './dto/tech-loss-playoff.dto';
import { ManualPlayoffSeriesGameDto } from './dto/manual-playoff-series-game.dto';
import { OpenPlayoffMatchDto } from './dto/open-playoff-match.dto';
import { PlayoffBracketGameSummaryDto } from './dto/series-game-slot.dto';
import { PlayoffLeagueFixture } from './playoff-league-fixture.entity';
import { Playoff } from './playoff.entity';
import { PlayoffSeries } from './playoff-series.entity';

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
    requestedTeamIds: string[] = [],
  ): Promise<PlayoffResponseDto> {
    const tournament = await this.dataSource
      .getRepository(Tournament)
      .findOne({ where: { id: tournamentId } });
    if (!tournament) throw new NotFoundException('Tournament not found');

    const existing = await this.playoffRepo.findByTournamentId(tournamentId);
    if (existing) throw new ConflictException('Playoff already started');

    const playoffTeamIds = await this.mergeStagedPlayoffTeamsWithRequested(
      tournamentId,
      requestedTeamIds,
    );
    if (playoffTeamIds.length === 0) {
      throw new BadRequestException(
        'No playoff participants — stage teams via POST /tournaments/:id/playoff/teams and/or send teamIds in the start payload.',
      );
    }

    const eligibleTeamIds = await findEligibleQualificationTeamIds(
      this.dataSource,
      tournamentId,
    );
    const eligibleSet = new Set(eligibleTeamIds);
    const invalidIds = playoffTeamIds.filter((id) => !eligibleSet.has(id));
    if (invalidIds.length) {
      throw new BadRequestException(
        `Teams must be registered for this tournament or present in its qualification bracket: ${invalidIds.join(', ')}`,
      );
    }

    const seeds = await this.computeSeeds(tournamentId, playoffTeamIds);

    const slug = `core_${tournamentId.replace(/-/g, '').slice(0, 8)}_${Date.now().toString(36)}`;
    const { id: challongeTournamentId, url: challongeUrl } =
      await this.challonge.createTournament(tournament.name, slug);

    const teamRepo = this.dataSource.getRepository(Team);
    const teams = await teamRepo.find({
      where: { id: In(playoffTeamIds) },
      relations: ['captain'],
    });
    const teamMap = new Map(teams.map((t) => [t.id, t]));

    const challongeRows = this.buildChallongeBulkPayload(seeds, teamMap);
    const createdParticipants = await this.challonge.bulkAddParticipantsAll(
      challongeUrl,
      challongeRows,
    );
    const challongeIdByTeamId = this.resolveChallongeIdsByTeam(
      challongeRows,
      createdParticipants,
    );

    const tptRepo = this.dataSource.getRepository(TournamentPlayoffTeam);

    // Insert TournamentPlayoffTeam rows (idempotent — orIgnore if pre-staged)
    await tptRepo
      .createQueryBuilder()
      .insert()
      .orIgnore()
      .values(playoffTeamIds.map((teamId) => ({ tournamentId, teamId })))
      .execute();

    for (const { teamId } of seeds) {
      const challongeId = challongeIdByTeamId.get(teamId);
      if (challongeId !== undefined) {
        await tptRepo.update(
          { tournamentId, teamId },
          { challongeParticipantId: String(challongeId) },
        );
      }
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

    const persistedPlayoff = await this.dataSource
      .getRepository(Playoff)
      .findOneOrFail({ where: { id: playoff.id } });

    await this.ensurePlayoffSeriesForBracket(persistedPlayoff.id, challongeUrl);

    await this.bootstrapDotaLeagueMirroring(
      persistedPlayoff,
      tournamentId,
      challongeUrl,
      playoffTeamIds,
    );

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

    const saved = await this.recordPlayoffBracketGame({
      playoff,
      challongeMatch: {
        id: challongeMatch.id,
        round: challongeMatch.round,
        player1_id: challongeMatch.player1_id,
        player2_id: challongeMatch.player2_id,
      },
      winnerTeamId: winnerRow.teamId,
      loserTeamId: loserRow.teamId,
      dotaMatchId,
    });

    await this.maybeSyncPlayoffFixturesIntoDotaWithBackoff(tournamentId);

    return saved;
  }

  /**
   * Admin-only (see controller): record a playoff map without querying OpenDota.
   */
  async submitPlayoffBracketGameManual(
    tournamentId: string,
    body: ManualPlayoffSeriesGameDto,
  ): Promise<PlayoffMatch> {
    const playoff = await this.playoffRepo.findByTournamentId(tournamentId);
    if (!playoff) throw new NotFoundException('Playoff not found');

    const dotaMatchId = body.dotaMatchId?.trim()?.length
      ? body.dotaMatchId.trim()
      : `manual_${randomUUID()}`;

    const existingMatch = await this.dataSource
      .getRepository(PlayoffMatch)
      .findOne({ where: { playoffId: playoff.id, dotaMatchId } });
    if (existingMatch) {
      throw new BadRequestException(
        `${dotaMatchId} is already tied to this playoff bracket`,
      );
    }

    const tptRepo = this.dataSource.getRepository(TournamentPlayoffTeam);
    const allRows = await tptRepo.find({
      where: { tournamentId, isDisqualified: false },
      relations: ['team'],
    });
    const winnerRow = allRows.find((r) => r.teamId === body.winnerTeamId);
    if (!winnerRow) {
      throw new NotFoundException(
        'Winner team is not an active playoff participant',
      );
    }
    const winnerPid = Number(winnerRow.challongeParticipantId);
    if (!Number.isFinite(winnerPid)) {
      throw new BadRequestException(
        'Winner team is missing Challonge linkage — reopen bracket tab or reconcile participants',
      );
    }

    const opens = await this.challonge.listOpenMatches(playoff.challongeUrl);
    const midStr = body.challongeMatchId.trim();
    const focussed = opens.find((m) => String(m.id) === midStr);
    if (!focussed) {
      throw new BadRequestException(
        'Referenced Challonge bracket node is not an open matchup (or unknown id)',
      );
    }

    let oppParticipant = 0;
    if (focussed.participant1Id === winnerPid) {
      oppParticipant = focussed.participant2Id;
    } else if (focussed.participant2Id === winnerPid) {
      oppParticipant = focussed.participant1Id;
    } else {
      throw new BadRequestException(
        'Winner is not seeded into the referenced Challonge bracket slot',
      );
    }

    const loserTeamId = [...allRows].find((r) => {
      const c = Number(r.challongeParticipantId);
      return Number.isFinite(c) && c === oppParticipant;
    })?.teamId;
    if (!loserTeamId) {
      throw new BadRequestException(
        'Could not resolve loser Core team UUID for opponent participant',
      );
    }

    const challongeMatch = {
      id: focussed.id,
      round: focussed.round,
      player1_id: focussed.participant1Id,
      player2_id: focussed.participant2Id,
    };

    const saved = await this.recordPlayoffBracketGame({
      playoff,
      challongeMatch,
      winnerTeamId: winnerRow.teamId,
      loserTeamId,
      dotaMatchId,
    });

    await this.maybeSyncPlayoffFixturesIntoDotaWithBackoff(tournamentId);

    return saved;
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

    const teamMap = new Map(activeRows.map((r) => [r.teamId, r.team]));
    const challongeRows = this.buildChallongeBulkPayload(seeds, teamMap);
    const createdParticipants = await this.challonge.bulkAddParticipantsAll(
      newChallongeUrl,
      challongeRows,
    );
    const challongeIdByTeamId = this.resolveChallongeIdsByTeam(
      challongeRows,
      createdParticipants,
    );

    for (const row of activeRows) {
      const challongeId = challongeIdByTeamId.get(row.teamId);
      if (challongeId !== undefined) {
        await tptRepo.update(
          { tournamentId, teamId: row.teamId },
          { challongeParticipantId: String(challongeId) },
        );
      }
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
    await this.replayPlayoffBucketsOntoFreshChallonge(
      newChallongeUrl,
      idMap,
      remainingMatches,
    );

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

    const rebound = await this.playoffRepo.findByTournamentId(tournamentId);
    if (rebound) {
      const cleared = await this.discardPlayoffLeagueMirroring(rebound);
      await this.bootstrapDotaLeagueMirroring(
        cleared,
        tournamentId,
        cleared.challongeUrl,
        refreshedRows.map((r) => r.teamId),
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

    const challongeNameForTeam = (
      tid: string,
      displayName: string,
    ): string | undefined => {
      const base = displayName.trim() || `Team_${tid.slice(0, 8)}`;
      let dup = false;
      for (const row of activeRows) {
        if (row.teamId === tid) continue;
        const peer = row.team.name.trim() || `Team_${row.teamId.slice(0, 8)}`;
        if (peer === base) dup = true;
      }
      const disambiguated = dup ? `${base} [${tid.slice(0, 8)}]` : base;
      return (
        nameToChallongeId.get(disambiguated) ?? nameToChallongeId.get(base)
      );
    };

    const challongeIdToTeam = new Map<
      string,
      { id: string; name: string; logoUrl: string | null }
    >();
    for (const row of activeRows) {
      const cid = challongeNameForTeam(row.teamId, row.team.name);
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

    await this.ensurePlayoffSeriesForBracket(playoff.id, playoff.challongeUrl);

    const seriesRepo = this.dataSource.getRepository(PlayoffSeries);
    const allSeriesRows = await seriesRepo.find({
      where: { playoffId: playoff.id },
    });
    const seriesByChallongeId = new Map(
      allSeriesRows.map((s) => [s.challongeMatchId, s]),
    );

    const allPlayoffGames = await this.playoffMatchRepo.findByPlayoffId(
      playoff.id,
    );

    // Return ALL matches where both participants are determined (open + complete).
    const allMatches = await this.challonge.listAllMatchesWithBothParticipants(
      playoff.challongeUrl,
    );

    return allMatches.flatMap((m): OpenPlayoffMatchDto[] => {
      const teamA = challongeIdToTeam.get(String(m.participant1Id));
      const teamB = challongeIdToTeam.get(String(m.participant2Id));
      if (!teamA || !teamB) return [];

      const midStr = String(m.id);
      const srs = seriesByChallongeId.get(midStr);
      if (!srs) {
        this.logger.error(
          `Bracket slot ${midStr} missing persisted series envelope — rerun sync`,
        );
        return [];
      }

      const slotGames = allPlayoffGames
        .filter((g) => g.challongeMatchId === midStr)
        .sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );

      const orientAId = srs.teamAId ?? teamA.id;
      const orientBId = srs.teamBId ?? teamB.id;
      const decided = slotGames.filter((g) => !!g.winnerId);
      const { winsA: winsTeamA, winsB: winsTeamB } = this.countWinsOriented(
        orientAId,
        orientBId,
        decided,
      );

      const games: PlayoffBracketGameSummaryDto[] = slotGames.map((g, i) => ({
        id: g.id,
        gameNumber: g.gameNumber ?? i + 1,
        winnerTeamId: g.winnerId,
        dotaMatchId: g.dotaMatchId ?? null,
      }));

      const format: 'bo1' | 'bo3' = srs.bestOf >= 3 ? 'bo3' : 'bo1';
      const seriesKind: 'standard' | 'finals_bo3' = srs.isFinalsBo3
        ? 'finals_bo3'
        : 'standard';

      return [
        {
          challongeMatchId: m.id,
          round: m.round,
          state: m.state,
          teamA,
          teamB,
          seriesId: srs.id,
          format,
          seriesKind,
          winsTeamA,
          winsTeamB,
          seriesWinnerTeamId: srs.seriesWinnerId,
          seriesResolved: !!srs.seriesWinnerId,
          games,
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

    const finalsBo3 = await this.challonge.getFinalBo3ChallongeMatchIds(
      playoff.challongeUrl,
    );
    const isFinalsBo3 = finalsBo3.has(challongeMatch.id);

    const cmPayload = {
      id: challongeMatch.id,
      round: challongeMatch.round,
      player1_id: challongeMatch.player1_id,
      player2_id: challongeMatch.player2_id,
    };

    const base = `tech_loss_${Date.now()}`;
    if (isFinalsBo3) {
      await this.recordPlayoffBracketGame({
        playoff,
        challongeMatch: cmPayload,
        winnerTeamId,
        loserTeamId,
        dotaMatchId: `${base}_g1`,
      });
      await this.recordPlayoffBracketGame({
        playoff,
        challongeMatch: cmPayload,
        winnerTeamId,
        loserTeamId,
        dotaMatchId: `${base}_g2`,
      });
    } else {
      await this.recordPlayoffBracketGame({
        playoff,
        challongeMatch: cmPayload,
        winnerTeamId,
        loserTeamId,
        dotaMatchId: base,
      });
    }

    await this.maybeSyncPlayoffFixturesIntoDotaWithBackoff(tournamentId);

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

    const teamMap = new Map(activeRows.map((r) => [r.teamId, r.team]));
    const challongeRows = this.buildChallongeBulkPayload(seeds, teamMap);
    const createdParticipants = await this.challonge.bulkAddParticipantsAll(
      newChallongeUrl,
      challongeRows,
    );
    const challongeIdByTeamId = this.resolveChallongeIdsByTeam(
      challongeRows,
      createdParticipants,
    );

    const participantUpdates: Array<{
      teamId: string;
      challongeParticipantId: string;
    }> = [];
    for (const s of seeds) {
      const cid = challongeIdByTeamId.get(s.teamId);
      if (cid === undefined) {
        this.logger.warn(
          `rebuildChallongeBracket: no Challonge participant id for team ${s.teamId}`,
        );
        continue;
      }
      participantUpdates.push({
        teamId: s.teamId,
        challongeParticipantId: String(cid),
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

    const { matchIdUpdates, seriesIdUpdates } =
      await this.replayPlayoffBucketsOntoFreshChallonge(
        newChallongeUrl,
        idMap,
        remainingMatches,
      );

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
      for (const { seriesId, challongeMatchId } of seriesIdUpdates) {
        await manager
          .getRepository(PlayoffSeries)
          .update({ id: seriesId }, { challongeMatchId });
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

    const playoffFresh =
      await this.playoffRepo.findByTournamentId(tournamentId);
    if (playoffFresh) {
      const cleared = await this.discardPlayoffLeagueMirroring(playoffFresh);
      await this.bootstrapDotaLeagueMirroring(
        cleared,
        tournamentId,
        cleared.challongeUrl,
        activeRows.map((r) => r.teamId),
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

  /**
   * Staged playoff roster (tournament_playoff_team) is merged with any ids from the
   * start request so the bracket always includes every team the admin pre-selected.
   */
  private async mergeStagedPlayoffTeamsWithRequested(
    tournamentId: string,
    requestedTeamIds: string[],
  ): Promise<string[]> {
    const staged = await this.dataSource
      .getRepository(TournamentPlayoffTeam)
      .find({
        where: { tournamentId, isDisqualified: false },
        select: ['teamId'],
        order: { id: 'ASC' },
      });

    const seen = new Set<string>();
    const out: string[] = [];
    const pushUnique = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      out.push(id);
    };

    for (const row of staged) pushUnique(row.teamId);
    for (const id of requestedTeamIds) pushUnique(id);
    return out;
  }

  /**
   * Uses `misc` (Core team UUID) on Challonge plus disambiguated display names so
   * duplicate team labels or API name mangling cannot drop participant ids.
   */
  private buildChallongeBulkPayload(
    seeds: { teamId: string; seed: number }[],
    teamById: Map<string, Team>,
  ): { name: string; seed: number; misc: string }[] {
    const bases = seeds.map((s) => {
      const t = teamById.get(s.teamId);
      const raw = (t?.name ?? '').trim();
      const base = raw.length > 0 ? raw : `Team_${s.teamId.slice(0, 8)}`;
      return { s, base };
    });

    const freq = new Map<string, number>();
    for (const { base } of bases) {
      freq.set(base, (freq.get(base) ?? 0) + 1);
    }

    return bases.map(({ s, base }) => {
      const dup = freq.get(base)! > 1;
      const name = dup ? `${base} [${s.teamId.slice(0, 8)}]` : base;
      return { name, seed: s.seed, misc: s.teamId };
    });
  }

  private resolveChallongeIdsByTeam(
    rows: { name: string; misc: string }[],
    created: { id: number; name: string; misc: string | null }[],
  ): Map<string, number> {
    const norm = (m: string | null | undefined) => (m ?? '').trim();

    const byMisc = new Map<string, number>();
    for (const c of created) {
      const k = norm(c.misc);
      if (k) byMisc.set(k, c.id);
    }

    const byName = new Map<string, number>();
    for (const c of created) byName.set(c.name, c.id);

    const out = new Map<string, number>();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const id =
        byMisc.get(r.misc.trim()) ?? byName.get(r.name) ?? created[i]?.id;
      if (id !== undefined) {
        out.set(r.misc, id);
      } else {
        this.logger.warn(
          `Challonge participant not resolved for Core team ${r.misc} display "${r.name}"`,
        );
      }
    }
    return out;
  }

  private async computeSeeds(
    tournamentId: string,
    teamIds: string[],
  ): Promise<{ teamId: string; seed: number }[]> {
    const uniq = [...new Set(teamIds)];
    const teamRepo = this.dataSource.getRepository(Team);
    const pointsRepo = this.dataSource.getRepository(PlayerTournamentPoints);

    const teams = await teamRepo.find({
      where: { id: In(uniq) },
      relations: ['captain'],
    });

    if (teams.length !== uniq.length) {
      const found = new Set(teams.map((t) => t.id));
      const missing = uniq.filter((id) => !found.has(id));
      throw new BadRequestException(
        `Playoff references unknown or removed teams: ${missing.join(', ')}`,
      );
    }

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

  private async discardPlayoffLeagueMirroring(
    playoff: Playoff,
  ): Promise<Playoff> {
    await this.dataSource.getRepository(PlayoffLeagueFixture).delete({
      playoffId: playoff.id,
    });
    playoff.dotaPlayoffContainingNodeGroupId = null;
    return this.playoffRepo.save(playoff);
  }

  /**
   * After Challonge playoff starts or bracket is recreated: organisational node in Dota league,
   * register playoff teams under it, RR-style pair fixtures for current open Challonge slots.
   */
  private async bootstrapDotaLeagueMirroring(
    playoffRow: Playoff,
    tournamentId: string,
    challongeUrl: string,
    coreTeamIds: string[],
  ): Promise<void> {
    if (!this.dota2.isLeagueApiConfigured()) {
      this.logger.warn(
        'Dota league API not configured (DOTA_* env) — skipping playoff league mirrors',
      );
      return;
    }
    try {
      const playoff = await this.ensureDotaOrganizationalShell(playoffRow);
      const shell = playoff.dotaPlayoffContainingNodeGroupId;
      if (!shell) return;
      await this.registerTeamsInPlayoffLeague(shell, coreTeamIds);
      await this.syncOpenChallongeMatchesIntoLeague(
        shell,
        playoff.id,
        tournamentId,
        challongeUrl,
      );
    } catch (err) {
      this.logger.warn(
        'Dota league playoff mirror (bootstrap/sync) failed; Challonge state is unchanged.',
        err,
      );
    }
  }

  private async maybeSyncPlayoffFixturesIntoDota(
    tournamentId: string,
  ): Promise<void> {
    const playoff = await this.playoffRepo.findByTournamentId(tournamentId);
    if (!playoff?.dotaPlayoffContainingNodeGroupId || !playoff.challongeUrl)
      return;
    if (!this.dota2.isLeagueApiConfigured()) return;

    try {
      await this.syncOpenChallongeMatchesIntoLeague(
        playoff.dotaPlayoffContainingNodeGroupId,
        playoff.id,
        tournamentId,
        playoff.challongeUrl,
      );
    } catch (err) {
      this.logger.warn(
        `Dota league sync for open Challonge fixtures failed (playoff=${playoff.id})`,
        err,
      );
    }
  }

  /** Challonge can lag behind after report; second pass picks up upper-bracket slots. */
  private async maybeSyncPlayoffFixturesIntoDotaWithBackoff(
    tournamentId: string,
  ): Promise<void> {
    await this.maybeSyncPlayoffFixturesIntoDota(tournamentId);
    await this.sleep(800);
    await this.maybeSyncPlayoffFixturesIntoDota(tournamentId);
  }

  private winsNeededForBestOf(bestOf: number): number {
    return Math.ceil(bestOf / 2);
  }

  private bucketPlayoffMatchesForReplay(
    playoffMatches: PlayoffMatch[],
  ): PlayoffMatch[][] {
    const map = new Map<string, PlayoffMatch[]>();
    for (const m of playoffMatches) {
      const key =
        m.seriesId && m.seriesId.length > 0
          ? m.seriesId
          : `legacy:${m.challongeMatchId}:${m.playoffId}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    for (const [, arr] of map) {
      arr.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    }
    return [...map.values()];
  }

  private countWinsOriented(
    teamAId: string,
    teamBId: string,
    games: Pick<PlayoffMatch, 'winnerId'>[],
  ): { winsA: number; winsB: number } {
    let winsA = 0;
    let winsB = 0;
    for (const g of games) {
      if (!g.winnerId) continue;
      if (g.winnerId === teamAId) winsA += 1;
      else if (g.winnerId === teamBId) winsB += 1;
    }
    return { winsA, winsB };
  }

  private crownFromWins(
    bestOf: number,
    teamAId: string,
    teamBId: string,
    winsA: number,
    winsB: number,
  ): string | null {
    const need = this.winsNeededForBestOf(bestOf);
    if (winsA >= need) return teamAId;
    if (winsB >= need) return teamBId;
    return null;
  }

  private async replayPlayoffBucketsOntoFreshChallonge(
    freshUrl: string,
    idMap: Map<string, TournamentPlayoffTeam>,
    playoffMatches: PlayoffMatch[],
  ): Promise<{
    matchIdUpdates: { id: string; challongeMatchId: string }[];
    seriesIdUpdates: { seriesId: string; challongeMatchId: string }[];
  }> {
    const buckets = this.bucketPlayoffMatchesForReplay(playoffMatches);
    const matchIdUpdates: { id: string; challongeMatchId: string }[] = [];
    const seriesIdUpdates: { seriesId: string; challongeMatchId: string }[] =
      [];
    const seriesRepo = this.dataSource.getRepository(PlayoffSeries);
    const reassignedSeries = new Set<string>();

    for (const bucket of buckets) {
      const completed = bucket.filter(
        (g) => !!g.teamAId && !!g.teamBId && !!g.winnerId,
      );
      if (completed.length === 0) continue;

      const latest = completed[completed.length - 1];
      const teamAId = latest.teamAId!;
      const teamBId = latest.teamBId!;

      const rowA = idMap.get(teamAId);
      const rowB = idMap.get(teamBId);
      if (!rowA || !rowB) continue;

      let challongeMatch: {
        id: number;
        player1_id: number;
        player2_id: number;
      };
      try {
        challongeMatch = await this.challonge.findOpenMatch(
          freshUrl,
          Number(rowA.challongeParticipantId),
          Number(rowB.challongeParticipantId),
        );
      } catch (err) {
        this.logger.warn(
          `replay bracket: matchup not ready for ${teamAId} vs ${teamBId}`,
          err,
        );
        continue;
      }

      const seriesRowHint = bucket.find((g) => g.seriesId);
      const seriesRow: PlayoffSeries | null = seriesRowHint?.seriesId
        ? await seriesRepo.findOne({ where: { id: seriesRowHint.seriesId } })
        : await seriesRepo.findOne({
            where: {
              playoffId: latest.playoffId,
              challongeMatchId: latest.challongeMatchId,
            },
          });

      const bestOf = seriesRow?.bestOf ?? 1;
      const { winsA, winsB } = this.countWinsOriented(
        teamAId,
        teamBId,
        completed,
      );

      const crowned = this.crownFromWins(
        bestOf,
        teamAId,
        teamBId,
        winsA,
        winsB,
      );
      if (!crowned) {
        this.logger.warn(
          `replay bracket: unresolved BO bucket (games=${completed.length}, bestOf=${bestOf})`,
        );
        continue;
      }

      const p1 = challongeMatch.player1_id;
      const p2 = challongeMatch.player2_id;

      const winnerParticipant = Number(
        (crowned === teamAId ? rowA : rowB).challongeParticipantId,
      );
      if (winnerParticipant !== p1 && winnerParticipant !== p2) {
        this.logger.warn(
          `replay bracket: crowned team's Challonge participant is not staged in recreated slot`,
        );
        continue;
      }

      const winnerScore = crowned === teamAId ? winsA : winsB;
      const loserScore = crowned === teamAId ? winsB : winsA;

      try {
        await this.challonge.reportMatchResult(
          freshUrl,
          challongeMatch.id,
          winnerParticipant,
          p1,
          p2,
          winnerScore,
          loserScore,
        );
      } catch (err) {
        this.logger.warn(`replay bracket: Challonge PUT failed`, err);
        continue;
      }

      const newMidStr = String(challongeMatch.id);
      for (const g of bucket) {
        matchIdUpdates.push({ id: g.id, challongeMatchId: newMidStr });
      }
      const sid = seriesRow?.id ?? seriesRowHint?.seriesId;
      if (sid && !reassignedSeries.has(sid)) {
        reassignedSeries.add(sid);
        seriesIdUpdates.push({
          seriesId: sid,
          challongeMatchId: newMidStr,
        });
      }
    }

    return { matchIdUpdates, seriesIdUpdates };
  }

  private async ensurePlayoffSeriesForBracket(
    playoffId: string,
    challongeUrl: string,
  ): Promise<void> {
    const finalsBo3Ids =
      await this.challonge.getFinalBo3ChallongeMatchIds(challongeUrl);
    const nodes = await this.challonge.listMatchesIdRound(challongeUrl);
    const repo = this.dataSource.getRepository(PlayoffSeries);
    for (const n of nodes) {
      const mid = String(n.id);
      const isBo3 = finalsBo3Ids.has(n.id);
      const bestOf = isBo3 ? 3 : 1;
      const existing = await repo.findOne({
        where: { playoffId, challongeMatchId: mid },
      });
      if (!existing) {
        await repo.save(
          repo.create({
            playoffId,
            challongeMatchId: mid,
            bestOf,
            isFinalsBo3: isBo3,
          }),
        );
        continue;
      }
      if (existing.bestOf !== bestOf || existing.isFinalsBo3 !== isBo3) {
        existing.bestOf = bestOf;
        existing.isFinalsBo3 = isBo3;
        await repo.save(existing);
      }
    }
  }

  private async recordPlayoffBracketGame(opts: {
    playoff: Playoff;
    challongeMatch: {
      id: number;
      round: number;
      player1_id: number;
      player2_id: number;
    };
    winnerTeamId: string;
    loserTeamId: string;
    dotaMatchId: string;
  }): Promise<PlayoffMatch> {
    const { playoff, challongeMatch, winnerTeamId, loserTeamId, dotaMatchId } =
      opts;

    await this.ensurePlayoffSeriesForBracket(playoff.id, playoff.challongeUrl);

    const seriesRepo = this.dataSource.getRepository(PlayoffSeries);
    const pmRepo = this.dataSource.getRepository(PlayoffMatch);

    const midStr = String(challongeMatch.id);
    const series = await seriesRepo.findOne({
      where: { playoffId: playoff.id, challongeMatchId: midStr },
    });
    if (!series)
      throw new NotFoundException('Playoff series slot not materialized');

    const tptRepo = this.dataSource.getRepository(TournamentPlayoffTeam);
    const activeRows = await tptRepo.find({
      where: { tournamentId: playoff.tournamentId, isDisqualified: false },
      relations: ['team'],
    });

    const hasBoth = activeRows.some((r) => r.teamId === winnerTeamId);
    const hasOpp = activeRows.some((r) => r.teamId === loserTeamId);
    if (!hasBoth || !hasOpp) {
      throw new BadRequestException(
        'Both teams must be active playoff participants',
      );
    }
    if (winnerTeamId === loserTeamId) {
      throw new BadRequestException('Winner and loser must differ');
    }

    const p1 = challongeMatch.player1_id;
    const p2 = challongeMatch.player2_id;

    const teamFromParticipant = (pid: number): string | null =>
      activeRows.find((r) => Number(r.challongeParticipantId) === pid)
        ?.teamId ?? null;

    const orientA = teamFromParticipant(p1);
    const orientB = teamFromParticipant(p2);
    if (!orientA || !orientB) {
      throw new BadRequestException(
        'Unable to map Challonge participant slots to Core team ids',
      );
    }
    const slotTeams = new Set([orientA, orientB]);
    if (!slotTeams.has(winnerTeamId) || !slotTeams.has(loserTeamId)) {
      throw new BadRequestException(
        'Winner and loser must occupy the Challonge bracket slot pairing',
      );
    }
    let teamAId = series.teamAId;
    let teamBId = series.teamBId;
    if (!teamAId || !teamBId) {
      teamAId = orientA;
      teamBId = orientB;
    } else if (
      !(
        (teamAId === orientA && teamBId === orientB) ||
        (teamAId === orientB && teamBId === orientA)
      )
    ) {
      throw new BadRequestException(
        'Bracket matchup does not match persisted series participants',
      );
    }

    const priorGames = await pmRepo.find({
      where: { seriesId: series.id },
      order: { createdAt: 'ASC' },
    });
    const resolvedGames = priorGames.filter((g) => !!g.winnerId);

    if (series.seriesWinnerId) {
      throw new BadRequestException(
        'This bracket series is already finalized — cannot add more maps',
      );
    }

    const need = this.winsNeededForBestOf(series.bestOf);
    const { winsA: priorA, winsB: priorB } = this.countWinsOriented(
      teamAId,
      teamBId,
      resolvedGames,
    );

    if (series.bestOf >= 3) {
      if (Math.max(priorA, priorB) >= need) {
        throw new BadRequestException(
          'Series already has a decisive score — refusing another map',
        );
      }
      if (resolvedGames.length >= series.bestOf) {
        throw new BadRequestException(
          `${series.bestOf} games already stored for this best-of finals slot`,
        );
      }
    }

    const gameNumber =
      priorGames.reduce((mx, g) => Math.max(mx, g.gameNumber ?? 0), 0) + 1;

    const matchEntity = this.playoffMatchRepo.create({
      playoffId: playoff.id,
      seriesId: series.id,
      gameNumber,
      teamAId,
      teamBId,
      winnerId: winnerTeamId,
      dotaMatchId,
      challongeMatchId: midStr,
    });
    await this.playoffMatchRepo.save(matchEntity);

    const decided = [...resolvedGames, matchEntity];

    const { winsA, winsB } = this.countWinsOriented(teamAId, teamBId, decided);

    const crownedTeamId = this.crownFromWins(
      series.bestOf,
      teamAId,
      teamBId,
      winsA,
      winsB,
    );

    if (
      series.bestOf >= 3 &&
      decided.length >= series.bestOf &&
      !crownedTeamId
    ) {
      throw new ConflictException(
        'BO3 ledger is full but no crowned winner — corrupt bracket state',
      );
    }

    await seriesRepo.update(
      { id: series.id },
      {
        teamAId,
        teamBId,
        ...(crownedTeamId
          ? { seriesWinnerId: crownedTeamId, resolvedAt: new Date() }
          : {}),
      },
    );

    if (series.bestOf === 1 && crownedTeamId) {
      const participantWinner = crownedTeamId === teamAId ? p1 : p2;
      await this.challonge.reportMatchResult(
        playoff.challongeUrl,
        challongeMatch.id,
        participantWinner,
        p1,
        p2,
        1,
        0,
      );
      return matchEntity;
    }

    if (series.bestOf >= 3 && crownedTeamId) {
      const participantWinner = crownedTeamId === teamAId ? p1 : p2;
      const winnerScore = crownedTeamId === teamAId ? winsA : winsB;
      const loserScore = crownedTeamId === teamAId ? winsB : winsA;

      await this.challonge.reportMatchResult(
        playoff.challongeUrl,
        challongeMatch.id,
        participantWinner,
        p1,
        p2,
        winnerScore,
        loserScore,
      );
    }

    return matchEntity;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Map Challonge participant id → Dota pro team id. Prefer `misc` (Core team UUID) from the
   * Challonge API so upper-bracket slots stay correct even when DB `challongeParticipantId` is stale.
   */
  private async buildChallongeParticipantIdToDotaTeamId(
    tournamentId: string,
    challongeUrl: string,
  ): Promise<Map<string, string>> {
    const tptRepo = this.dataSource.getRepository(TournamentPlayoffTeam);
    const rows = await tptRepo.find({
      where: { tournamentId, isDisqualified: false },
      relations: ['team'],
    });

    const teamByCoreId = new Map(rows.map((r) => [r.teamId, r.team]));
    const map = new Map<string, string>();

    const participants = await this.challonge.listParticipants(challongeUrl);
    for (const p of participants) {
      const misc = (p.misc ?? '').trim();
      if (!misc) continue;
      const teamEntity = teamByCoreId.get(misc);
      const dota = (teamEntity?.dotaTeamId ?? '').trim();
      if (dota) map.set(String(p.id), dota);
    }

    for (const r of rows) {
      const cid = (r.challongeParticipantId ?? '').trim();
      const dota = (r.team?.dotaTeamId ?? '').trim();
      if (!cid || !dota) continue;
      if (!map.has(cid)) map.set(cid, dota);
    }

    return map;
  }

  private async ensureDotaOrganizationalShell(
    playoff: Playoff,
  ): Promise<Playoff> {
    if (!this.dota2.isLeagueApiConfigured()) return playoff;
    if (playoff.dotaPlayoffContainingNodeGroupId) return playoff;

    await this.dota2.addNodeGroup({
      nodeGroupId: '',
      nodeGroupType: 1,
      teamCount: 0,
      containingNodeGroupId: '0',
      phase: 2,
      defaultNodeType: 0,
    });
    const id = await this.dota2.resolveOrganizationalNodeGroupId();
    playoff.dotaPlayoffContainingNodeGroupId = id;
    await this.playoffRepo.save(playoff);
    return playoff;
  }

  private async registerTeamsInPlayoffLeague(
    shellGroupId: string,
    coreTeamIds: string[],
  ): Promise<void> {
    if (coreTeamIds.length === 0) return;

    const teamRepo = this.dataSource.getRepository(Team);
    const teams = await teamRepo.find({
      where: { id: In(coreTeamIds) },
    });

    for (const team of teams) {
      const dotaTeamId = (team.dotaTeamId ?? '').trim();
      if (!dotaTeamId) {
        this.logger.warn(
          `Playoff league: skip team ${team.id} — no dotaTeamId registered`,
        );
        continue;
      }
      try {
        await this.dota2.addNodeGroupTeam(shellGroupId, dotaTeamId);
      } catch (err) {
        this.logger.warn(
          `addNodeGroupTeam failed for team ${team.id} in playoff shell`,
          err,
        );
      }
    }
  }

  private async syncOpenChallongeMatchesIntoLeague(
    shellGroupId: string,
    playoffId: string,
    tournamentId: string,
    challongeUrl: string,
  ): Promise<void> {
    const fixtureRepo = this.dataSource.getRepository(PlayoffLeagueFixture);

    const challongeParticipantIdToDota =
      await this.buildChallongeParticipantIdToDotaTeamId(
        tournamentId,
        challongeUrl,
      );

    const fixtures = await fixtureRepo.find({ where: { playoffId } });
    const existingMatches = new Set(fixtures.map((f) => f.challongeMatchId));

    const finalsBo3ChallongeIds =
      await this.challonge.getFinalBo3ChallongeMatchIds(challongeUrl);

    const opens = await this.challonge.listOpenMatches(challongeUrl);

    for (const m of opens) {
      const dA = challongeParticipantIdToDota.get(String(m.participant1Id));
      const dB = challongeParticipantIdToDota.get(String(m.participant2Id));
      if (!dA || !dB || dA === dB) continue;

      const mid = String(m.id);
      if (existingMatches.has(mid)) continue;

      const mirrorAsBo1 = !finalsBo3ChallongeIds.has(m.id);

      try {
        const nodeId = await this.dota2.createTwoTeamFixtureNode(
          shellGroupId,
          dA,
          dB,
          mirrorAsBo1,
        );
        await fixtureRepo.save(
          fixtureRepo.create({
            playoffId,
            challongeMatchId: mid,
            dotaFixtureNodeGroupId: nodeId,
          }),
        );
        existingMatches.add(mid);
      } catch (err) {
        this.logger.warn(
          `Dota RR fixture create failed for Challonge match ${mid} (${dA} vs ${dB})`,
          err,
        );
      }
    }
  }
}
