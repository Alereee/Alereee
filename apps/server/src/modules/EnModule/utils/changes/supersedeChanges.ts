import { EntityManager, In, IsNull } from 'typeorm';
import { EnChange } from '../../entities/en_change.entity';

// the drivers bind a few hundred parameters at most
const BATCH = 500;

/**
 * Says of the edits of the given entries that they no longer show in what
 * is served (issue #531): the content of the source took their place. The
 * rows stay — the history is never erased. With a part of speech only the
 * edits of that article are meant, without one every edit of the headword.
 * Answers how many rows it touched.
 */
export const supersedeChanges = async (
  em: EntityManager,
  headwords: readonly string[],
  partOfSpeech?: string,
): Promise<number> => {
  let touched = 0;
  const unique = [...new Set(headwords)];
  for (let from = 0; from < unique.length; from += BATCH) {
    const result = await em.getRepository(EnChange).update(
      {
        headword: In(unique.slice(from, from + BATCH)),
        superseded_at: IsNull(),
        ...(partOfSpeech !== undefined && { part_of_speech: partOfSpeech }),
      },
      { superseded_at: new Date() },
    );
    touched += result.affected ?? 0;
  }
  return touched;
};

/** Whether the dataset has an edit that still shows: an import into a dataset nobody edited has nothing to look for */
export const hasActiveChanges = async (em: EntityManager): Promise<boolean> =>
  (await em.getRepository(EnChange).count({ where: { superseded_at: IsNull() }, take: 1 })) > 0;
