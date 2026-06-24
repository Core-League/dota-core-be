import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

export enum RemovePlayerPenalty {
  SUBTRACT = 'subtract',
  NONE = 'none',
}

export class RemovePlayerQueryDto {
  @ApiPropertyOptional({
    enum: RemovePlayerPenalty,
    default: RemovePlayerPenalty.SUBTRACT,
    description:
      'Point penalty applied to the removed player. `subtract` (default) reduces their tournament points to 30%; `none` removes the player without touching points (admin override).',
  })
  @IsOptional()
  @IsEnum(RemovePlayerPenalty)
  penalty?: RemovePlayerPenalty;
}
