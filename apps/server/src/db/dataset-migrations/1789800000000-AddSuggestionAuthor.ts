import { MigrationInterface, QueryRunner } from 'typeorm';

// The name a sender of a correction asks to be credited by (issue #531), kept
// with their consent. The queue of suggestions is a table of every dataset.
export class AddSuggestionAuthor1789800000000 implements MigrationInterface {
  name = 'AddSuggestionAuthor1789800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "suggestions" ADD "author_name" character varying(128)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "suggestions" DROP COLUMN "author_name"`);
  }
}
