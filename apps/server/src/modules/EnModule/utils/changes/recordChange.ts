import { EntityManager } from 'typeorm';
import { ChangeActionE, ChangeDiffT, ChangeEntityE, ChangeRecordT } from '../../../../../types';
import { EnChange } from '../../entities/en_change.entity';
import { EnWord } from '../../entities/en_word.entity';
import { markEntryUserModified } from '../markEntryUserModified';
import { currentChangeSource } from './context';

/** The article an edit belongs to: the headword and the part of speech of the base word */
export type ArticleT = { headword: string; part_of_speech: string };

export type NewChangeT = ArticleT & {
  entity: ChangeEntityE;
  action: ChangeActionE;
  record?: ChangeRecordT | null;
  /** Null when the edit changed nothing: no row is written */
  diff: ChangeDiffT | null;
};

/** The article of a word row; a form row belongs to the article of its base word */
export const articleOf = (row: EnWord): ArticleT => {
  const base = row.base_form ?? row;
  return { headword: base.word.word, part_of_speech: base.part_of_speech };
};

/** The article of a word row by its id; null when the row is gone */
export const articleOfRow = async (em: EntityManager, wordRowId: number): Promise<ArticleT | null> => {
  const row = await em.getRepository(EnWord).findOne({
    where: { id: wordRowId },
    relations: { word: true, base_form: { word: true } },
  });
  return row ? articleOf(row) : null;
};

/**
 * What an edit of the content leaves behind (issue #531), with the manager
 * of the edit itself so both stand or fall together: the entry is kept
 * through the updates of its dataset (`user_modified`, issue #328), and the
 * history gets a row with the values that changed. An edit that changed
 * nothing leaves nothing: a dialog saved as it was opened does not take the
 * entry out of the updates of its dataset.
 */
export const recordChange = async (em: EntityManager, change: NewChangeT): Promise<void> => {
  if (!change.diff) return;
  await markEntryUserModified(em, change.headword);
  const source = currentChangeSource();
  const changes = em.getRepository(EnChange);
  await changes.save(
    changes.create({
      headword: change.headword,
      part_of_speech: change.part_of_speech,
      entity: change.entity,
      action: change.action,
      record: change.record ?? null,
      diff: change.diff,
      origin: source.origin,
      suggestion_id: source.suggestion_id ?? null,
      author: source.author ?? null,
      superseded_at: source.superseded ? new Date() : null,
    }),
  );
};
