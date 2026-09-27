import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The dictionary tables of one dataset (issue #527): what the shared
 * migrations built in `public` up to AddArabicTranslationLanguage, written
 * without a schema so it lands in the schema the connection's search_path
 * names first. The enum types are the ones of `public` — one vocabulary of
 * parts of speech, levels and languages for every dataset of the instance,
 * so a new translation language is one ALTER TYPE, not one per dataset.
 *
 * `public` itself never runs this: its tables exist, and the shared
 * migration that introduced the datasets marked it as applied there.
 */
export class DatasetBaseline1789500000000 implements MigrationInterface {
  name = 'DatasetBaseline1789500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "en_entries" ("createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updateAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "word" character varying(128) NOT NULL, "type" "public"."en_entries_type_enum" NOT NULL DEFAULT 'word', "user_modified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_en_entries" PRIMARY KEY ("word"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_EN_ENTRY_TYPE" ON "en_entries" ("type")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_EN_ENTRY_WORD_LOWER_C" ON "en_entries" ((LOWER("word") COLLATE "C"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_EN_ENTRY_WORD_TRGM" ON "en_entries" USING GIN ("word" gin_trgm_ops)`,
    );

    await queryRunner.query(
      `CREATE TABLE "en_words" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updateAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "generated" boolean NOT NULL DEFAULT true, "generated_by_model" text, "is_obsolete" boolean NOT NULL DEFAULT false, "is_abbreviation" boolean NOT NULL DEFAULT false, "word_level" "public"."en_words_word_level_enum", "area_variant" "public"."en_words_area_variant_enum", "categories" "public"."en_words_categories_enum" array NOT NULL DEFAULT '{}', "language_register" "public"."en_words_language_register_enum", "part_of_speech" "public"."en_words_part_of_speech_enum" NOT NULL, "form_of_word" "public"."en_words_form_of_word_enum" NOT NULL, "description" text, "transcription" text, "pattern" text, "noun___irregular_plural" boolean, "noun___uncountable" boolean, "noun___is_proper" boolean, "noun___always_plural" boolean, "verb___is_irregular" boolean, "verb___transitivity" "public"."en_words_verb___transitivity_enum", "verb___is_phrasal" boolean, "verb___phrasal_object_pattern" "public"."en_words_verb___phrasal_object_pattern_enum", "version" text NOT NULL DEFAULT '0.0.1', "word" character varying(128), "baseFormId" integer, "basePhrasalId" integer, CONSTRAINT "PK_en_words" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_EN_WORD" ON "en_words" ("word")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_EN_WORD_LOOKUP" ON "en_words" ("word", "part_of_speech", "form_of_word")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_EN_WORD_LOWER_C" ON "en_words" ((LOWER("word") COLLATE "C"), "id")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_EN_BASE_FORM" ON "en_words" ("baseFormId")`);
    await queryRunner.query(`CREATE INDEX "IDX_EN_BASE_PHRASAL" ON "en_words" ("basePhrasalId")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_EN_PHRASAL_SEARCH" ON "en_words" ("basePhrasalId", "part_of_speech", "form_of_word")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_EN_PART_OF_SPEECH" ON "en_words" ("part_of_speech")`);
    await queryRunner.query(`CREATE INDEX "IDX_EN_FORM_OF_WORD" ON "en_words" ("form_of_word")`);
    await queryRunner.query(`CREATE INDEX "IDX_EN_WORD_LEVEL" ON "en_words" ("word_level")`);
    await queryRunner.query(`CREATE INDEX "IDX_EN_AREA_VARIANT" ON "en_words" ("area_variant")`);
    await queryRunner.query(`CREATE INDEX "IDX_EN_LANGUAGE_REGISTER" ON "en_words" ("language_register")`);
    await queryRunner.query(`CREATE INDEX "IDX_EN_CATEGORIES" ON "en_words" USING GIN ("categories")`);

    await queryRunner.query(
      `CREATE TABLE "en_meanings" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updateAt" TIMESTAMP NOT NULL DEFAULT now(), "categories" "public"."en_meanings_categories_enum" array NOT NULL DEFAULT '{}', "meaning_level" "public"."en_meanings_meaning_level_enum", "area_variant" "public"."en_meanings_area_variant_enum" NOT NULL DEFAULT 'common', "language_register" "public"."en_meanings_language_register_enum", "sort_order" integer NOT NULL, "title" text NOT NULL, "definition" text NOT NULL, "is_obsolete" boolean NOT NULL DEFAULT false, "examples" text array, "word" integer, CONSTRAINT "PK_en_meanings" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_EN_MEANING_WORD" ON "en_meanings" ("word")`);
    await queryRunner.query(`CREATE INDEX "IDX_EN_MEANING_WORD_SORT" ON "en_meanings" ("word", "sort_order")`);

    await queryRunner.query(
      `CREATE TABLE "en_meanings_translations" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updateAt" TIMESTAMP NOT NULL DEFAULT now(), "language" "public"."en_meanings_translations_language_enum" NOT NULL, "title" text NOT NULL, "definition" text NOT NULL, "variants_of_words" text array NOT NULL DEFAULT '{}', "meaning" integer, CONSTRAINT "PK_en_meanings_translations" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_EN_MEANING_TRANSLATION_LANGUAGE" ON "en_meanings_translations" ("language")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_EN_MEANING_TRANSLATION_MEANING" ON "en_meanings_translations" ("meaning")`,
    );

    await queryRunner.query(
      `CREATE TABLE "en_short_translations" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updateAt" TIMESTAMP NOT NULL DEFAULT now(), "description" text NOT NULL, "language" "public"."en_short_translations_language_enum" NOT NULL, "variants_of_words" text array NOT NULL DEFAULT '{}', "word" integer, CONSTRAINT "PK_en_short_translations" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_EN_SHORT_TRANSLATION_LANGUAGE" ON "en_short_translations" ("language")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_EN_SHORT_TRANSLATION_WORD" ON "en_short_translations" ("word")`);

    await queryRunner.query(
      `CREATE TABLE "en_meaning_synonyms" ("meaning_id" integer NOT NULL, "word" character varying(128) NOT NULL, CONSTRAINT "PK_en_meaning_synonyms" PRIMARY KEY ("meaning_id", "word"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_EN_MEANING_SYNONYM_MEANING" ON "en_meaning_synonyms" ("meaning_id")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_EN_MEANING_SYNONYM_WORD" ON "en_meaning_synonyms" ("word")`);
    await queryRunner.query(
      `CREATE TABLE "en_meaning_antonyms" ("meaning_id" integer NOT NULL, "word" character varying(128) NOT NULL, CONSTRAINT "PK_en_meaning_antonyms" PRIMARY KEY ("meaning_id", "word"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_EN_MEANING_ANTONYM_MEANING" ON "en_meaning_antonyms" ("meaning_id")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_EN_MEANING_ANTONYM_WORD" ON "en_meaning_antonyms" ("word")`);

    // reader feedback belongs to the dataset it is about: its word_id points
    // at this schema's en_words, and it goes when the dataset is dropped
    await queryRunner.query(
      `CREATE TABLE "suggestions" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "headword" character varying(128) NOT NULL, "word_id" integer, "message" text NOT NULL, "dataset_version" character varying(64), "status" character varying NOT NULL DEFAULT 'new', "kind" character varying NOT NULL DEFAULT 'report', "edits" jsonb, CONSTRAINT "PK_suggestions" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_SUGGESTION_HEADWORD" ON "suggestions" ("headword")`);
    await queryRunner.query(`CREATE INDEX "IDX_SUGGESTION_STATUS" ON "suggestions" ("status")`);

    await queryRunner.query(
      `ALTER TABLE "en_words" ADD CONSTRAINT "FK_en_words_entry" FOREIGN KEY ("word") REFERENCES "en_entries"("word") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "en_words" ADD CONSTRAINT "FK_en_words_base_form" FOREIGN KEY ("baseFormId") REFERENCES "en_words"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "en_words" ADD CONSTRAINT "FK_en_words_base_phrasal" FOREIGN KEY ("basePhrasalId") REFERENCES "en_words"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "en_meanings" ADD CONSTRAINT "FK_en_meanings_word" FOREIGN KEY ("word") REFERENCES "en_words"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "en_meanings_translations" ADD CONSTRAINT "FK_en_meanings_translations_meaning" FOREIGN KEY ("meaning") REFERENCES "en_meanings"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "en_short_translations" ADD CONSTRAINT "FK_en_short_translations_word" FOREIGN KEY ("word") REFERENCES "en_words"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "en_meaning_synonyms" ADD CONSTRAINT "FK_en_meaning_synonyms_meaning" FOREIGN KEY ("meaning_id") REFERENCES "en_meanings"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "en_meaning_synonyms" ADD CONSTRAINT "FK_en_meaning_synonyms_word" FOREIGN KEY ("word") REFERENCES "en_entries"("word") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "en_meaning_antonyms" ADD CONSTRAINT "FK_en_meaning_antonyms_meaning" FOREIGN KEY ("meaning_id") REFERENCES "en_meanings"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "en_meaning_antonyms" ADD CONSTRAINT "FK_en_meaning_antonyms_word" FOREIGN KEY ("word") REFERENCES "en_entries"("word") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "suggestions" ADD CONSTRAINT "FK_suggestions_word" FOREIGN KEY ("word_id") REFERENCES "en_words"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'suggestions',
      'en_meaning_antonyms',
      'en_meaning_synonyms',
      'en_short_translations',
      'en_meanings_translations',
      'en_meanings',
      'en_words',
      'en_entries',
    ]) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
  }
}
