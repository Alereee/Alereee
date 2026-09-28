import { EntityManager, FindOptionsRelations } from 'typeorm';
import { EnEntryTypesE, EnPartOfSpeechE, EnWordFormsE } from '../../../../../types';
import { EnEntry } from '../../entities/en_entry.entity';
import { EnWord } from '../../entities/en_word.entity';

/** Everything an article says: what the history of a creation and of a deletion holds (issue #531) */
export const ARTICLE_RELATIONS: FindOptionsRelations<EnWord> = {
  word: true,
  forms: { word: true },
  meanings: { translations: true, synonyms: true, antonyms: true },
  short_translations: true,
  base_phrasal: { word: true },
};

/** The article of a headword and a part of speech: the row of the base word, with everything it says */
export const findArticle = async (
  em: EntityManager,
  headword: string,
  partOfSpeech: string,
): Promise<EnWord | null> => {
  const rows = em.getRepository(EnWord);
  const found = await rows
    .createQueryBuilder('w')
    .innerJoin('w.word', 'entry')
    .select('w.id', 'id')
    .where('entry.word = :headword', { headword })
    .andWhere('w.part_of_speech = :partOfSpeech', { partOfSpeech })
    .andWhere('w.form_of_word = :baseForm', { baseForm: EnWordFormsE.base_form })
    .orderBy('w.id', 'ASC')
    .getRawOne<{ id: number }>();
  return found ? rows.findOne({ where: { id: found.id }, relations: ARTICLE_RELATIONS }) : null;
};

/** The kind of entry an article of the part of speech is */
export const entryTypeOf = (partOfSpeech: string): EnEntryTypesE => {
  if (partOfSpeech === EnPartOfSpeechE.phrase) return EnEntryTypesE.phrase;
  if (partOfSpeech === EnPartOfSpeechE.grammar_pattern) return EnEntryTypesE.grammar_pattern;
  return EnEntryTypesE.word;
};

export const getOrAddEntry = async (em: EntityManager, word: string, type: EnEntryTypesE): Promise<EnEntry> => {
  const entries = em.getRepository(EnEntry);
  return (await entries.findOne({ where: { word } })) ?? entries.save({ word, type });
};

/** An entry no word row names any more goes with the last of them */
export const dropEntryIfUnused = async (em: EntityManager, spelling: string): Promise<void> => {
  const rows = await em
    .getRepository(EnWord)
    .createQueryBuilder('w')
    .where('w.word = :word', { word: spelling })
    .getCount();
  if (rows === 0) await em.getRepository(EnEntry).delete({ word: spelling });
};

/**
 * Deletes a word row with its forms (loaded with `word` and `forms.word`).
 * Form rows used to die via the entry cascade; entries may survive now, so
 * the forms are deleted explicitly.
 */
export const deleteWordRows = async (em: EntityManager, word: EnWord): Promise<void> => {
  const rows = em.getRepository(EnWord);
  const forms = word.forms ?? [];
  const spellings = new Set<string>([...forms.map((form) => form.word.word), word.word.word]);
  if (forms.length > 0) await rows.delete(forms.map((form) => form.id));
  await rows.delete({ id: word.id });
  for (const spelling of spellings) await dropEntryIfUnused(em, spelling);
};
