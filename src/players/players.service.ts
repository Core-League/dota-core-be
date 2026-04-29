import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Player } from './player.entity';
import { toPlayerRankDto } from './dto/player-rank.dto';
import { PlayerResponseDto } from './dto/player-response.dto';
import { getRoleColorByName } from '../user-roles/role.constants';
import { PlayersRepository } from './players.repository';

@Injectable()
export class PlayersService {
  constructor(private readonly playersRepo: PlayersRepository) {}

  private toResponse(player: Player): PlayerResponseDto {
    return {
      id: player.id,
      steamId: player.steamId ?? null,
      discordId: player.discordId ?? null,
      telegramId: player.telegramId ?? null,
      avatarUrl: player.avatarUrl ?? null,
      discordName: player.discordName ?? null,
      discordUsername: player.discordUsername ?? null,
      rating: player.rating,
      rank: toPlayerRankDto(player.rating),
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

  create(payload: Partial<Player>): Promise<Player> {
    const entity = this.playersRepo.create(payload);
    return this.playersRepo.save(entity);
  }

  async findAll(): Promise<PlayerResponseDto[]> {
    const rows = await this.playersRepo.findAll();
    return rows.map((p) => this.toResponse(p));
  }

  async findOne(id: string): Promise<PlayerResponseDto> {
    const player = await this.playersRepo.findOneById(id);
    if (!player) {
      throw new NotFoundException('Гравця не знайдено');
    }
    return this.toResponse(player);
  }

  async update(
    id: string,
    payload: Partial<Player>,
    options?: { actorHasAdminRole?: boolean },
  ): Promise<PlayerResponseDto> {
    const player = await this.playersRepo.findOneById(id);
    if (!player) {
      throw new NotFoundException('Гравця не знайдено');
    }
    if (
      player.verifiedAt != null &&
      Object.prototype.hasOwnProperty.call(payload, 'rating')
    ) {
      if (!options?.actorHasAdminRole) {
        throw new ForbiddenException(
          'Verified players cannot change their rating',
        );
      }
    }
    Object.assign(player, payload);
    await this.playersRepo.save(player);
    const refreshed = await this.playersRepo.findOneById(id);
    if (!refreshed) {
      throw new NotFoundException('Гравця не знайдено');
    }
    return this.toResponse(refreshed);
  }

  async remove(id: string): Promise<void> {
    const player = await this.playersRepo.findOneById(id);
    if (!player) {
      throw new NotFoundException('Гравця не знайдено');
    }
    await this.playersRepo.remove(player);
  }
}
