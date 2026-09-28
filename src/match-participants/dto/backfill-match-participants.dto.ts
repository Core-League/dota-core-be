import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BackfillMatchParticipantsFailureDto {
  @ApiProperty({ enum: ['qualification', 'playoff'] })
  stage: string;

  @ApiProperty()
  matchId: string;

  @ApiProperty()
  dotaMatchId: string;

  @ApiProperty()
  error: string;
}

export class BackfillMatchParticipantsReportDto {
  @ApiProperty({ description: 'Maps looked at in this call' })
  processed: number;

  @ApiProperty({ description: 'Maps that now have participant rows' })
  recorded: number;

  @ApiProperty({ description: 'Participant rows written in this call' })
  participants: number;

  @ApiProperty({ type: [BackfillMatchParticipantsFailureDto] })
  failed: BackfillMatchParticipantsFailureDto[];

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Pass as afterDotaMatchId on the next call to continue past this batch',
  })
  lastDotaMatchId: string | null;

  @ApiProperty({
    description: 'Maps still without participant rows after lastDotaMatchId',
  })
  remaining: number;
}
