import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Player } from '../players/player.entity';
import { Duel } from './duel.entity';
import { DuelQueueEntry } from './duel-queue.entity';
import { DuelRating } from './duel-rating.entity';
import { DuelsService } from './duels.service';
import { HostBot } from './host-bot.entity';
import { HostBotsService } from './host-bots.service';

/**
 * Entities + business services of the 1v1 ladder, without HTTP or schedulers.
 * Imported by `DuelsModule` (api-v1) and by the bot-worker's root module, so
 * both processes run the very same rating code.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Duel,
      DuelRating,
      DuelQueueEntry,
      HostBot,
      Player,
    ]),
  ],
  providers: [DuelsService, HostBotsService],
  exports: [DuelsService, HostBotsService, TypeOrmModule],
})
export class DuelsCoreModule {}
