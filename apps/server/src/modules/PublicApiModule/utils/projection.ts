import { getActiveDatasetSource } from '../../../core/utils/active-dataset';
import { EnChange } from '../../EnModule/entities/en_change.entity';
import { EnWord } from '../../EnModule/entities/en_word.entity';
import { EnMeaning } from '../../EnModule/entities/en_meaning.entity';
import { EnMeaningTranslation } from '../../EnModule/entities/en_meaning_translation.entity';
import { EnShortTranslation } from '../../EnModule/entities/en_short_translation.entity';
import { normalizeWordLinks } from '../../EnModule/utils/normalizeWordLinks';
import {
  PublicChangeV1T,
  AvailableTranslationLanguagesE,
  EnAreaVariantsE,
  PublicSearchWordV1T,
  PublicWordV1FormT,
  PublicWordV1MeaningT,
  PublicWordV1MeaningTranslationT,
  PublicWordV1ShortTranslationT,
  PublicWordV1T,
} from '../../../../types';

/**
 * The public projection of the dictionary rows (issue #392): every field of
 * `types/public/v1` is assigned by name, nothing is spread from an entity,
 * so the answer of `/api/v1` is exactly what the contract lists — a column
 * added to `EnWord` stays internal until it is added here and there on
 * purpose. Relation rows are mapped in the order they arrive; the callers
 * sort them (PublicWordsService.sortRelations).
 */

export const toPublicShortTranslation = (row: EnShortTranslation): PublicWordV1ShortTranslationT => ({
  id: row.id,
  language: row.language,
  description: row.description,
  variants_of_words: row.variants_of_words ?? [],
});

export const toPublicMeaningTranslation = (row: EnMeaningTranslation): PublicWordV1MeaningTranslationT => ({
  id: row.id,
  language: row.language,
  title: row.title,
  definition: row.definition,
  variants_of_words: row.variants_of_words ?? [],
});

export type PublicTranslationFilterT = {
  // keep only these translation languages; undefined or empty means all
  translation_languages?: AvailableTranslationLanguagesE[] | undefined;
};

const matchesLanguage = (language: AvailableTranslationLanguagesE, filter: PublicTranslationFilterT): boolean =>
  !filter.translation_languages?.length || filter.translation_languages.includes(language);

export const toPublicMeaning = (
  row: EnMeaning,
  filter: PublicTranslationFilterT = {},
): PublicWordV1MeaningT => ({
  id: row.id,
  sort_order: row.sort_order,
  title: row.title,
  definition: row.definition,
  is_obsolete: row.is_obsolete ?? false,
  examples: row.examples ?? [],
  categories: row.categories ?? [],
  meaning_level: row.meaning_level ?? null,
  area_variant: row.area_variant ?? EnAreaVariantsE.common,
  language_register: row.language_register ?? null,
  translations: (row.translations ?? [])
    .filter((t) => matchesLanguage(t.language, filter))
    .map(toPublicMeaningTranslation),
  synonyms: normalizeWordLinks(row.synonyms?.map((entry) => entry.word)),
  antonyms: normalizeWordLinks(row.antonyms?.map((entry) => entry.word)),
});

export const toPublicForm = (row: EnWord): PublicWordV1FormT => ({
  id: row.id,
  word: row.word.word,
  form_of_word: row.form_of_word,
  // the column is nullable, the contract is not: an unmarked form is common
  area_variant: row.area_variant ?? EnAreaVariantsE.common,
  transcription: row.transcription ?? null,
});

export type PublicSearchWordOptionsT = {
  similarity?: number | undefined;
  // the source of the dataset the row was read from; the active one's when absent
  source?: string | undefined;
  // the entry has edits that still show in what is served (WordRowsService.modifiedArticles)
  modified?: boolean | undefined;
};

/**
 * The flat search item: the entry, its grammar and its forms, with where it
 * comes from (issue #527) and whether it was changed on the instance (issue
 * #531) — what every answer that carries an entry says of it
 */
export const toPublicSearchWord = (
  row: EnWord,
  { similarity, source, modified }: PublicSearchWordOptionsT = {},
): PublicSearchWordV1T => ({
  id: row.id,
  word: row.word.word,
  part_of_speech: row.part_of_speech,
  form_of_word: row.form_of_word,
  is_obsolete: row.is_obsolete ?? false,
  is_abbreviation: row.is_abbreviation ?? false,
  word_level: row.word_level ?? null,
  area_variant: row.area_variant ?? null,
  categories: row.categories ?? [],
  language_register: row.language_register ?? null,
  description: row.description ?? null,
  transcription: row.transcription ?? null,
  pattern: row.pattern ?? null,
  noun___irregular_plural: row.noun___irregular_plural ?? null,
  noun___uncountable: row.noun___uncountable ?? null,
  noun___is_proper: row.noun___is_proper ?? null,
  noun___always_plural: row.noun___always_plural ?? null,
  verb___is_irregular: row.verb___is_irregular ?? null,
  verb___transitivity: row.verb___transitivity ?? null,
  verb___is_phrasal: row.verb___is_phrasal ?? null,
  verb___phrasal_object_pattern: row.verb___phrasal_object_pattern ?? null,
  base_phrasal: row.base_phrasal?.word?.word ?? null,
  forms: (row.forms ?? []).map(toPublicForm),
  ...(similarity !== undefined && { similarity }),
  source: source ?? getActiveDatasetSource(),
  modified: modified ?? false,
});

export type PublicWordOptionsT = PublicTranslationFilterT &
  PublicSearchWordOptionsT & {
    // map the meanings / short translations (the relation must be loaded);
    // an unrequested join answers an empty list
    with_meanings?: boolean;
    with_translations?: boolean;
    // the phrasal variants were loaded: list them (absent otherwise)
    with_phrasal_variants?: boolean;
  };

/** The full entry: the search item plus meanings, short translations and, when loaded, phrasal variants */
export const toPublicWord = (row: EnWord, options: PublicWordOptionsT = {}): PublicWordV1T => ({
  ...toPublicSearchWord(row, options),
  meanings: options.with_meanings ? (row.meanings ?? []).map((m) => toPublicMeaning(m, options)) : [],
  short_translations: options.with_translations
    ? (row.short_translations ?? [])
        .filter((t) => matchesLanguage(t.language, options))
        .map(toPublicShortTranslation)
    : [],
  ...(options.with_phrasal_variants && {
    phrasal_variants: (row.phrasal_variants ?? []).map((variant) => variant.word.word),
  }),
});

// the editorial state of the instance stays on the admin API, in the history too
const EDITORIAL_FIELDS = new Set(['generated', 'generated_by_model', 'version']);

/**
 * One edit as a reader is shown it (issue #531): no ids — they differ
 * between instances — and nothing of the editorial state
 */
export const toPublicChange = (row: EnChange, source?: string): PublicChangeV1T => ({
  created_at: new Date(row.created_at).toISOString(),
  word: row.headword,
  part_of_speech: row.part_of_speech,
  entity: row.entity,
  action: row.action,
  record: row.record,
  diff: Object.fromEntries(Object.entries(row.diff).filter(([field]) => !EDITORIAL_FIELDS.has(field))),
  origin: row.origin,
  author: row.author,
  // the dataset the edit was read from; the active one when none is named
  source: source ?? getActiveDatasetSource(),
});
