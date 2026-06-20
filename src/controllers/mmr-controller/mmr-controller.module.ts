import { Module } from '@nestjs/common';
import { MmrUpdateModule } from '../../use-cases/mmr-update/mmr-update.module';
import { MmrAdminController } from './mmr-admin.controller';
import { MmrUserController } from './mmr-user.controller';

@Module({
  imports: [MmrUpdateModule],
  // User controller first so the static `me` route is registered before the
  // admin `:id` route (avoids `/mmr-requests/me` matching `:id`).
  controllers: [MmrUserController, MmrAdminController],
})
export class MmrControllerModule {}
