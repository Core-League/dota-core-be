import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Playoff } from './playoff.entity';

@Entity('playoff_league_fixture')
@Unique('UQ_playoff_league_fixture_playoff_match', [
  'playoffId',
  'challongeMatchId',
])
export class PlayoffLeagueFixture {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  playoffId: string;

  @ManyToOne(() => Playoff, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'playoffId' })
  playoff: Playoff;

  @Column({ type: 'varchar' })
  challongeMatchId: string;

  @Column({ type: 'varchar' })
  dotaFixtureNodeGroupId: string;
}
