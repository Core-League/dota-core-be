import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { VerificationSlotStatus } from '../../types/enums/verification/VerificationSlotStatus';

/**
 * A bookable 30-minute verification slot on the admin calendar
 * (`verification_slot`). Admin auto-generates a day's worth of `free` slots from
 * a working-hours range; `endsAt` is always `startsAt + 30m`. v2 owns this table.
 */
@Entity({ name: 'verification_slot' })
export class VerificationSlotModel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'timestamptz' })
  startsAt: Date;

  @Column({ type: 'timestamptz' })
  endsAt: Date;

  @Column({
    type: 'enum',
    enum: VerificationSlotStatus,
    default: VerificationSlotStatus.Free,
  })
  status: VerificationSlotStatus;
}
