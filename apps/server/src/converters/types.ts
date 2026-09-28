import {
  AvailableTranslationLanguagesE,
  CategoryE,
  EnAreaVariantsE,
  EnPartOfSpeechE,
  EnVerbTransitivityE,
  EnWordFormsE,
  LanguageRegisterE,
  ManifestProvenanceT,
} from '../../types';

/**
 * What a source adapter hands to the writer (issue #527): one base-form
 * entry — a headword with its part of speech — in the terms of the
 * project's model, whatever the source calls them. An adapter knows its
 * source and nothing about the dataset files; the writer knows the files
 * and nothing about the sources.
 */
export type ConvertedTranslationT = {
  language: AvailableTranslationLanguagesE;
  /** The words of the translation, the first one the main */
  words: string[];
};

export type ConvertedMeaningT = {
  definition: string;
  examples: string[];
  is_obsolete: boolean;
  area_variant: EnAreaVariantsE;
  language_register: LanguageRegisterE | '';
  categories: CategoryE[];
  /** Headwords; the writer names their part of speech as the meaning's own */
  synonyms: string[];
  antonyms: string[];
  translations: ConvertedTranslationT[];
};

export type ConvertedFormT = {
  word: string;
  form_of_word: EnWordFormsE;
  /** A form of a word nobody uses any more: listed, and not what the irregular flags are read from */
  is_obsolete?: boolean;
};

export type ConvertedEntryT = {
  word: string;
  part_of_speech: EnPartOfSpeechE;
  transcription: string;
  area_variant: EnAreaVariantsE | '';
  language_register: LanguageRegisterE | '';
  categories: CategoryE[];
  is_obsolete: boolean;
  is_abbreviation: boolean;
  noun___is_proper: boolean;
  noun___uncountable: boolean;
  noun___always_plural: boolean;
  noun___irregular_plural: boolean;
  verb___is_irregular: boolean;
  verb___is_phrasal: boolean;
  verb___transitivity: EnVerbTransitivityE | '';
  /** The base verb of a phrasal verb ("give" of "give up"); '' otherwise */
  base_phrasal: string;
  forms: ConvertedFormT[];
  meanings: ConvertedMeaningT[];
};

/** Why an adapter left a record of its source out; counted and printed at the end */
export type SkipReasonT =
  | 'other_language'
  | 'unsupported_part_of_speech'
  | 'no_definition'
  | 'form_or_alternative'
  | 'headword_too_long'
  | 'malformed';

export type ConverterContextT = {
  /** Called for every entry the adapter produced, in the order of the source */
  emit: (entry: ConvertedEntryT) => Promise<void>;
  skip: (reason: SkipReasonT) => void;
  /** Stop after this many source records (a trial run); undefined = all of them */
  limit?: number | undefined;
  log: (message: string) => void;
  /** How far into its input the adapter is, in bytes; an adapter that reads in seconds does not report */
  progress?: ((read: number, total: number) => void) | undefined;
};

export type SourceAdapterT = {
  /** The name on the command line and the `source` of the manifest */
  name: string;
  /** One line for `--help` */
  description: string;
  /** Where the data comes from and under which terms: the manifest carries it, the instance shows it */
  provenance: (options: Record<string, string>) => Required<ManifestProvenanceT>;
  /**
   * The version of the file the source distributes, as the file says it
   * (issue #530): the day an extract was made, the edition of a release.
   * Null when the file does not say — the day of the conversion is recorded
   * then. Nothing is asked of the source
   */
  versionOf: (input: string, options: Record<string, string>) => Promise<string | null>;
  /** Reads `input` (the file the source distributes, packed or not) and emits its entries */
  convert: (input: string, options: Record<string, string>, context: ConverterContextT) => Promise<void>;
};

/** The longest headword `en_entries.word` takes */
export const HEADWORD_MAX_LENGTH = 128;
