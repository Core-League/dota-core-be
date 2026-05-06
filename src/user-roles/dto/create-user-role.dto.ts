import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn } from 'class-validator';
import { ROLE_NAMES } from '../role.constants';

export class CreateUserRoleDto {
  @ApiProperty({ enum: [...ROLE_NAMES] })
  @IsIn([...ROLE_NAMES])
  name: string;

  @ApiProperty()
  @IsBoolean()
  isAdminRole: boolean;
}
