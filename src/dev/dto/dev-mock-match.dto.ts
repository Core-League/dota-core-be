import { IsIn, IsUUID } from 'class-validator';

export class DevMockMatchDto {
  @IsUUID()
  tournamentId: string;

  @IsUUID()
  teamAId: string;

  @IsUUID()
  teamBId: string;

  @IsIn(['qualification', 'playoff'])
  phase: 'qualification' | 'playoff';
}
