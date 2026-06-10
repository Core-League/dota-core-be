import type { VerificationRequest } from '../../entities/verification/request';
import type { VerificationRequestStatus } from '../../enums/verification/VerificationRequestStatus';
import type { VerificationType } from '../../enums/verification/VerificationType';

export interface CreateBookingInput {
  slotId: string;
  teamId: string;
  type: VerificationType;
  createdByPlayerId: string;
  playerIds: string[];
}

export interface IRequestRepository {
  createBooking(input: CreateBookingInput): Promise<VerificationRequest>;
  findById(id: string): Promise<VerificationRequest | null>;
  findBySlotId(slotId: string): Promise<VerificationRequest | null>;
  findInRange(from: Date, to: Date): Promise<VerificationRequest[]>;
  setStatus(id: string, status: VerificationRequestStatus): Promise<void>;
}
