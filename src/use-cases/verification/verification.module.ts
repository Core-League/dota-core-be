import { Module } from '@nestjs/common';
import { Dota2Module } from '../../dota2/dota2.module';
import { VerificationRequestService } from './verification-request.service';
import { VerificationSlotService } from './verification-slot.service';

@Module({
  imports: [Dota2Module],
  providers: [VerificationSlotService, VerificationRequestService],
  exports: [VerificationSlotService, VerificationRequestService],
})
export class VerificationModule {}
