import { HttpService } from '@nestjs/axios';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { firstValueFrom } from 'rxjs';

import {
  type BracketIndexedRow,
  type ResolvedDeBo3,
  bracketOrdinalFromChallongeMatchAttrs,
  resolveDoubleElimBo3ByBracketOrdinal,
  PLAYOFF_BO3_FINALS_COUNT,
} from '../playoff/playoff-finals-bo3';

interface V2TournamentResponse {
  data: {
    id: string;
    attributes: { url: string };
  };
}

interface V2ParticipantItem {
  id: string;
  attributes: { name: string; misc?: string | null };
}

interface V2MatchItem {
  id: string;
  type?: string;
  attributes: {
    state: string;
    round: number;
    points_by_participant: Array<{ participant_id: number }>;
    [key: string]: unknown;
  };
  relationships?: Record<string, unknown>;
}

/** Challonge accepts large rosters safely if we bulk-add in chunks. */
const BULK_PARTICIPANTS_CHUNK = 100;

@Injectable()
export class ChallongeService {
  private readonly logger = new Logger(ChallongeService.name);
  private readonly baseUrl = 'https://api.challonge.com/v2.1';
  private readonly apiKey: string;

  constructor(private readonly http: HttpService) {
    this.apiKey = process.env.CHALLONGE_API_KEY ?? '';
    if (!this.apiKey) {
      this.logger.warn('CHALLONGE_API_KEY not set in environment');
    }
  }

  /** Paginates through Challonge `/matches.json` until a short page / empty slice. */
  private async fetchAllMatchPagesJsonApi(
    url: string,
    extraParams?: Record<string, string | undefined>,
  ): Promise<V2MatchItem[]> {
    const merged: V2MatchItem[] = [];
    const perPage = 100;
    const capPages = 200;

    for (let page = 1; page <= capPages; page += 1) {
      let slice: V2MatchItem[];
      try {
        const resp = await firstValueFrom(
          this.http.get<{ data: V2MatchItem[] }>(
            `${this.baseUrl}/tournaments/${url}/matches.json`,
            {
              headers: this.headers,
              params: (() => {
                const params: Record<string, string> = {
                  page: String(page),
                  per_page: String(perPage),
                };
                if (extraParams) {
                  for (const [k, v] of Object.entries(extraParams)) {
                    if (v !== undefined && v !== '') params[k] = v;
                  }
                }
                return params;
              })(),
            },
          ),
        );
        slice = resp.data.data ?? [];
      } catch (err) {
        this.logger.error(
          `fetchAllMatchPagesJsonApi HTTP failed page=${page}`,
          err,
        );
        throw new InternalServerErrorException(
          'Failed to fetch matches from Challonge',
        );
      }

      if (slice.length === 0) break;
      merged.push(...slice);
      if (slice.length < perPage) break;
    }

    return merged;
  }

  private get headers() {
    return {
      'Content-Type': 'application/vnd.api+json',
      Accept: 'application/json',
      'Authorization-Type': 'v1',
      Authorization: this.apiKey,
    };
  }

  async createTournament(
    name: string,
    slug: string,
  ): Promise<{ id: number; url: string }> {
    try {
      const resp = await firstValueFrom(
        this.http.post<V2TournamentResponse>(
          `${this.baseUrl}/tournaments.json`,
          {
            data: {
              type: 'tournament',
              attributes: {
                name,
                url: slug,
                tournament_type: 'double elimination',
                game_name: 'Dota 2',
                double_elimination_options: {
                  grand_finals_modifier: 'single match',
                },
              },
            },
          },
          { headers: this.headers },
        ),
      );
      const t = resp.data.data;
      return { id: Number(t.id), url: t.attributes.url };
    } catch (err) {
      this.logger.error('createTournament failed', err);
      throw new InternalServerErrorException(
        'Failed to create tournament on Challonge',
      );
    }
  }

  /**
   * One bulk_add POST. Prefer `bulkAddParticipantsAll` when many teams participate.
   */
  async bulkAddParticipants(
    url: string,
    participants: { name: string; seed: number; misc?: string }[],
  ): Promise<{ name: string; id: number; misc: string | null }[]> {
    try {
      const resp = await firstValueFrom(
        this.http.post<{ data: V2ParticipantItem[] }>(
          `${this.baseUrl}/tournaments/${url}/participants/bulk_add.json`,
          {
            data: {
              type: 'Participants',
              attributes: { participants },
            },
          },
          { headers: this.headers },
        ),
      );
      const rows = resp.data?.data ?? [];
      return rows.map((p) => ({
        name: p.attributes.name,
        id: Number(p.id),
        misc: p.attributes.misc ?? null,
      }));
    } catch (err) {
      this.logger.error('bulkAddParticipants failed', err);
      throw new InternalServerErrorException(
        'Failed to add participants to Challonge tournament',
      );
    }
  }

  /** Batched bulk_add — avoids truncation / payload limits when many seeds are sent at once. */
  async bulkAddParticipantsAll(
    url: string,
    participants: { name: string; seed: number; misc?: string }[],
  ): Promise<{ name: string; id: number; misc: string | null }[]> {
    const out: { name: string; id: number; misc: string | null }[] = [];
    for (let i = 0; i < participants.length; i += BULK_PARTICIPANTS_CHUNK) {
      const chunk = participants.slice(i, i + BULK_PARTICIPANTS_CHUNK);
      if (chunk.length === 0) continue;
      const created = await this.bulkAddParticipants(url, chunk);
      out.push(...created);
    }
    return out;
  }

  async listParticipants(
    url: string,
  ): Promise<{ id: number; name: string; misc: string | null }[]> {
    try {
      const resp = await firstValueFrom(
        this.http.get<{ data: V2ParticipantItem[] }>(
          `${this.baseUrl}/tournaments/${url}/participants.json`,
          { headers: this.headers },
        ),
      );
      return resp.data.data.map((p) => ({
        id: Number(p.id),
        name: p.attributes.name,
        misc: p.attributes.misc ?? null,
      }));
    } catch (err) {
      this.logger.error('listParticipants failed', err);
      throw new InternalServerErrorException(
        'Failed to fetch participants from Challonge',
      );
    }
  }

  async listAllMatchesWithBothParticipants(url: string): Promise<
    {
      id: number;
      participant1Id: number;
      participant2Id: number;
      round: number;
      state: string;
    }[]
  > {
    const matches = await this.fetchAllMatchPagesJsonApi(url);

    return matches
      .filter((m) => (m.attributes.points_by_participant ?? []).length >= 2)
      .map((m) => {
        const [p1, p2] = m.attributes.points_by_participant;
        return {
          id: Number(m.id),
          participant1Id: p1.participant_id,
          participant2Id: p2.participant_id,
          round: m.attributes.round,
          state: m.attributes.state,
        };
      });
  }

  async startTournament(url: string): Promise<void> {
    try {
      await firstValueFrom(
        this.http.put(
          `${this.baseUrl}/tournaments/${url}/change_state.json`,
          {
            data: {
              type: 'TournamentState',
              attributes: { state: 'start' },
            },
          },
          { headers: this.headers },
        ),
      );
    } catch (err) {
      this.logger.error('startTournament failed', err);
      throw new InternalServerErrorException(
        'Failed to start tournament on Challonge',
      );
    }
  }

  async listOpenMatches(url: string): Promise<
    {
      id: number;
      participant1Id: number;
      participant2Id: number;
      round: number;
    }[]
  > {
    const matches = await this.fetchAllMatchPagesJsonApi(url, {
      state: 'open',
    });

    return matches
      .filter((m) => {
        const pts = m.attributes.points_by_participant ?? [];
        if (pts.length < 2) return false;
        return pts.every(
          (slot) =>
            typeof slot.participant_id === 'number' && slot.participant_id > 0,
        );
      })
      .map((m) => {
        const [p1, p2] = m.attributes.points_by_participant;
        return {
          id: Number(m.id),
          participant1Id: p1.participant_id,
          participant2Id: p2.participant_id,
          round: m.attributes.round,
        };
      });
  }

  async findOpenMatch(
    url: string,
    participantIdA: number,
    participantIdB: number,
  ): Promise<{
    id: number;
    player1_id: number;
    player2_id: number;
    round: number;
  }> {
    this.logger.log(
      `findOpenMatch: looking for participants ${participantIdA} vs ${participantIdB} in ${url}`,
    );
    const matches = await this.fetchAllMatchPagesJsonApi(url, {
      state: 'open',
    });

    this.logger.log(`findOpenMatch: received ${matches.length} open matches`);
    for (const m of matches) {
      const ids = (m.attributes.points_by_participant ?? []).map(
        (p) => p.participant_id,
      );
      this.logger.log(
        `  match ${m.id} round=${m.attributes.round} participants=${ids.join(',')}`,
      );
    }

    const found = matches.find((m) => {
      const ids = (m.attributes.points_by_participant ?? []).map(
        (p) => p.participant_id,
      );
      return ids.includes(participantIdA) && ids.includes(participantIdB);
    });

    if (!found) {
      throw new NotFoundException(
        'No open Challonge match found between these two participants',
      );
    }

    const participants = found.attributes.points_by_participant ?? [];
    return {
      id: Number(found.id),
      player1_id: participants[0]?.participant_id,
      player2_id: participants[1]?.participant_id,
      round: found.attributes.round,
    };
  }

  /** All bracket nodes `{id, round}` (paginates). */
  async listMatchesIdRound(
    url: string,
  ): Promise<{ id: number; round: number }[]> {
    const allMatches = await this.fetchAllMatchPagesJsonApi(url);
    return allMatches.map((m) => ({
      id: Number(m.id),
      round: m.attributes.round,
    }));
  }

  /** Усі Challonge міси разом із 1-based canonical ordinal (поле порядку сітки). */
  async listBracketIndexedMatches(url: string): Promise<BracketIndexedRow[]> {
    const rows = await this.fetchAllMatchPagesJsonApi(url);
    return rows.map((m) => {
      const attrs = (m.attributes ?? {}) as Record<string, unknown>;
      return {
        challongeNumericId: Number(m.id),
        bracketOrdinal1Based: bracketOrdinalFromChallongeMatchAttrs(attrs),
      };
    });
  }

  /**
   * У double elimination із N активних команд очікуємо лише три BO3-finals:
   * UB final (N−2), LB final (2N−4), GF (2N−3) за canonical bracket порядком.
   */
  async getDoubleElimBo3BracketResolution(
    url: string,
    activeTeamCount: number,
  ): Promise<ResolvedDeBo3> {
    const indexed = await this.listBracketIndexedMatches(url);
    const resolved = resolveDoubleElimBo3ByBracketOrdinal(
      indexed,
      activeTeamCount,
    );
    for (const line of resolved.diagnostics) {
      if (line.startsWith('ERROR')) this.logger.error(line);
      else if (line.startsWith('WARN')) this.logger.warn(line);
      else this.logger.log(line);
    }
    const got = resolved.bo3ChallongeIds.size;
    if (got !== PLAYOFF_BO3_FINALS_COUNT && activeTeamCount >= 4) {
      this.logger.error(
        `DE BO3 safety: expected=${PLAYOFF_BO3_FINALS_COUNT} assigned=${got} ` +
          `ids=[${[...resolved.bo3ChallongeIds].sort((a, b) => a - b).join(',')}]`,
      );
    }
    return resolved;
  }

  /** Back-compat: набір Challonge numeric id з BO3. */
  async getFinalBo3ChallongeMatchIds(
    url: string,
    activeTeamCount: number,
  ): Promise<Set<number>> {
    const r = await this.getDoubleElimBo3BracketResolution(
      url,
      activeTeamCount,
    );
    return r.bo3ChallongeIds;
  }

  async reportMatchResult(
    url: string,
    matchId: number,
    winnerParticipantId: number,
    player1ParticipantId: number,
    player2ParticipantId: number,
    winnerWins = 1,
    loserWins = 0,
  ): Promise<void> {
    const loserParticipantId =
      winnerParticipantId === player1ParticipantId
        ? player2ParticipantId
        : player1ParticipantId;

    try {
      await firstValueFrom(
        this.http.put(
          `${this.baseUrl}/tournaments/${url}/matches/${matchId}.json`,
          {
            data: {
              type: 'match',
              attributes: {
                match: [
                  {
                    participant_id: winnerParticipantId,
                    score_set: String(winnerWins),
                    advancing: true,
                  },
                  {
                    participant_id: loserParticipantId,
                    score_set: String(loserWins),
                    advancing: false,
                  },
                ],
              },
            },
          },
          { headers: this.headers },
        ),
      );
    } catch (err) {
      this.logger.error('reportMatchResult failed', err);
      throw new InternalServerErrorException(
        'Failed to report match result on Challonge',
      );
    }
  }

  async deleteTournament(url: string): Promise<void> {
    try {
      await firstValueFrom(
        this.http.delete(`${this.baseUrl}/tournaments/${url}.json`, {
          headers: this.headers,
        }),
      );
    } catch (err) {
      this.logger.error('deleteTournament failed', err);
      throw new InternalServerErrorException(
        'Failed to delete tournament on Challonge',
      );
    }
  }
}
