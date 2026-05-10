import { ApiProperty } from '@nestjs/swagger';
import { ROLE_NAMES } from '../../user-roles/role.constants';

export class AdminPlayerRoleItemDto {
  @ApiProperty({ enum: [...ROLE_NAMES] })
  name: string;

  @ApiProperty({
    description:
      'Для ролі «Адмін» очікується true; для «Гість/Гравець/Капітан» — false.',
  })
  isAdminRole: boolean;
}

export class AdminSetPlayerRolesDto {
  @ApiProperty({
    type: [AdminPlayerRoleItemDto],
    description:
      'Повний набір призначень ролей гравцю (замінює існуючі записи user_roles для цього гравця).',
  })
  roles: AdminPlayerRoleItemDto[];
}
