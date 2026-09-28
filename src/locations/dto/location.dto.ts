import { ApiProperty } from '@nestjs/swagger';

export class CountryDto {
  @ApiProperty({
    description: 'ISO 3166-1 alpha-2 code (upper-case)',
    example: 'UA',
  })
  code: string;

  @ApiProperty({ description: 'English country name', example: 'Ukraine' })
  name: string;
}

export class CitiesResponseDto {
  @ApiProperty({ example: 'UA' })
  countryCode: string;

  @ApiProperty({ type: [String], example: ['Kyiv', 'Lviv'] })
  cities: string[];
}
