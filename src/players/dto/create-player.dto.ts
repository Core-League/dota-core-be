import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import type { PlayerPosition } from '../player.entity';

export class CreatePlayerDto {
  @ApiPropertyOptional({
    description:
      'Optional until linked; omit for Discord-only placeholder flows',
  })
  @IsOptional()
  @IsString()
  steamId?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  discordId: string;

  @ApiPropertyOptional({
    description:
      'Optional until linked; omit for Discord-only placeholder flows',
  })
  @IsOptional()
  @IsString()
  telegramId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  discordName: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  discordUsername: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  rating?: number;

  @ApiPropertyOptional({
    description: 'Dota map / roles (1–5); omit or null when unset',
    type: [Number],
    enum: [1, 2, 3, 4, 5],
    isArray: true,
    nullable: true,
  })
  @IsOptional()
  @IsArray()
  @IsIn([1, 2, 3, 4, 5], { each: true })
  positions?: PlayerPosition[] | null;
}
