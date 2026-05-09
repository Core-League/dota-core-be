import { ApiProperty } from '@nestjs/swagger';

export class AdminPlayerRoleRowDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  isAdminRole: boolean;

  @ApiProperty({ description: 'HEX #RRGGBB' })
  color: string;
}

export class AdminPlayerRolesResultDto {
  @ApiProperty()
  playerId: string;

  @ApiProperty({ type: String, nullable: true })
  verifiedAt: Date | null;

  @ApiProperty({ type: [AdminPlayerRoleRowDto] })
  roles: AdminPlayerRoleRowDto[];
}
