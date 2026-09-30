import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { FriendRelation, FriendshipStatus } from '../friends.constants';

/** Player card on the friends page / in a request row. */
export class FriendPlayerDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional({ nullable: true })
  discordName: string | null;

  @ApiPropertyOptional({ nullable: true })
  discordUsername: string | null;

  @ApiPropertyOptional({ nullable: true })
  avatarUrl: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'SteamID64; duels need it',
  })
  steamId: string | null;

  @ApiPropertyOptional({ nullable: true })
  countryCode: string | null;

  @ApiProperty({ description: 'Tournament rating (MMR-like) of the player' })
  rating: number;

  @ApiProperty({
    description: 'Current 1v1 ladder rating (0 before the first duel)',
  })
  duelRating: number;
}

export class FriendDto {
  @ApiProperty({ description: 'friendship.id (unfriend goes by player id)' })
  friendshipId: string;

  @ApiProperty({ type: FriendPlayerDto })
  player: FriendPlayerDto;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Friends since',
  })
  since: Date;
}

export class FriendRequestDto {
  @ApiProperty({
    description: 'friendship.id — the id to accept / decline / cancel',
  })
  id: string;

  @ApiProperty({ enum: FriendshipStatus })
  status: FriendshipStatus;

  @ApiProperty({ type: FriendPlayerDto, description: 'Who asked' })
  requester: FriendPlayerDto;

  @ApiProperty({ type: FriendPlayerDto, description: 'Who was asked' })
  addressee: FriendPlayerDto;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}

/** Everything the friends page needs, from the caller's point of view. */
export class FriendsOverviewDto {
  @ApiProperty({ type: [FriendDto] })
  friends: FriendDto[];

  @ApiProperty({
    type: [FriendRequestDto],
    description: 'Requests waiting for my answer',
  })
  incoming: FriendRequestDto[];

  @ApiProperty({
    type: [FriendRequestDto],
    description: 'Requests I sent that are still open',
  })
  outgoing: FriendRequestDto[];
}

export class FriendRelationDto {
  @ApiProperty({ enum: FriendRelation })
  relation: FriendRelation;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'friendship.id of the open request (incoming / outgoing); null otherwise',
  })
  requestId: string | null;
}

export class CreateFriendRequestDto {
  @ApiProperty({ description: 'Player to befriend' })
  @IsUUID()
  playerId: string;
}
