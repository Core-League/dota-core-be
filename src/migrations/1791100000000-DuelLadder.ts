import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 1v1 Solo Mid ladder: host bot accounts, the matchmaking queue, per-player
 * rating lines and the duels themselves. The bot-worker process shares these
 * tables with api-v1 (see src/duels and src/dota-bot).
 */
export class DuelLadder1791100000000 implements MigrationInterface {
  name = 'DuelLadder1791100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "host_bot" (
        "id" SERIAL NOT NULL,
        "accountName" character varying(64) NOT NULL,
        "passwordEnc" text NOT NULL,
        "steamId64" character varying(32),
        "region" integer NOT NULL DEFAULT 3,
        "status" character varying(16) NOT NULL DEFAULT 'OFFLINE',
        "currentDuelId" uuid,
        "lastError" text,
        "lastHeartbeatAt" TIMESTAMP WITH TIME ZONE,
        "enabled" boolean NOT NULL DEFAULT true,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_host_bot_account_name" UNIQUE ("accountName"),
        CONSTRAINT "PK_host_bot" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE TABLE "duel_rating" (
        "playerId" uuid NOT NULL,
        "rating" integer NOT NULL DEFAULT 0,
        "wins" integer NOT NULL DEFAULT 0,
        "losses" integer NOT NULL DEFAULT 0,
        "streak" integer NOT NULL DEFAULT 0,
        "lastPlayedAt" TIMESTAMP WITH TIME ZONE,
        "cooldownUntil" TIMESTAMP WITH TIME ZONE,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_duel_rating" PRIMARY KEY ("playerId")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "duel_rating"
        ADD CONSTRAINT "FK_duel_rating_player"
        FOREIGN KEY ("playerId") REFERENCES "player"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_duel_rating_rating" ON "duel_rating" ("rating" DESC)`,
    );

    await queryRunner.query(
      `CREATE TABLE "duel_queue" (
        "playerId" uuid NOT NULL,
        "rating" integer NOT NULL DEFAULT 0,
        "joinedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_duel_queue" PRIMARY KEY ("playerId")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "duel_queue"
        ADD CONSTRAINT "FK_duel_queue_player"
        FOREIGN KEY ("playerId") REFERENCES "player"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `CREATE TABLE "duel" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "state" character varying(24) NOT NULL DEFAULT 'PENDING',
        "player1Id" uuid,
        "player2Id" uuid,
        "player1Rating" integer NOT NULL DEFAULT 0,
        "player2Rating" integer NOT NULL DEFAULT 0,
        "hostBotId" integer,
        "lobbyId" character varying(32),
        "lobbyName" character varying(64) NOT NULL,
        "lobbyPassword" character varying(32) NOT NULL,
        "region" integer NOT NULL DEFAULT 3,
        "lobbyPlayers" jsonb,
        "radiantPlayerId" uuid,
        "direPlayerId" uuid,
        "winnerId" uuid,
        "loserId" uuid,
        "dotaMatchId" character varying(32),
        "matchOutcome" integer,
        "ratingDelta" integer,
        "ratingAppliedAt" TIMESTAMP WITH TIME ZONE,
        "stats" jsonb,
        "error" text,
        "cancelReason" character varying(48),
        "failReason" character varying(48),
        "adminReviewRequired" boolean NOT NULL DEFAULT false,
        "resolvedByAdminId" uuid,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "lobbyReadyAt" TIMESTAMP WITH TIME ZONE,
        "liveAt" TIMESTAMP WITH TIME ZONE,
        "finishedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_duel" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "duel"
        ADD CONSTRAINT "FK_duel_player1"
        FOREIGN KEY ("player1Id") REFERENCES "player"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "duel"
        ADD CONSTRAINT "FK_duel_player2"
        FOREIGN KEY ("player2Id") REFERENCES "player"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "duel"
        ADD CONSTRAINT "FK_duel_host_bot"
        FOREIGN KEY ("hostBotId") REFERENCES "host_bot"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_duel_state" ON "duel" ("state")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_duel_player1" ON "duel" ("player1Id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_duel_player2" ON "duel" ("player2Id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_duel_created" ON "duel" ("createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "duel"`);
    await queryRunner.query(`DROP TABLE "duel_queue"`);
    await queryRunner.query(`DROP TABLE "duel_rating"`);
    await queryRunner.query(`DROP TABLE "host_bot"`);
  }
}
