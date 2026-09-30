import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { DuelsCoreModule } from '../duels/duels-core.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Player } from '../players/player.entity';
import { FriendsController } from './friends.controller';
import { FriendsService } from './friends.service';
import { Friendship } from './friendship.entity';

/**
 * Friend requests and friendships (`/friends`). Exports `FriendsService` so
 * the duel challenge flow can check "are these two friends".
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Friendship, Player]),
    AuthModule,
    DuelsCoreModule,
    NotificationsModule,
  ],
  controllers: [FriendsController],
  providers: [FriendsService],
  exports: [FriendsService],
})
export class FriendsModule {}
