import { randomInt } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  Match3LeaderboardDto,
  Match3RunResultDto,
  Match3RunStartDto,
} from './dto/match3.dto';
import { Match3Run, Match3RunStatus } from './match3-run.entity';
import { replayMatch3, type TMatch3Action } from './match3.engine';

const LEADERBOARD_SIZE = 10;
/** An ACTIVE run older than this can no longer be finished. */
const RUN_TTL_MS = 6 * 60 * 60 * 1000;
const SEED_MAX = 2 ** 31 - 1;

interface ILeaderboardRow {
  playerId: string;
  score: number;
  finishedAt: Date;
  position: string | number;
  total: string | number;
  discordName: string | null;
  discordUsername: string | null;
  avatarUrl: string | null;
}

@Injectable()
export class Match3Service {
  constructor(
    @InjectRepository(Match3Run)
    private readonly runs: Repository<Match3Run>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /** Issues a seed. An abandoned ACTIVE run of the player is dropped. */
  async startRun(playerId: string): Promise<Match3RunStartDto> {
    await this.runs.delete({ playerId, status: Match3RunStatus.ACTIVE });
    const run = await this.runs.save(
      this.runs.create({ playerId, seed: randomInt(0, SEED_MAX) }),
    );
    return { id: run.id, seed: run.seed };
  }

  /** Replays the action log from the run's seed and stores the server-computed score. */
  async finishRun(
    playerId: string,
    runId: string,
    actions: Record<string, unknown>[],
  ): Promise<Match3RunResultDto> {
    const run = await this.runs.findOne({
      where: { id: runId, playerId, status: Match3RunStatus.ACTIVE },
    });
    if (!run || Date.now() - run.startedAt.getTime() > RUN_TTL_MS) {
      throw new NotFoundException({
        error: 'run_not_found',
        message: 'Гру не знайдено або її вже завершено',
      });
    }

    // Shapes are untrusted: the engine rejects anything it cannot apply
    const { state, valid } = replayMatch3(
      run.seed,
      actions as unknown as TMatch3Action[],
    );
    if (!valid) {
      throw new BadRequestException({
        error: 'invalid_run',
        message: 'Журнал ходів не відповідає правилам гри',
      });
    }

    const previousBest = await this.bestOf(playerId);
    // Guarded by status: a double submit finishes the run only once
    const updated = await this.runs.update(
      { id: run.id, status: Match3RunStatus.ACTIVE },
      {
        status: Match3RunStatus.FINISHED,
        score: state.score,
        moves: state.movesMade,
        bestChain: state.bestChain,
        actions: actions.length,
        finishedAt: new Date(),
      },
    );
    if (!updated.affected) {
      throw new NotFoundException({
        error: 'run_not_found',
        message: 'Гру не знайдено або її вже завершено',
      });
    }

    const best = Math.max(previousBest, state.score);
    const board = await this.getLeaderboard(playerId);
    return {
      score: state.score,
      moves: state.movesMade,
      bestChain: state.bestChain,
      best,
      position: board.me?.position ?? null,
      isRecord: state.score > previousBest,
    };
  }

  /** Top 10 by each player's best run, plus the viewer's place. */
  async getLeaderboard(viewerId: string | null): Promise<Match3LeaderboardDto> {
    const rows: ILeaderboardRow[] = await this.dataSource.query(
      `WITH best AS (
         SELECT DISTINCT ON (r."playerId") r."playerId", r."score", r."finishedAt"
         FROM "match3_run" r
         WHERE r."status" = $1 AND r."score" > 0
         ORDER BY r."playerId", r."score" DESC, r."finishedAt" ASC
       ),
       ranked AS (
         SELECT b.*,
                ROW_NUMBER() OVER (ORDER BY b."score" DESC, b."finishedAt" ASC) AS "position",
                COUNT(*) OVER () AS "total"
         FROM best b
       )
       SELECT k."playerId", k."score", k."finishedAt", k."position", k."total",
              p."discordName", p."discordUsername", p."avatarUrl"
       FROM ranked k
       JOIN "player" p ON p."id" = k."playerId"
       WHERE k."position" <= $2 OR k."playerId" = $3
       ORDER BY k."position" ASC`,
      [Match3RunStatus.FINISHED, LEADERBOARD_SIZE, viewerId],
    );

    const mine = viewerId
      ? rows.find((row) => row.playerId === viewerId)
      : undefined;
    return {
      rows: rows
        .filter((row) => Number(row.position) <= LEADERBOARD_SIZE)
        .map((row) => ({
          position: Number(row.position),
          player: {
            id: row.playerId,
            discordName: row.discordName,
            discordUsername: row.discordUsername,
            avatarUrl: row.avatarUrl,
          },
          score: row.score,
          achievedAt: row.finishedAt,
        })),
      totalPlayers: rows.length ? Number(rows[0].total) : 0,
      me: mine ? { best: mine.score, position: Number(mine.position) } : null,
    };
  }

  private async bestOf(playerId: string): Promise<number> {
    const row = await this.runs
      .createQueryBuilder('r')
      .select('MAX(r.score)', 'best')
      .where('r.playerId = :playerId', { playerId })
      .andWhere('r.status = :status', { status: Match3RunStatus.FINISHED })
      .getRawOne<{ best: number | null }>();
    return Number(row?.best ?? 0);
  }
}
