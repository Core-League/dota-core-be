import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class DiscordExchangeDto {
  @ApiProperty({ description: 'Authorization code from Discord redirect' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({
    description: 'State value returned by Discord (signed by this API)',
  })
  @IsString()
  @IsNotEmpty()
  state: string;
}
