import { ApiProperty } from '@nestjs/swagger';

export class RegeneratedLeagueFixtureDto {
  @ApiProperty({ description: 'Challonge match the fixture mirrors.' })
  challongeMatchId: string;

  @ApiProperty({
    description: 'Node group created for the fixture in the Dota 2 league.',
  })
  nodeGroupId: string;

  @ApiProperty({ description: 'Label shown on the league page ("A vs B").' })
  name: string;
}

/** Outcome of `POST /tournaments/:id/playoff/regenerate-matches`. */
export class RegenerateLeagueMatchesResultDto {
  @ApiProperty({ description: 'League the fixtures were created in.' })
  dotaLeagueId: number;

  @ApiProperty({
    description:
      'Organisational node group that now wraps the playoff fixtures in the league.',
  })
  shellNodeGroupId: string;

  @ApiProperty({
    type: [String],
    description:
      'Node groups of the previous mirror (fixtures and shell) that were removed ' +
      'from the league. A removal that failed is logged and left for manual cleanup.',
  })
  removedNodeGroupIds: string[];

  @ApiProperty({
    type: [RegeneratedLeagueFixtureDto],
    description: 'One entry per open bracket match recreated in the league.',
  })
  fixtures: RegeneratedLeagueFixtureDto[];

  @ApiProperty({
    type: [String],
    description:
      'Open bracket matches whose fixture could not be created. Re-run the ' +
      'endpoint to retry them.',
  })
  failedChallongeMatchIds: string[];

  @ApiProperty({
    type: [String],
    description:
      'Fixtures created whose node has no teams bound, so the match cannot be ' +
      'picked when creating a lobby. Empty when everything is playable.',
  })
  unplayableNodeGroupIds: string[];
}
