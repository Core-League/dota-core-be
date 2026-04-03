import { ApiProperty } from '@nestjs/swagger';

export class CreateUserRoleDto {
  @ApiProperty()
  name: string;

  @ApiProperty()
  isAdminRole: boolean;

  @ApiProperty({ description: 'UUID of the player' })
  playerId: string;
}
