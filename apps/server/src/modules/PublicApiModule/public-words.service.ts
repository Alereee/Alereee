import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsRelations, In, Repository, SelectQueryBuilder } from 'typeorm';
import { EnWord } from '../EnModule/entities/en_word.entity';
import { FULL_WORD_RELATIONS, SEARCH_ITEM_RELATIONS } from '../EnModule/utils/wordRelations';
import { WordRowsService } from '../EnModule/word-rows.service';
import { foldedWord } from '../EnModule/utils/foldedWord';
import { escapeLike } from '../EnModule/modules/EnSearch/utils/escapeLike';
import { WordLinkKindT } from '../EnModule/utils/normalizeWordLinks';
import { toPublicChange, toPublicWord } from './utils/projection';
import { EnChangesService } from '../EnModule/modules/EnChanges/enChanges.service';
import { ErrorCodes } from '../../../core/constants/error_codes';
import { checkIsPostgres } from '../../../configuration';
import {
  AvailableTranslationLanguagesE,
  EnWordFormsE,
  PublicEntryRefV1T,
  PublicHeadwordFormsV1ResT,
  PublicHeadwordHistoryV1ResT,
  PublicHeadwordLinksV1ResT,
  PublicHeadwordMeaningsV1ResT,
  PublicHeadwordTranslationsV1ResT,
  PublicHeadwordV1MetaT,
  PublicHeadwordV1ResT,
  PublicWordsBatchItemV1T,
  PublicWordsBatchV1ResT,
  PublicWordsV1ResT,
  PublicWordV1T,
} from '../../../types';
import { WordFiltersV1QueryDTO } from './dto/WordFiltersV1Query.dto';
import { ListWordsV1QueryDTO, PUBLIC_LIST_DEFAULT_LIMIT } from './dto/ListWordsV1Query.dto';
import { decodeWordCursor, encodeWordCursor, wordListFingerprint } from './utils/cursor';

/**
 * What a spelling names in the dictionary: the headword the answer is
 * about, the other spellings that differ from it by case only, and the base
 * entries of the headword
 */
type ResolvedHeadwordT = { word: string; variants: string[]; ids: number[] };

/**
 * Read-only dictionary lookups of the public API (issue #272): a headword
 * with all of its entries, an entry by id, the filtered cursor-paged list
 * and a random entry. Everything answers in the shapes of
 * `types/public/v1`, built with the same mappers as the admin reads.
 */
@Injectable()
export class PublicWordsService {
  constructor(
    @InjectRepository(EnWord)
    private readonly enWordsRep: Repository<EnWord>,
    private readonly wordRows: WordRowsService,
    private readonly changes: EnChangesService,
  ) {}

  // ------------------------------------------------------------ headword

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
  private async resolveHeadwords(asked: string[]): Promise<Map<string, ResolvedHeadwordT>> {
    const found = new Map<string, ResolvedHeadwordT>();
    if (asked.length === 0) return found;
    const rows = await this.enWordsRep
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

  private async resolveHeadword(raw: string): Promise<ResolvedHeadwordT> {
    const word = raw.trim();
    const resolved = word ? (await this.resolveHeadwords([word])).get(word) : undefined;
    if (!resolved) {
      throw new NotFoundException(ErrorCodes.word_doesnt_found);
    }
    return resolved;
  }

  private metaOf({ word, variants }: ResolvedHeadwordT, count: number): PublicHeadwordV1MetaT {
    return { word, count, variants };
  }

  // Relation rows come back in storage order; the public answer sorts them
  // by their natural keys so consumers see one order on every driver
  private sortRelations(row: EnWord): EnWord {
    row.forms?.sort((a, b) => a.id - b.id);
    row.meanings?.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    row.meanings?.forEach((m) => m.translations?.sort((a, b) => a.id - b.id));
    row.short_translations?.sort((a, b) => a.id - b.id);
    return row;
  }

  // Every relation of the contract, projected by name (issue #392)
  private async loadFull(ids: number[]): Promise<PublicWordV1T[]> {
    const rows = await this.wordRows.load(ids, FULL_WORD_RELATIONS);
    const modified = await this.wordRows.modifiedArticles(rows);
    return rows.map((row) =>
      toPublicWord(this.sortRelations(row), {
        with_meanings: true,
        with_translations: true,
        with_phrasal_variants: true,
        modified: modified.has(row),
      }),
    );
  }

  async getByHeadword(raw: string): Promise<PublicHeadwordV1ResT> {
    const resolved = await this.resolveHeadword(raw);
    const data = await this.loadFull(resolved.ids);
    return { data, meta: this.metaOf(resolved, data.length) };
  }

  /**
   * Many headwords in two queries instead of two per word (issue #397): the
   * spellings are matched like the single lookup and de-duplicated in
   * request order by the headword they name; the ones naming no entry go to
   * `meta.not_found`
   */
  async getByHeadwords(raws: string[]): Promise<PublicWordsBatchV1ResT> {
    const asked = [...new Set(raws.map((raw) => raw.trim()).filter((word) => word !== ''))];
    const resolved = await this.resolveHeadwords(asked);
    const entries = await this.loadFull([...new Set([...resolved.values()].flatMap(({ ids }) => ids))]);
    const entryById = new Map(entries.map((entry) => [entry.id, entry]));
    const data = new Map<string, PublicWordsBatchItemV1T>();
    const not_found = new Set<string>();
    for (const word of asked) {
      const headword = resolved.get(word);
      if (!headword) {
        not_found.add(word.toLowerCase());
        continue;
      }
      // "Run" and "run" name one headword where the dictionary holds one spelling
      if (data.has(headword.word)) continue;
      const found = headword.ids
        .map((id) => entryById.get(id))
        .filter((entry): entry is PublicWordV1T => entry !== undefined);
      data.set(headword.word, { word: headword.word, count: found.length, entries: found });
    }
    return { data: [...data.values()], meta: { count: data.size, not_found: [...not_found] } };
  }

  // The entry a part belongs to, with what the entry itself says of where it
  // comes from (issue #527) and of whether it was changed (issue #531): a
  // meaning or a translation served on its own is attributed like the whole
  private entryRef(entry: PublicWordV1T): PublicEntryRefV1T {
    return {
      word_id: entry.id,
      part_of_speech: entry.part_of_speech,
      ...(entry.source !== undefined && { source: entry.source }),
      modified: entry.modified ?? false,
    };
  }

  async getMeaningsByHeadword(raw: string): Promise<PublicHeadwordMeaningsV1ResT> {
    const { data: entries, meta } = await this.getByHeadword(raw);
    const data = entries.flatMap((entry) =>
      entry.meanings.map((meaning) => ({ ...meaning, ...this.entryRef(entry) })),
    );
    return { data, meta };
  }

  /**
   * The edits of the entries a spelling names (issue #531). The history is
   * kept by the spelling of the base word, so the entries are found first:
   * "ran" answers with the history of "run".
   */
  async getHistoryByHeadword(raw: string): Promise<PublicHeadwordHistoryV1ResT> {
    const resolved = await this.resolveHeadword(raw);
    const rows = await this.enWordsRep.find({
      where: { id: In(resolved.ids) },
      select: { id: true, part_of_speech: true, word: { word: true } },
      relations: { word: true },
    });
    const articles = new Set(rows.map((row) => `${row.word.word}\u0000${row.part_of_speech}`));
    const edits = await this.changes.activeOf([...new Set(rows.map((row) => row.word.word))]);
    const data = edits
      // an edit without a part of speech is about every article of its headword
      .filter((edit) => !edit.part_of_speech || articles.has(`${edit.headword}\u0000${edit.part_of_speech}`))
      .map(toPublicChange);
    return { data, meta: { word: resolved.word, count: data.length, variants: resolved.variants } };
  }

  async getFormsByHeadword(raw: string): Promise<PublicHeadwordFormsV1ResT> {
    const { data: entries, meta } = await this.getByHeadword(raw);
    const data = entries.flatMap((entry) => entry.forms.map((form) => ({ ...form, ...this.entryRef(entry) })));
    return { data, meta };
  }

  /** The synonyms or antonyms of every meaning of the headword, each naming its meaning and entry (issue #403) */
  async getLinksByHeadword(raw: string, kind: WordLinkKindT): Promise<PublicHeadwordLinksV1ResT> {
    const { data: entries, meta } = await this.getByHeadword(raw);
    const data = entries.flatMap((entry) =>
      entry.meanings.flatMap((meaning) =>
        meaning[kind].map((word) => ({ word, meaning_id: meaning.id, ...this.entryRef(entry) })),
      ),
    );
    return { data, meta };
  }

  async getTranslationsByHeadword(
    raw: string,
    languages?: AvailableTranslationLanguagesE[],
  ): Promise<PublicHeadwordTranslationsV1ResT> {
    const { data: entries, meta } = await this.getByHeadword(raw);
    const matches = (language: AvailableTranslationLanguagesE) =>
      !languages?.length || languages.includes(language);
    const short_translations = entries.flatMap((entry) =>
      entry.short_translations
        .filter((t) => matches(t.language))
        .map((t) => ({ ...t, ...this.entryRef(entry) })),
    );
    const meaning_translations = entries.flatMap((entry) =>
      entry.meanings.flatMap((meaning) =>
        meaning.translations
          .filter((t) => matches(t.language))
          .map((t) => ({ ...t, meaning_id: meaning.id, ...this.entryRef(entry) })),
      ),
    );
    return { data: { short_translations, meaning_translations }, meta };
  }

  // ------------------------------------------------------------------ id

  async getById(id: number): Promise<PublicWordV1T> {
    const [entry] = await this.loadFull([id]);
    if (!entry) {
      throw new NotFoundException(ErrorCodes.word_doesnt_found);
    }
    return entry;
  }

  // ---------------------------------------------------------------- list

  /** The shared filters as WHERE clauses; values of one filter are OR-ed */
  private applyFilters(qb: SelectQueryBuilder<EnWord>, filters: WordFiltersV1QueryDTO): void {
    const forms = filters.form_of_word?.length ? filters.form_of_word : [EnWordFormsE.base_form];
    qb.andWhere('w.form_of_word IN (:...forms)', { forms });
    // a case-folded byte-order prefix on the headword: the same
    // IDX_EN_WORD_LOWER_C range the ordering walks, so an autocomplete page
    // is one index scan (issue #403)
    const prefix = filters.search?.trim().toLowerCase();
    if (prefix) {
      qb.andWhere(`${this.orderedWord} LIKE :prefix ESCAPE '\\'`, { prefix: `${escapeLike(prefix)}%` });
    }
    if (filters.is_obsolete !== undefined) {
      qb.andWhere({ is_obsolete: filters.is_obsolete });
    }
    if (filters.part_of_speech?.length) {
      qb.andWhere('w.part_of_speech IN (:...partsOfSpeech)', { partsOfSpeech: filters.part_of_speech });
    }
    if (filters.word_level?.length) {
      qb.andWhere('w.word_level IN (:...wordLevels)', { wordLevels: filters.word_level });
    }
    if (filters.language_register?.length) {
      qb.andWhere('w.language_register IN (:...registers)', { registers: filters.language_register });
    }
    if (filters.area_variant?.length) {
      qb.andWhere('w.area_variant IN (:...areaVariants)', { areaVariants: filters.area_variant });
    }
    if (filters.category?.length) {
      if (checkIsPostgres()) {
        // an enum[] column: the overlap operator is what the GIN index
        // IDX_EN_CATEGORIES serves (`= ANY(...)` is not indexable)
        qb.andWhere('w.categories && ARRAY[:...categories]::"en_words_categories_enum"[]', {
          categories: filters.category,
        });
      } else {
        // a comma-joined text on SQLite: match one whole token
        const clauses = filters.category.map(
          (_, i) => `(',' || w.categories || ',') LIKE ('%,' || :category${i} || ',%')`,
        );
        qb.andWhere(
          `(${clauses.join(' OR ')})`,
          Object.fromEntries(filters.category.map((c, i) => [`category${i}`, c])),
        );
      }
    }
  }

  private filtered(filters: WordFiltersV1QueryDTO): SelectQueryBuilder<EnWord> {
    const qb = this.enWordsRep.createQueryBuilder('w');
    this.applyFilters(qb, filters);
    return qb;
  }

  private async loadPage(ids: number[], query: ListWordsV1QueryDTO): Promise<PublicWordV1T[]> {
    if (ids.length === 0) return [];
    const with_meanings = query.with_meanings ?? false;
    const with_translations = query.with_translations ?? false;
    const relations: FindOptionsRelations<EnWord> = { ...SEARCH_ITEM_RELATIONS };
    if (with_meanings) relations.meanings = { translations: true, synonyms: true, antonyms: true };
    if (with_translations) relations.short_translations = true;
    const rows = await this.wordRows.load(ids, relations);
    const modified = await this.wordRows.modifiedArticles(rows);
    return rows.map((row) =>
      toPublicWord(this.sortRelations(row), { with_meanings, with_translations, modified: modified.has(row) }),
    );
  }

  // The headword column of en_words, case-folded and ordered by its bytes
  // (backed by IDX_EN_WORD_LOWER_C on Postgres); no join, en_entries.word
  // holds the same value
  private get orderedWord(): string {
    return foldedWord('w.word');
  }

  /**
   * Keyset pagination over (word, id): the page after a cursor is every row
   * that sorts after the cursor's row, so pages never repeat or skip items
   * while the dictionary is edited. One row past the page tells whether a
   * next page exists.
   */
  async listWords(query: ListWordsV1QueryDTO): Promise<PublicWordsV1ResT> {
    const limit = query.limit ?? PUBLIC_LIST_DEFAULT_LIMIT;
    const qb = this.filtered(query).select('w.id', 'id').addSelect('w.word', 'word');
    if (query.cursor !== undefined) {
      const cursor = decodeWordCursor(query.cursor);
      // a token of another filter set names a position in another listing
      if (!cursor || cursor.filters !== wordListFingerprint(query)) {
        throw new BadRequestException(ErrorCodes.invalid_cursor);
      }
      // a row comparison, not `word > :w OR (word = :w AND id > :id)`: the
      // planner turns it into one index range start (0.1 ms instead of a
      // 30 ms walk of the index from its beginning on the full dictionary)
      qb.andWhere(`(${this.orderedWord}, w.id) > (:cursorWord, :cursorId)`, {
        cursorWord: cursor.word.toLowerCase(),
        cursorId: cursor.id,
      });
    }
    const rows = await qb
      .orderBy(this.orderedWord, 'ASC')
      .addOrderBy('w.id', 'ASC')
      .limit(limit + 1)
      .getRawMany<{ id: number; word: string }>();
    const has_more = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const data = await this.loadPage(
      page.map((row) => Number(row.id)),
      query,
    );
    return {
      data,
      meta: {
        limit,
        has_more,
        next_cursor:
          has_more && last
            ? encodeWordCursor({ word: last.word, id: Number(last.id), filters: wordListFingerprint(query) })
            : null,
      },
    };
  }

  // -------------------------------------------------------------- random

  private async firstMatchFrom(
    filters: WordFiltersV1QueryDTO,
    pivot: number,
    direction: 'ASC' | 'DESC',
  ): Promise<number | null> {
    const hit = await this.filtered(filters)
      .select('w.id', 'id')
      .andWhere(direction === 'ASC' ? 'w.id >= :pivot' : 'w.id < :pivot', { pivot })
      .orderBy('w.id', direction)
      .limit(1)
      .getRawOne<{ id: unknown }>();
    return hit?.id === null || hit?.id === undefined ? null : Number(hit.id);
  }

  /**
   * A random entry without `ORDER BY random()`: a pivot is drawn in the id
   * range of the whole table (two primary-key lookups, whatever the
   * filters), then the first matching row at or after it is taken, wrapping
   * around to the last matching row before it — index lookups only, the
   * filter indexes bound the walk for selective filters. Rows right after a
   * gap in the ids are drawn slightly more often; for a "word of the day"
   * that bias does not matter.
   */
  async getRandom(filters: WordFiltersV1QueryDTO): Promise<PublicWordV1T> {
    const bounds = await this.enWordsRep
      .createQueryBuilder('w')
      .select('MIN(w.id)', 'min')
      .addSelect('MAX(w.id)', 'max')
      .getRawOne<{ min: unknown; max: unknown }>();
    if (bounds?.min === null || bounds?.min === undefined) {
      throw new NotFoundException(ErrorCodes.word_doesnt_found);
    }
    const min = Number(bounds.min);
    const max = Number(bounds.max);
    const pivot = min + Math.floor(Math.random() * (max - min + 1));
    const id =
      (await this.firstMatchFrom(filters, pivot, 'ASC')) ?? (await this.firstMatchFrom(filters, pivot, 'DESC'));
    if (id === null) {
      throw new NotFoundException(ErrorCodes.word_doesnt_found);
    }
    return this.getById(id);
  }
}
