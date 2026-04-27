import { ApiProperty } from '@nestjs/swagger';
import { ROLE_NAMES } from '../role.constants';

export class UserRoleResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: [...ROLE_NAMES] })
  name: string;

  @ApiProperty()
  isAdminRole: boolean;

  @ApiProperty({
    description: 'CSS hex #RRGGBB (для parseHexColor на клієнті)',
    example: '#2563EB',
  })
  color: string;
}
