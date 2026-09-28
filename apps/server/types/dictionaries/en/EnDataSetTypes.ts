import { EnWord } from '../../../src/modules/EnModule/entities/en_word.entity';
import {
  EnAreaVariantsE,
  EnMeaningT,
  EnMeaningTranslationT,
  EnPartOfSpeechE,
  EnPhrasalObjectPatternE,
  EnShortTranslationT,
  EnVerbTransitivityE,
  EnWordFormT,
  LanguageRegisterE,
  WordLevelE,
} from '../';

export type EnMeaningTranslationDST = Omit<EnMeaningTranslationT, 'id'>;
// A linked word (synonym, antonym) in the dataset names the word together
// with its part of speech, so the file is readable on its own; the database
// stores the link by headword
export type EnWordLinkDST = { word: string; part_of_speech: EnPartOfSpeechE };
export type EnSynonymDST = EnWordLinkDST;
export type EnAntonymDST = EnWordLinkDST;
export type EnMeaningDST = Omit<
  EnMeaningT,
  'id' | 'translations' | 'meaning_level' | 'language_register' | 'synonyms' | 'antonyms'
> & {
  translations: EnMeaningTranslationDST[];
  synonyms: EnSynonymDST[];
  antonyms: EnAntonymDST[];
  meaning_level: WordLevelE | '';
  language_register: LanguageRegisterE | '';
};
export type EnShortTranslationDST = Omit<EnShortTranslationT, 'id'>;
export type EnWordFormDST = Omit<EnWordFormT, 'id'>;

// The key of a base-form entry, as the collection files name their parent
// (issue #442): the headword and its part of speech, unique among base
// forms; phrases and grammar patterns carry their own part of speech here
export type DataSetWordKeyT = { word: string; part_of_speech: EnPartOfSpeechE };

// One line of the meanings file: the meaning's own columns and links next to
// the key of its word; the translations live in their own file
export type DataSetMeaningT = DataSetWordKeyT & Omit<EnMeaningDST, 'translations'>;
// One line of the meaning-translations file: the translation next to the key
// of its meaning — the word key plus the meaning's sort order and title,
// unique within a word
export type DataSetMeaningTranslationT = DataSetWordKeyT & {
  meaning_sort_order: number;
  meaning_title: string;
} & EnMeaningTranslationDST;
// One line of the short-translations file: the translation next to the word key
export type DataSetShortTranslationT = DataSetWordKeyT & EnShortTranslationDST;

export type DataSetWordT = Omit<
  EnWord,
  | 'createdAt'
  | 'updateAt'
  | 'meanings'
  | 'short_translations'
  | 'forms'
  | 'pattern'
  | 'base_phrasal'
  | 'word'
  | 'base_form'
  | 'phrasal_variants'
  | 'id'
  | 'form_of_word'
  | 'word_level'
  | 'area_variant'
  | 'language_register'
  | 'verb___transitivity'
  | 'verb___phrasal_object_pattern'
> & {
  word: string;
  word_level: WordLevelE | '';
  area_variant: EnAreaVariantsE | '';
  language_register: LanguageRegisterE | '';
  verb___transitivity: EnVerbTransitivityE | '';
  verb___phrasal_object_pattern: EnPhrasalObjectPatternE | '';
  // datasets published before #442 nest the meanings and short translations
  // in the word line; current datasets ship them in their own files
  meanings?: EnMeaningDST[] | undefined;
  short_translations?: EnShortTranslationDST[] | undefined;
  forms: EnWordFormDST[];
  base_phrasal: string;
  phrasal_variants: string[];
  version: string;
};

export type DataSetPhraseT = Omit<
  EnWord,
  | 'createdAt'
  | 'updateAt'
  | 'meanings'
  | 'short_translations'
  | 'forms'
  | 'pattern'
  | 'base_phrasal'
  | 'word'
  | 'base_form'
  | 'phrasal_variants'
  | 'id'
  | 'form_of_word'
  | 'word_level'
  | 'area_variant'
  | 'language_register'
  | 'verb___transitivity'
  | 'verb___phrasal_object_pattern'
  | 'verb___is_phrasal'
  | 'verb___is_irregular'
  | 'noun___uncountable'
  | 'noun___is_proper'
  | 'noun___irregular_plural'
  | 'noun___always_plural'
  | 'is_abbreviation'
  | 'part_of_speech'
> & {
  phrase: string;
  level: WordLevelE | '';
  area_variant: EnAreaVariantsE | '';
  language_register: LanguageRegisterE | '';
  meanings?: EnMeaningDST[] | undefined;
  short_translations?: EnShortTranslationDST[] | undefined;
  version: string;
};

export type DataSetGrammarPatternT = DataSetPhraseT & { pattern: string[] };

/**
 * A line of the changes file (issue #531): one edit of the dataset, as the
 * history of the instance that exported it holds it, without what only that
 * instance knows — the id of the row, the id of the suggestion it came from
 */
export type DataSetChangeT = {
  created_at: string;
  headword: string;
  part_of_speech: string | null;
  entity: string;
  action: string;
  record: unknown;
  diff: Record<string, { before: unknown; after: unknown }>;
  origin: string;
  author: string | null;
  superseded_at: string | null;
};
