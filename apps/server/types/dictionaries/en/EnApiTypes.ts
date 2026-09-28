import { ErrorResT } from '../../errors';
import { EnAreaVariantsE, EnPartOfSpeechE, EnWordT } from '.';
import type { PublicSearchWordV1T, PublicWordV1T } from '../../public/v1';
import type { AvailableTranslationLanguagesE, CategoryE, LanguageRegisterE, WordLevelE } from '../index';
import { AddWordReqDTO } from '../../../src/modules/EnModule/dto/AddWordReq.dto';
import { CheckWordQueryDTO } from '../../../src/modules/EnModule/dto/CheckWordQuery.dto';
import { AddWordFormReqDTO } from '../../../src/modules/EnModule/dto/AddWordFormReq.dto';
import { EditWordFormReqDTO } from '../../../src/modules/EnModule/dto/EditWordFormReq.dto';
import { AddShortTranslationReqDTO } from '../../../src/modules/EnModule/modules/EnShortTranslation/dto/AddShortTranslationReq.dto';
import { EditShortTranslationReqDTO } from '../../../src/modules/EnModule/modules/EnShortTranslation/dto/EditShortTranslationReq.dto';
import { AddMeaningReqDTO } from '../../../src/modules/EnModule/modules/EnMeaning/dto/AddMeaningReq.dto';
import { EditMeaningReqDTO } from '../../../src/modules/EnModule/modules/EnMeaning/dto/EditMeaningReq.dto';
import { AddMeaningTranslationReqDTO } from '../../../src/modules/EnModule/modules/EnMeaningTranslation/dto/AddMeaningTranslationReq.dto';
import { EditMeaningTranslationReqDTO } from '../../../src/modules/EnModule/modules/EnMeaningTranslation/dto/EditMeaningTranslationReq.dto';
import { EditCommonInfoOfWordReqDTO } from '../../../src/modules/EnModule/dto/EditCommonInfoOfWordReq.dto';
import { EditPhrasalBaseReqDTO } from '../../../src/modules/EnModule/dto/EditPhrasalBase.dto';
import { ImportDictionaryReq } from '../../../src/modules/EnModule/modules/EnImportDictionary/dto/ImportDictionaryReq.dto';
import { UploadDictionaryReqDTO } from '../../../src/modules/EnModule/modules/EnImportDictionary/dto/UploadDictionaryReq.dto';
import { SearchReqDTO } from '../../../src/modules/EnModule/modules/EnSearch/dto/SearchReq.dto';
import { SearchDetailedReqDTO } from '../../../src/modules/EnModule/modules/EnSearch/dto/SearchDetailedReq.dto';
import { ListWordsQueryDTO } from '../../../src/modules/EnModule/modules/EnAdminLists/dto/ListWordsQuery.dto';
import { ListMeaningsQueryDTO } from '../../../src/modules/EnModule/modules/EnAdminLists/dto/ListMeaningsQuery.dto';
import { ListMeaningTranslationsQueryDTO } from '../../../src/modules/EnModule/modules/EnAdminLists/dto/ListMeaningTranslationsQuery.dto';
import { ListShortTranslationsQueryDTO } from '../../../src/modules/EnModule/modules/EnAdminLists/dto/ListShortTranslationsQuery.dto';
import { EnDictionaryImportPhasesE } from '../../../src/modules/EnModule/modules/EnImportDictionary/constants';

export type CheckWordResT = { hasWord: boolean; id?: number } | ErrorResT;
export type CheckWordQueryT = CheckWordQueryDTO;
// The add endpoint echoes the request body back, so the response mirrors the request type
export type AddWordReqT = AddWordReqDTO;
export type AddResT = AddWordReqT | ErrorResT;
export type SearchReqT = SearchReqDTO;
// The admin UI searches through the public prefix, so it sees the public projection (issue #392)
export type SearchResT = PublicSearchWordV1T[] | ErrorResT;
// `fuzzy`: the exact tiers found nothing and the items come from the trigram
// similarity tier (Postgres only, issue #278); each item then carries `similarity`.
// `short_term`: the term is shorter than 3 characters and only the exact and
// prefix tiers ran (issue #292)
export type SearchItemsT = { items: PublicSearchWordV1T[]; fuzzy: boolean; short_term: boolean };
export type SearchDetailedReqT = SearchDetailedReqDTO;
export type SearchDetailedItemsT = {
  items: PublicWordV1T[];
  page: number;
  limit: number;
  has_more: boolean;
  fuzzy: boolean;
  short_term: boolean;
};

// Admin listings (GET /api/en/words, /meanings, /meaning-translations, /short-translations)
// used by the bulk-request page
export type PaginatedListT<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
  has_more: boolean;
  // the id of the last row of this page when there is a next one: pass it as
  // `after` to read the next page without an OFFSET (the dictionary listings;
  // the audit journal pages by number only)
  next_after?: number | null;
};

export type ListWordsQueryT = ListWordsQueryDTO;
export type EnWordListItemT = {
  id: number;
  word: string;
  part_of_speech: EnPartOfSpeechE;
  area_variant: EnAreaVariantsE | null;
  word_level: WordLevelE | null;
  language_register: LanguageRegisterE | null;
  generated: boolean;
  generated_by_model: string | null;
  version: string;
  is_obsolete: boolean;
  transcription: string | null;
  description: string | null;
  categories: CategoryE[];
  meanings_count: number;
  short_translations_count: number;
};
export type EnWordsListT = PaginatedListT<EnWordListItemT>;
export type ListWordsResT = EnWordsListT | ErrorResT;

export type ListMeaningsQueryT = ListMeaningsQueryDTO;
// a meaning next to the word it belongs to
export type EnMeaningListItemT = {
  id: number;
  word_id: number;
  word: string;
  part_of_speech: EnPartOfSpeechE;
  title: string;
  definition: string;
  sort_order: number;
  area_variant: EnAreaVariantsE;
  meaning_level: WordLevelE | null;
  language_register: LanguageRegisterE | null;
  categories: CategoryE[];
  is_obsolete: boolean;
  examples: string[];
  synonyms: string[];
  antonyms: string[];
  translations_count: number;
};
export type EnMeaningsListT = PaginatedListT<EnMeaningListItemT>;
export type ListMeaningsResT = EnMeaningsListT | ErrorResT;

export type ListMeaningTranslationsQueryT = ListMeaningTranslationsQueryDTO;
// a meaning translation next to its meaning and word
export type EnMeaningTranslationListItemT = {
  id: number;
  meaning_id: number;
  word_id: number;
  word: string;
  part_of_speech: EnPartOfSpeechE;
  meaning_title: string;
  meaning_definition: string;
  // with the title, the key of the meaning within its word in the dataset files (issue #442)
  meaning_sort_order: number;
  language: AvailableTranslationLanguagesE;
  title: string;
  definition: string;
  variants_of_words: string[];
};
export type EnMeaningTranslationsListT = PaginatedListT<EnMeaningTranslationListItemT>;
export type ListMeaningTranslationsResT = EnMeaningTranslationsListT | ErrorResT;

export type ListShortTranslationsQueryT = ListShortTranslationsQueryDTO;
// a short translation next to the word it belongs to
export type EnShortTranslationListItemT = {
  id: number;
  word_id: number;
  word: string;
  part_of_speech: EnPartOfSpeechE;
  language: AvailableTranslationLanguagesE;
  description: string;
  variants_of_words: string[];
};
export type EnShortTranslationsListT = PaginatedListT<EnShortTranslationListItemT>;
export type ListShortTranslationsResT = EnShortTranslationsListT | ErrorResT;
export type DeleteResT = { success: boolean } | ErrorResT;
export type AddWordFormResT = { success: boolean; id: number } | ErrorResT;
export type AddWordFormReqT = AddWordFormReqDTO;
export type EditWordFormResT = { success: boolean } | ErrorResT;
export type EditWordFormReqT = EditWordFormReqDTO;
export type GetWordByIdResT = EnWordT | ErrorResT;

export type AddShortTranslationReqT = AddShortTranslationReqDTO;
export type AddShortTranslationResT = { success: boolean; id: number } | ErrorResT;
export type DeleteShortTranslationResT = { success: boolean } | ErrorResT;
export type EditShortTranslationResT = { success: boolean } | ErrorResT;
export type EditShortTranslationReqT = EditShortTranslationReqDTO;

export type AddMeaningReqT = AddMeaningReqDTO;
export type AddMeaningResT = { success: boolean; id: number } | ErrorResT;
export type EditMeaningReqT = EditMeaningReqDTO;
export type EditMeaningResT = { success: boolean } | ErrorResT;
export type DeleteMeaningResT = { success: boolean } | ErrorResT;

export type AddMeaningTranslationReqT = AddMeaningTranslationReqDTO;
export type AddMeaningTranslationResT = { success: boolean; id: number } | ErrorResT;
export type EditMeaningTranslationReqT = EditMeaningTranslationReqDTO;
export type EditMeaningTranslationResT = { success: boolean } | ErrorResT;
export type DeleteMeaningTranslationResT = { success: boolean } | ErrorResT;

export type EditCommonInfoOfWordReqT = EditCommonInfoOfWordReqDTO;
export type EditCommonInfoOfWordResT = { success: boolean } | ErrorResT;

export type EditPhrasalBaseReqT = EditPhrasalBaseReqDTO;
export type EditPhrasalBaseResT = { success: boolean } | ErrorResT;

// PATCH /en/reset-user-modified/:word (issue #328): clears the entry's
// user-modified flag so the next dictionary update replaces it again
export type ResetEntryUserModifiedResT = { success: boolean } | ErrorResT;

export type ImportDictionaryReqT = ImportDictionaryReq;
// text fields of the multipart upload (the files go in their own fields)
export type UploadDictionaryReqT = Partial<UploadDictionaryReqDTO>;
export type ImportDictionaryChunkT = {
  percent: number;
  stage?: EnDictionaryImportPhasesE | undefined;
  downloaded?: number | undefined;
  total?: number | undefined;
  exportId?: string | undefined;
  datasetVersion?: string | undefined;
  // Summary of an update-mode import (issue #328), set on the completed
  // chunk: entries replaced with the dataset content, entries new to the
  // dictionary, and entries kept because the admin edited them
  updated_entries?: number | undefined;
  added_entries?: number | undefined;
  kept_user_modified?: number | undefined;
};

/** Who started an import: an admin from the UI, or the server itself on first start (issue #268) */
export enum ImportTriggerE {
  manual = 'manual',
  auto = 'auto',
}

/**
 * The import slot of the process — what is running now, or how the last
 * import ended (`GET /api/en/dictionary/import/status`, the admin banner,
 * the readiness probe). One import runs at a time.
 */
export type ImportStatusT = {
  running: boolean;
  trigger?: ImportTriggerE | undefined;
  /** Human-readable source, e.g. "HuggingFace" or the dataset file name */
  label?: string | undefined;
  stage?: EnDictionaryImportPhasesE | undefined;
  /** 0–100 over the whole import, download excluded */
  percent?: number | undefined;
  started_at?: string | undefined;
  finished_at?: string | undefined;
  /** Set when the last import failed; the error code or message */
  error?: string | undefined;
  /** Version of the dataset being (or last) imported, when its manifest names one */
  dataset_version?: string | undefined;
  /** The dataset of the instance the import writes into (issue #527); the active one unless named */
  dataset?: string | undefined;
};

// manifest.json stored next to the jsonl files in the dataset repository;
// the export writes it into the archive, the import reads it for progress
// totals and the dataset version
export type DatasetManifestT = {
  version: string;
  generatedAt?: string | undefined;
  files: Record<string, { lines: number }>;
  // meaning → synonym / antonym links across all files; count into the import
  // progress total for the linking stages (absent in datasets published
  // before #259 / #266 respectively)
  synonym_links?: number | undefined;
  antonym_links?: number | undefined;
  // translation rows per language across all files (issue #410): what a
  // consumer can expect for each member of AvailableTranslationLanguagesE
  // in this revision; absent in datasets published before
  translations?: Record<string, { meaning_translations: number; short_translations: number }> | undefined;
  // terms of the data (issue #270): the SPDX identifier of the license and
  // a sufficient attribution line; absent in datasets published before
  license?: string | undefined;
  attribution?: string | undefined;
  // where the data comes from (issue #527): a dataset converted from a public
  // source names it and the rest of its terms; the project's own dataset,
  // and every manifest written before, names none of them
  source?: string | undefined;
  license_url?: string | undefined;
  attribution_url?: string | undefined;
  // a notice for the readers of the data; an empty string says there is none
  notice?: string | undefined;
  // entries that were changed or added on the instance the dataset was
  // exported from (issue #531): the copy differs from its source by them.
  // Absent in a dataset nobody edited and in every manifest written before
  modified_entries?: number | undefined;
};

/** The fields of a manifest that say where the data comes from and under which terms */
export const MANIFEST_PROVENANCE_FIELDS = [
  'source',
  'license',
  'license_url',
  'attribution',
  'attribution_url',
  'notice',
] as const;
export type ManifestProvenanceT = Pick<DatasetManifestT, (typeof MANIFEST_PROVENANCE_FIELDS)[number]>;

export type GetDatasetManifestResT = DatasetManifestT | ErrorResT;

// Where an import reads the dataset from (issue #269): the published
// HuggingFace dataset, or a directory / zip archive inside the server's
// DICTIONARY_IMPORT_DIR. Uploads go through their own multipart endpoint.
export enum ImportSourceKindE {
  huggingface = 'huggingface',
  file = 'file',
}
export type ImportSourceFileT = {
  // relative to DICTIONARY_IMPORT_DIR; what the import request sends back as `source.path`
  path: string;
  kind: 'zip' | 'directory';
  size: number;
  modified_at?: string | undefined;
};
export type ImportSourcesT = {
  // false when DICTIONARY_IMPORT_DIR is unset: the UI offers uploads only
  import_dir_configured: boolean;
  files: ImportSourceFileT[];
  // version tags of the published dataset repo, newest first (issue #322);
  // [] when the HF refs API is unreachable
  revisions: string[];
};
export type GetImportSourcesResT = ImportSourcesT | ErrorResT;
export type GetImportStatusResT = ImportStatusT | ErrorResT;

export type EnPosStatT = { part_of_speech: EnPartOfSpeechE; count: number };
export type EnWordLevelStatT = { word_level: WordLevelE | null; count: number };
export type EnStatisticsT = {
  totals: {
    entries: number;
    words: number;
    phrases: number;
    grammar_patterns: number;
    word_forms: number;
    meanings: number;
    meaning_translations: number;
    short_translations: number;
  };
  coverage: {
    words_with_meanings: number;
    words_with_short_translations: number;
    generated_words: number;
    obsolete_words: number;
    phrasal_verbs: number;
  };
  by_part_of_speech: EnPosStatT[];
  by_word_level: EnWordLevelStatT[];
};
export type GetEnStatisticsResT = EnStatisticsT | ErrorResT;

export type EnTranslationsStatisticsT = {
  totals: {
    meanings: number;
    meaning_translations: number;
    short_translations: number;
    meanings_without_translations: number;
    avg_meanings_per_word: number;
  };
  by_language: {
    language: AvailableTranslationLanguagesE;
    meaning_translations: number;
    short_translations: number;
  }[];
  meanings_by_level: { meaning_level: WordLevelE | null; count: number }[];
};
export type GetEnTranslationsStatisticsResT = EnTranslationsStatisticsT | ErrorResT;

export type EnStatisticsIssueKeyT =
  | 'words_without_meanings'
  | 'words_without_short_translations'
  | 'words_without_level'
  | 'words_without_transcription'
  | 'words_without_description'
  | 'meanings_without_translations'
  | 'meanings_without_examples'
  | 'meanings_without_synonyms'
  | 'meanings_without_antonyms'
  | 'empty_meaning_translations'
  | 'empty_short_translations';
export type EnIssueStatT = { key: EnStatisticsIssueKeyT; count: number; total: number };
export type EnIssuesStatisticsT = { issues: EnIssueStatT[] };
export type GetEnIssuesStatisticsResT = EnIssuesStatisticsT | ErrorResT;

// Mirrors ExportDictionaryQueryDTO: the settings of an export
export type ExportDictionaryQueryT = {
  /** The version to write for the entries edited on the instance, in place of `custom_version` */
  edited_version?: string | undefined;
};
