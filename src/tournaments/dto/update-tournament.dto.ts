import { ApiPropertyOptional } from '@nestjs/swagger';
import { PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { TournamentStatus } from '../tournaments.model';
import { CreateTournamentDto } from './create-tournament.dto';

export class UpdateTournamentDto extends PartialType(CreateTournamentDto) {
  @ApiPropertyOptional({ enum: TournamentStatus, enumName: 'TournamentStatus' })
  @IsOptional()
  @IsEnum(TournamentStatus)
  tournamentStatus?: TournamentStatus;
}
