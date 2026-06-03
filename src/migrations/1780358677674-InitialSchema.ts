import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1780358677674 implements MigrationInterface {
  name = 'InitialSchema1780358677674';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "player" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "steamId" character varying, "discordId" character varying, "telegramId" character varying, "avatarUrl" character varying, "discordName" character varying, "discordUsername" character varying, "rating" real NOT NULL DEFAULT '0', "positions" smallint array, "verifiedAt" TIMESTAMP WITH TIME ZONE, "teamId" character varying(64), CONSTRAINT "UQ_aab14547f7e31bcc1c8249181da" UNIQUE ("steamId"), CONSTRAINT "UQ_93ba121bb90426b8f154099b971" UNIQUE ("discordId"), CONSTRAINT "UQ_f3efb1b36ef5ae199e17a8a5fa1" UNIQUE ("telegramId"), CONSTRAINT "PK_65edadc946a7faf4b638d5e8885" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "match" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "dotaMatchId" character varying NOT NULL, "teamAId" uuid, "teamBId" uuid, "winnerId" uuid, CONSTRAINT "PK_92b6c3a6631dd5b24a67c69f69d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "team" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "logoUrl" character varying, "dotaTeamId" character varying, "discordRoleId" character varying, "discordChannelId" character varying, "isVerified" boolean NOT NULL, "isPlayingTournament" boolean NOT NULL, "verifiedAt" TIMESTAMP WITH TIME ZONE, "disbandedAt" TIMESTAMP WITH TIME ZONE, "captainId" uuid NOT NULL, "coachId" uuid, CONSTRAINT "REL_f71181e2994176fd624db416c2" UNIQUE ("captainId"), CONSTRAINT "REL_4ec92b7a3b6eca6881a3f1b634" UNIQUE ("coachId"), CONSTRAINT "PK_f57d8293406df4af348402e4b74" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."tournament_division_enum" AS ENUM('DIVISION_I', 'DIVISION_II', 'DIVISION_III')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."tournament_tournamentstatus_enum" AS ENUM('QUALIFICATIONS', 'PLAYOFF', 'COMPLETED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "tournament" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "prizePool" integer, "division" "public"."tournament_division_enum", "headerBannerUrl" character varying, "listBannerUrl" character varying, "tournamentSlots" integer, "registrationStartsAt" TIMESTAMP NOT NULL, "registrationEndsAt" TIMESTAMP NOT NULL, "tournamentStartsAt" TIMESTAMP NOT NULL, "tournamentEndsAt" TIMESTAMP NOT NULL, "tournamentStatus" "public"."tournament_tournamentstatus_enum" NOT NULL, "tournamentGridUrl" character varying, CONSTRAINT "PK_449f912ba2b62be003f0c22e767" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "user_roles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "isAdminRole" boolean NOT NULL, "playerId" uuid, CONSTRAINT "PK_8acd5cf26ebd158416f477de799" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "tournament_playoff_team" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tournamentId" uuid NOT NULL, "teamId" uuid NOT NULL, "challongeParticipantId" character varying, "isDisqualified" boolean NOT NULL DEFAULT false, CONSTRAINT "UQ_bd3a8bb593dda6f07747ef8134c" UNIQUE ("tournamentId", "teamId"), CONSTRAINT "PK_0ef1ad2c207fce98639bd5f1bbb" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "player_tournament_points" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "playerId" uuid NOT NULL, "tournamentId" uuid NOT NULL, "points" integer NOT NULL DEFAULT '0', CONSTRAINT "UQ_737367c18395197eb2cc39874db" UNIQUE ("playerId", "tournamentId"), CONSTRAINT "PK_047c9e5d0c6a106982d7935ba57" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "team_invite" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "token" character varying(64) NOT NULL, "teamId" uuid NOT NULL, "createdById" uuid NOT NULL, "slot" character varying NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_deb3080b1edfad7d043d6db876e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_254b336a9b26140fd99c24fbc2" ON "team_invite" ("token") `,
    );
    await queryRunner.query(
      `CREATE TABLE "qualification_match" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "dotaMatchId" character varying, "nodeGroupId" character varying NOT NULL, "qualificationId" uuid, "teamAId" uuid, "teamBId" uuid, "winnerId" uuid, CONSTRAINT "PK_4ed5eff971ffc09b6ca7671ee3f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "qualification" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "startTime" TIMESTAMP WITH TIME ZONE NOT NULL, "endTime" TIMESTAMP WITH TIME ZONE NOT NULL, "nodeGroupId" character varying NOT NULL, "tournamentId" uuid, CONSTRAINT "REL_07ac5186b55ebbc998b5e95e14" UNIQUE ("tournamentId"), CONSTRAINT "PK_c8244868552c4364a5264440a66" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "playoff" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tournamentId" uuid NOT NULL, "challongeTournamentId" character varying NOT NULL, "challongeUrl" character varying NOT NULL, "challongeEmbedUrl" character varying NOT NULL, "dotaPlayoffContainingNodeGroupId" character varying, CONSTRAINT "REL_3ca4da1280ecb0aaa89bf3ae80" UNIQUE ("tournamentId"), CONSTRAINT "PK_e2169a84dbb69b2269bad529a12" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "playoff_series" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "playoffId" uuid NOT NULL, "challongeMatchId" character varying NOT NULL, "bestOf" smallint NOT NULL, "isFinalSeries" boolean NOT NULL DEFAULT false, "finalType" character varying, "teamAId" uuid, "teamBId" uuid, "seriesWinnerId" uuid, "resolvedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_playoff_series_playoff_challonge" UNIQUE ("playoffId", "challongeMatchId"), CONSTRAINT "PK_c235f49c9047f816a2f8cd679b6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "playoff_match" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "playoffId" uuid NOT NULL, "seriesId" uuid, "gameNumber" smallint, "teamAId" uuid, "teamBId" uuid, "winnerId" uuid, "dotaMatchId" character varying, "challongeMatchId" character varying NOT NULL, "isVerified" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_3036aec9ed6905717a398114e15" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "playoff_league_fixture" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "playoffId" uuid NOT NULL, "challongeMatchId" character varying NOT NULL, "fixtureSlot" smallint NOT NULL DEFAULT '0', "dotaFixtureNodeGroupId" character varying NOT NULL, CONSTRAINT "UQ_playoff_league_fixture_playoff_mid_slot" UNIQUE ("playoffId", "challongeMatchId", "fixtureSlot"), CONSTRAINT "PK_a0e0541041db0530fa52bb538bd" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "team_main_players" ("teamId" uuid NOT NULL, "playerId" uuid NOT NULL, CONSTRAINT "PK_34ca75ae058057c29263fb676fd" PRIMARY KEY ("teamId", "playerId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d6b84a9db23bb43d120fed62a0" ON "team_main_players" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_844c892f1da645a9d18001fc5f" ON "team_main_players" ("playerId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "team_reserved_players" ("teamId" uuid NOT NULL, "playerId" uuid NOT NULL, CONSTRAINT "PK_1ddad880c144a35e627e1923845" PRIMARY KEY ("teamId", "playerId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6ed63b56a71a6d2ff154c087d6" ON "team_reserved_players" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3e81c16ec80ac9ce7fbe7e35f8" ON "team_reserved_players" ("playerId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "tournament_team" ("tournamentId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_f392ba6d30973c32ce1276f083c" PRIMARY KEY ("tournamentId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a57753f0e48a8681c0b2163ed1" ON "tournament_team" ("tournamentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e7ea12e2d49a7f5e6e1481429a" ON "tournament_team" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "tournament_allowed_roles" ("tournamentId" uuid NOT NULL, "roleId" uuid NOT NULL, CONSTRAINT "PK_627c121c434d4e931607f019e92" PRIMARY KEY ("tournamentId", "roleId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a06d129f3bf5315cacb537bedc" ON "tournament_allowed_roles" ("tournamentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8474dcf3526d3ed8a74a4d5958" ON "tournament_allowed_roles" ("roleId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "match" ADD CONSTRAINT "FK_ed5f9ae2f22492649e603c01e3c" FOREIGN KEY ("teamAId") REFERENCES "team"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "match" ADD CONSTRAINT "FK_954f8d7997e49ee77fb7bd84062" FOREIGN KEY ("teamBId") REFERENCES "team"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "match" ADD CONSTRAINT "FK_367ddf891f920aae1b667353193" FOREIGN KEY ("winnerId") REFERENCES "team"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "team" ADD CONSTRAINT "FK_f71181e2994176fd624db416c24" FOREIGN KEY ("captainId") REFERENCES "player"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "team" ADD CONSTRAINT "FK_4ec92b7a3b6eca6881a3f1b6341" FOREIGN KEY ("coachId") REFERENCES "player"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_roles" ADD CONSTRAINT "FK_7b441dd84e573c82a454851221e" FOREIGN KEY ("playerId") REFERENCES "player"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament_playoff_team" ADD CONSTRAINT "FK_958f6588ad1b14a6a5a7fe867fc" FOREIGN KEY ("tournamentId") REFERENCES "tournament"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament_playoff_team" ADD CONSTRAINT "FK_11f202f7082a88d6b2e83a184cb" FOREIGN KEY ("teamId") REFERENCES "team"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "player_tournament_points" ADD CONSTRAINT "FK_848cb8f189f6764218ea1f7613e" FOREIGN KEY ("playerId") REFERENCES "player"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "player_tournament_points" ADD CONSTRAINT "FK_aa5bdf8bf95835f569eb10b02f7" FOREIGN KEY ("tournamentId") REFERENCES "tournament"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_invite" ADD CONSTRAINT "FK_dec64033827ee287d0863a1b180" FOREIGN KEY ("teamId") REFERENCES "team"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_invite" ADD CONSTRAINT "FK_5efc64d67b9461380ec87e442d8" FOREIGN KEY ("createdById") REFERENCES "player"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "qualification_match" ADD CONSTRAINT "FK_222041b956acd68125f532e6ef7" FOREIGN KEY ("qualificationId") REFERENCES "qualification"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "qualification_match" ADD CONSTRAINT "FK_c067990bcfd92b21c0678495d01" FOREIGN KEY ("teamAId") REFERENCES "team"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "qualification_match" ADD CONSTRAINT "FK_0afbf748fa32e664e9be66bd9fb" FOREIGN KEY ("teamBId") REFERENCES "team"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "qualification_match" ADD CONSTRAINT "FK_9c448a2102caaa0b890119b6b99" FOREIGN KEY ("winnerId") REFERENCES "team"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "qualification" ADD CONSTRAINT "FK_07ac5186b55ebbc998b5e95e146" FOREIGN KEY ("tournamentId") REFERENCES "tournament"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "playoff" ADD CONSTRAINT "FK_3ca4da1280ecb0aaa89bf3ae80d" FOREIGN KEY ("tournamentId") REFERENCES "tournament"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "playoff_series" ADD CONSTRAINT "FK_bcf5c236653bf8b20c072482415" FOREIGN KEY ("playoffId") REFERENCES "playoff"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "playoff_series" ADD CONSTRAINT "FK_f27f2244fba0d9a4127cc98dfac" FOREIGN KEY ("teamAId") REFERENCES "team"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "playoff_series" ADD CONSTRAINT "FK_7e2190c99b512870ffad830c7b1" FOREIGN KEY ("teamBId") REFERENCES "team"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "playoff_series" ADD CONSTRAINT "FK_debf376783016bfb6e94795bd25" FOREIGN KEY ("seriesWinnerId") REFERENCES "team"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "playoff_match" ADD CONSTRAINT "FK_8df84ce405292065486681b23b0" FOREIGN KEY ("playoffId") REFERENCES "playoff"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "playoff_match" ADD CONSTRAINT "FK_e5e927f43dafe410d567db2ed03" FOREIGN KEY ("seriesId") REFERENCES "playoff_series"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "playoff_match" ADD CONSTRAINT "FK_1bdd9de5920baa7990490197eab" FOREIGN KEY ("teamAId") REFERENCES "team"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "playoff_match" ADD CONSTRAINT "FK_c4ae9aef131dc1cee829720159d" FOREIGN KEY ("teamBId") REFERENCES "team"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "playoff_match" ADD CONSTRAINT "FK_8d3dc4ae0cfa83d2c576440c1ef" FOREIGN KEY ("winnerId") REFERENCES "team"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "playoff_league_fixture" ADD CONSTRAINT "FK_fe3737a7d8c3da5b61927224928" FOREIGN KEY ("playoffId") REFERENCES "playoff"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_main_players" ADD CONSTRAINT "FK_d6b84a9db23bb43d120fed62a0e" FOREIGN KEY ("teamId") REFERENCES "team"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_main_players" ADD CONSTRAINT "FK_844c892f1da645a9d18001fc5fb" FOREIGN KEY ("playerId") REFERENCES "player"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_reserved_players" ADD CONSTRAINT "FK_6ed63b56a71a6d2ff154c087d6d" FOREIGN KEY ("teamId") REFERENCES "team"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_reserved_players" ADD CONSTRAINT "FK_3e81c16ec80ac9ce7fbe7e35f8e" FOREIGN KEY ("playerId") REFERENCES "player"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament_team" ADD CONSTRAINT "FK_a57753f0e48a8681c0b2163ed12" FOREIGN KEY ("tournamentId") REFERENCES "tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament_team" ADD CONSTRAINT "FK_e7ea12e2d49a7f5e6e1481429a1" FOREIGN KEY ("teamId") REFERENCES "team"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament_allowed_roles" ADD CONSTRAINT "FK_a06d129f3bf5315cacb537bedc3" FOREIGN KEY ("tournamentId") REFERENCES "tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament_allowed_roles" ADD CONSTRAINT "FK_8474dcf3526d3ed8a74a4d5958b" FOREIGN KEY ("roleId") REFERENCES "user_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tournament_allowed_roles" DROP CONSTRAINT "FK_8474dcf3526d3ed8a74a4d5958b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament_allowed_roles" DROP CONSTRAINT "FK_a06d129f3bf5315cacb537bedc3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament_team" DROP CONSTRAINT "FK_e7ea12e2d49a7f5e6e1481429a1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament_team" DROP CONSTRAINT "FK_a57753f0e48a8681c0b2163ed12"`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_reserved_players" DROP CONSTRAINT "FK_3e81c16ec80ac9ce7fbe7e35f8e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_reserved_players" DROP CONSTRAINT "FK_6ed63b56a71a6d2ff154c087d6d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_main_players" DROP CONSTRAINT "FK_844c892f1da645a9d18001fc5fb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_main_players" DROP CONSTRAINT "FK_d6b84a9db23bb43d120fed62a0e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "playoff_league_fixture" DROP CONSTRAINT "FK_fe3737a7d8c3da5b61927224928"`,
    );
    await queryRunner.query(
      `ALTER TABLE "playoff_match" DROP CONSTRAINT "FK_8d3dc4ae0cfa83d2c576440c1ef"`,
    );
    await queryRunner.query(
      `ALTER TABLE "playoff_match" DROP CONSTRAINT "FK_c4ae9aef131dc1cee829720159d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "playoff_match" DROP CONSTRAINT "FK_1bdd9de5920baa7990490197eab"`,
    );
    await queryRunner.query(
      `ALTER TABLE "playoff_match" DROP CONSTRAINT "FK_e5e927f43dafe410d567db2ed03"`,
    );
    await queryRunner.query(
      `ALTER TABLE "playoff_match" DROP CONSTRAINT "FK_8df84ce405292065486681b23b0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "playoff_series" DROP CONSTRAINT "FK_debf376783016bfb6e94795bd25"`,
    );
    await queryRunner.query(
      `ALTER TABLE "playoff_series" DROP CONSTRAINT "FK_7e2190c99b512870ffad830c7b1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "playoff_series" DROP CONSTRAINT "FK_f27f2244fba0d9a4127cc98dfac"`,
    );
    await queryRunner.query(
      `ALTER TABLE "playoff_series" DROP CONSTRAINT "FK_bcf5c236653bf8b20c072482415"`,
    );
    await queryRunner.query(
      `ALTER TABLE "playoff" DROP CONSTRAINT "FK_3ca4da1280ecb0aaa89bf3ae80d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "qualification" DROP CONSTRAINT "FK_07ac5186b55ebbc998b5e95e146"`,
    );
    await queryRunner.query(
      `ALTER TABLE "qualification_match" DROP CONSTRAINT "FK_9c448a2102caaa0b890119b6b99"`,
    );
    await queryRunner.query(
      `ALTER TABLE "qualification_match" DROP CONSTRAINT "FK_0afbf748fa32e664e9be66bd9fb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "qualification_match" DROP CONSTRAINT "FK_c067990bcfd92b21c0678495d01"`,
    );
    await queryRunner.query(
      `ALTER TABLE "qualification_match" DROP CONSTRAINT "FK_222041b956acd68125f532e6ef7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_invite" DROP CONSTRAINT "FK_5efc64d67b9461380ec87e442d8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_invite" DROP CONSTRAINT "FK_dec64033827ee287d0863a1b180"`,
    );
    await queryRunner.query(
      `ALTER TABLE "player_tournament_points" DROP CONSTRAINT "FK_aa5bdf8bf95835f569eb10b02f7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "player_tournament_points" DROP CONSTRAINT "FK_848cb8f189f6764218ea1f7613e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament_playoff_team" DROP CONSTRAINT "FK_11f202f7082a88d6b2e83a184cb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament_playoff_team" DROP CONSTRAINT "FK_958f6588ad1b14a6a5a7fe867fc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_roles" DROP CONSTRAINT "FK_7b441dd84e573c82a454851221e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "team" DROP CONSTRAINT "FK_4ec92b7a3b6eca6881a3f1b6341"`,
    );
    await queryRunner.query(
      `ALTER TABLE "team" DROP CONSTRAINT "FK_f71181e2994176fd624db416c24"`,
    );
    await queryRunner.query(
      `ALTER TABLE "match" DROP CONSTRAINT "FK_367ddf891f920aae1b667353193"`,
    );
    await queryRunner.query(
      `ALTER TABLE "match" DROP CONSTRAINT "FK_954f8d7997e49ee77fb7bd84062"`,
    );
    await queryRunner.query(
      `ALTER TABLE "match" DROP CONSTRAINT "FK_ed5f9ae2f22492649e603c01e3c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8474dcf3526d3ed8a74a4d5958"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a06d129f3bf5315cacb537bedc"`,
    );
    await queryRunner.query(`DROP TABLE "tournament_allowed_roles"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e7ea12e2d49a7f5e6e1481429a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a57753f0e48a8681c0b2163ed1"`,
    );
    await queryRunner.query(`DROP TABLE "tournament_team"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3e81c16ec80ac9ce7fbe7e35f8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6ed63b56a71a6d2ff154c087d6"`,
    );
    await queryRunner.query(`DROP TABLE "team_reserved_players"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_844c892f1da645a9d18001fc5f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d6b84a9db23bb43d120fed62a0"`,
    );
    await queryRunner.query(`DROP TABLE "team_main_players"`);
    await queryRunner.query(`DROP TABLE "playoff_league_fixture"`);
    await queryRunner.query(`DROP TABLE "playoff_match"`);
    await queryRunner.query(`DROP TABLE "playoff_series"`);
    await queryRunner.query(`DROP TABLE "playoff"`);
    await queryRunner.query(`DROP TABLE "qualification"`);
    await queryRunner.query(`DROP TABLE "qualification_match"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_254b336a9b26140fd99c24fbc2"`,
    );
    await queryRunner.query(`DROP TABLE "team_invite"`);
    await queryRunner.query(`DROP TABLE "player_tournament_points"`);
    await queryRunner.query(`DROP TABLE "tournament_playoff_team"`);
    await queryRunner.query(`DROP TABLE "user_roles"`);
    await queryRunner.query(`DROP TABLE "tournament"`);
    await queryRunner.query(
      `DROP TYPE "public"."tournament_tournamentstatus_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."tournament_division_enum"`);
    await queryRunner.query(`DROP TABLE "team"`);
    await queryRunner.query(`DROP TABLE "match"`);
    await queryRunner.query(`DROP TABLE "player"`);
  }
}
