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
@Unique('UQ_playoff_league_fixture_playoff_mid_slot', [
  'playoffId',
  'challongeMatchId',
  'fixtureSlot',
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

  /** 0 = один Dota-слот (BO1); 1–3 = окремі ігрові місця всередині BO3-серії. */
  @Column({ type: 'smallint', default: 0 })
  fixtureSlot: number;

  @Column({ type: 'varchar' })
  dotaFixtureNodeGroupId: string;
}
