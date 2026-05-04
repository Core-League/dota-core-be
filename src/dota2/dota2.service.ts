import { HttpService } from '@nestjs/axios';
import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';

export interface OpenDotaPlayer {
  player_slot: number;
  account_id: number;
  isRadiant: boolean;
}

export interface OpenDotaTeam {
  team_id: number;
  name?: string;
}

export interface OpenDotaMatch {
  match_id: number;
  human_players: number;
  duration: number;
  start_time: number;
  radiant_win: boolean;
  radiant_team: OpenDotaTeam;
  dire_team: OpenDotaTeam;
  players: OpenDotaPlayer[];
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

  async addNodeGroupTeam(nodeGroupId: string, dotaTeamId: string): Promise<void> {
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
      throw new InternalServerErrorException('Не вдалося отримати дані матчу з OpenDota');
    }
  }
}
