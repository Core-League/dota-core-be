import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

  @ApiProperty()
  discordId: string;

  @ApiPropertyOptional({ nullable: true })
  telegramId: string | null;

  @ApiPropertyOptional({ nullable: true })
  avatarUrl: string | null;

  @ApiProperty()
  discordName: string;

  @ApiProperty()
  discordUsername: string;

  @ApiProperty()
  rating: number;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  verifiedAt: Date | null;

  @ApiProperty({ type: [CurrentPlayerRoleDto] })
  roles: CurrentPlayerRoleDto[];
}
