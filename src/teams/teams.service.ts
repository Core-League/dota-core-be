import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { Team } from './team.entity';
import { TeamInviteRepository } from './team-invite.repository';
import { TeamsRepository } from './teams.repository';
import { CreateTeamDto } from './dto/create-team.dto';
import { PlayerTournamentPoints } from '../tournaments/player-tournament-points.entity';
import { Player } from '../players/player.entity';
import { UserRoles } from '../user-roles/user-roles.entity';
import { Role, getRoleColorByName } from '../user-roles/role.constants';
import { toPlayerRankDto } from '../players/dto/player-rank.dto';
import { resolveTeamDivision } from '../tournaments/tournament-division.util';
import { computeTeamAvgRating } from './team-rating.util';
import { DiscordBotService } from '../discord/discord-bot.service';
import { AuthService } from '../auth/auth.service';
import { Dota2Service } from '../dota2/dota2.service';
import {
  TeamResponseDto,
  TeamTournamentEmbeddedDto,
} from './dto/team-response.dto';
import { PlayerResponseDto } from '../players/dto/player-response.dto';
import { Tournament } from '../tournaments/tournaments.entity';
import { RemovePlayerPenalty } from './dto/remove-player-query.dto';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const roundOrNull = (value: number | null): number | null =>
  value === null ? null : Math.round(value);

@Injectable()
export class TeamsService {
  private readonly logger = new Logger(TeamsService.name);

  constructor(
    private readonly teamsRepo: TeamsRepository,
    private readonly inviteRepo: TeamInviteRepository,
    private readonly discord: DiscordBotService,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly authService: AuthService,
    private readonly dota2: Dota2Service,
  ) {}

  /** Для інших модулів (напр. турніри) — той самий DTO, що й у REST. */
  toTeamResponse(team: Team): TeamResponseDto {
    return this.mapTeamResponse(team);
  }

  async createTeam(
    dto: CreateTeamDto,
    captainId: string,
  ): Promise<TeamResponseDto> {
    const existingTeams = await this.teamsRepo.findByCaptainId(captainId);
    if (existingTeams.length > 0) {
      throw new ConflictException('Ви вже є капітаном іншої команди');
    }

    const { coachId, ...teamFields } = dto;
    const entity = this.teamsRepo.create({
      ...teamFields,
      captain: { id: captainId } as Player,
      mainPlayers: [{ id: captainId } as Player],
      ...(coachId ? { coach: { id: coachId } as Player } : {}),
    });
    // Use save() (not the query-builder insert) so the captain is written into
    // the team_main_players junction table — QueryBuilder .insert() persists the
    // team's own columns only and silently drops ManyToMany relations, which left
    // every captain missing from their own roster.
    const saved = await this.teamsRepo.save(entity);
    const createdTeamId = saved.id;
    await this.syncPlayerTeamLinks(createdTeamId);

    await this.grantCaptainRole(captainId);

    await this.syncDiscordGuildRolesForPlayer(captainId);

    const full = await this.teamsRepo.findOneById(createdTeamId);
    if (!full) {
      throw new InternalServerErrorException('Не вдалося завантажити команду');
    }
    return this.mapTeamResponse(full);
  }

  async findAll(): Promise<TeamResponseDto[]> {
    const teams = await this.teamsRepo.findAll();
    return teams.map((t) => this.mapTeamResponse(t));
  }

  async search() {
    const teams = await this.teamsRepo.findAll();
    const mapped = teams.map((t) => this.mapTeamResponse(t));
    return mapped;
  }

  async findOne(id: string): Promise<TeamResponseDto> {
    const team = await this.teamsRepo.findOneById(id);
    if (!team) {
      throw new NotFoundException('Команду не знайдено');
    }
    return this.mapTeamResponse(team);
  }

  async update(id: string, payload: Partial<Team>): Promise<TeamResponseDto> {
    const team = await this.teamsRepo.findOneById(id);
    if (!team) throw new NotFoundException('Команду не знайдено');

    const wasVerified = team.isVerified;
    Object.assign(team, payload);
    const saved = await this.teamsRepo.save(team);
    await this.syncPlayerTeamLinks(id);

    if (!wasVerified && saved.isVerified) {
      void this.onTeamVerified(saved);
    } else if (wasVerified && !saved.isVerified && saved.captain?.steamId) {
      // Inverse of onTeamVerified for a plain PATCH that flips verified→unverified
      // (parity with AdminService.unverifyTeam): revoke the captain's league admin.
      void this.dota2.revokeLeagueAdmin(saved.captain.steamId);
    }

    const reloaded = await this.teamsRepo.findOneById(id);
    if (!reloaded) throw new NotFoundException('Команду не знайдено');
    return this.mapTeamResponse(reloaded);
  }

  private async onTeamVerified(team: Team): Promise<void> {
    const roleId = await this.discord.createTeamRole(team.name);
    if (!roleId) return;

    const channelId = await this.discord.createTeamVoiceChannel(
      team.name,
      roleId,
    );

    await this.teamsRepo.save(
      Object.assign(team, {
        discordRoleId: roleId,
        discordChannelId: channelId,
      }),
    );

    const allMembers = [
      team.captain,
      team.coach,
      ...(team.mainPlayers ?? []),
      ...(team.reservedPlayers ?? []),
    ].filter(Boolean) as { discordId: string | null }[];
    await this.discord.addPlayersToRole(allMembers, roleId);

    if (team.captain?.discordId) {
      await this.discord.addCaptainRole(team.captain.discordId);
    }

    if (team.captain?.steamId && team.captain?.verifiedAt) {
      void this.dota2.addLeagueAdmin(team.captain.steamId);
    }

    this.logger.log(
      `Discord setup complete for team ${team.id}: role=${roleId} channel=${channelId ?? 'null'}`,
    );
  }

  async remove(id: string): Promise<void> {
    const team = await this.teamsRepo.findOneById(id);
    if (!team) throw new NotFoundException('Команду не знайдено');
    if (team.disbandedAt) throw new NotFoundException('Команду вже розпущено');
    const captainId = team.captain?.id;
    const captainDiscordId = team.captain?.discordId ?? null;
    const captainSteamId = team.captain?.steamId ?? null;
    const wasVerified = team.isVerified;
    const { discordRoleId, discordChannelId } = team;

    await this.dataSource.transaction(async (manager) => {
      await manager.query(`DELETE FROM "tournament_team" WHERE "teamId" = $1`, [
        id,
      ]);
      await manager.query(
        `DELETE FROM "tournament_playoff_team" WHERE "teamId" = $1`,
        [id],
      );
      team.disbandedAt = new Date();
      await manager.save(team);
      await this.resetPlayersTeamIdColumn(id, manager);
    });

    if (captainId) {
      await this.revokeCaptainRoleIfNoLongerCaptain(captainId);
      await this.syncDiscordGuildRolesForPlayer(captainId);
    }

    if (discordChannelId) {
      await this.discord.deleteChannel(discordChannelId);
    }
    if (discordRoleId) {
      await this.discord.deleteRole(discordRoleId);
    }
    if (captainDiscordId) {
      await this.discord.removeCaptainRole(captainDiscordId);
    }

    // A verified team's captain holds Dota2 league admin — revoke it on disband.
    // Fire-and-forget: a Dota2 failure must not block the disband.
    if (wasVerified && captainSteamId) {
      void this.dota2.revokeLeagueAdmin(captainSteamId);
    }
  }

  async changeCaptain(
    teamId: string,
    newCaptainPlayerId: string,
    actorPlayerId: string,
  ): Promise<TeamResponseDto> {
    const team = await this.teamsRepo.findOneWithRoster(teamId);
    if (!team) throw new NotFoundException('Команду не знайдено');

    const actorPlayer = await this.dataSource.getRepository(Player).findOne({
      where: { id: actorPlayerId },
      relations: ['roles'],
    });
    const isAdmin = (actorPlayer?.roles ?? []).some((r) => r.isAdminRole);

    if (!isAdmin && team.captain?.id !== actorPlayerId) {
      throw new ForbiddenException(
        'Тільки капітан або адмін може передати капітанство',
      );
    }

    if (newCaptainPlayerId === team.captain?.id) {
      throw new BadRequestException('Цей гравець вже є капітаном');
    }

    const mainPlayers = team.mainPlayers ?? [];
    const reservedPlayers = team.reservedPlayers ?? [];

    const newCaptainInMain = mainPlayers.find(
      (p) => p.id === newCaptainPlayerId,
    );
    const newCaptainInReserved = reservedPlayers.find(
      (p) => p.id === newCaptainPlayerId,
    );
    const newCaptain = newCaptainInMain ?? newCaptainInReserved;

    if (!newCaptain) {
      throw new BadRequestException(
        'Новий капітан повинен бути гравцем команди',
      );
    }

    const oldCaptain = team.captain;
    const oldCaptainDiscordId = oldCaptain?.discordId ?? null;

    if (newCaptainInReserved) {
      // Move new captain from reserved to main, old captain from main to reserved
      team.mainPlayers = [
        ...mainPlayers.filter((p) => p.id !== oldCaptain?.id),
        newCaptain,
      ];
      team.reservedPlayers = oldCaptain
        ? [
            ...reservedPlayers.filter((p) => p.id !== newCaptainPlayerId),
            oldCaptain,
          ]
        : reservedPlayers.filter((p) => p.id !== newCaptainPlayerId);
    }

    team.captain = newCaptain;
    const saved = await this.teamsRepo.save(team);
    await this.syncPlayerTeamLinks(teamId);

    await this.grantCaptainRole(newCaptain.id);
    if (oldCaptain?.id) {
      await this.revokeCaptainRoleIfNoLongerCaptain(oldCaptain.id);
    }

    if (oldCaptainDiscordId) {
      await this.discord.removeCaptainRole(oldCaptainDiscordId);
    }
    if (newCaptain.discordId) {
      await this.discord.addCaptainRole(newCaptain.discordId);
    }

    if (team.isVerified) {
      if (oldCaptain?.steamId) {
        void this.dota2.revokeLeagueAdmin(oldCaptain.steamId);
      }
      if (newCaptain.steamId && newCaptain.verifiedAt) {
        void this.dota2.addLeagueAdmin(newCaptain.steamId);
      }
    }

    const reloaded = await this.teamsRepo.findOneById(saved.id);
    if (!reloaded) throw new NotFoundException('Команду не знайдено');
    return this.mapTeamResponse(reloaded);
  }

  async addPlayerToTeam(
    teamId: string,
    playerId: string,
    slot: 'main' | 'reserved',
  ): Promise<TeamResponseDto> {
    const team = await this.teamsRepo.findOneWithRoster(teamId);
    if (!team) throw new NotFoundException('Команду не знайдено');

    const player = await this.dataSource.getRepository(Player).findOne({
      where: { id: playerId },
    });
    if (!player) throw new NotFoundException('Гравця не знайдено');

    if (player.teamId !== null) {
      throw new ConflictException('Гравець вже є учасником іншої команди');
    }

    const main = team.mainPlayers ?? [];
    const reserved = team.reservedPlayers ?? [];
    const alreadyOnTeam = [...main, ...reserved].some((p) => p.id === playerId);
    if (alreadyOnTeam) {
      throw new ConflictException('Гравець вже є в складі цієї команди');
    }

    if (slot === 'main') {
      if (main.length >= 5) {
        throw new BadRequestException(
          'Основний склад вже заповнений (максимум 5 гравців)',
        );
      }
      team.mainPlayers = [...main, player];
    } else {
      if (reserved.length >= 3) {
        throw new BadRequestException(
          'Список запасних вже заповнений (максимум 3 гравців)',
        );
      }
      team.reservedPlayers = [...reserved, player];
    }

    await this.teamsRepo.save(team);
    await this.syncPlayerTeamLinks(teamId);

    if (team.discordRoleId && player.discordId) {
      await this.discord.addMemberRole(player.discordId, team.discordRoleId);
    }

    const reloaded = await this.teamsRepo.findOneById(teamId);
    if (!reloaded) throw new NotFoundException('Команду не знайдено');
    return this.mapTeamResponse(reloaded);
  }

  async removePlayerFromTeam(
    teamId: string,
    playerId: string,
    penalty: RemovePlayerPenalty = RemovePlayerPenalty.SUBTRACT,
    actorPlayerId: string,
  ): Promise<TeamResponseDto> {
    const actor = await this.dataSource.getRepository(Player).findOne({
      where: { id: actorPlayerId },
      relations: ['roles'],
    });
    const isAdmin = (actor?.roles ?? []).some((r) => r.isAdminRole);

    const team = await this.teamsRepo.findOneWithRoster(teamId);
    if (!team) {
      throw new NotFoundException('Team not found');
    }

    const isSelf = actorPlayerId === playerId;
    const isCaptain = team.captain?.id === actorPlayerId;
    if (!isAdmin && !isCaptain && !isSelf) {
      throw new ForbiddenException(
        'Тільки капітан або адміністратор може видаляти гравців з команди',
      );
    }

    if (penalty === RemovePlayerPenalty.NONE && !isAdmin) {
      throw new ForbiddenException(
        'Тільки адміністратор може видаляти гравця без втрати поінтів',
      );
    }

    if (penalty === RemovePlayerPenalty.SUBTRACT) {
      const pointsRepo = this.dataSource.getRepository(PlayerTournamentPoints);
      for (const t of team.tournaments ?? []) {
        const record = await pointsRepo.findOne({
          where: { playerId, tournamentId: t.id },
        });
        if (record && record.points > 0) {
          record.points = Math.floor(record.points * 0.3);
          await pointsRepo.save(record);
        }
      }
    }

    const roster = [
      team.captain,
      team.coach,
      ...(team.mainPlayers ?? []),
      ...(team.reservedPlayers ?? []),
    ].filter(Boolean) as Player[];
    const removedDiscordId =
      roster.find((p) => p.id === playerId)?.discordId ?? null;

    // Snapshot the verified-team integrations before mutating the roster, so we
    // can tear them down if removal drops the team below 5 main players.
    const wasVerified = team.isVerified;
    const verifiedRoleId = team.discordRoleId;
    const verifiedChannelId = team.discordChannelId;
    const verifiedCaptainSteamId = team.captain?.steamId ?? null;

    const wasCaptain = team.captain?.id === playerId;
    const oldCaptainSteamId = wasCaptain
      ? (team.captain?.steamId ?? null)
      : null;
    team.mainPlayers = (team.mainPlayers || []).filter(
      (p) => p.id !== playerId,
    );
    team.reservedPlayers = (team.reservedPlayers || []).filter(
      (p) => p.id !== playerId,
    );
    if (team.coach?.id === playerId) {
      team.coach = null;
    }

    if (wasCaptain) {
      const nextCaptain = team.mainPlayers[0];
      if (!nextCaptain) {
        // The last captain is leaving and there is no main player to promote.
        // Disband the team: this detaches all players (player.teamId = null)
        // and revokes the captain's Капітан role.
        await this.remove(teamId);
        const disbanded = await this.teamsRepo.findOneById(teamId);
        if (!disbanded) throw new NotFoundException('Team not found');
        return this.mapTeamResponse(disbanded);
      }
      team.captain = nextCaptain;
    }

    // A verified team must keep at least 5 main players. If removal drops it
    // below that, strip verification and tear down its verified integrations.
    const shouldUnverify = wasVerified && team.mainPlayers.length < 5;
    if (shouldUnverify) {
      team.isVerified = false;
      team.verifiedAt = null;
      team.discordRoleId = null;
      team.discordChannelId = null;
    }

    const saved = await this.teamsRepo.save(team);
    await this.syncPlayerTeamLinks(teamId);

    if (team.discordRoleId && removedDiscordId) {
      await this.discord.removeMemberRole(removedDiscordId, team.discordRoleId);
    }
    if (wasCaptain) {
      if (saved.captain?.id) {
        await this.grantCaptainRole(saved.captain.id);
      }
      await this.revokeCaptainRoleIfNoLongerCaptain(playerId);
      if (removedDiscordId) {
        await this.discord.removeCaptainRole(removedDiscordId);
      }
      if (saved.captain?.discordId) {
        await this.discord.addCaptainRole(saved.captain.discordId);
      }
      if (team.isVerified) {
        if (oldCaptainSteamId) {
          void this.dota2.revokeLeagueAdmin(oldCaptainSteamId);
        }
        if (saved.captain?.steamId && saved.captain?.verifiedAt) {
          void this.dota2.addLeagueAdmin(saved.captain.steamId);
        }
      }
    }

    // Full teardown of the verified-team integrations (inverse of onTeamVerified).
    if (shouldUnverify) {
      if (verifiedChannelId) {
        await this.discord.deleteChannel(verifiedChannelId);
      }
      if (verifiedRoleId) {
        await this.discord.deleteRole(verifiedRoleId);
      }
      if (verifiedCaptainSteamId) {
        void this.dota2.revokeLeagueAdmin(verifiedCaptainSteamId);
      }
      this.logger.log(
        `Team ${teamId} dropped below 5 main players — verification stripped`,
      );
    }

    const reloaded = await this.teamsRepo.findOneById(teamId);
    if (!reloaded) throw new NotFoundException('Team not found');
    return this.mapTeamResponse(reloaded);
  }

  private async resetPlayersTeamIdColumn(
    teamId: string,
    manager: EntityManager,
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .update(Player)
      .set({ teamId: null })
      .where('"teamId" = :tid', { tid: teamId })
      .execute();
  }

  private async syncDiscordGuildRolesForPlayer(
    playerId: string,
  ): Promise<void> {
    const player = await this.dataSource.getRepository(Player).findOne({
      where: { id: playerId },
      relations: ['roles'],
    });
    if (player) {
      await this.authService.syncPlayerGuildRoles(player);
    }
  }

  /**
   * Grants the application-level Captain (Капітан) user-role to a player.
   * Idempotent — does nothing if the player already holds it.
   */
  private async grantCaptainRole(playerId: string): Promise<void> {
    const rolesRepo = this.dataSource.getRepository(UserRoles);
    const existing = await rolesRepo.findOne({
      where: { player: { id: playerId }, name: Role.CAPTAIN },
    });
    if (!existing) {
      await rolesRepo.save(
        rolesRepo.create({
          name: Role.CAPTAIN,
          isAdminRole: false,
          player: { id: playerId } as Player,
        }),
      );
    }
  }

  /**
   * Revokes the Captain (Капітан) user-role from a player, but only when they
   * are no longer captain of any active (non-disbanded) team. Guards against
   * stripping the role from someone who still captains another team.
   */
  private async revokeCaptainRoleIfNoLongerCaptain(
    playerId: string,
  ): Promise<void> {
    const stillCaptain = await this.teamsRepo.findByCaptainId(playerId);
    if (stillCaptain.length > 0) return;

    const rolesRepo = this.dataSource.getRepository(UserRoles);
    const captainRole = await rolesRepo.findOne({
      where: { player: { id: playerId }, name: Role.CAPTAIN },
    });
    if (captainRole) {
      await rolesRepo.remove(captainRole);
    }
  }

  private async syncPlayerTeamLinks(teamId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.resetPlayersTeamIdColumn(teamId, manager);

      const team = await manager.findOne(Team, {
        where: { id: teamId },
        relations: ['captain', 'coach', 'mainPlayers', 'reservedPlayers'],
      });
      if (!team) return;

      const ids = new Set<string>();
      if (team.captain?.id) ids.add(team.captain.id);
      if (team.coach?.id) ids.add(team.coach.id);
      for (const p of team.mainPlayers ?? []) ids.add(p.id);
      for (const p of team.reservedPlayers ?? []) ids.add(p.id);

      if (ids.size === 0) return;

      await manager
        .createQueryBuilder()
        .update(Player)
        .set({ teamId })
        .where('id IN (:...ids)', { ids: [...ids] })
        .execute();
    });
  }

  /**
   * Before a player is hard-deleted, hand off any active team they captain
   * through the same promote-or-disband path used when a captain leaves
   * (`removePlayerFromTeam`): the next main player is promoted — revoking the
   * old captain's Dota2 league admin and adding the new captain's when the team
   * is verified — or the team is disbanded if no one can be promoted. Keeps the
   * single source of truth for captain hand-off in `removePlayerFromTeam`.
   */
  async reassignCaptaincyBeforeDeletion(playerId: string): Promise<void> {
    const teams = await this.teamsRepo.findByCaptainId(playerId);
    for (const team of teams) {
      await this.removePlayerFromTeam(
        team.id,
        playerId,
        RemovePlayerPenalty.SUBTRACT,
        playerId,
      );
    }
  }

  async createInvite(
    teamId: string,
    captainPlayerId: string,
    slot: 'main' | 'reserved' | 'coach',
  ): Promise<{ token: string; expiresAt: Date }> {
    const team = await this.teamsRepo.findOneWithRoster(teamId);
    if (!team) throw new NotFoundException('Команду не знайдено');
    if (team.captain?.id !== captainPlayerId) {
      throw new ForbiddenException('Тільки капітан може створювати запрошення');
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const invite = this.inviteRepo.create({
      token,
      teamId,
      createdById: captainPlayerId,
      slot,
      expiresAt,
    });
    await this.inviteRepo.save(invite);
    return { token, expiresAt };
  }

  async getInviteInfo(token: string): Promise<{
    teamId: string;
    teamName: string;
    logoUrl: string | null;
    slot: 'main' | 'reserved' | 'coach';
    expiresAt: Date;
  }> {
    const invite = await this.inviteRepo.findByToken(token);
    if (!invite) throw new NotFoundException('Запрошення не знайдено');
    if (invite.expiresAt < new Date()) {
      throw new GoneException('Запрошення вже недійсне');
    }
    return {
      teamId: invite.teamId,
      teamName: invite.team.name,
      logoUrl: invite.team.logoUrl,
      slot: invite.slot,
      expiresAt: invite.expiresAt,
    };
  }

  async acceptInvite(token: string, playerId: string): Promise<void> {
    const invite = await this.inviteRepo.findByToken(token);
    if (!invite) throw new NotFoundException('Запрошення не знайдено');
    if (invite.expiresAt < new Date()) {
      throw new GoneException('Запрошення вже недійсне');
    }

    if (invite.slot === 'coach') {
      const team = await this.teamsRepo.findOneWithRoster(invite.teamId);
      if (!team) throw new NotFoundException('Команду не знайдено');

      const player = await this.dataSource.getRepository(Player).findOne({
        where: { id: playerId },
      });
      if (!player) throw new NotFoundException('Гравця не знайдено');

      if (team.coach !== null) {
        throw new ConflictException('У команді вже є тренер');
      }
      if (player.teamId !== null) {
        throw new ConflictException('Гравець вже є учасником іншої команди');
      }

      team.coach = player;
      await this.teamsRepo.save(team);
      await this.syncPlayerTeamLinks(invite.teamId);

      const teamRoleId: string | null = team.discordRoleId;
      if (teamRoleId && player.discordId) {
        await this.discord.addMemberRole(player.discordId, teamRoleId);
      }
    } else {
      await this.addPlayerToTeam(invite.teamId, playerId, invite.slot);
    }

    await this.inviteRepo.remove(invite);
  }

  private mapPlayerForTeamResponse(player: Player): PlayerResponseDto {
    const rating = player.rating ?? 0;
    return {
      id: player.id,
      steamId: player.steamId ?? null,
      discordId: player.discordId ?? null,
      telegramId: player.telegramId ?? null,
      avatarUrl: player.avatarUrl ?? null,
      discordName: player.discordName ?? null,
      discordUsername: player.discordUsername ?? null,
      rating,
      rank: toPlayerRankDto(rating),
      positions: player.positions ?? null,
      verifiedAt: player.verifiedAt ?? null,
      teamId: player.teamId ?? null,
      roles: (player.roles ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        isAdminRole: r.isAdminRole,
        color: getRoleColorByName(r.name) ?? '#64748B',
      })),
    };
  }

  private mapTournamentEmbedded(t: Tournament): TeamTournamentEmbeddedDto {
    return {
      id: t.id,
      name: t.name,
      prizePool: t.prizePool ?? 0,
      headerBannerUrl: t.headerBannerUrl ?? null,
      listBannerUrl: t.listBannerUrl ?? null,
      tournamentSlots: t.tournamentSlots ?? null,
      registrationStartsAt: t.registrationStartsAt,
      registrationEndsAt: t.registrationEndsAt,
      qualificationStartsAt: t.qualificationStartsAt,
      qualificationEndsAt: t.qualificationEndsAt,
      tournamentStartsAt: t.tournamentStartsAt,
      tournamentEndsAt: t.tournamentEndsAt,
      tournamentStatus: t.tournamentStatus,
      bracketType: t.bracketType,
      hasThirdPlaceMatch: t.hasThirdPlaceMatch,
      upperBracketFinalBestOf: t.upperBracketFinalBestOf,
      lowerBracketFinalBestOf: t.lowerBracketFinalBestOf,
      grandFinalBestOf: t.grandFinalBestOf,
      tournamentGridUrl: t.tournamentGridUrl ?? null,
    };
  }

  private mapTeamResponse(team: Team): TeamResponseDto {
    if (!team.captain && !team.disbandedAt) {
      throw new InternalServerErrorException('Команда без капітана');
    }
    return {
      id: team.id,
      name: team.name,
      logoUrl: team.logoUrl ?? null,
      dotaTeamId: team.dotaTeamId ?? null,
      isVerified: team.isVerified,
      isPlayingTournament: team.isPlayingTournament,
      verifiedAt: team.verifiedAt ?? null,
      disbandedAt: team.disbandedAt ?? null,
      captain: team.captain
        ? this.mapPlayerForTeamResponse(team.captain)
        : null,
      coach: team.coach ? this.mapPlayerForTeamResponse(team.coach) : null,
      mainPlayers: (team.mainPlayers ?? []).map((p) =>
        this.mapPlayerForTeamResponse(p),
      ),
      reservedPlayers: (team.reservedPlayers ?? []).map((p) =>
        this.mapPlayerForTeamResponse(p),
      ),
      tournaments: (team.tournaments ?? []).map((t) =>
        this.mapTournamentEmbedded(t),
      ),
      division: resolveTeamDivision(team.mainPlayers ?? []),
      avgRating: roundOrNull(computeTeamAvgRating(team.mainPlayers ?? [])),
    };
  }
}
