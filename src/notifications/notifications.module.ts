import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { DuelsCoreModule } from '../duels/duels-core.module';
import { Notification } from './notification.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';

/**
 * The header bell: persisted inbox rows, `GET/POST /notifications` and the
 * `/notifications` socket namespace. Writers (friends, duel challenges) call
 * `NotificationsService`; the pushes ride the duel event bus, whose LISTEN
 * connection lives in `DuelsModule` and forwards `notification` events here.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Notification]),
    AuthModule,
    DuelsCoreModule,
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsGateway],
  exports: [NotificationsService, NotificationsGateway],
})
export class NotificationsModule {}
