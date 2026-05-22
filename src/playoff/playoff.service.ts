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
import { findEligibleQualificationTeamIds } from '../tournaments/tournament-playoff-team.eligibility';

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

    const slug = `core-${tournamentId.replace(/-/g, '').slice(0, 8)}`;
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

    await this.challonge.reportMatchResult(
      playoff.challongeUrl,
      challongeMatch.id,
      Number(winnerRow.challongeParticipantId),
    );

    const match = this.playoffMatchRepo.create({
      playoffId: playoff.id,
      teamAId: winnerRow.teamId,
      teamBId: loserRow.teamId,
      winnerId: winnerRow.teamId,
      dotaMatchId,
      challongeMatchId: String(challongeMatch.id),
    });

    return this.playoffMatchRepo.save(match);
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

    const newSlug = `core-${tournamentId.replace(/-/g, '').slice(0, 8)}-${Date.now().toString(36)}`;
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
      relations: ['team'],
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
    for (const r of rows) {
      const id = byMisc.get(r.misc.trim()) ?? byName.get(r.name);
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
}
