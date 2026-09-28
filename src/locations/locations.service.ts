import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { CountryDto } from './dto/location.dto';

/**
 * Countries that are never offered to players and are rejected on write
 * (ISO 3166-1 alpha-2). Kept server-side so the rule holds regardless of client.
 */
export const EXCLUDED_COUNTRY_CODES: ReadonlySet<string> = new Set([
  'RU', // Russia
  'BY', // Belarus
  'IR', // Iran
]);

const COUNTRIES_NOW_BASE_URL =
  process.env.LOCATIONS_API_URL ?? 'https://countriesnow.space/api/v0.1';
/** OpenStreetMap Overpass endpoint — source of localized (`name:uk`) city names. */
const OVERPASS_URL =
  process.env.LOCATIONS_OVERPASS_URL ??
  'https://overpass-api.de/api/interpreter';
/** Overpass fair-use asks for an identifying UA; big countries take tens of seconds. */
const OVERPASS_USER_AGENT = 'dota-core-be/1.0 (profile location picker)';
const OVERPASS_TIMEOUT_MS = 65_000;
/** Country list changes ~never; cities per country are re-fetched after this window. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CountriesNowIsoRow {
  name: string;
  Iso2: string;
  Iso3: string;
}

interface CountriesNowEnvelope<T> {
  error: boolean;
  msg: string;
  data: T;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface OverpassElement {
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

/**
 * Location catalogs for the profile picker. Owns the exclusion rule and caches
 * everything in memory (24h).
 *
 * - Countries: countriesnow.space (free, keyless), filtered and sorted.
 * - Cities: OpenStreetMap Overpass first — it carries Ukrainian names
 *   (`name:uk`) for cities and towns of every country, which is what the UI
 *   shows. If Overpass is down or times out (very large countries), we fall
 *   back to countriesnow's English list so the picker still works.
 */
@Injectable()
export class LocationsService {
  private readonly logger = new Logger(LocationsService.name);

  private countriesCache: CacheEntry<CountryDto[]> | null = null;
  private countriesInFlight: Promise<CountryDto[]> | null = null;
  private readonly citiesCache = new Map<string, CacheEntry<string[]>>();

  constructor(private readonly http: HttpService) {}

  static normalizeCountryCode(code: string): string {
    return code.trim().toUpperCase();
  }

  static isExcludedCountry(code: string): boolean {
    return EXCLUDED_COUNTRY_CODES.has(
      LocationsService.normalizeCountryCode(code),
    );
  }

  /** Allowed countries sorted by English name; served from cache after the first hit. */
  async getCountries(): Promise<CountryDto[]> {
    if (this.countriesCache && this.countriesCache.expiresAt > Date.now()) {
      return this.countriesCache.value;
    }
    if (!this.countriesInFlight) {
      this.countriesInFlight = this.fetchCountries().finally(() => {
        this.countriesInFlight = null;
      });
    }
    return this.countriesInFlight;
  }

  /** Cities of one allowed country (by ISO alpha-2). */
  async getCities(countryCode: string): Promise<string[]> {
    const code = LocationsService.normalizeCountryCode(countryCode);
    const country = await this.findCountry(code);
    if (!country) {
      throw new BadRequestException('Невідома або недоступна країна');
    }

    const cached = this.citiesCache.get(code);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const cities = await this.fetchCities(country);
    this.citiesCache.set(code, {
      value: cities,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return cities;
  }

  /**
   * Resolves a code against the allowed catalog; `null` when unknown or
   * excluded. If the upstream is down we only enforce the exclusion list so
   * a third-party outage does not block profile edits.
   */
  async findCountry(countryCode: string): Promise<CountryDto | null> {
    const code = LocationsService.normalizeCountryCode(countryCode);
    if (LocationsService.isExcludedCountry(code)) return null;

    let countries: CountryDto[];
    try {
      countries = await this.getCountries();
    } catch (err) {
      this.logger.warn(
        `Country catalog unavailable; accepting "${code}" on format alone`,
        err instanceof Error ? err.message : err,
      );
      return { code, name: code };
    }
    return countries.find((c) => c.code === code) ?? null;
  }

  private async fetchCountries(): Promise<CountryDto[]> {
    let rows: CountriesNowIsoRow[];
    try {
      const { data } = await firstValueFrom(
        this.http.get<CountriesNowEnvelope<CountriesNowIsoRow[]>>(
          `${COUNTRIES_NOW_BASE_URL}/countries/iso`,
        ),
      );
      if (data.error || !Array.isArray(data.data)) {
        throw new Error(data.msg || 'Malformed countries payload');
      }
      rows = data.data;
    } catch (err) {
      this.logger.warn('countriesnow /countries/iso failed', err);
      throw new ServiceUnavailableException(
        'Довідник країн тимчасово недоступний',
      );
    }

    const seen = new Set<string>();
    const countries: CountryDto[] = [];
    for (const row of rows) {
      const code = LocationsService.normalizeCountryCode(row.Iso2 ?? '');
      const name = (row.name ?? '').trim();
      if (!/^[A-Z]{2}$/.test(code) || !name) continue;
      if (EXCLUDED_COUNTRY_CODES.has(code) || seen.has(code)) continue;
      seen.add(code);
      countries.push({ code, name });
    }
    countries.sort((a, b) => a.name.localeCompare(b.name, 'en'));

    this.countriesCache = {
      value: countries,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    return countries;
  }

  /** Overpass (Ukrainian names) with an English fallback; see class docs. */
  private async fetchCities(country: CountryDto): Promise<string[]> {
    try {
      const localized = await this.fetchCitiesFromOverpass(country.code);
      if (localized.length) return localized;
      this.logger.warn(
        `Overpass returned no places for ${country.code}; using English list`,
      );
    } catch (err) {
      this.logger.warn(
        `Overpass failed for ${country.code}; using English list`,
        err instanceof Error ? err.message : err,
      );
    }
    return this.fetchCitiesFromCountriesNow(country.name);
  }

  /**
   * Cities + towns (`place=city|town`) inside the country's admin boundary.
   * Villages are left out on purpose — for large countries they push the
   * payload past what Overpass will serve in one request.
   */
  private async fetchCitiesFromOverpass(
    countryCode: string,
  ): Promise<string[]> {
    const query = [
      `[out:json][timeout:60];`,
      `area["ISO3166-1"="${countryCode}"]["admin_level"="2"]->.a;`,
      `node[place~"^(city|town)$"](area.a);`,
      `out tags;`,
    ].join('');

    const { data } = await firstValueFrom(
      this.http.post<OverpassResponse>(
        OVERPASS_URL,
        new URLSearchParams({ data: query }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': OVERPASS_USER_AGENT,
          },
          timeout: OVERPASS_TIMEOUT_MS,
        },
      ),
    );

    const unique = new Set<string>();
    for (const el of data?.elements ?? []) {
      const tags = el.tags ?? {};
      const name = (
        tags['name:uk'] ??
        tags['name'] ??
        tags['name:en'] ??
        ''
      ).trim();
      if (name) unique.add(name);
    }
    return [...unique].sort((a, b) => a.localeCompare(b, 'uk'));
  }

  private async fetchCitiesFromCountriesNow(
    countryName: string,
  ): Promise<string[]> {
    let cities: string[];
    try {
      const { data } = await firstValueFrom(
        this.http.get<CountriesNowEnvelope<string[]>>(
          `${COUNTRIES_NOW_BASE_URL}/countries/cities/q`,
          { params: { country: countryName } },
        ),
      );
      if (data.error || !Array.isArray(data.data)) {
        throw new Error(data.msg || 'Malformed cities payload');
      }
      cities = data.data;
    } catch (err) {
      this.logger.warn(`countriesnow cities failed for "${countryName}"`, err);
      throw new ServiceUnavailableException(
        'Довідник міст тимчасово недоступний',
      );
    }

    const unique = new Set<string>();
    for (const c of cities) {
      const name = typeof c === 'string' ? c.trim() : '';
      if (name) unique.add(name);
    }
    return [...unique].sort((a, b) => a.localeCompare(b, 'en'));
  }
}
