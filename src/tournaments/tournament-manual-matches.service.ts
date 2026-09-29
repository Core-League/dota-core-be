import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import { Dota2Service, OpenDotaMatch } from '../dota2/dota2.service';
import { DueloService } from '../duelo/duelo.service';
import type { MatchStage } from '../match-participants/match-participant.entity';
import { MatchParticipantsService } from '../match-participants/match-participants.service';
import { PlayoffMatch } from '../playoff/playoff-match.entity';
import { Player } from '../players/player.entity';
import { QualificationMatch } from '../qualification/qualification-match.entity';
import { Team } from '../teams/team.entity';
import {
  LinkManualMatchDto,
  LinkManualMatchResultDto,
  ManualMatchDto,
  ManualMatchTeamDto,
  SetMapDotaMatchDto,
  SetMapDotaMatchResultDto,
  TournamentMapDto,
} from './dto/manual-match.dto';

const STEAM_ID_OFFSET = 76561197960265728n;
const NUMERIC_ID = /^[0-9]+$/;

/** A map counts as manual when it has a winner but no real (numeric) Dota match id. */
function isManualId(dotaMatchId: string | null): boolean {
  return !dotaMatchId || !NUMERIC_ID.test(dotaMatchId);
}

function toTeamDto(team: Team): ManualMatchTeamDto {
  return { id: team.id, name: team.name, logoUrl: team.logoUrl ?? null };
}

/**
 * Admin flow for maps whose result was entered by hand (tech loss, manual
 * playoff entry): lists them per tournament and attaches the real Dota 2
 * match id later, so participant statistics and the Duelo sync get fed
 * without touching points or the bracket.
 */
@Injectable()
export class TournamentManualMatchesService {
  private readonly logger = new Logger(TournamentManualMatchesService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly dota2: Dota2Service,
    private readonly matchParticipants: MatchParticipantsService,
    private readonly duelo: DueloService,
  ) {}

  async listManualMatches(tournamentId: string): Promise<ManualMatchDto[]> {
    const qualMatches = await this.dataSource
      .getRepository(QualificationMatch)
      .find({
        where: { qualification: { tournament: { id: tournamentId } } },
        relations: ['teamA', 'teamB', 'winner'],
      });

    const playoffMatches = await this.dataSource
      .getRepository(PlayoffMatch)
      .find({
        where: { playoff: { tournamentId } },
        relations: ['teamA', 'teamB', 'series'],
        order: { createdAt: 'ASC' },
      });

    const qual: ManualMatchDto[] = qualMatches
      .filter(
        (m) => m.winner && m.teamA && m.teamB && isManualId(m.dotaMatchId),
      )
      .map((m) => ({
        stage: 'qualification',
        matchId: m.id,
        teamA: toTeamDto(m.teamA!),
        teamB: toTeamDto(m.teamB!),
        winnerTeamId: m.winner!.id,
        dotaMatchId: m.dotaMatchId,
        gameNumber: null,
        bestOf: null,
        finalType: null,
      }));

    const playoff: ManualMatchDto[] = playoffMatches
      .filter(
        (m) => m.winnerId && m.teamA && m.teamB && isManualId(m.dotaMatchId),
      )
      .map((m) => ({
        stage: 'playoff',
        matchId: m.id,
        teamA: toTeamDto(m.teamA!),
        teamB: toTeamDto(m.teamB!),
        winnerTeamId: m.winnerId!,
        dotaMatchId: m.dotaMatchId,
        gameNumber: m.gameNumber,
        bestOf: m.series?.bestOf ?? null,
        finalType: m.series?.finalType ?? null,
      }));

    return [...qual, ...playoff];
  }

  /** Every map of the tournament with both teams known, whatever its Dota match id — the audit view. */
  async listMaps(tournamentId: string): Promise<TournamentMapDto[]> {
    const qualMatches = await this.dataSource
      .getRepository(QualificationMatch)
      .find({
        where: { qualification: { tournament: { id: tournamentId } } },
        relations: ['teamA', 'teamB', 'winner'],
      });

    const playoffMatches = await this.dataSource
      .getRepository(PlayoffMatch)
      .find({
        where: { playoff: { tournamentId } },
        relations: ['teamA', 'teamB', 'series'],
        order: { createdAt: 'ASC' },
      });

    const qual: TournamentMapDto[] = qualMatches
      .filter((m) => m.teamA && m.teamB)
      .map((m) => ({
        stage: 'qualification',
        matchId: m.id,
        teamA: toTeamDto(m.teamA!),
        teamB: toTeamDto(m.teamB!),
        winnerTeamId: m.winner?.id ?? null,
        dotaMatchId: m.dotaMatchId,
        createdAt: null,
        gameNumber: null,
        bestOf: null,
        finalType: null,
        seriesId: null,
      }));

    const playoff: TournamentMapDto[] = playoffMatches
      .filter((m) => m.teamA && m.teamB)
      .map((m) => ({
        stage: 'playoff',
        matchId: m.id,
        teamA: toTeamDto(m.teamA!),
        teamB: toTeamDto(m.teamB!),
        winnerTeamId: m.winnerId,
        dotaMatchId: m.dotaMatchId,
        createdAt: m.createdAt?.toISOString() ?? null,
        gameNumber: m.gameNumber,
        bestOf: m.series?.bestOf ?? null,
        finalType: m.series?.finalType ?? null,
        seriesId: m.seriesId,
      }));

    return [...qual, ...playoff];
  }

  /**
   * Replace or detach the Dota match id of any map. Unlike `linkDotaMatch` it
   * also accepts maps that already carry a real id (a wrong one) and maps
   * without a recorded winner. Participant rows of the old id are dropped and
   * rewritten from the new match; points and the bracket stay untouched.
   */
  async setDotaMatch(
    tournamentId: string,
    dto: SetMapDotaMatchDto,
  ): Promise<SetMapDotaMatchResultDto> {
    const next = dto.dotaMatchId?.trim() || null;
    if (next !== null && !NUMERIC_ID.test(next)) {
      throw new BadRequestException('ID матчу Dota 2 має бути числом');
    }

    const target = await this.loadMap(tournamentId, dto.stage, dto.matchId);
    const previous = target.dotaMatchId;
    const base = {
      stage: dto.stage,
      matchId: dto.matchId,
      previousDotaMatchId: previous,
    };

    if (next === previous) {
      return {
        ...base,
        dotaMatchId: next,
        winnerVerified: false,
        participantsRemoved: 0,
        participantsRecorded: 0,
      };
    }

    if (next === null) {
      const participantsRemoved = await this.matchParticipants.removeForMatch(
        dto.stage,
        dto.matchId,
      );
      await this.storeDotaMatchId(dto.stage, dto.matchId, null);
      this.logger.log(
        `Detached dota match ${previous} from ${dto.stage} map ${dto.matchId} (tournament ${tournamentId})`,
      );
      return {
        ...base,
        dotaMatchId: null,
        winnerVerified: false,
        participantsRemoved,
        participantsRecorded: 0,
      };
    }

    await this.assertDotaIdUnusedExcept(next, dto.stage, dto.matchId);

    const matchData = await this.dota2.getOpenDotaMatch(next);
    if (typeof matchData.radiant_win !== 'boolean') {
      throw new UnprocessableEntityException(
        'OpenDota не повернув результат матчу — спробуйте пізніше',
      );
    }

    const radiantCoreTeamId = await this.resolveRadiantCoreTeamId(
      target.teamA,
      target.teamB,
      matchData,
    );
    let winnerVerified = false;
    if (radiantCoreTeamId) {
      const dotaWinnerId = matchData.radiant_win
        ? radiantCoreTeamId
        : radiantCoreTeamId === target.teamA.id
          ? target.teamB.id
          : target.teamA.id;
      if (target.winnerId && dotaWinnerId !== target.winnerId && !dto.force) {
        const dotaWinner =
          dotaWinnerId === target.teamA.id ? target.teamA : target.teamB;
        throw new UnprocessableEntityException(
          `У матчі ${next} перемогла «${dotaWinner.name}», а в Core записано іншого переможця. ` +
            'Спершу виправте результат або передайте force.',
        );
      }
      winnerVerified = target.winnerId === dotaWinnerId;
    } else if (!dto.force) {
      throw new UnprocessableEntityException(
        `Не вдалося впізнати команди Core у матчі ${next} — перевірте ID або передайте force.`,
      );
    }

    const participantsRemoved = await this.matchParticipants.removeForMatch(
      dto.stage,
      dto.matchId,
    );
    await this.storeDotaMatchId(dto.stage, dto.matchId, next);

    let participantsRecorded = 0;
    if (target.winnerId) {
      participantsRecorded = await this.matchParticipants.recordFromDota(
        {
          stage: dto.stage,
          matchId: dto.matchId,
          tournamentId,
          dotaMatchId: next,
          teamAId: target.teamA.id,
          teamBId: target.teamB.id,
          winnerId: target.winnerId,
        },
        matchData,
      );
      void this.duelo.sendMatchResult(matchData, `${dto.stage}:relink`);
    }

    this.logger.log(
      `Set dota match ${next} (was ${previous}) on ${dto.stage} map ${dto.matchId} (tournament ${tournamentId}); ` +
        `winnerVerified=${winnerVerified}, force=${dto.force === true}, participants=${participantsRecorded}`,
    );

    return {
      ...base,
      dotaMatchId: next,
      winnerVerified,
      participantsRemoved,
      participantsRecorded,
    };
  }

  private async storeDotaMatchId(
    stage: MatchStage,
    matchId: string,
    dotaMatchId: string | null,
  ): Promise<void> {
    if (stage === 'qualification') {
      await this.dataSource
        .getRepository(QualificationMatch)
        .update({ id: matchId }, { dotaMatchId });
    } else {
      await this.dataSource
        .getRepository(PlayoffMatch)
        .update({ id: matchId }, { dotaMatchId });
    }
  }

  /** Any map of the tournament with both teams present; winner and Dota id may be missing. */
  private async loadMap(
    tournamentId: string,
    stage: MatchStage,
    matchId: string,
  ): Promise<{
    teamA: Team;
    teamB: Team;
    winnerId: string | null;
    dotaMatchId: string | null;
  }> {
    if (stage === 'qualification') {
      const match = await this.dataSource
        .getRepository(QualificationMatch)
        .findOne({
          where: { id: matchId },
          relations: [
            'qualification',
            'qualification.tournament',
            'teamA',
            'teamB',
            'winner',
          ],
        });
      if (!match || match.qualification?.tournament?.id !== tournamentId) {
        throw new NotFoundException('Кваліфікаційний матч не знайдено');
      }
      if (!match.teamA || !match.teamB) {
        throw new BadRequestException('Одну з команд матчу видалено');
      }
      return {
        teamA: match.teamA,
        teamB: match.teamB,
        winnerId: match.winner?.id ?? null,
        dotaMatchId: match.dotaMatchId,
      };
    }

    const match = await this.dataSource.getRepository(PlayoffMatch).findOne({
      where: { id: matchId },
      relations: ['playoff', 'teamA', 'teamB'],
    });
    if (!match || match.playoff?.tournamentId !== tournamentId) {
      throw new NotFoundException('Матч плей-оф не знайдено');
    }
    if (!match.teamA || !match.teamB) {
      throw new BadRequestException('Одну з команд матчу видалено');
    }
    return {
      teamA: match.teamA,
      teamB: match.teamB,
      winnerId: match.winnerId,
      dotaMatchId: match.dotaMatchId,
    };
  }

  /** Like `assertDotaIdUnused`, but the map being edited may already hold the id. */
  private async assertDotaIdUnusedExcept(
    dotaMatchId: string,
    stage: MatchStage,
    matchId: string,
  ): Promise<void> {
    const [qual, playoff] = await Promise.all([
      this.dataSource
        .getRepository(QualificationMatch)
        .findOne({ where: { dotaMatchId }, select: ['id'] }),
      this.dataSource
        .getRepository(PlayoffMatch)
        .findOne({ where: { dotaMatchId }, select: ['id'] }),
    ]);
    const clashes =
      (qual && !(stage === 'qualification' && qual.id === matchId)) ||
      (playoff && !(stage === 'playoff' && playoff.id === matchId));
    if (clashes) {
      throw new BadRequestException(
        `Dota-матч ${dotaMatchId} уже прив’язано до іншого матчу`,
      );
    }
  }

  async linkDotaMatch(
    tournamentId: string,
    dto: LinkManualMatchDto,
  ): Promise<LinkManualMatchResultDto> {
    const dotaMatchId = dto.dotaMatchId.trim();
    if (!NUMERIC_ID.test(dotaMatchId)) {
      throw new BadRequestException('ID матчу Dota 2 має бути числом');
    }

    const target = await this.loadManualTarget(
      tournamentId,
      dto.stage,
      dto.matchId,
    );

    await this.assertDotaIdUnused(dotaMatchId);

    const matchData = await this.dota2.getOpenDotaMatch(dotaMatchId);
    if (typeof matchData.radiant_win !== 'boolean') {
      throw new UnprocessableEntityException(
        'OpenDota не повернув результат матчу — спробуйте пізніше',
      );
    }

    const radiantCoreTeamId = await this.resolveRadiantCoreTeamId(
      target.teamA,
      target.teamB,
      matchData,
    );
    let winnerVerified = false;
    if (radiantCoreTeamId) {
      const dotaWinnerId = matchData.radiant_win
        ? radiantCoreTeamId
        : radiantCoreTeamId === target.teamA.id
          ? target.teamB.id
          : target.teamA.id;
      if (dotaWinnerId !== target.winnerId) {
        const dotaWinner =
          dotaWinnerId === target.teamA.id ? target.teamA : target.teamB;
        throw new UnprocessableEntityException(
          `У матчі ${dotaMatchId} перемогла «${dotaWinner.name}», а в Core записано іншого переможця. ` +
            'Спершу виправте результат, потім прив’яжіть ID.',
        );
      }
      winnerVerified = true;
    } else {
      this.logger.warn(
        `Linking dota match ${dotaMatchId} to ${dto.stage} map ${dto.matchId} without team verification ` +
          '(no Dota team ids and no linked Steam accounts on either roster)',
      );
    }

    if (dto.stage === 'qualification') {
      await this.dataSource
        .getRepository(QualificationMatch)
        .update({ id: dto.matchId }, { dotaMatchId });
    } else {
      await this.dataSource
        .getRepository(PlayoffMatch)
        .update({ id: dto.matchId }, { dotaMatchId });
    }

    // Who really played (player stats). Never fails the link.
    const participantsRecorded = await this.matchParticipants.recordFromDota(
      {
        stage: dto.stage,
        matchId: dto.matchId,
        tournamentId,
        dotaMatchId,
        teamAId: target.teamA.id,
        teamBId: target.teamB.id,
        winnerId: target.winnerId,
      },
      matchData,
    );

    void this.duelo.sendMatchResult(matchData, `${dto.stage}:link`);

    this.logger.log(
      `Linked dota match ${dotaMatchId} to ${dto.stage} map ${dto.matchId} (tournament ${tournamentId}); ` +
        `winnerVerified=${winnerVerified}, participants=${participantsRecorded}`,
    );

    return {
      stage: dto.stage,
      matchId: dto.matchId,
      dotaMatchId,
      winnerVerified,
      participantsRecorded,
    };
  }

  private async loadManualTarget(
    tournamentId: string,
    stage: MatchStage,
    matchId: string,
  ): Promise<{ teamA: Team; teamB: Team; winnerId: string }> {
    if (stage === 'qualification') {
      const match = await this.dataSource
        .getRepository(QualificationMatch)
        .findOne({
          where: { id: matchId },
          relations: [
            'qualification',
            'qualification.tournament',
            'teamA',
            'teamB',
            'winner',
          ],
        });
      if (!match || match.qualification?.tournament?.id !== tournamentId) {
        throw new NotFoundException('Кваліфікаційний матч не знайдено');
      }
      if (!match.teamA || !match.teamB || !match.winner) {
        throw new BadRequestException(
          'Матч не має результату або одну з команд видалено',
        );
      }
      if (!isManualId(match.dotaMatchId)) {
        throw new BadRequestException(
          `Матч уже прив’язано до Dota-матчу ${match.dotaMatchId}`,
        );
      }
      return {
        teamA: match.teamA,
        teamB: match.teamB,
        winnerId: match.winner.id,
      };
    }

    const match = await this.dataSource.getRepository(PlayoffMatch).findOne({
      where: { id: matchId },
      relations: ['playoff', 'teamA', 'teamB'],
    });
    if (!match || match.playoff?.tournamentId !== tournamentId) {
      throw new NotFoundException('Матч плей-оф не знайдено');
    }
    if (!match.teamA || !match.teamB || !match.winnerId) {
      throw new BadRequestException(
        'Матч не має результату або одну з команд видалено',
      );
    }
    if (!isManualId(match.dotaMatchId)) {
      throw new BadRequestException(
        `Матч уже прив’язано до Dota-матчу ${match.dotaMatchId}`,
      );
    }
    return {
      teamA: match.teamA,
      teamB: match.teamB,
      winnerId: match.winnerId,
    };
  }

  /** A Dota match is one map; it cannot back two Core maps anywhere. */
  private async assertDotaIdUnused(dotaMatchId: string): Promise<void> {
    const [qual, playoff] = await Promise.all([
      this.dataSource
        .getRepository(QualificationMatch)
        .existsBy({ dotaMatchId }),
      this.dataSource.getRepository(PlayoffMatch).existsBy({ dotaMatchId }),
    ]);
    if (qual || playoff) {
      throw new BadRequestException(
        `Dota-матч ${dotaMatchId} уже прив’язано до іншого матчу`,
      );
    }
  }

  /**
   * Which Core team was Radiant: by the Dota team ids on the match first,
   * then by counting linked Steam accounts of each roster per side. Null when
   * neither source identifies a side.
   */
  private async resolveRadiantCoreTeamId(
    teamA: Team,
    teamB: Team,
    match: OpenDotaMatch,
  ): Promise<string | null> {
    const radiantDotaId = String(
      match.radiant_team_id ?? match.radiant_team?.team_id ?? '',
    );
    const direDotaId = String(
      match.dire_team_id ?? match.dire_team?.team_id ?? '',
    );
    const a = teamA.dotaTeamId ?? '';
    const b = teamB.dotaTeamId ?? '';
    if (radiantDotaId && radiantDotaId === a) return teamA.id;
    if (radiantDotaId && radiantDotaId === b) return teamB.id;
    if (direDotaId && direDotaId === a) return teamB.id;
    if (direDotaId && direDotaId === b) return teamA.id;

    const players = (match.players ?? []).filter(
      (p) => Number.isFinite(p.account_id) && p.account_id > 0,
    );
    if (!players.length) return null;

    const rosters = await this.dataSource.getRepository(Team).find({
      where: { id: In([teamA.id, teamB.id]) },
      relations: ['captain', 'mainPlayers', 'reservedPlayers'],
    });
    const steamIdsOf = (teamId: string): Set<string> => {
      const team = rosters.find((t) => t.id === teamId);
      const members: Player[] = [
        team?.captain,
        ...(team?.mainPlayers ?? []),
        ...(team?.reservedPlayers ?? []),
      ].filter((p): p is Player => !!p);
      return new Set(
        members
          .map((p) => p.steamId)
          .filter((s): s is string => typeof s === 'string' && s.length > 0),
      );
    };
    const rosterA = steamIdsOf(teamA.id);
    const rosterB = steamIdsOf(teamB.id);

    let radiantA = 0;
    let radiantB = 0;
    let direA = 0;
    let direB = 0;
    for (const p of players) {
      const steamId = (BigInt(p.account_id) + STEAM_ID_OFFSET).toString();
      const isRadiant =
        typeof p.isRadiant === 'boolean' ? p.isRadiant : p.player_slot < 128;
      if (rosterA.has(steamId)) {
        if (isRadiant) radiantA++;
        else direA++;
      }
      if (rosterB.has(steamId)) {
        if (isRadiant) radiantB++;
        else direB++;
      }
    }

    const aOnRadiant = radiantA + direB;
    const aOnDire = direA + radiantB;
    if (aOnRadiant === 0 && aOnDire === 0) return null;
    if (aOnRadiant === aOnDire) return null;
    return aOnRadiant > aOnDire ? teamA.id : teamB.id;
  }
}
