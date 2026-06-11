import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A moderation tag in the admin catalog (`tag`), e.g. the seeded
 * `suspicious-behavior` tag. `name` is the stable machine slug; `title` is the
 * display text shown in the UI. v2 owns this table.
 */
@Entity({ name: 'tag' })
export class TagModel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column()
  title: string;
}
