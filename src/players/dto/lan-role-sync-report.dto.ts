import { ApiProperty } from '@nestjs/swagger';

export class LanRoleSyncReportDto {
  @ApiProperty({
    description:
      'False when the bot token or guild id is missing on the server',
  })
  configured: boolean;

  @ApiProperty({ type: [String], description: 'Roles created this run' })
  created: string[];

  @ApiProperty({ type: [String], description: 'Roles now on the member' })
  assigned: string[];

  @ApiProperty({ type: [String], description: 'Roles taken off the member' })
  removed: string[];

  @ApiProperty({
    type: [String],
    description: 'Discord failures, with HTTP status and Discord message',
    example: ['assign "Львів": HTTP 403 Missing Permissions (50013)'],
  })
  errors: string[];
}
