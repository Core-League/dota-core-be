import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  ValidateNested,
} from 'class-validator';
import {
  DUEL_TOURNAMENT_PRIZES_MAX,
  DuelSeasonStatus,
} from '../duel.constants';
import { DuelPlayerDto } from './duel.dto';
import {
  DuelTournamentPrizeDto,
  DuelTournamentPrizeInputDto,
} from './duel-tournament.dto';

/** One prize place of a season: a tournament prize plus who won it and whether it was handed out. */
export class DuelSeasonPrizeDto extends DuelTournamentPrizeDto {
  @ApiPropertyOptional({
    type: DuelPlayerDto,
    nullable: true,
    description:
      'Winner of the place (once settled); rating is their final season rating',
  })
  awardedPlayer: DuelPlayerDto | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    format: 'date-time',
    description:
      'When the prize was handed out: VIP — granted automatically at settlement; custom — marked by an admin',
  })
  issuedAt: string | null;
}

/** A monthly ladder season (Kyiv calendar month). */
export class DuelSeasonDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: '1, 2, 3, … — «Сезон N»' })
  number: number;

  @ApiProperty({ type: String, format: 'date-time' })
  startsAt: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Exclusive end: the first moment of the next season',
  })
  endsAt: Date;

  @ApiProperty({ enum: DuelSeasonStatus })
  status: DuelSeasonStatus;

  @ApiProperty({
    description:
      'The time is up but the results are still being settled: the ladder queue is closed meanwhile',
  })
  closing: boolean;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  endedAt: Date | null;

  @ApiProperty({
    type: DuelSeasonPrizeDto,
    isArray: true,
    description: 'Prize places, by place',
  })
  prizes: DuelSeasonPrizeDto[];

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    format: 'date-time',
    description: 'Winners fixed and VIP granted',
  })
  prizesAwardedAt: Date | null;
}

export class UpdateDuelSeasonPrizesDto {
  @ApiProperty({
    type: DuelTournamentPrizeInputDto,
    isArray: true,
    maxItems: DUEL_TOURNAMENT_PRIZES_MAX,
    description: 'Replaces all prize places; one prize per place',
  })
  @IsArray()
  @ArrayMaxSize(DUEL_TOURNAMENT_PRIZES_MAX)
  @ValidateNested({ each: true })
  @Type(() => DuelTournamentPrizeInputDto)
  prizes: DuelTournamentPrizeInputDto[];
}

export class SetDuelSeasonPrizeIssuedDto {
  @ApiProperty({ description: 'true — handed out, false — not yet' })
  @IsBoolean()
  issued: boolean;
}
