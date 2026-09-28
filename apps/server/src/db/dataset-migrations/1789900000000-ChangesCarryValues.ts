import { MigrationInterface, QueryRunner } from 'typeorm';

// A row of the history is an edit with its values (issue #531). The builds
// that came before this migration wrote a row without values for every entry
// flagged `user_modified`, as a guess that it differs from its source; a
// dataset is taken to be clean until an edit is recorded, so those rows go,
// and the column says that a row without values cannot be.
export class ChangesCarryValues1789900000000 implements MigrationInterface {
  name = 'ChangesCarryValues1789900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "en_changes" WHERE "diff" IS NULL`);
    await queryRunner.query(`ALTER TABLE "en_changes" ALTER COLUMN "diff" SET NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "en_changes" ALTER COLUMN "diff" DROP NOT NULL`);
  }
}
