import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class JoinTournamentDto {
  @ApiPropertyOptional({
    description:
      "Admin-only: join a specific team by ID instead of the requester's team",
  })
  @IsOptional()
  @IsUUID()
  teamId?: string;
}
