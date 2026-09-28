import { DataSource, In, Repository } from 'typeorm';
import { EnWord } from '../../EnModule/entities/en_word.entity';
import { EnChangesService } from '../../EnModule/modules/EnChanges/enChanges.service';
import { foldedWord } from '../../EnModule/utils/foldedWord';
import { FULL_WORD_RELATIONS } from '../../EnModule/utils/wordRelations';
import { WordRowsService } from '../../EnModule/word-rows.service';
import { PublicChangeV1T, PublicWordV1T } from '../../../../types';
import { toPublicChange, toPublicWord } from './projection';

/**
 * What a spelling names in the dictionary: the headword the answer is
 * about, the other spellings that differ from it by case only, and the base
 * entries of the headword
 */
export type ResolvedHeadwordT = { word: string; variants: string[]; ids: number[] };

// Relation rows come back in storage order; the public answer sorts them
// by their natural keys so consumers see one order on every driver
export const sortRelations = (row: EnWord): EnWord => {
  row.forms?.sort((a, b) => a.id - b.id);
  row.meanings?.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  row.meanings?.forEach((m) => m.translations?.sort((a, b) => a.id - b.id));
  row.short_translations?.sort((a, b) => a.id - b.id);
  return row;
};

/**
 * The reads of a headword on one connection, which is one dataset: the
 * application's connection for the dataset that is served, a connection of
 * its own for another one (issue #528). What a spelling names, what its
 * entries say and what was changed in them are answered by the dataset the
 * connection is on, and attributed to it.
 */
export class HeadwordReader {
  constructor(
    private readonly words: Repository<EnWord>,
    private readonly wordRows: WordRowsService,
    private readonly changes: EnChangesService,
    // the source of the dataset the connection is on; the active one's when absent
    private readonly source?: string,
  ) {}

  /** A reader of the dataset a connection is on */
  static on(dataSource: DataSource, source: string): HeadwordReader {
    return new HeadwordReader(
      dataSource.getRepository(EnWord),
      new WordRowsService(dataSource),
      new EnChangesService(dataSource),
      source,
    );
  }

  /**
   * The base entries each spelling names: a row that is a base form itself,
   * or the base form an inflected row ("ran") belongs to. One query for the
   * whole list (the batch lookup, issue #397); per spelling the ids are
   * ordered by part of speech, then id, so the answer is stable. A spelling
   * with no entry has no key in the result.
   *
   * The match does not depend on the case of the letters — unless the
   * dictionary holds several spellings that differ by it, as a dataset of a
   * public source does ("Test", a match of cricket, and "test"): those are
   * words of their own, and a request that spells one of them exactly is
   * answered with that one. A request that spells none of them ("TEST")
   * gets them all.
   */
  async resolveMany(asked: string[]): Promise<Map<string, ResolvedHeadwordT>> {
    const found = new Map<string, ResolvedHeadwordT>();
    if (asked.length === 0) return found;
    const rows = await this.words
      .createQueryBuilder('w')
      .innerJoin('w.word', 'entry')
      .leftJoin('w.base_form', 'baseForm')
      .select(['w.id', 'w.part_of_speech'])
      .addSelect(['entry.word'])
      .addSelect(['baseForm.id', 'baseForm.part_of_speech'])
      // case-folded: a grammar pattern keeps its sentence capitals in the
      // dictionary and is still found by its lower-case spelling (issue #440)
      .where(`${foldedWord('entry.word')} IN (:...words)`, {
        words: [...new Set(asked.map((word) => word.toLowerCase()))],
      })
      .getMany();
    // the spellings the dictionary holds under one case-folded key, each with its base entries
    const spellings = new Map<string, Map<string, Map<number, EnWord>>>();
    for (const row of rows) {
      const target = row.base_form ?? row;
      const folded = row.word.word.toLowerCase();
      const bySpelling = spellings.get(folded) ?? new Map<string, Map<number, EnWord>>();
      const targets = bySpelling.get(row.word.word) ?? new Map<number, EnWord>();
      targets.set(target.id, target);
      bySpelling.set(row.word.word, targets);
      spellings.set(folded, bySpelling);
    }
    for (const word of asked) {
      const bySpelling = spellings.get(word.toLowerCase());
      if (!bySpelling) continue;
      // "Test" and "test" are two words where the dictionary holds both: a
      // request that spells one of them gets that one. Where the dictionary
      // holds one spelling the case of the request does not matter
      const exact = bySpelling.size > 1 ? bySpelling.get(word) : undefined;
      const targets = exact ?? new Map([...bySpelling.values()].flatMap((entries) => [...entries]));
      const others = [...bySpelling.keys()].filter((spelling) => !exact || spelling !== word);
      found.set(word, {
        word: exact ? word : word.toLowerCase(),
        variants: bySpelling.size > 1 ? others.sort() : [],
        ids: [...targets.values()]
          .sort((a, b) => a.part_of_speech.localeCompare(b.part_of_speech) || a.id - b.id)
          .map((row) => row.id),
      });
    }
    return found;
  }

  /** What one spelling names; undefined when the dataset has no such word */
  async resolve(raw: string): Promise<ResolvedHeadwordT | undefined> {
    const word = raw.trim();
    return word ? (await this.resolveMany([word])).get(word) : undefined;
  }

  // Every relation of the contract, projected by name (issue #392)
  async loadFull(ids: number[]): Promise<PublicWordV1T[]> {
    const rows = await this.wordRows.load(ids, FULL_WORD_RELATIONS);
    const modified = await this.wordRows.modifiedArticles(rows);
    return rows.map((row) =>
      toPublicWord(sortRelations(row), {
        with_meanings: true,
        with_translations: true,
        with_phrasal_variants: true,
        modified: modified.has(row),
        source: this.source,
      }),
    );
  }

  /**
   * The edits of the entries a spelling names (issue #531). The history is
   * kept by the spelling of the base word, so the entries are found first:
   * "ran" answers with the history of "run".
   */
  async history(resolved: ResolvedHeadwordT): Promise<PublicChangeV1T[]> {
    const rows = await this.words.find({
      where: { id: In(resolved.ids) },
      select: { id: true, part_of_speech: true, word: { word: true } },
      relations: { word: true },
    });
    const articles = new Set(rows.map((row) => `${row.word.word}\u0000${row.part_of_speech}`));
    const edits = await this.changes.activeOf([...new Set(rows.map((row) => row.word.word))]);
    return (
      edits
        // an edit without a part of speech is about every article of its headword
        .filter((edit) => !edit.part_of_speech || articles.has(`${edit.headword}\u0000${edit.part_of_speech}`))
        .map((edit) => toPublicChange(edit, this.source))
    );
  }
}
