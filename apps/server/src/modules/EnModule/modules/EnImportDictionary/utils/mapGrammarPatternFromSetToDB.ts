import { DataSetGrammarPatternT } from '../../../../../../types/dictionaries/en/EnDataSetTypes';
import { EnAreaVariantsE, EnPartOfSpeechE, EnWordFormsE, EnWordT } from '../../../../../../types';
import { getVersion } from '../../../../../../configuration';
import { mapMeaningFromSetToDB } from './mapMeaningFromSetToDB';

export const mapGrammarPatternFromSetToDB = (ph: DataSetGrammarPatternT): EnWordT => {
  return {
    word: ph.phrase,
    part_of_speech: EnPartOfSpeechE.grammar_pattern,
    pattern: ph.pattern,
    form_of_word: EnWordFormsE.base_form,
    area_variant: ph.area_variant || EnAreaVariantsE.common,
    generated_by_model: ph.generated_by_model,
    generated: !!ph.generated,
    verb___phrasal_object_pattern: null,
    verb___transitivity: null,
    // an unset register stays unset (issue #527): a dataset of another source knows none
    language_register: ph.language_register || null,
    categories: ph.categories,
    verb___is_phrasal: false,
    verb___is_irregular: false,
    version: ph.version || getVersion(),
    noun___is_proper: false,
    word_level: ph.level || null,
    description: ph.description,
    transcription: ph.transcription,
    is_obsolete: ph.is_obsolete,
    is_abbreviation: false,
    noun___uncountable: false,
    noun___irregular_plural: false,
    id: 0,
    noun___always_plural: false,
    base_phrasal: undefined,
    base_form: undefined,
    phrasal_variants: [],
    forms: [],
    // nested only in datasets published before #442; current datasets ship
    // the collections in their own files
    short_translations: (ph.short_translations ?? []).map((s) => ({ id: 0, ...s })),
    meanings: (ph.meanings ?? []).map(mapMeaningFromSetToDB),
  };
};
