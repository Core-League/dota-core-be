import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Player } from '../players/player.entity';
import { Duel } from './duel.entity';
import { DuelChallenge } from './duel-challenge.entity';
import { DuelEventsPublisher } from './duel-events.publisher';
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
      DuelChallenge,
      HostBot,
      Player,
    ]),
  ],
  providers: [DuelsService, HostBotsService, DuelEventsPublisher],
  exports: [DuelsService, HostBotsService, DuelEventsPublisher, TypeOrmModule],
})
export class DuelsCoreModule {}
