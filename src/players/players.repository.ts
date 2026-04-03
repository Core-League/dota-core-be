import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Player } from './player.entity';

@Injectable()
export class PlayersRepository {
  constructor(
    @InjectRepository(Player)
    private readonly repo: Repository<Player>,
  ) {}

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
