import { HttpService } from '@nestjs/axios';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { firstValueFrom } from 'rxjs';

interface ChallongeParticipant {
  participant: { id: number; name: string; misc?: string | null };
}

interface ChallongeMatch {
  match: {
    id: number;
    player1_id: number;
    player2_id: number;
    state: string;
    winner_id: number | null;
  };
}

interface ChallongeTournamentResponse {
  tournament: { id: number; url: string };
}

/** Challonge accepts large rosters safely if we bulk-add in chunks. */
const BULK_PARTICIPANTS_CHUNK = 100;

@Injectable()
export class ChallongeService {
  private readonly logger = new Logger(ChallongeService.name);
  private readonly baseUrl = 'https://api.challonge.com/v1';
  private readonly apiKey: string;

  constructor(private readonly http: HttpService) {
    this.apiKey = process.env.CHALLONGE_API_KEY ?? '';
    if (!this.apiKey) {
      this.logger.warn('CHALLONGE_API_KEY not set in environment');
    }
  }

  async createTournament(
    name: string,
    slug: string,
  ): Promise<{ id: number; url: string }> {
    try {
      const resp = await firstValueFrom(
        this.http.post<ChallongeTournamentResponse>(
          `${this.baseUrl}/tournaments.json`,
          {
            tournament: {
              name,
              url: slug,
              tournament_type: 'double elimination',
            },
          },
          { params: { api_key: this.apiKey } },
        ),
      );
      const t = resp.data.tournament;
      return { id: t.id, url: t.url };
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
        this.http.post(
          `${this.baseUrl}/tournaments/${url}/participants/bulk_add.json`,
          { participants },
          { params: { api_key: this.apiKey } },
        ),
      );
      const rows = (resp.data ?? []) as ChallongeParticipant[];
      return rows.map((p) => ({
        name: p.participant.name,
        id: p.participant.id,
        misc: p.participant.misc ?? null,
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

  async startTournament(url: string): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(
          `${this.baseUrl}/tournaments/${url}/start.json`,
          {},
          { params: { api_key: this.apiKey } },
        ),
      );
    } catch (err) {
      this.logger.error('startTournament failed', err);
      throw new InternalServerErrorException(
        'Failed to start tournament on Challonge',
      );
    }
  }

  async findOpenMatch(
    url: string,
    participantIdA: number,
    participantIdB: number,
  ): Promise<{ id: number; player1_id: number; player2_id: number }> {
    let matches: ChallongeMatch[];
    try {
      const resp = await firstValueFrom(
        this.http.get(`${this.baseUrl}/tournaments/${url}/matches.json`, {
          params: { api_key: this.apiKey, state: 'open' },
        }),
      );
      matches = resp.data as ChallongeMatch[];
    } catch (err) {
      this.logger.error('findOpenMatch HTTP call failed', err);
      throw new InternalServerErrorException(
        'Failed to fetch matches from Challonge',
      );
    }

    const found = matches.find((m) => {
      const p1 = m.match.player1_id;
      const p2 = m.match.player2_id;
      return (
        (p1 === participantIdA && p2 === participantIdB) ||
        (p1 === participantIdB && p2 === participantIdA)
      );
    });
    if (!found) {
      throw new NotFoundException(
        'No open Challonge match found between these two participants',
      );
    }
    return {
      id: found.match.id,
      player1_id: found.match.player1_id,
      player2_id: found.match.player2_id,
    };
  }

  async reportMatchResult(
    url: string,
    matchId: number,
    winnerParticipantId: number,
  ): Promise<void> {
    try {
      await firstValueFrom(
        this.http.put(
          `${this.baseUrl}/tournaments/${url}/matches/${matchId}.json`,
          {
            match: {
              winner_id: winnerParticipantId,
              scores_csv: '1-0',
            },
          },
          { params: { api_key: this.apiKey } },
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
          params: { api_key: this.apiKey },
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
