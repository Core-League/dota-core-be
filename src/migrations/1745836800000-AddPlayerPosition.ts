import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddPlayerPosition1745836800000 implements MigrationInterface {
  name = 'AddPlayerPosition1745836800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('player');
    if (!table?.findColumnByName('position')) {
      await queryRunner.addColumn(
        'player',
        new TableColumn({
          name: 'position',
          type: 'smallint',
          isNullable: true,
        }),
      );
    }
    await queryRunner.query(
      `ALTER TABLE "player" DROP CONSTRAINT IF EXISTS "CHK_player_position_range"`,
    );
    await queryRunner.query(
      `ALTER TABLE "player" ADD CONSTRAINT "CHK_player_position_range" CHECK ("position" IS NULL OR ("position" >= 1 AND "position" <= 5))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "player" DROP CONSTRAINT IF EXISTS "CHK_player_position_range"`,
    );
    await queryRunner.dropColumn('player', 'position');
  }
}
