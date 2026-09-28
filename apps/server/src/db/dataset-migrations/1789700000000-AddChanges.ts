import { MigrationInterface, QueryRunner } from 'typeorm';

// The history of the edits of a dataset (issue #531): a table in every
// dataset schema. It starts empty: a dataset is taken to be what its source
// published, and the history holds what is changed from here on. Nothing is
// guessed about the entries edited before — `user_modified` says that an
// entry is kept through an update, not what differs in it.
export class AddChanges1789700000000 implements MigrationInterface {
  name = 'AddChanges1789700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "en_changes" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "headword" character varying(128) NOT NULL, "part_of_speech" character varying(32), "entity" character varying(32) NOT NULL, "action" character varying(16) NOT NULL, "record" jsonb, "diff" jsonb, "origin" character varying(16) NOT NULL, "suggestion_id" integer, "author" character varying(128), "superseded_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_en_changes" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_EN_CHANGES_HEADWORD" ON "en_changes" ("headword")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_EN_CHANGES_HEADWORD"`);
    await queryRunner.query(`DROP TABLE "en_changes"`);
  }
}
