import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { PlayerPosition } from '../../players/player.entity';

export class CurrentPlayerRoleDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  isAdminRole: boolean;
}

export class CurrentPlayerDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional({ nullable: true })
  steamId: string | null;

  @ApiPropertyOptional({ nullable: true })
  discordId: string | null;

  @ApiPropertyOptional({ nullable: true })
  telegramId: string | null;

  @ApiPropertyOptional({ nullable: true })
  avatarUrl: string | null;

  @ApiPropertyOptional({ nullable: true })
  discordName: string | null;

  @ApiPropertyOptional({ nullable: true })
  discordUsername: string | null;

  @ApiProperty()
  rating: number;

  @ApiPropertyOptional({
    description: 'Dota map / role position (1–5)',
    enum: [1, 2, 3, 4, 5],
    nullable: true,
  })
  position: PlayerPosition | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  verifiedAt: Date | null;

  @ApiProperty({ type: [CurrentPlayerRoleDto] })
  roles: CurrentPlayerRoleDto[];
}
