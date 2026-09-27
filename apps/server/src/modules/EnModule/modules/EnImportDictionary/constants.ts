import { AvailableTranslationLanguagesE } from '../../../../../types';

export enum EnDictionaryImportPhasesE {
  saving_words,
  saving_phrasal_verbs,
  saving_grammar_patterns,
  saving_phrases,
  downloading_database,
  completed,
  packing_archive,
  linking_synonyms,
  linking_antonyms,
  unpacking_archive,
  saving_meanings,
  saving_meaning_translations,
  saving_short_translations,
  // a file of a public source being turned into the project's format (issue #527);
  // like the download, the stage reports its own bytes
  converting_source,
}

export const SYSTEM_FIELDS = ['id', 'createdAt', 'updateAt', 'updatedAt'];

// Every jsonl file is written in a deterministic order: lines by
// (word, part_of_speech, area_variant) and every nested collection by its
// natural keys, so re-exports of the same data are byte-identical. The exact
// rules live in utils/sortForDataSet.ts (issue #247).
// The entry files carry the entries themselves; the meanings, their
// translations and the short translations are files of their own, one line
// per row next to the key of its parent (issue #442). The translations ship
// one file per language (`…-meaning-translations.<lang>.jsonl`,
// `…-short-translations.<lang>.jsonl`, see translationFileName): a file of
// one language stays a manageable size and loads on its own. The combined
// `meaningTranslations` / `shortTranslations` names are what exports between
// #442 and the split wrote; the import still reads them, the export no longer
// writes them
export const DATASET_FILE_NAMES = {
  words: 'vocab-bloom-hub-en-words.jsonl',
  phrasalVerbs: 'vocab-bloom-hub-en-phrasal-verbs.jsonl',
  grammarPatterns: 'vocab-bloom-hub-en-grammar-patterns.jsonl',
  phrases: 'vocab-bloom-hub-en-phrases.jsonl',
  meanings: 'vocab-bloom-hub-en-meanings.jsonl',
  meaningTranslations: 'vocab-bloom-hub-en-meaning-translations.jsonl',
  shortTranslations: 'vocab-bloom-hub-en-short-translations.jsonl',
} as const;

export type TranslationFileKindT = 'meaningTranslations' | 'shortTranslations';
export const TRANSLATION_FILE_KINDS: readonly TranslationFileKindT[] = [
  'meaningTranslations',
  'shortTranslations',
];

/** The dataset file of one translation language: the combined name with the language before the extension */
export const translationFileName = (
  kind: TranslationFileKindT,
  language: AvailableTranslationLanguagesE,
): string => DATASET_FILE_NAMES[kind].replace(/\.jsonl$/, `.${language}.jsonl`);

/** The per-language translation files of a kind, in the order of the languages */
export const translationFileNames = (kind: TranslationFileKindT): string[] =>
  Object.values(AvailableTranslationLanguagesE).map((language) => translationFileName(kind, language));

export const MANIFEST_FILE_NAME = 'manifest.json';

// Every file a dataset may contain; anything else in a local directory or an
// uploaded archive is rejected before the import starts (issue #269)
export const DATASET_KNOWN_FILE_NAMES: readonly string[] = [
  ...Object.values(DATASET_FILE_NAMES),
  ...TRANSLATION_FILE_KINDS.flatMap((kind) => translationFileNames(kind)),
  MANIFEST_FILE_NAME,
];

export const DATASET_REPO = 'Fristail27/vocab-bloom-hub-en';
export const DATASET_DEFAULT_REVISION = 'main';

// A revision is a git ref of the HF dataset repo (issue #322): a version tag
// like `v0.1.0`, a branch, or a commit sha; `main` is the moving latest
export const datasetBaseUrl = (revision: string = DATASET_DEFAULT_REVISION): string =>
  `https://huggingface.co/datasets/${DATASET_REPO}/resolve/${encodeURIComponent(revision)}/data`;

// Lists the repo's git refs — the version tags the import can pin
export const DATASET_REFS_URL = `https://huggingface.co/api/datasets/${DATASET_REPO}/refs`;

// Uploaded archives are limited to keep a mistaken upload from filling the
// disk; the published dataset zips are a few tens of megabytes
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;
// Multipart fields of the upload endpoint: one archive, or the dataset files
// in their own slots so the uploaded file's own name does not matter; the
// translations have a slot per language (`meaning_translations_<lang>`,
// `short_translations_<lang>`)
export const UPLOAD_ARCHIVE_FIELD = 'archive';
export const UPLOAD_FILE_FIELDS: Readonly<Record<string, string>> = {
  words: DATASET_FILE_NAMES.words,
  phrasal_verbs: DATASET_FILE_NAMES.phrasalVerbs,
  grammar_patterns: DATASET_FILE_NAMES.grammarPatterns,
  phrases: DATASET_FILE_NAMES.phrases,
  meanings: DATASET_FILE_NAMES.meanings,
  ...Object.fromEntries(
    Object.values(AvailableTranslationLanguagesE).flatMap((language) => [
      [`meaning_translations_${language}`, translationFileName('meaningTranslations', language)],
      [`short_translations_${language}`, translationFileName('shortTranslations', language)],
    ]),
  ),
  manifest: MANIFEST_FILE_NAME,
};
export type UploadFileFieldT = keyof typeof UPLOAD_FILE_FIELDS;
/** The translation slot of a language, or null for any other upload field */
export const translationUploadField = (
  field: string,
): { kind: 'meaning_translations' | 'short_translations'; language: AvailableTranslationLanguagesE } | null => {
  const match = /^(meaning_translations|short_translations)_([a-z]+)$/.exec(field);
  if (!match || !(Object.values(AvailableTranslationLanguagesE) as string[]).includes(match[2])) return null;
  return {
    kind: match[1] as 'meaning_translations' | 'short_translations',
    language: match[2] as AvailableTranslationLanguagesE,
  };
};
// A single unpacked dataset file may not exceed this (zip-bomb guard)
export const MAX_DATASET_FILE_BYTES = 2 * 1024 * 1024 * 1024;

// Snapshot of the last dataset published without a manifest.json; used only
// as the progress total when the manifest is missing (legacy datasets)
export const LEGACY_DATASET_TOTAL_LINES = 87074 + 912 + 28560 + 28;

// Settings key holding the dataset version of the last successful import
export const DATASET_VERSION_SETTINGS_FIELD = 'en_dataset_version';
