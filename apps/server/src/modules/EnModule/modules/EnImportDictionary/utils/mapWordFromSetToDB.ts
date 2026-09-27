import { DataSetWordT } from '../../../../../../types/dictionaries/en/EnDataSetTypes';
import { EnAreaVariantsE, EnWordFormsE } from '../../../../../../types';
import { getVersion } from '../../../../../../configuration';
import { mapMeaningFromSetToDB } from './mapMeaningFromSetToDB';

export const mapWordFromSetToDB = (line: DataSetWordT) => {
  return {
    word: line.word,
    part_of_speech: line.part_of_speech,
    pattern: null,
    form_of_word: EnWordFormsE.base_form,
    area_variant: line.area_variant || EnAreaVariantsE.common,
    generated_by_model: line.generated_by_model,
    generated: !!line.generated,
    verb___phrasal_object_pattern: line.verb___phrasal_object_pattern || null,
    verb___transitivity: line.verb___transitivity || null,
    // an unset register stays unset (issue #527): a dataset of another source knows none
    language_register: line.language_register || null,
    categories: line.categories || [],
    verb___is_phrasal: !!line.verb___is_phrasal,
    verb___is_irregular: !!line.verb___is_irregular,
    noun___is_proper: !!line.noun___is_proper,
    word_level: line.word_level || null,
    description: line.description,
    transcription: line.transcription,
    is_obsolete: line.is_obsolete,
    version: line.version || getVersion(),
    is_abbreviation: line.is_abbreviation,
    noun___uncountable: line.noun___uncountable,
    noun___irregular_plural: line.noun___irregular_plural,
    id: 0,
    noun___always_plural: line.noun___always_plural,
    base_phrasal: undefined,
    base_form: undefined,
    phrasal_variants: [],
    forms: line.forms.map((w) => ({ ...w, id: 0 })),
    // nested only in datasets published before #442; current datasets ship
    // the collections in their own files
    short_translations: (line.short_translations ?? []).map((s) => ({ id: 0, ...s })),
    meanings: (line.meanings ?? []).map(mapMeaningFromSetToDB),
  };
};
