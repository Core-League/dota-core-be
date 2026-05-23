import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class JoinTournamentDto {
  @ApiPropertyOptional({
    description:
      'UUID команди для реєстрації вручну (адмін-панель). Дозволено лише JWT користувачу з адміністративною роллю; для dev також BYPASS_TEAM_VERIFICATION.',
  })
  @IsOptional()
  @IsUUID()
  teamId?: string;
}
