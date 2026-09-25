import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * What the configured DOTA_* session sees when it opens a league's tournament
 * admin page, side by side with Valve's public record of the league. Built to
 * answer one question fast: "is it the cookies, or is it this league?"
 */
export class DotaLeagueAccessDto {
  @ApiProperty()
  leagueId: number;

  @ApiProperty({
    description:
      'False when DOTA_SESSION_ID / DOTA_OAUTH_TOKEN are not set at all; the page probe is skipped then.',
  })
  sessionConfigured: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'League name from the public API; null when Valve has no league with this id.',
  })
  publicName: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Valve league status from the public API; 3 = accepted.',
  })
  publicStatus: number | null;

  @ApiProperty({
    description: 'Node groups Valve reports publicly for this league.',
  })
  publicNodeGroups: number;

  @ApiProperty({
    description:
      'True when the session landed on the league admin page rather than the public landing page. ' +
      'False for 19183 and 20246 alike means the cookies are dead; false for one league only means ' +
      'the logged-in account has no rights on that league.',
  })
  adminPageReached: boolean;

  @ApiPropertyOptional({ nullable: true })
  pageTitle: string | null;

  @ApiProperty({
    description:
      'True when the page offers a Login link, i.e. Valve does not consider the session logged in.',
  })
  loginLinkPresent: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Steam persona shown in the page header when Valve recognises the session; null when not found.',
  })
  loggedInAs: string | null;

  @ApiProperty({
    description:
      'Organisational ("tournament") groups visible on the admin page.',
  })
  organizationalGroupsOnPage: number;

  @ApiProperty({ description: 'Plain-language reading of the above.' })
  verdict: string;
}
