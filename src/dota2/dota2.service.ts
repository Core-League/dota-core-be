import { HttpService } from '@nestjs/axios';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as cheerio from 'cheerio';
import { firstValueFrom } from 'rxjs';

export interface StratzMatchPlayer {
  steamAccountId: number;
  kills: number;
  deaths: number;
  assists: number;
  numLastHits: number;
  goldPerMinute: number;
  experiencePerMinute: number;
  heroDamage: number;
  towerDamage: number;
  heroHealing: number;
}

export interface StratzTeam {
  id: number;
  name?: string;
  tag?: string;
}

export interface StratzMatch {
  id: number;
  didRadiantWin: boolean;
  durationSeconds: number;
  startDateTime: number;
  numHumanPlayers: number;
  radiantTeamId?: number;
  direTeamId?: number;
  radiantTeam?: StratzTeam;
  direTeam?: StratzTeam;
  players: StratzMatchPlayer[];
}

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

/**
 * Valve `node_group_type` values — mirrors the "Match Group Type" dropdown on
 * the league tournament page.
 *
 * Only SHOWMATCH reliably binds added teams to the group's node. Creating a
 * two-team fixture as ROUND_ROBIN leaves the node with `team_id_1/2 = 0`, and
 * such a match cannot be picked when creating a lobby.
 */
export const NODE_GROUP_TYPE = {
  ORGANIZATIONAL: 1,
  ROUND_ROBIN: 2,
  SHOWMATCH: 7,
} as const;

/**
 * Valve `default_node_type`: series length of the nodes in a group — mirrors
 * the "Node Type" dropdown on the league tournament page (Best of 1 / 3 / 5).
 * BO1 and BO3 are confirmed against live leagues; BO5 follows the same
 * ordering and should be checked on the admin page the first time it is used.
 */
export const DEFAULT_NODE_TYPE = {
  BO1: 1,
  BO3: 2,
  BO5: 3,
} as const;

/** `default_node_type` for a series length; anything unknown falls back to BO1. */
export function defaultNodeTypeForBestOf(bestOf: number): number {
  switch (bestOf) {
    case 5:
      return DEFAULT_NODE_TYPE.BO5;
    case 3:
      return DEFAULT_NODE_TYPE.BO3;
    default:
      return DEFAULT_NODE_TYPE.BO1;
  }
}

interface DotaNode {
  node_id: number;
  node_group_id: number;
  node_type: number;
  team_id_1: number;
  team_id_2: number;
  has_started: boolean;
  is_completed: boolean;
}

/** The node group blob Valve embeds in each group header's onclick handler. */
interface DotaNodeGroup {
  node_group_id: number;
  parent_node_group_id: number;
  node_group_type: number;
  default_node_type: number;
  name: string;
  team_count: number;
  nodes: DotaNode[];
}

@Injectable()
export class Dota2Service {
  private readonly logger = new Logger(Dota2Service.name);

  constructor(private readonly http: HttpService) {}

  /**
   * True when the DOTA_* session env vars are present for league POST +
   * tournament page scrape. When false, playoff/qual fixtures skip Dota league
   * calls (Challonge still works).
   *
   * The league itself is not part of this check: every tournament-scoped call
   * takes its `leagueId` from `Tournament.dotaLeagueId`. Only the captain
   * league-admin calls fall back to `DOTA_LEAGUE_ID`.
   */
  isLeagueApiConfigured(): boolean {
    const oauthToken = process.env.DOTA_OAUTH_TOKEN ?? '';
    return Boolean(this.sessionId && oauthToken.length > 0);
  }

  /**
   * League whose admin list mirrors verified captains. Not tied to a
   * tournament, so it stays an env setting; tournaments carry their own league.
   */
  private get defaultLeagueId(): string {
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

  private baseUrl(leagueId: number | string, path: string): string {
    return `https://www.dota2.com/league/${leagueId}/${path}`;
  }

  private commonHeaders(leagueId: number | string): Record<string, string> {
    return {
      accept: '*/*',
      'content-type': 'application/x-www-form-urlencoded',
      cookie: this.cookie,
      origin: 'https://www.dota2.com',
      referer: `https://www.dota2.com/league/${leagueId}/tournament`,
      'x-requested-with': 'XMLHttpRequest',
    };
  }

  async addNodeGroup(
    leagueId: number,
    params: {
      nodeGroupId: string;
      nodeGroupType: number;
      teamCount: number;
      containingNodeGroupId: string;
      phase: number;
      defaultNodeType?: number;
      name?: string;
    },
  ): Promise<void> {
    const body = new URLSearchParams({
      sessionid: this.sessionId,
      node_group_id: params.nodeGroupId,
      name: params.name ?? '',
      team_count: String(params.teamCount),
      start_time: '0',
      end_time: '0',
      advancing_team_count: '0',
      secondary_advancing_team_count: '0',
      tertiary_advancing_team_count: '0',
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

    let data: unknown;
    try {
      ({ data } = await firstValueFrom(
        this.http.post<unknown>(
          this.baseUrl(leagueId, 'post_addnodegroup'),
          body.toString(),
          { headers: this.commonHeaders(leagueId) },
        ),
      ));
    } catch (err) {
      this.logger.error(`addNodeGroup failed (league ${leagueId})`, err);
      throw new InternalServerErrorException('Dota2 addNodeGroup failed');
    }
    this.assertValveAccepted('addNodeGroup', leagueId, data);
  }

  /**
   * Valve answers league admin POSTs with HTTP 200 whatever happened; a
   * rejection (no admin rights on the league, unknown league, expired
   * session) only shows as `success: false` in the JSON body. Surface it
   * instead of letting the page scrape fail later with a vaguer message.
   */
  private assertValveAccepted(
    op: string,
    leagueId: number | string,
    data: unknown,
  ): void {
    const body = typeof data === 'string' ? data : JSON.stringify(data);
    this.logger.debug(
      `${op} (league ${leagueId}) response: ${(body ?? '').slice(0, 300)}`,
    );
    const rejected =
      data !== null &&
      typeof data === 'object' &&
      (data as { success?: unknown }).success === false;
    if (rejected) {
      this.logger.error(
        `${op} rejected by Dota2 for league ${leagueId}: ${(body ?? '').slice(0, 300)}`,
      );
      throw new InternalServerErrorException(
        `Dota 2 league ${leagueId} rejected ${op}. Check that the league exists ` +
          'and that the DOTA_SESSION_ID account is one of its admins.',
      );
    }
  }

  /**
   * Creates a top-level organisational node group (a "tournament" container
   * on the league page) and returns its id.
   *
   * The create endpoint does not return the id, so the page is snapshotted
   * before and after and the group that appeared is the one just created.
   * Comparing snapshots, rather than taking the highest id on the page, means
   * a silently ignored create is reported as such instead of handing back an
   * older group — which on a league that already holds tournaments would
   * quietly hijack a stranger's container.
   */
  async createOrganizationalNodeGroup(
    leagueId: number,
    name?: string,
  ): Promise<string> {
    const before = await this.listOrganizationalNodeGroups(leagueId);
    await this.addNodeGroup(leagueId, {
      nodeGroupId: '',
      nodeGroupType: NODE_GROUP_TYPE.ORGANIZATIONAL,
      teamCount: 0,
      containingNodeGroupId: '0',
      phase: 2,
      defaultNodeType: 0,
      name,
    });
    const after = await this.listOrganizationalNodeGroups(leagueId);

    let created = -1;
    for (const id of after.ids) {
      if (!before.ids.has(id)) created = Math.max(created, id);
    }
    if (created < 0) {
      this.logger.error(
        `League ${leagueId}: no organisational node group appeared after post_addnodegroup ` +
          `(page title "${after.title}", ${after.ids.size} organisational group(s) on the page)`,
      );
      throw new InternalServerErrorException(
        `Dota 2 league ${leagueId}: the tournament node group was not created. ` +
          'Check that the league exists and that the DOTA_SESSION_ID account is one of its admins.',
      );
    }

    this.logger.log(
      `League ${leagueId}: created organisational nodeGroupId=${created}`,
    );
    return String(created);
  }

  async addNodeGroupTeam(
    leagueId: number,
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
        this.http.post(
          this.baseUrl(leagueId, 'post_addnodegroupteam'),
          body.toString(),
          { headers: this.commonHeaders(leagueId) },
        ),
      );
    } catch (err) {
      this.logger.error(`addNodeGroupTeam failed (league ${leagueId})`, err);
      throw new InternalServerErrorException('Dota2 addNodeGroupTeam failed');
    }
  }

  async removeNodeGroup(leagueId: number, nodeGroupId: string): Promise<void> {
    const body = new URLSearchParams({
      sessionid: this.sessionId,
      node_group_id: nodeGroupId,
    });

    try {
      await firstValueFrom(
        this.http.post(
          this.baseUrl(leagueId, 'post_removenodegroup'),
          body.toString(),
          { headers: this.commonHeaders(leagueId) },
        ),
      );
    } catch (err) {
      this.logger.error(`removeNodeGroup failed (league ${leagueId})`, err);
      throw new InternalServerErrorException('Dota2 removeNodeGroup failed');
    }
  }

  async addLeagueAdmin(steamId: string): Promise<void> {
    const leagueId = this.defaultLeagueId;
    if (!leagueId) {
      this.logger.warn('addLeagueAdmin skipped: DOTA_LEAGUE_ID is not set');
      return;
    }
    const body = new URLSearchParams({
      sessionid: this.sessionId,
      profile_url: `https://steamcommunity.com/profiles/${steamId}/`,
    });
    try {
      await firstValueFrom(
        this.http.post(
          this.baseUrl(leagueId, 'post_addadmin'),
          body.toString(),
          {
            headers: this.commonHeaders(leagueId),
          },
        ),
      );
      this.logger.log(`addLeagueAdmin: ${steamId}`);
    } catch (err) {
      this.logger.error('addLeagueAdmin failed', err);
    }
  }

  async revokeLeagueAdmin(steamId: string): Promise<void> {
    const leagueId = this.defaultLeagueId;
    if (!leagueId) {
      this.logger.warn('revokeLeagueAdmin skipped: DOTA_LEAGUE_ID is not set');
      return;
    }
    const accountId = String(BigInt(steamId) - 76561197960265728n);
    const body = new URLSearchParams({
      sessionid: this.sessionId,
      account_id: accountId,
    });
    try {
      await firstValueFrom(
        this.http.post(
          this.baseUrl(leagueId, 'post_revokeadmin'),
          body.toString(),
          { headers: this.commonHeaders(leagueId) },
        ),
      );
      this.logger.log(`revokeLeagueAdmin: ${steamId}`);
    } catch (err) {
      this.logger.error('revokeLeagueAdmin failed', err);
    }
  }

  // ── HTML parsing ─────────────────────────────────────────────────────────

  async fetchTournamentPage(leagueId: number): Promise<string> {
    try {
      const { data } = await firstValueFrom(
        this.http.get<string>(this.baseUrl(leagueId, 'tournament'), {
          headers: {
            accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'accept-language': 'en-US,en;q=0.9',
            cookie: this.cookie,
            referer: `https://www.dota2.com/league/${leagueId}/tournament`,
            'user-agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
          responseType: 'text',
        }),
      );
      return data;
    } catch (err) {
      this.logger.error(`fetchTournamentPage failed (league ${leagueId})`, err);
      throw new InternalServerErrorException(
        'Failed to fetch Dota2 tournament page',
      );
    }
  }

  /**
   * Every non-organisational node group on the page carries its full state as
   * JSON inside its header's edit/delete `onclick`. Reading that is exact,
   * unlike matching on the `.Type*` CSS classes: a group created with
   * `node_group_type=7` renders as `.TypeShowmatch` and never matches
   * `.TypeRoundRobin`, so class-based lookups miss silently.
   *
   * Organisational groups have no edit/delete controls and so are absent here —
   * use {@link listOrganizationalNodeGroups} for those.
   */
  private parseNodeGroups(html: string): Map<number, DotaNodeGroup> {
    const $ = cheerio.load(html);
    const groups = new Map<number, DotaNodeGroup>();

    $('.NodeGroup').each((_, el) => {
      const header = $(el).children('.NodeGroupHeader');
      const onclick =
        header.children('.NodeGroupHeaderEdit').attr('onclick') ??
        header.children('.NodeGroupHeaderDelete').attr('onclick');
      if (!onclick) return;

      const start = onclick.indexOf('{');
      const end = onclick.lastIndexOf('}');
      if (start < 0 || end <= start) return;

      try {
        const group = JSON.parse(
          onclick.slice(start, end + 1),
        ) as DotaNodeGroup;
        if (typeof group.node_group_id === 'number') {
          groups.set(group.node_group_id, group);
        }
      } catch {
        // one malformed blob must not blind us to the rest of the page
      }
    });

    return groups;
  }

  /**
   * Ids of every organisational (`.TypeOrganizational`) node group on the
   * league tournament page, plus the page title — the title is the quickest
   * hint whether the session landed on the admin page or on a login / "no
   * access" page when the list comes back empty.
   */
  private async listOrganizationalNodeGroups(
    leagueId: number,
  ): Promise<{ ids: Set<number>; title: string }> {
    const html = await this.fetchTournamentPage(leagueId);
    const $ = cheerio.load(html);

    const ids = new Set<number>();
    $('.TypeOrganizational.NodeGroup').each((_, el) => {
      const match = $(el)
        .attr('id')
        ?.match(/^NodeGroup(\d+)$/);
      if (match) ids.add(parseInt(match[1], 10));
    });

    return { ids, title: $('title').text().trim() };
  }

  /**
   * After calling addNodeGroup with a `containing_node_group_id`, return the
   * newest child of that parent — the group just created.
   *
   * Scoped to the given parent on purpose: picking the globally highest id on
   * the page can hand back a group belonging to a different tournament in the
   * same league.
   */
  async resolveNewestChildNodeGroupId(
    leagueId: number,
    containingNodeGroupId: string,
  ): Promise<string> {
    const groups = this.parseNodeGroups(
      await this.fetchTournamentPage(leagueId),
    );
    const parentId = parseInt(containingNodeGroupId, 10);

    let newest = -1;
    for (const group of groups.values()) {
      if (group.parent_node_group_id === parentId) {
        newest = Math.max(newest, group.node_group_id);
      }
    }

    if (newest < 0) {
      this.logger.error(
        `No child node group found under NodeGroup${containingNodeGroupId} ` +
          `(parsed ${groups.size} node groups from the page)`,
      );
      throw new InternalServerErrorException(
        `Could not resolve child NodeGroup id inside NodeGroup${containingNodeGroupId} from Dota2 page`,
      );
    }

    this.logger.log(
      `Resolved child nodeGroupId=${newest} inside NodeGroup${containingNodeGroupId}`,
    );
    return String(newest);
  }

  /**
   * Post-condition check for two-team fixtures. Adding teams to a group does
   * not always bind them to that group's node — when it doesn't, the node keeps
   * `team_id_1/2 = 0` and the match cannot be selected while creating a lobby,
   * with nothing in the create/add responses to signal it.
   *
   * @returns the subset of ids whose node has no teams bound (missing groups
   *          count as unplayable).
   */
  async findUnplayableFixtureNodeGroups(
    leagueId: number,
    nodeGroupIds: string[],
  ): Promise<string[]> {
    if (nodeGroupIds.length === 0) return [];

    const groups = this.parseNodeGroups(
      await this.fetchTournamentPage(leagueId),
    );
    return nodeGroupIds.filter((id) => {
      const group = groups.get(parseInt(id, 10));
      if (!group) return true;
      return !(group.nodes ?? []).some(
        (node) => node.team_id_1 > 0 && node.team_id_2 > 0,
      );
    });
  }

  /**
   * Pair node under organisational parent.
   * Every series length uses `node_group_type=7` (Showmatch); only
   * `default_node_type` differs:
   *   BO1 → default_node_type=1
   *   BO3 → default_node_type=2
   *   BO5 → default_node_type=3
   *
   * Showmatch is the only type that binds the added teams to the group's node,
   * which is what makes the match selectable when creating a lobby.
   *
   * @param leagueId — The Dota 2 league the fixture is created in (`Tournament.dotaLeagueId`).
   * @param name — Optional display label shown on the Dota 2 admin page ("Team A vs Team B").
   * @param bestOf — Series length of the slot (1, 3 or 5); defaults to a BO1.
   */
  async createTwoTeamFixtureNode(
    leagueId: number,
    containingOrganizationalGroupId: string,
    dotaTeamIdA: string,
    dotaTeamIdB: string,
    name?: string,
    bestOf: number = 1,
  ): Promise<string> {
    await this.addNodeGroup(leagueId, {
      nodeGroupId: '',
      nodeGroupType: NODE_GROUP_TYPE.SHOWMATCH,
      teamCount: 2,
      containingNodeGroupId: containingOrganizationalGroupId,
      phase: 0,
      defaultNodeType: defaultNodeTypeForBestOf(bestOf),
      name,
    });
    let matchNodeGroupId: string | undefined;
    try {
      matchNodeGroupId = await this.resolveNewestChildNodeGroupId(
        leagueId,
        containingOrganizationalGroupId,
      );

      await this.addNodeGroupTeam(leagueId, matchNodeGroupId, dotaTeamIdA);
      await this.addNodeGroupTeam(leagueId, matchNodeGroupId, dotaTeamIdB);
      return matchNodeGroupId;
    } catch (err) {
      if (matchNodeGroupId) {
        try {
          await this.removeNodeGroup(leagueId, matchNodeGroupId);
        } catch (removeErr) {
          this.logger.warn(
            `removeNodeGroup failed for orphan fixture node ${matchNodeGroupId}`,
            removeErr,
          );
        }
      }
      throw err;
    }
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
      const status = (err as { response?: { status?: number } }).response
        ?.status;
      if (status === 404) {
        void this.requestOpenDotaParse(matchId);
        const stratz = await this.getStratzMatch(matchId);
        if (stratz) return this.stratzToOpenDota(stratz);
        throw new ServiceUnavailableException(
          'Дані про матч оновлюються. Спробуйте за кілька хвилин',
        );
      }
      this.logger.error('OpenDota getMatch failed', err);
      throw new InternalServerErrorException(
        'Не вдалося отримати дані матчу з OpenDota',
      );
    }
  }

  async getStratzMatch(matchId: string): Promise<StratzMatch | null> {
    const apiKey = process.env.STARTZ_API_KEY ?? '';
    const query = `{
      match(id: ${matchId}) {
        id
        didRadiantWin
        durationSeconds
        startDateTime
        numHumanPlayers
        radiantTeamId
        direTeamId
        radiantTeam { id name tag }
        direTeam { id name tag }
        players {
          steamAccountId
          kills
          deaths
          assists
          numLastHits
          goldPerMinute
          experiencePerMinute
          heroDamage
          towerDamage
          heroHealing
        }
      }
    }`;

    try {
      const { data } = await firstValueFrom(
        this.http.post<{ data?: { match?: StratzMatch } }>(
          'https://api.stratz.com/graphql',
          { query },
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
              'User-Agent': 'STRATZ_API',
            },
          },
        ),
      );
      const match = data?.data?.match ?? null;
      if (!match) {
        this.logger.warn(`Stratz returned no data for match ${matchId}`);
        return null;
      }
      this.logger.log(`Stratz match ${matchId} fetched successfully`);
      return match;
    } catch (err) {
      this.logger.warn(`Stratz getMatch failed for match ${matchId}`, err);
      return null;
    }
  }

  private stratzToOpenDota(s: StratzMatch): OpenDotaMatch {
    return {
      match_id: s.id,
      duration: s.durationSeconds,
      start_time: s.startDateTime,
      radiant_win: s.didRadiantWin,
      human_players: s.numHumanPlayers,
      game_mode: 0,
      lobby_type: 0,
      cluster: 0,
      patch: 0,
      region: 0,
      radiant_score: 0,
      dire_score: 0,
      radiant_team_id: s.radiantTeamId,
      dire_team_id: s.direTeamId,
      radiant_team: s.radiantTeam
        ? {
            team_id: s.radiantTeam.id,
            name: s.radiantTeam.name,
            tag: s.radiantTeam.tag,
          }
        : undefined,
      dire_team: s.direTeam
        ? { team_id: s.direTeam.id, name: s.direTeam.name, tag: s.direTeam.tag }
        : undefined,
      players: (s.players ?? []).map((p) => ({
        match_id: s.id,
        player_slot: 0,
        account_id: p.steamAccountId,
        hero_id: 0,
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        gold_per_min: p.goldPerMinute,
        xp_per_min: p.experiencePerMinute,
        last_hits: p.numLastHits,
        denies: 0,
        hero_damage: p.heroDamage,
        tower_damage: p.towerDamage,
        hero_healing: p.heroHealing,
        level: 0,
        isRadiant: false,
        win: 0,
        lose: 0,
        personaname: null,
        radiant_win: s.didRadiantWin,
        duration: s.durationSeconds,
        start_time: s.startDateTime,
        game_mode: 0,
        lobby_type: 0,
        lane: null,
        lane_role: null,
        rank_tier: null,
      })),
    };
  }

  private async requestOpenDotaParse(matchId: string): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(`https://api.opendota.com/api/request/${matchId}`, null),
      );
      this.logger.log(`OpenDota parse requested for match ${matchId}`);
    } catch (err) {
      this.logger.warn(
        `OpenDota parse request failed for match ${matchId}`,
        err,
      );
    }
  }
}
