import { HttpService } from '@nestjs/axios';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import * as cheerio from 'cheerio';
import { firstValueFrom } from 'rxjs';

export interface OpenDotaPlayer {
  match_id: number;
  player_slot: number;
  account_id: number;
  hero_id: number;
  kills: number;
  deaths: number;
  assists: number;
  gold_per_min: number;
  xp_per_min: number;
  last_hits: number;
  denies: number;
  hero_damage: number;
  tower_damage: number;
  hero_healing: number;
  level: number;
  isRadiant: boolean;
  win: number;
  lose: number;
  personaname: string | null;
  radiant_win: boolean;
  duration: number;
  start_time: number;
  game_mode: number;
  lobby_type: number;
  lane: number | null;
  lane_role: number | null;
  rank_tier: number | null;
}

export interface OpenDotaTeam {
  team_id?: number;
  name?: string;
  tag?: string;
  logo_url?: string | null;
}

export interface OpenDotaMatch {
  match_id: number;
  duration: number;
  start_time: number;
  radiant_win: boolean;
  human_players: number;
  game_mode: number;
  lobby_type: number;
  cluster: number;
  patch: number;
  region: number;
  radiant_score: number;
  dire_score: number;
  radiant_team_id?: number;
  dire_team_id?: number;
  radiant_team?: OpenDotaTeam;
  dire_team?: OpenDotaTeam;
  players: OpenDotaPlayer[];
  replay_url?: string;
}

@Injectable()
export class Dota2Service {
  private readonly logger = new Logger(Dota2Service.name);

  constructor(private readonly http: HttpService) {}

  private get leagueId(): string {
    return process.env.DOTA_LEAGUE_ID ?? '';
  }

  private get cookie(): string {
    const sessionId = process.env.DOTA_SESSION_ID ?? '';
    const oauthToken = process.env.DOTA_OAUTH_TOKEN ?? '';
    const oauthInfo = process.env.DOTA_OAUTH_INFO ?? '';
    return `Steam_Language=russian; dota_oauth_token=${oauthToken}; sessionid=${sessionId}; dota_oauth_info=${oauthInfo}`;
  }

  private get sessionId(): string {
    return process.env.DOTA_SESSION_ID ?? '';
  }

  private baseUrl(path: string): string {
    return `https://www.dota2.com/league/${this.leagueId}/${path}`;
  }

  private commonHeaders(): Record<string, string> {
    return {
      accept: '*/*',
      'content-type': 'application/x-www-form-urlencoded',
      cookie: this.cookie,
      origin: 'https://www.dota2.com',
      referer: `https://www.dota2.com/league/${this.leagueId}/tournament`,
      'x-requested-with': 'XMLHttpRequest',
    };
  }

  async addNodeGroup(params: {
    nodeGroupId: string;
    nodeGroupType: number;
    teamCount: number;
    containingNodeGroupId: string;
    phase: number;
    defaultNodeType?: number;
  }): Promise<void> {
    const body = new URLSearchParams({
      sessionid: this.sessionId,
      node_group_id: params.nodeGroupId,
      name: '',
      team_count: String(params.teamCount),
      start_time: '0',
      end_time: '0',
      advancing_team_count: '',
      secondary_advancing_team_count: '',
      tertiary_advancing_team_count: '',
      node_group_type: String(params.nodeGroupType),
      default_node_type: String(params.defaultNodeType ?? 0),
      max_rounds: '0',
      win_loss_limit: '0',
      is_tiebreaker: '0',
      is_final_group: '0',
      containing_node_group_id: params.containingNodeGroupId,
      phase: String(params.phase),
      region: '0',
      teams_minor: '0',
      teams_major: '0',
      elimination_dpc_points: '0',
    });

    try {
      await firstValueFrom(
        this.http.post(this.baseUrl('post_addnodegroup'), body.toString(), {
          headers: this.commonHeaders(),
        }),
      );
    } catch (err) {
      this.logger.error('addNodeGroup failed', err);
      throw new InternalServerErrorException('Dota2 addNodeGroup failed');
    }
  }

  async addNodeGroupTeam(
    nodeGroupId: string,
    dotaTeamId: string,
  ): Promise<void> {
    const body = new URLSearchParams({
      sessionid: this.sessionId,
      node_group_id: nodeGroupId,
      team_id: dotaTeamId,
    });

    try {
      await firstValueFrom(
        this.http.post(this.baseUrl('post_addnodegroupteam'), body.toString(), {
          headers: this.commonHeaders(),
        }),
      );
    } catch (err) {
      this.logger.error('addNodeGroupTeam failed', err);
      throw new InternalServerErrorException('Dota2 addNodeGroupTeam failed');
    }
  }

  async removeNodeGroup(nodeGroupId: string): Promise<void> {
    const body = new URLSearchParams({
      sessionid: this.sessionId,
      node_group_id: nodeGroupId,
    });

    try {
      await firstValueFrom(
        this.http.post(this.baseUrl('post_removenodegroup'), body.toString(), {
          headers: this.commonHeaders(),
        }),
      );
    } catch (err) {
      this.logger.error('removeNodeGroup failed', err);
      throw new InternalServerErrorException('Dota2 removeNodeGroup failed');
    }
  }

  // ── HTML parsing ─────────────────────────────────────────────────────────

  async fetchTournamentPage(): Promise<string> {
    try {
      const { data } = await firstValueFrom(
        this.http.get<string>(this.baseUrl('tournament'), {
          headers: {
            accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'accept-language': 'en-US,en;q=0.9',
            cookie: this.cookie,
            referer: `https://www.dota2.com/league/${this.leagueId}/tournament`,
            'user-agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
          responseType: 'text',
        }),
      );
      return data;
    } catch (err) {
      this.logger.error('fetchTournamentPage failed', err);
      throw new InternalServerErrorException(
        'Failed to fetch Dota2 tournament page',
      );
    }
  }

  /**
   * After calling addNodeGroup (nodeGroupType=1, organisational), fetch the
   * tournament page and return the id of the last .TypeOrganizational.NodeGroup
   * element — that is the node group Dota2 just created.
   */
  async resolveOrganizationalNodeGroupId(): Promise<string> {
    const html = await this.fetchTournamentPage();
    const $ = cheerio.load(html);
    const el = $('.TypeOrganizational.NodeGroup').last();
    const rawId = el.attr('id'); // e.g. "NodeGroup96"
    const match = rawId?.match(/^NodeGroup(\d+)$/);
    if (!match) {
      this.logger.error(
        `Could not find .TypeOrganizational.NodeGroup on page (last id="${rawId ?? 'none'}")`,
      );
      throw new InternalServerErrorException(
        'Could not resolve organisational NodeGroup id from Dota2 page',
      );
    }
    const id = match[1];
    this.logger.log(
      `Resolved organisational nodeGroupId=${id} from Dota2 page`,
    );
    return id;
  }

  /**
   * After calling addNodeGroup (nodeGroupType=7, round-robin match) inside a
   * qualification group, fetch the tournament page and return the id of the
   * last .TypeRoundRobin.NodeGroup element that is a descendant of
   * #NodeGroup{containingNodeGroupId}.
   */
  async resolveRoundRobinNodeGroupId(
    containingNodeGroupId: string,
  ): Promise<string> {
    const html = await this.fetchTournamentPage();
    const $ = cheerio.load(html);
    const el = $(
      `#NodeGroup${containingNodeGroupId} .TypeRoundRobin.NodeGroup`,
    ).last();
    const rawId = el.attr('id'); // e.g. "NodeGroup85"
    const match = rawId?.match(/^NodeGroup(\d+)$/);
    if (!match) {
      this.logger.error(
        `Could not find .TypeRoundRobin.NodeGroup inside #NodeGroup${containingNodeGroupId} (last id="${rawId ?? 'none'}")`,
      );
      throw new InternalServerErrorException(
        `Could not resolve round-robin NodeGroup id inside NodeGroup${containingNodeGroupId} from Dota2 page`,
      );
    }
    const id = match[1];
    this.logger.log(
      `Resolved round-robin nodeGroupId=${id} inside NodeGroup${containingNodeGroupId}`,
    );
    return id;
  }

  // ── OpenDota ─────────────────────────────────────────────────────────────

  async getOpenDotaMatch(matchId: string): Promise<OpenDotaMatch> {
    try {
      const { data } = await firstValueFrom(
        this.http.get<OpenDotaMatch>(
          `https://api.opendota.com/api/matches/${matchId}`,
        ),
      );
      return data;
    } catch (err) {
      this.logger.error('OpenDota getMatch failed', err);
      throw new InternalServerErrorException(
        'Не вдалося отримати дані матчу з OpenDota',
      );
    }
  }
}
