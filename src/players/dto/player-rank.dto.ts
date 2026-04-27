import { ApiProperty } from '@nestjs/swagger';
import { resolvePlayerRankFromNumericRating } from '../rank-system/resolve-player-rank';

export class PlayerRankDto {
  @ApiProperty()
  rankNumber: number;

  @ApiProperty({ description: '1–5' })
  stars: number;

  @ApiProperty({
    description:
      'Код рангу для UI (рівняння rank*10+stars, напр. Легенда 3 зорі = 53; Титан завжди 81)',
  })
  numericName: number;

  @ApiProperty()
  nameUk: string;
}

export function toPlayerRankDto(rating: number): PlayerRankDto {
  const r = resolvePlayerRankFromNumericRating(rating);
  return {
    rankNumber: r.rankNumber,
    stars: r.stars,
    numericName: r.numericName,
    nameUk: r.nameUk,
  };
}
