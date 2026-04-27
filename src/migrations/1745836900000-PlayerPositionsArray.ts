import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class PlayerPositionsArray1745836900000 implements MigrationInterface {
  name = 'PlayerPositionsArray1745836900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    let table = await queryRunner.getTable('player');
    if (!table?.findColumnByName('positions')) {
      await queryRunner.addColumn(
        'player',
        new TableColumn({
          name: 'positions',
          type: 'smallint',
          isArray: true,
          isNullable: true,
        }),
      );
    }
    table = await queryRunner.getTable('player');
    if (table?.findColumnByName('position')) {
      await queryRunner.query(`
        UPDATE "player"
        SET "positions" = ARRAY["position"]::smallint[]
        WHERE "position" IS NOT NULL
      `);
    }
    await queryRunner.query(
      `ALTER TABLE "player" DROP CONSTRAINT IF EXISTS "CHK_player_position_range"`,
    );
    table = await queryRunner.getTable('player');
    if (table?.findColumnByName('position')) {
      await queryRunner.dropColumn('player', 'position');
    }
    await queryRunner.query(
      `ALTER TABLE "player" DROP CONSTRAINT IF EXISTS "CHK_player_positions_range"`,
    );
    await queryRunner.query(`
      ALTER TABLE "player" ADD CONSTRAINT "CHK_player_positions_range" CHECK (
        "positions" IS NULL
        OR ARRAY[1, 2, 3, 4, 5]::smallint[] @> "positions"
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "player" DROP CONSTRAINT IF EXISTS "CHK_player_positions_range"`,
    );
    let table = await queryRunner.getTable('player');
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
    await queryRunner.query(`
      UPDATE "player"
      SET "position" = "positions"[1]
      WHERE "positions" IS NOT NULL AND cardinality("positions") >= 1
    `);
    table = await queryRunner.getTable('player');
    if (table?.findColumnByName('positions')) {
      await queryRunner.dropColumn('player', 'positions');
    }
    await queryRunner.query(
      `ALTER TABLE "player" ADD CONSTRAINT "CHK_player_position_range" CHECK ("position" IS NULL OR ("position" >= 1 AND "position" <= 5))`,
    );
  }
}
