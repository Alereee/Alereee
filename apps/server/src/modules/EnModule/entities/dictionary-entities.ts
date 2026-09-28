import { EnChange } from './en_change.entity';
import { EnEntry } from './en_entry.entity';
import { EnMeaning } from './en_meaning.entity';
import { EnMeaningTranslation } from './en_meaning_translation.entity';
import { EnShortTranslation } from './en_short_translation.entity';
import { EnWord } from './en_word.entity';

/**
 * The tables of a dictionary: what a dataset keeps in its schema next to the
 * queue of suggestions. One list for the application, the connection an
 * import opens and the databases the unit tests build — a table added here
 * is known everywhere at once.
 */
export const DICTIONARY_ENTITIES = [
  EnEntry,
  EnWord,
  EnMeaning,
  EnMeaningTranslation,
  EnShortTranslation,
  EnChange,
];
