import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min, ValidateIf } from 'class-validator';

export class UpdateSocialFollowersDto {
  @ApiProperty({
    type: Number,
    nullable: true,
    minimum: 0,
    example: 1250,
    description:
      'Follower / member count entered by an admin. `null` clears the manual value.',
  })
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  followers: number | null;
}
