import { HttpService } from '@nestjs/axios';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { firstValueFrom } from 'rxjs';

interface V2TournamentResponse {
  data: {
    id: string;
    attributes: { url: string };
  };
}

interface V2ParticipantItem {
  id: string;
  attributes: { name: string };
}

interface V2MatchItem {
  id: string;
  attributes: {
    state: string;
    round: number;
    points_by_participant: Array<{ participant_id: number }>;
    [key: string]: unknown;
  };
}

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

  async bulkAddParticipants(
    url: string,
    participants: { name: string; seed: number }[],
  ): Promise<{ name: string; id: number }[]> {
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
      return resp.data.data.map((p) => ({
        name: p.attributes.name,
        id: Number(p.id),
      }));
    } catch (err) {
      this.logger.error('bulkAddParticipants failed', err);
      throw new InternalServerErrorException(
        'Failed to add participants to Challonge tournament',
      );
    }
  }

  async listParticipants(url: string): Promise<{ id: number; name: string }[]> {
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
    let matches: V2MatchItem[];
    try {
      const resp = await firstValueFrom(
        this.http.get<{ data: V2MatchItem[] }>(
          `${this.baseUrl}/tournaments/${url}/matches.json`,
          { headers: this.headers },
        ),
      );
      matches = resp.data.data;
    } catch (err) {
      this.logger.error(
        'listAllMatchesWithBothParticipants HTTP call failed',
        err,
      );
      throw new InternalServerErrorException(
        'Failed to fetch matches from Challonge',
      );
    }

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
    let matches: V2MatchItem[];
    try {
      const resp = await firstValueFrom(
        this.http.get<{ data: V2MatchItem[] }>(
          `${this.baseUrl}/tournaments/${url}/matches.json`,
          { headers: this.headers, params: { state: 'open' } },
        ),
      );
      matches = resp.data.data;
    } catch (err) {
      this.logger.error('listOpenMatches HTTP call failed', err);
      throw new InternalServerErrorException(
        'Failed to fetch matches from Challonge',
      );
    }

    return matches
      .filter((m) => (m.attributes.points_by_participant ?? []).length >= 2)
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
    let matches: V2MatchItem[];
    try {
      const resp = await firstValueFrom(
        this.http.get<{ data: V2MatchItem[] }>(
          `${this.baseUrl}/tournaments/${url}/matches.json`,
          {
            headers: this.headers,
            params: { state: 'open' },
          },
        ),
      );
      matches = resp.data.data;
    } catch (err) {
      this.logger.error('findOpenMatch HTTP call failed', err);
      throw new InternalServerErrorException(
        'Failed to fetch matches from Challonge',
      );
    }

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

  /**
   * Returns the set of Challonge round numbers that should be played as BO3:
   * upper bracket final, lower bracket final, grand final, and bracket reset.
   *
   * Detection: BO3 rounds are all positive rounds that come after the last
   * multi-match winners-bracket round (i.e., every single-match round at the
   * end of the bracket), plus the most-negative (lower bracket final) round.
   */
  async getBO3Rounds(url: string): Promise<Set<number>> {
    let allMatches: V2MatchItem[];
    try {
      const resp = await firstValueFrom(
        this.http.get<{ data: V2MatchItem[] }>(
          `${this.baseUrl}/tournaments/${url}/matches.json`,
          { headers: this.headers },
        ),
      );
      allMatches = resp.data.data;
    } catch (err) {
      this.logger.error('getBO3Rounds HTTP call failed', err);
      throw new InternalServerErrorException(
        'Failed to fetch matches from Challonge',
      );
    }

    const bo3Rounds = new Set<number>();

    this.logger.log(
      `getBO3Rounds: total matches=${allMatches.length} rounds=${allMatches
        .map((m) => m.attributes.round)
        .sort((a, b) => a - b)
        .join(',')}`,
    );

    const positiveRounds = [
      ...new Set(
        allMatches.map((m) => m.attributes.round).filter((r) => r > 0),
      ),
    ].sort((a, b) => a - b);

    const negativeRounds = [
      ...new Set(
        allMatches.map((m) => m.attributes.round).filter((r) => r < 0),
      ),
    ].sort((a, b) => a - b);

    // Mark winners semifinal + everything after it (GF, bracket reset) as BO3.
    // The winners semifinal is the second-to-last unique positive round.
    // (Round 3 for a 4-team bracket holds both GF and bracket-reset matches,
    //  so the old "rounds after last multi-match" heuristic breaks — it treats
    //  round 3 as the last multi-match and finds nothing after it.)
    const bo3PositiveThreshold =
      positiveRounds.length >= 2
        ? positiveRounds[positiveRounds.length - 2]
        : (positiveRounds[0] ?? Infinity);

    positiveRounds
      .filter((r) => r >= bo3PositiveThreshold)
      .forEach((r) => bo3Rounds.add(r));

    if (negativeRounds.length > 0) bo3Rounds.add(negativeRounds[0]);

    this.logger.log(
      `getBO3Rounds: bo3PositiveThreshold=${bo3PositiveThreshold} bo3Rounds=${[...bo3Rounds].sort((a, b) => a - b).join(',')}`,
    );

    return bo3Rounds;
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
