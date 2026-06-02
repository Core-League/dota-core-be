import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitV21780435072262 implements MigrationInterface {
  name = 'InitV21780435072262';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "transaction" ("id" character varying NOT NULL, "accountId" character varying NOT NULL, "time" TIMESTAMP WITH TIME ZONE NOT NULL, "amount" bigint NOT NULL, "description" character varying NOT NULL, "comment" character varying, "mcc" integer NOT NULL, "counterIban" character varying, "counterEdrpou" character varying, "balance" bigint NOT NULL, "hold" boolean NOT NULL, "currencyCode" integer NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_89eadb93a89810556e1cbcd6ab9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3d6e89b14baa44a71870450d14" ON "transaction" ("accountId") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."asset_storagetype_enum" AS ENUM('LOCAL', 'EXTERNAL_URL')`,
    );
    await queryRunner.query(
      `CREATE TABLE "asset" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "storageType" "public"."asset_storagetype_enum" NOT NULL DEFAULT 'LOCAL', "path" character varying NOT NULL, CONSTRAINT "PK_1209d107fe21482beaea51b745e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."sponsor_kind_enum" AS ENUM('BETKING', 'DUELO_GG')`,
    );
    await queryRunner.query(
      `CREATE TABLE "sponsor" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "logoAssetId" uuid, "kind" "public"."sponsor_kind_enum" NOT NULL, "matchers" text array NOT NULL DEFAULT '{}', CONSTRAINT "PK_31c4354cde945c685aabe017541" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."operation_group_kind_enum" AS ENUM('PRIZE', 'CUSTOM')`,
    );
    await queryRunner.query(
      `CREATE TABLE "operation_group" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "kind" "public"."operation_group_kind_enum" NOT NULL, "title" character varying NOT NULL, "iconAssetId" uuid, "aggregatedAmount" bigint NOT NULL, "groupKey" character varying NOT NULL, CONSTRAINT "PK_06d0f571aaac8d5b3bd773d7177" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fbd27879cff4c413a0359171ad" ON "operation_group" ("groupKey") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."operation_type_enum" AS ENUM('BETKING', 'DUELO_GG', 'PRIZE', 'CUSTOM')`,
    );
    await queryRunner.query(
      `CREATE TABLE "operation" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "transactionId" character varying, "type" "public"."operation_type_enum" NOT NULL, "amount" bigint NOT NULL, "time" TIMESTAMP WITH TIME ZONE NOT NULL, "title" character varying NOT NULL, "iconAssetId" uuid, "groupId" uuid, "comment" character varying, "raw" jsonb, CONSTRAINT "PK_18556ee6e49c005fc108078f3ab" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_23802483cd9e06844cd9f0c5af" ON "operation" ("transactionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cf193f6b3a69ea391d68cd47e7" ON "operation" ("groupId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "forecast_config" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "divisions" jsonb NOT NULL, "fees" jsonb NOT NULL, "prizePoolPercent" integer NOT NULL DEFAULT '60', "isActive" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_14162ddb8f6c5b0ae652523f0db" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "custom_category" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "label" character varying NOT NULL, "iconAssetId" uuid, CONSTRAINT "PK_cee9f9cb0dd20aebc9b5fc232d9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "account" ("id" character varying NOT NULL, "maskedPan" text array NOT NULL DEFAULT '{}', "balance" bigint NOT NULL, "currencyCode" integer NOT NULL, "type" character varying NOT NULL, CONSTRAINT "PK_54115ee388cdb6d86bb4bf5b2ea" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "sponsor" ADD CONSTRAINT "FK_c085ce4306b99c177d9b69d08f1" FOREIGN KEY ("logoAssetId") REFERENCES "asset"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "operation_group" ADD CONSTRAINT "FK_d2ed6715feb563453cc15f1a858" FOREIGN KEY ("iconAssetId") REFERENCES "asset"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "operation" ADD CONSTRAINT "FK_0d3f78908a42168977d71141759" FOREIGN KEY ("iconAssetId") REFERENCES "asset"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "operation" ADD CONSTRAINT "FK_cf193f6b3a69ea391d68cd47e7f" FOREIGN KEY ("groupId") REFERENCES "operation_group"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "custom_category" ADD CONSTRAINT "FK_1dd3a97e6fb6831116a532c5b39" FOREIGN KEY ("iconAssetId") REFERENCES "asset"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "custom_category" DROP CONSTRAINT "FK_1dd3a97e6fb6831116a532c5b39"`,
    );
    await queryRunner.query(
      `ALTER TABLE "operation" DROP CONSTRAINT "FK_cf193f6b3a69ea391d68cd47e7f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "operation" DROP CONSTRAINT "FK_0d3f78908a42168977d71141759"`,
    );
    await queryRunner.query(
      `ALTER TABLE "operation_group" DROP CONSTRAINT "FK_d2ed6715feb563453cc15f1a858"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sponsor" DROP CONSTRAINT "FK_c085ce4306b99c177d9b69d08f1"`,
    );
    await queryRunner.query(`DROP TABLE "account"`);
    await queryRunner.query(`DROP TABLE "custom_category"`);
    await queryRunner.query(`DROP TABLE "forecast_config"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cf193f6b3a69ea391d68cd47e7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_23802483cd9e06844cd9f0c5af"`,
    );
    await queryRunner.query(`DROP TABLE "operation"`);
    await queryRunner.query(`DROP TYPE "public"."operation_type_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fbd27879cff4c413a0359171ad"`,
    );
    await queryRunner.query(`DROP TABLE "operation_group"`);
    await queryRunner.query(`DROP TYPE "public"."operation_group_kind_enum"`);
    await queryRunner.query(`DROP TABLE "sponsor"`);
    await queryRunner.query(`DROP TYPE "public"."sponsor_kind_enum"`);
    await queryRunner.query(`DROP TABLE "asset"`);
    await queryRunner.query(`DROP TYPE "public"."asset_storagetype_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3d6e89b14baa44a71870450d14"`,
    );
    await queryRunner.query(`DROP TABLE "transaction"`);
  }
}
