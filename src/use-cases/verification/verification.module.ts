import { Module } from '@nestjs/common';
import { VerificationRequestService } from './verification-request.service';
import { VerificationSlotService } from './verification-slot.service';

@Module({
  providers: [VerificationSlotService, VerificationRequestService],
  exports: [VerificationSlotService, VerificationRequestService],
})
export class VerificationModule {}
