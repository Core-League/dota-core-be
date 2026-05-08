import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { Role } from '../../user-roles/role.constants';
import type { RoleName } from '../../user-roles/role.constants';

/**
 * Roles that an admin may assign as a player's primary (non-admin) role via
 * the admin API. Excludes:
 *  - Адмін: managed via dedicated grant/revoke endpoints.
 *  - Капітан: managed by `TeamsService` as a side effect of team captaincy.
 */
export const ASSIGNABLE_PRIMARY_ROLE_NAMES: readonly RoleName[] = [
  Role.GUEST,
  Role.PLAYER,
  Role.MEDIA,
];

export class SetPlayerRoleDto {
  @ApiProperty({
    enum: [...ASSIGNABLE_PRIMARY_ROLE_NAMES],
    description: "Player's new primary role (Гість, Гравець, or Медіа).",
  })
  @IsIn([...ASSIGNABLE_PRIMARY_ROLE_NAMES])
  name: RoleName;
}
