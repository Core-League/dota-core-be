import { Injectable, NotFoundException } from '@nestjs/common';
import { Player } from './player.entity';
import { PlayersRepository } from './players.repository';

@Injectable()
export class PlayersService {
  constructor(private readonly playersRepo: PlayersRepository) {}

  create(payload: Partial<Player>): Promise<Player> {
    const entity = this.playersRepo.create(payload);
    return this.playersRepo.save(entity);
  }

  findAll(): Promise<Player[]> {
    return this.playersRepo.findAll();
  }

  async findOne(id: string): Promise<Player> {
    const player = await this.playersRepo.findOneById(id);
    if (!player) {
      throw new NotFoundException('Гравця не знайдено');
    }
    return player;
  }

  async update(id: string, payload: Partial<Player>): Promise<Player> {
    const player = await this.findOne(id);
    Object.assign(player, payload);
    return this.playersRepo.save(player);
  }

  async remove(id: string): Promise<void> {
    const player = await this.findOne(id);
    await this.playersRepo.remove(player);
  }
}
