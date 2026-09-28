import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `social_channel_stat` — admin-entered follower counts per social channel for
 * the analytics dashboard (Instagram / TikTok have no public counter API).
 */
export class SocialChannelStat1790900000000 implements MigrationInterface {
  name = 'SocialChannelStat1790900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "social_channel_stat" (` +
        `"channel" character varying(32) NOT NULL, ` +
        `"followers" integer, ` +
        `"updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_social_channel_stat_channel" PRIMARY KEY ("channel"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "social_channel_stat"`);
  }
}
