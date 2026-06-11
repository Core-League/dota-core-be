import { Module } from '@nestjs/common';
import { VerificationModule } from '../../use-cases/verification/verification.module';
import { VerificationAdminController } from './verification-admin.controller';
import { VerificationUserController } from './verification-user.controller';

@Module({
  imports: [VerificationModule],
  controllers: [VerificationAdminController, VerificationUserController],
})
export class VerificationControllerModule {}
