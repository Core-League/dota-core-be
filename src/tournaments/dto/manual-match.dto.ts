import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumberString, IsUUID, MaxLength } from 'class-validator';
import type { MatchStage } from '../../match-participants/match-participant.entity';

export const MANUAL_MATCH_STAGES = ['qualification', 'playoff'] as const;

export class ManualMatchTeamDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true, type: String }) logoUrl: string | null;
}

/**
 * A finished qualification / playoff map whose result was recorded without a
 * real Dota 2 match (tech loss or manual admin entry). Such maps carry a
 * synthetic `dotaMatchId` (`tech_loss_*`, `manual_*`) or none at all, so
 * player statistics and partner sync have nothing to read until an admin
 * links the real match id.
 */
export class ManualMatchDto {
  @ApiProperty({ enum: MANUAL_MATCH_STAGES })
  stage: MatchStage;

  @ApiProperty({ format: 'uuid' })
  matchId: string;

  @ApiProperty({ type: ManualMatchTeamDto })
  teamA: ManualMatchTeamDto;

  @ApiProperty({ type: ManualMatchTeamDto })
  teamB: ManualMatchTeamDto;

  @ApiProperty({ format: 'uuid' })
  winnerTeamId: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Synthetic id currently stored (`tech_loss_*` / `manual_*`) or null.',
  })
  dotaMatchId: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Playoff only: 1-based game index inside the series.',
  })
  gameNumber: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Playoff only: series length (1 / 3 / 5).',
  })
  bestOf: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Playoff only: `upper_bracket_final` / `lower_bracket_final` / `grand_final` for finals slots.',
  })
  finalType: string | null;
}

export class LinkManualMatchDto {
  @ApiProperty({ enum: MANUAL_MATCH_STAGES })
  @IsIn(MANUAL_MATCH_STAGES)
  stage: MatchStage;

  @ApiProperty({
    format: 'uuid',
    description: 'Core map id (qualification_match / playoff_match).',
  })
  @IsUUID()
  matchId: string;

  @ApiProperty({ description: 'Numeric Dota 2 match id to attach.' })
  @IsNumberString()
  @MaxLength(20)
  dotaMatchId: string;
}

export class LinkManualMatchResultDto {
  @ApiProperty({ enum: MANUAL_MATCH_STAGES })
  stage: MatchStage;

  @ApiProperty({ format: 'uuid' })
  matchId: string;

  @ApiProperty()
  dotaMatchId: string;

  @ApiProperty({
    description:
      'True when the Core teams could be resolved from the OpenDota match and the recorded winner matched.',
  })
  winnerVerified: boolean;

  @ApiProperty({
    description: 'Participant rows written for player statistics.',
  })
  participantsRecorded: number;
}
