import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Player } from './player.entity';

@Injectable()
export class PlayersRepository {
  private readonly repo: Repository<Player>;

  constructor(@InjectDataSource() dataSource: DataSource) {
    this.repo = dataSource.getRepository(Player);
  }

  create(payload: Partial<Player>): Player {
    return this.repo.create(payload);
  }

  save(player: Player): Promise<Player> {
    return this.repo.save(player);
  }

  findAll(): Promise<Player[]> {
    return this.repo.find({ relations: ['roles'] });
  }

  findOneById(id: string): Promise<Player | null> {
    return this.repo.findOne({ where: { id }, relations: ['roles'] });
  }

  remove(player: Player): Promise<Player> {
    return this.repo.remove(player);
  }
}
