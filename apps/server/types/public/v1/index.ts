import type {
  EnAreaVariantsE,
  EnPartOfSpeechE,
  EnPhrasalObjectPatternE,
  EnVerbTransitivityE,
  EnWordFormsE,
} from '../../dictionaries/en';
import type {
  AvailableTranslationLanguagesE,
  CategoryE,
  LanguageRegisterE,
  WordLevelE,
} from '../../dictionaries';
import type { ErrorResT } from '../../errors';
import type { ChangeActionE, ChangeDiffT, ChangeEntityE, ChangeOriginE, ChangeRecordT } from '../../changes';

/**
 * Contract of the public read-only API, `/api/v1` (issues #271, #272). The
 * shapes here are what consuming applications rely on: they change only with
 * a new version prefix. Errors reuse ErrorResT (`{ statusCode, message,
 * error: true }`), every response carries `X-API-Version: 1`.
 */
export const PUBLIC_API_V1_VERSION = '1';

// Every successful answer is an envelope: the payload under `data`, paging
// and counts under `meta`. Single resources travel as `{ data }` alone
export type PublicItemResT<TItem> = { data: TItem };
export type PublicListResT<TItem, TMeta> = { data: TItem[]; meta: TMeta };

// `fuzzy`: the exact tiers found nothing and the items come from the trigram
// similarity tier (Postgres instances only, issue #278); every item then
// carries `similarity` (0–1) — the "did you mean" signal.
// `short_term`: the term has fewer than 3 characters, so only the exact and
// prefix tiers were searched (issue #292)
export type PublicSearchV1MetaT = {
  /** @asType integer */
  count: number;
  fuzzy: boolean;
  short_term: boolean;
};
export type PublicSearchV1ResT = PublicListResT<PublicSearchWordV1T, PublicSearchV1MetaT>;

export type PublicSearchDetailedV1MetaT = {
  /** @asType integer */
  page: number;
  /** @asType integer */
  limit: number;
  has_more: boolean;
  fuzzy: boolean;
  short_term: boolean;
};
export type PublicSearchDetailedV1ResT = PublicListResT<PublicWordV1T, PublicSearchDetailedV1MetaT>;

// ------------------------------------------------------------ words (#272)

// The projection of a dictionary entry the public API promises (issue #392):
// every field is listed here on purpose and mapped by name in
// PublicApiModule/utils/projection.ts — nothing is spread from the database
// row, so a column added to the entity does not become a public promise by
// accident. The instance's editorial state (`generated`, `generated_by_model`,
// `version`, `user_modified`) stays on the admin API.

export type PublicWordV1ShortTranslationT = {
  /** @asType integer */
  id: number;
  language: AvailableTranslationLanguagesE;
  description: string;
  variants_of_words: string[];
};

export type PublicWordV1MeaningTranslationT = {
  /** @asType integer */
  id: number;
  language: AvailableTranslationLanguagesE;
  title: string;
  definition: string;
  variants_of_words: string[];
};

// `synonyms` and `antonyms` are the linked headwords (sorted, lowercase)
export type PublicWordV1MeaningT = {
  /** @asType integer */
  id: number;
  /** @asType integer */
  sort_order: number;
  title: string;
  definition: string;
  is_obsolete: boolean;
  examples: string[];
  categories: CategoryE[];
  meaning_level: WordLevelE | null;
  area_variant: EnAreaVariantsE;
  language_register: LanguageRegisterE | null;
  translations: PublicWordV1MeaningTranslationT[];
  synonyms: string[];
  antonyms: string[];
};

// An inflected form of an entry ("ran" of the verb "run")
export type PublicWordV1FormT = {
  /** @asType integer */
  id: number;
  word: string;
  form_of_word: EnWordFormsE;
  area_variant: EnAreaVariantsE;
  transcription: string | null;
};

// An entry as the flat search answers it: the word itself, its grammar and
// its forms — no meanings, no translations (the detailed search, the
// headword and id reads carry those)
export type PublicSearchWordV1T = {
  /** @asType integer */
  id: number;
  word: string;
  part_of_speech: EnPartOfSpeechE;
  form_of_word: EnWordFormsE;
  is_obsolete: boolean;
  is_abbreviation: boolean;
  word_level: WordLevelE | null;
  area_variant: EnAreaVariantsE | null;
  categories: CategoryE[];
  language_register: LanguageRegisterE | null;
  description: string | null;
  transcription: string | null;
  // grammar patterns the entry is used in
  pattern: string[] | null;
  noun___irregular_plural: boolean | null;
  noun___uncountable: boolean | null;
  noun___is_proper: boolean | null;
  noun___always_plural: boolean | null;
  verb___is_irregular: boolean | null;
  verb___transitivity: EnVerbTransitivityE | null;
  verb___is_phrasal: boolean | null;
  verb___phrasal_object_pattern: EnPhrasalObjectPatternE | null;
  // the headword of the base verb of a phrasal variant ("give" for "give up")
  base_phrasal: string | null;
  forms: PublicWordV1FormT[];
  // Trigram similarity (0–1) to the search term, present only on the items
  // of a fuzzy search answer (issue #278): the "did you mean" signal
  similarity?: number;
  // where the entry comes from (issue #527): the source of the dataset the
  // instance serves — `vocab-bloom-hub` for the project's own, `wiktionary`,
  // `wordnet`, … for one converted from a public source. The terms of that
  // source are in GET /api/v1/meta. Every answer that carries an entry, a
  // part of one or an edit of one names it. Always sent since 1.1; optional
  // in the contract so a client built on it still reads an instance of 1.0
  source?: string;
  // whether the entry was changed or added on this instance (issue #531): it
  // is not, or not only, what its source says. The licenses of the datasets
  // ask that a reader is told, so every answer that carries an entry carries
  // the mark; what was changed is the history of the headword
  // (/words/{word}/history). Always sent since 1.1; optional in the contract
  // so a client built on it still reads an instance of 1.0
  modified?: boolean;
};

// One dictionary entry with everything attached: forms, meanings (with their
// translations, synonyms and antonyms) and short translations. The detailed
// search joins meanings and short translations on request only (empty lists
// otherwise); `phrasal_variants` (the phrasal verbs built on this base verb)
// is present on the headword, id, batch and random reads
export type PublicWordV1T = PublicSearchWordV1T & {
  meanings: PublicWordV1MeaningT[];
  short_translations: PublicWordV1ShortTranslationT[];
  phrasal_variants?: string[];
};
export type PublicWordV1ResT = PublicItemResT<PublicWordV1T>;

// Every headword lookup answers for one spelling; `count` is the number of
// entries (parts of speech) found for it. The match does not depend on the
// case of the letters, unless the dictionary holds spellings that differ by
// it — "Test" and "test" in a dataset of a public source: they are words of
// their own, a request that spells one of them exactly is answered with that
// one and `word` keeps its case. `variants` lists the other spellings, each
// readable through /words/{word}; a request that spells none of them exactly
// ("TEST") is answered with the entries of all, `word` in lower case and
// every spelling in `variants`. Empty where the dictionary holds one
// spelling. Optional in the contract: a server of 1.0 does not send it
export type PublicHeadwordV1MetaT = {
  word: string;
  /** @asType integer */
  count: number;
  variants?: string[];
};
export type PublicHeadwordV1ResT = PublicListResT<PublicWordV1T, PublicHeadwordV1MetaT>;

// The partial reads flatten the entries of a headword into one list; every
// item names the entry it belongs to (`word_id`, `part_of_speech`)
export type PublicEntryRefV1T = {
  /** @asType integer */
  word_id: number;
  part_of_speech: EnPartOfSpeechE;
  // where that entry comes from, as `source` of the entry itself says (issue
  // #527): a part of an entry is attributed like the whole. Optional in the
  // contract
  source?: string;
  // whether that entry was changed or added on this instance (issue #531),
  // as `modified` of the entry itself says: a part of an entry is served
  // with the same indication as the whole. Optional in the contract
  modified?: boolean;
};

export type PublicMeaningV1T = PublicWordV1MeaningT & PublicEntryRefV1T;
export type PublicHeadwordMeaningsV1ResT = PublicListResT<PublicMeaningV1T, PublicHeadwordV1MetaT>;

export type PublicWordFormV1T = PublicWordV1FormT & PublicEntryRefV1T;
export type PublicHeadwordFormsV1ResT = PublicListResT<PublicWordFormV1T, PublicHeadwordV1MetaT>;

export type PublicShortTranslationV1T = PublicWordV1ShortTranslationT & PublicEntryRefV1T;
export type PublicMeaningTranslationV1T = PublicWordV1MeaningTranslationT &
  PublicEntryRefV1T & {
    /** @asType integer */
    meaning_id: number;
  };
// The thesaurus reads (issue #403): every synonym / antonym of a headword,
// one item per linked headword and meaning, in the order of the entries and
// their meanings
export type PublicWordLinkV1T = PublicEntryRefV1T & {
  /** @asType integer */
  meaning_id: number;
  // the linked headword (lowercase), readable through /words/{word}
  word: string;
};
export type PublicHeadwordLinksV1ResT = PublicListResT<PublicWordLinkV1T, PublicHeadwordV1MetaT>;

// The history of a headword (issue #531): what was changed or added on the
// instance and still shows in what is served, the latest first — the
// indication of modifications the licenses of the datasets ask for. An
// edit an update of the dataset replaced, or one that was taken back, is
// not listed. Records are named by what they say, not by ids: `record` is
// null for the entry itself, otherwise the form, the meaning or the
// translation the edit is about. `diff` holds the values before and after,
// per field. The editorial state of the instance is left out of it.
// `author` names the reader whose correction was applied, when they asked
// to be named
export type PublicChangeV1T = {
  created_at: string;
  // the spelling of the entry the edit belongs to, as `word` of the entry
  // says it: with `part_of_speech` it names the entry among the ones a
  // headword read answers
  word: string;
  part_of_speech: string | null;
  entity: ChangeEntityE;
  action: ChangeActionE;
  record: ChangeRecordT | null;
  diff: ChangeDiffT;
  origin: ChangeOriginE;
  author: string | null;
  // the source of the dataset the edit was made in: what the changed entry
  // is attributed to, next to the owner of the instance. Optional in the
  // contract like `source` of a word
  source?: string;
};
// `count` is the number of changes listed; `word` and `variants` as a headword read answers them
export type PublicHeadwordHistoryV1MetaT = {
  word: string;
  /** @asType integer */
  count: number;
  variants?: string[];
};
export type PublicHeadwordHistoryV1ResT = PublicListResT<PublicChangeV1T, PublicHeadwordHistoryV1MetaT>;

export type PublicHeadwordTranslationsV1T = {
  short_translations: PublicShortTranslationV1T[];
  meaning_translations: PublicMeaningTranslationV1T[];
};
export type PublicHeadwordTranslationsV1ResT = PublicItemResT<PublicHeadwordTranslationsV1T> & {
  meta: PublicHeadwordV1MetaT;
};

// Batch lookup (issue #397): one item per requested spelling that names
// entries, in request order (duplicates and case collapse); `word` is the
// normalized spelling as `meta.word` of the single lookup, `entries` what
// GET /words/{word} would answer. Spellings with no entry are listed in
// `meta.not_found` instead of failing the request
export type PublicWordsBatchItemV1T = {
  word: string;
  /** @asType integer */
  count: number;
  entries: PublicWordV1T[];
};
export type PublicWordsBatchV1MetaT = {
  /** @asType integer */
  count: number;
  not_found: string[];
};
export type PublicWordsBatchV1ResT = PublicListResT<PublicWordsBatchItemV1T, PublicWordsBatchV1MetaT>;

// Cursor pagination: `next_cursor` is an opaque token to pass back as
// `?cursor=`; null on the last page. Items are ordered by (word, id)
export type PublicWordsV1MetaT = {
  /** @asType integer */
  limit: number;
  has_more: boolean;
  next_cursor: string | null;
};
export type PublicWordsV1ResT = PublicListResT<PublicWordV1T, PublicWordsV1MetaT>;

// ------------------------------------------------------------- meta (#272)

export type PublicDatasetCountsV1T = {
  /** @asType integer */
  entries: number;
  /** @asType integer */
  words: number;
  /** @asType integer */
  phrases: number;
  /** @asType integer */
  grammar_patterns: number;
  /** @asType integer */
  word_forms: number;
  /** @asType integer */
  meanings: number;
  /** @asType integer */
  meaning_translations: number;
  /** @asType integer */
  short_translations: number;
};

export type PublicMetaV1T = {
  api_version: string;
  // version of the server (package.json)
  app_version: string;
  // version of the dataset the dictionary was last imported from; null when
  // the data was authored in place or imported from a dataset without a manifest
  dataset_version: string | null;
  // the dictionary data license (issue #270): SPDX identifier, its text, and
  // the attribution line a consumer has to show
  license: string;
  license_url: string;
  attribution: string;
  // the provenance notice to pass on to readers — for the project's own
  // dataset, that the data is generated by language models and not
  // human-verified (docs/data.md); empty when the dataset has none
  notice: string;
  // The dataset the instance serves (issue #527): its name on this instance,
  // what the data is (`vocab-bloom-hub`, `wiktionary`, `wordnet`, …) and where
  // the attribution leads when the source asks for a link. `license`,
  // `license_url`, `attribution`, `notice` and `dataset_version` above are
  // that dataset's. Always sent since 1.1; optional in the contract so a
  // client built on it still reads an instance of 1.0
  dataset?: string;
  source?: string;
  attribution_url?: string | null;
  // The notices the source of the dataset asks to be kept with its data, in
  // full (issue #531): the WordNet license and the one of CMUdict want their
  // text on every copy. Empty when the license is named by its link alone.
  // Optional in the contract like the fields above
  license_text?: string;
  // How many headwords of the served dataset have entries that were changed
  // or added on this instance (issue #531): 0 says that the data is what its
  // source published. Refreshed with the counts. Optional in the contract
  /** @asType integer */
  modified_entries?: number;
  counts: PublicDatasetCountsV1T;
  available_languages: PublicAvailableLanguagesV1T;
};
// The languages the instance serves (issue #394): `source` is the language of
// the headwords (`en` only, structural), `translations` the languages a
// translation may carry — the values `?language=` accepts. Both are lists so
// a further language extends the answer without changing its shape
export type PublicAvailableLanguagesV1T = {
  source: string[];
  translations: AvailableTranslationLanguagesE[];
};
export type PublicMetaV1ResT = PublicItemResT<PublicMetaV1T>;

// ------------------------------------------------------ suggestions (#327)

// Answer of POST /api/v1/suggestions: the stored report. The endpoint has a
// strict rate limit of its own (a few reports per hour per client) and stops
// accepting once too many reports are waiting for the admin.
export type PublicSuggestionCreatedV1T = {
  /** @asType integer */
  id: number;
  status: string;
};
export type PublicSuggestionCreatedV1ResT = PublicItemResT<PublicSuggestionCreatedV1T>;

export type PublicApiErrorT = ErrorResT & {
  /** @asType integer */
  statusCode: number;
};
