import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CitiesResponseDto, CountryDto } from './dto/location.dto';
import { LocationsService } from './locations.service';

/** Public catalog for the profile "location" picker (no auth — it is reference data). */
@ApiTags('locations')
@Controller('locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get('countries')
  @ApiOkResponse({ type: CountryDto, isArray: true })
  getCountries(): Promise<CountryDto[]> {
    return this.locationsService.getCountries();
  }

  @Get('cities')
  @ApiQuery({
    name: 'countryCode',
    required: true,
    type: String,
    description: 'ISO 3166-1 alpha-2 code from GET /locations/countries',
  })
  @ApiOkResponse({ type: CitiesResponseDto })
  async getCities(
    @Query('countryCode') countryCode = '',
  ): Promise<CitiesResponseDto> {
    const code = LocationsService.normalizeCountryCode(countryCode);
    const cities = await this.locationsService.getCities(code);
    return { countryCode: code, cities };
  }
}
