import { EnMeaningDST } from '../../../../../../types/dictionaries/en/EnDataSetTypes';
import { EnAreaVariantsE, EnMeaningT } from '../../../../../../types';
import { wordLinksFromDataSet } from './wordLinksFromDataSet';

/**
 * A dataset meaning as the database takes it: zeroed id, the enum defaults
 * of an unset field, the links reduced to headwords. Shared by the entry
 * lines that still nest their meanings (datasets before #442) and by the
 * meanings file, whose lines may carry no translations at all.
 */
export const mapMeaningFromSetToDB = (m: EnMeaningDST | Omit<EnMeaningDST, 'translations'>): EnMeaningT => {
  const translations = 'translations' in m ? (m.translations ?? []) : [];
  return {
    ...m,
    id: 0,
    meaning_level: m.meaning_level || null,
    // an unset register stays unset (issue #527): a dataset of another source knows none
    language_register: m.language_register || null,
    area_variant: m.area_variant || EnAreaVariantsE.common,
    synonyms: wordLinksFromDataSet(m.synonyms),
    antonyms: wordLinksFromDataSet(m.antonyms),
    translations: translations.map((t) => ({ id: 0, ...t })),
  };
};
