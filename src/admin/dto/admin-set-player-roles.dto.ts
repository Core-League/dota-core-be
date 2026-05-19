import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, ValidateNested } from 'class-validator';
import { ROLE_NAMES } from '../../user-roles/role.constants';

export class AdminPlayerRoleItemDto {
  @ApiProperty({ enum: [...ROLE_NAMES] })
  @IsIn([...ROLE_NAMES])
  name: string;

  @ApiProperty({
    description:
      'Для ролі «Адмін» очікується true; для «Гість/Гравець/Капітан» — false.',
  })
  @IsBoolean()
  isAdminRole: boolean;
}

export class AdminSetPlayerRolesDto {
  @ApiProperty({
    type: [AdminPlayerRoleItemDto],
    description:
      'Повний набір призначень ролей гравцю (замінює існуючі записи user_roles для цього гравця).',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AdminPlayerRoleItemDto)
  roles: AdminPlayerRoleItemDto[];
}
