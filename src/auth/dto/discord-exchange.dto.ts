import { ApiProperty } from '@nestjs/swagger';

export class DiscordExchangeDto {
  @ApiProperty({ description: 'Authorization code from Discord redirect' })
  code: string;

  @ApiProperty({
    description: 'State value returned by Discord (signed by this API)',
  })
  state: string;
}
