import { Injectable, Optional } from '@nestjs/common';
import { MetricsService, SearchTierT } from '../../../MetricsModule/metrics.service';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsRelations, Repository } from 'typeorm';
import { EnWord } from '../../entities/en_word.entity';
import { SearchReqDTO } from './dto/SearchReq.dto';
import { SearchDetailedReqDTO } from './dto/SearchDetailedReq.dto';
import { EnEntryTypesE, SearchDetailedItemsT, SearchItemsT } from '../../../../../types';
import { checkIsPostgres } from '../../../../../configuration';
import { toPublicSearchWord, toPublicWord } from '../../../PublicApiModule/utils/projection';
import { escapeLike } from './utils/escapeLike';
import { foldedWord, likeIgnoringCase } from '../../utils/foldedWord';
import { WordRowsService } from '../../word-rows.service';
import { SEARCH_ITEM_RELATIONS } from '../../utils/wordRelations';

/**
 * Terms shorter than this get the short-term flow (issue #292): the exact
 * and prefix tiers only. A one- or two-character term matches half the
 * dictionary in the substring tiers (`%a%` ≈ 175k of 298k headwords), has
 * no full trigram for the GIN index and no meaningful similarity — the
 * user means a letter, an article or an abbreviation, all exact headwords.
 */
export const SEARCH_MIN_SUBSTRING_LENGTH = 3;

type OrderedIdsT = {
  ids: number[];
  similarity: Map<number, number>;
  fuzzy: boolean;
  short_term: boolean;
  // the tier that produced the top answer (Prometheus, issue #281)
  tier: SearchTierT;
};

@Injectable()
export class EnSearchService {
  constructor(
    @InjectRepository(EnWord)
    private readonly enWordsRep: Repository<EnWord>,
    private readonly wordRows: WordRowsService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  private async getExactMatchesAndPhrasalVerbsIds(search: string, type: EnEntryTypesE | undefined) {
    const exactSet = new Set<number>();
    const phrasalSet = new Set<number>();
    const qb = this.enWordsRep
      .createQueryBuilder('w')
      .innerJoin('w.word', 'entry')
      .leftJoinAndSelect('w.base_form', 'baseForm')
      .leftJoinAndSelect('baseForm.base_phrasal', 'baseFormBasePhrasal')
      .leftJoinAndSelect('baseForm.phrasal_variants', 'baseFormPhrasalVariants')
      .leftJoinAndSelect('w.base_phrasal', 'basePhrasal')
      .leftJoinAndSelect('w.phrasal_variants', 'phrasalVariants')
      .where(`${foldedWord('entry.word')} = :word`, { word: search });
    // the type filter binds every tier, the exact one included (issue #440)
    if (type) qb.andWhere('entry.type = :type', { type });
    const exactMatch = await qb.getMany();
    // phrasal variants are words: with another type asked for they stay out
    const withPhrasal = !type || type === EnEntryTypesE.word;

    exactMatch?.forEach((w) => {
      if (w.base_form) {
        exactSet.add(w.base_form.id);
        if (withPhrasal && w.base_form.phrasal_variants) {
          w.base_form.phrasal_variants.forEach((p) => phrasalSet.add(p.id));
        }
      } else {
        exactSet.add(w.id);
        if (withPhrasal && w.phrasal_variants) {
          w.phrasal_variants.forEach((p) => phrasalSet.add(p.id));
        }
      }
    });

    return { exactSet, phrasalSet };
  }

  /**
   * One substring tier (phrase, suffix, contains) as a grouped query (issue
   * #440): every matching row — a headword or one of its inflected forms —
   * resolves to its base entry, one id per entry, and the LIMIT applies after
   * the grouping, so a tier fills the limit it is given even when the forms
   * outnumber the headwords, and a form never shows up next to its base. The
   * shortest headword comes first — "language" before "body language" for
   * "guag" — ties broken by the byte order of the first matching spelling.
   * The prefix tier has its own reader below.
   */
  private async tierIds(
    match: { where: string; params: Record<string, string> },
    includedTypes: EnEntryTypesE[],
    excludedIds: number[],
    limit: number,
  ): Promise<Set<number>> {
    const ids = new Set<number>();
    if (limit <= 0 || includedTypes.length === 0) return ids;

    const qb = this.enWordsRep
      .createQueryBuilder('w')
      .innerJoin('w.word', 'entry')
      .leftJoin('w.base_form', 'baseForm')
      .select('COALESCE(baseForm.id, w.id)', 'id')
      .addSelect(`MIN(${foldedWord('entry.word')})`, 'first_word')
      .where(match.where, match.params)
      .andWhere('entry.type IN (:...includedTypes)', { includedTypes });

    if (excludedIds.length > 0) {
      qb.andWhere('w.id NOT IN (:...excludedIds)', { excludedIds }).andWhere(
        '(baseForm.id IS NULL OR baseForm.id NOT IN (:...excludedIds))',
        { excludedIds },
      );
    }

    const rows = await qb
      .addSelect('MIN(LENGTH(entry.word))', 'shortest')
      .groupBy('COALESCE(baseForm.id, w.id)')
      .orderBy('shortest', 'ASC')
      .addOrderBy('first_word', 'ASC')
      .limit(limit)
      .getRawMany<{ id: unknown }>();
    rows.forEach((row) => ids.add(Number(row.id)));
    return ids;
  }

  /**
   * Headwords (and forms, resolved to their base) starting with the term, in
   * byte order; words only. Unlike the other tiers this one is not grouped in
   * SQL: a one-letter prefix matches ~18k rows and a GROUP BY would aggregate
   * them all before the LIMIT (40 ms), while the folded index already yields
   * the rows in the order wanted. So the rows are read in that order, LIMIT
   * on rows, and collapsed to their base entry here; when the forms leave the
   * chunk short of `limit` headwords, the next chunk starts after its last row
   * (a keyset), so the cost stays a bounded index range whatever the prefix.
   */
  private async getWordsStartsFromSearch(
    search: string,
    type: EnEntryTypesE | undefined,
    excludedIds: number[],
    limit: number,
  ): Promise<Set<number>> {
    const ids = new Set<number>();
    if (limit <= 0 || (type && type !== EnEntryTypesE.word)) return ids;
    const word = foldedWord('entry.word');
    const chunk = Math.max(limit * 2, 20);
    let after: { word: string; id: number } | undefined;
    // each chunk yields at least one new headword or ends the matches, so the
    // loop is bounded by the limit; the cap is a safety net against a pathology
    for (let round = 0; round < 8 && ids.size < limit; round += 1) {
      const qb = this.enWordsRep
        .createQueryBuilder('w')
        .innerJoin('w.word', 'entry')
        .leftJoin('w.base_form', 'baseForm')
        .select('COALESCE(baseForm.id, w.id)', 'id')
        .addSelect(word, 'first_word')
        .addSelect('w.id', 'row_id')
        .where(`${word} LIKE :word ESCAPE '\\'`, { word: `${escapeLike(search)}%` })
        .andWhere('entry.type = :wordType', { wordType: EnEntryTypesE.word });
      if (excludedIds.length > 0) {
        qb.andWhere('w.id NOT IN (:...excludedIds)', { excludedIds }).andWhere(
          '(baseForm.id IS NULL OR baseForm.id NOT IN (:...excludedIds))',
          { excludedIds },
        );
      }
      if (after) {
        qb.andWhere(`(${word}, w.id) > (:afterWord, :afterId)`, { afterWord: after.word, afterId: after.id });
      }
      const rows = await qb
        .orderBy('first_word', 'ASC')
        .addOrderBy('w.id', 'ASC')
        .limit(chunk)
        .getRawMany<{ id: unknown; first_word: string; row_id: unknown }>();
      for (const row of rows) {
        if (ids.size >= limit) break;
        ids.add(Number(row.id));
      }
      if (rows.length < chunk) break;
      const last = rows[rows.length - 1];
      after = { word: last.first_word, id: Number(last.row_id) };
    }
    return ids;
  }

  /** Headwords (and forms, resolved to their base) ending with the term; words only */
  private getWordsEndsFromSearch(
    search: string,
    type: EnEntryTypesE | undefined,
    excludedIds: number[],
    limit: number,
  ) {
    return this.tierIds(
      {
        where: `entry.word ${likeIgnoringCase()} :word ESCAPE '\\'`,
        params: { word: `%${escapeLike(search)}` },
      },
      !type || type === EnEntryTypesE.word ? [EnEntryTypesE.word] : [],
      excludedIds,
      limit,
    );
  }

  /** Anything containing the term, of the requested type or of every type */
  private getAnyMatchesWords(
    search: string,
    type: EnEntryTypesE | undefined,
    excludedIds: number[],
    limit: number,
  ) {
    return this.tierIds(
      {
        where: `entry.word ${likeIgnoringCase()} :word ESCAPE '\\'`,
        params: { word: `%${escapeLike(search)}%` },
      },
      type ? [type] : [EnEntryTypesE.grammar_pattern, EnEntryTypesE.phrase, EnEntryTypesE.word],
      excludedIds,
      limit,
    );
  }

  /** Phrases and grammar patterns containing the term as a whole word */
  private getPhrases(search: string, type: EnEntryTypesE | undefined, excludedIds: number[], limit: number) {
    const includedTypes = type
      ? [EnEntryTypesE.phrase, EnEntryTypesE.grammar_pattern].filter((t) => t === type)
      : [EnEntryTypesE.phrase, EnEntryTypesE.grammar_pattern];
    return this.tierIds(
      {
        // Three plain LIKEs: with the type predicate the planner walks the
        // ~26k phrases through IDX_EN_ENTRY_TYPE and filters, whatever the
        // operator — LIKE costs 5 ms over them, ILIKE 26 ms (docs/performance.md).
        // The term is lower case and so are the phrases; a capital inside a
        // grammar pattern is reached by the contains tier (ILIKE, trigram GIN).
        where:
          `(entry.word LIKE :start ESCAPE '\\' ` +
          "OR entry.word LIKE :middle ESCAPE '\\' OR entry.word LIKE :end ESCAPE '\\')",
        params: {
          start: `${escapeLike(search)} %`,
          middle: `% ${escapeLike(search)} %`,
          end: `% ${escapeLike(search)}`,
        },
      },
      includedTypes,
      excludedIds,
      limit,
    );
  }

  /**
   * The fuzzy tier (issue #278, Postgres only): headwords whose trigrams are
   * similar enough to the term (`%`, pg_trgm.similarity_threshold, 0.3 by
   * default), best match first, served by the GIN index IDX_EN_ENTRY_WORD_TRGM.
   * Inflected forms resolve to their base entry like in the other tiers.
   * Returns the similarity per word id.
   */
  private async getFuzzyMatches(
    search: string,
    type: EnEntryTypesE | undefined,
    limit: number,
  ): Promise<Map<number, number>> {
    const matches = new Map<number, number>();
    if (!checkIsPostgres() || limit <= 0) return matches;

    const includedTypes = type
      ? [type]
      : [EnEntryTypesE.grammar_pattern, EnEntryTypesE.phrase, EnEntryTypesE.word];
    const rows = await this.enWordsRep
      .createQueryBuilder('w')
      .innerJoin('w.word', 'entry')
      .leftJoin('w.base_form', 'baseForm')
      .select('COALESCE(baseForm.id, w.id)', 'id')
      .addSelect('similarity(entry.word, :search)', 'similarity')
      .where('entry.word % :search', { search })
      .andWhere('entry.type IN (:...includedTypes)', { includedTypes })
      .orderBy('similarity', 'DESC')
      .addOrderBy('entry.word', 'ASC')
      // several forms may resolve to one base entry; over-fetch, then dedupe
      .limit(limit * 3)
      .getRawMany<{ id: unknown; similarity: unknown }>();
    for (const row of rows) {
      const id = Number(row.id);
      if (!matches.has(id)) matches.set(id, Number(Number(row.similarity).toFixed(3)));
      if (matches.size >= limit) break;
    }
    return matches;
  }

  /**
   * Runs every tier in relevance order (exact, phrasal, starts-with, phrases,
   * ends-with, any) and returns up to `target` word ids in that order. When
   * none of them matches, the fuzzy tier answers instead (`similarity` per
   * id, `fuzzy: true`). A term shorter than SEARCH_MIN_SUBSTRING_LENGTH
   * stops after the starts-with tier (`short_term: true`, issue #292).
   */
  private async collectOrderedIds(
    search: string,
    type: EnEntryTypesE | undefined,
    target: number,
  ): Promise<OrderedIdsT> {
    const ordered: number[] = [];
    // a blank term names nothing; the prefix tier would otherwise match every headword
    if (search.length === 0) {
      return { ids: ordered, similarity: new Map(), fuzzy: false, short_term: true, tier: 'none' };
    }
    // the tier of the first id pushed: the one that produced the top answer
    let tier: SearchTierT = 'none';
    const pushUpToTarget = (set: Set<number>, from: SearchTierT) => {
      for (const id of set) {
        if (ordered.length >= target) return;
        if (ordered.length === 0) tier = from;
        ordered.push(id);
      }
    };

    const { exactSet, phrasalSet } = await this.getExactMatchesAndPhrasalVerbsIds(search, type);
    pushUpToTarget(exactSet, 'exact');
    pushUpToTarget(phrasalSet, 'phrasal');
    // exact/phrasal ids beyond the target still must not resurface in lower tiers
    let excludedIds = [...exactSet, ...phrasalSet];

    const wordsStartFromSet = await this.getWordsStartsFromSearch(
      search,
      type,
      excludedIds,
      target - ordered.length,
    );
    pushUpToTarget(wordsStartFromSet, 'prefix');
    excludedIds = [...excludedIds, ...wordsStartFromSet];

    // the short-term flow stops here: no phrase, suffix, substring or fuzzy
    // tier for a one- or two-character term (both index lookups so far)
    if (search.length < SEARCH_MIN_SUBSTRING_LENGTH) {
      return { ids: ordered, similarity: new Map(), fuzzy: false, short_term: true, tier };
    }

    const phrasesExactSet = await this.getPhrases(search, type, excludedIds, target - ordered.length);
    pushUpToTarget(phrasesExactSet, 'phrase');
    excludedIds = [...excludedIds, ...phrasesExactSet];

    const wordsEndsFromSet = await this.getWordsEndsFromSearch(
      search,
      type,
      excludedIds,
      target - ordered.length,
    );
    pushUpToTarget(wordsEndsFromSet, 'suffix');
    excludedIds = [...excludedIds, ...wordsEndsFromSet];

    const anyMatchesWordsSet = await this.getAnyMatchesWords(
      search,
      type,
      excludedIds,
      target - ordered.length,
    );
    pushUpToTarget(anyMatchesWordsSet, 'contains');

    if (ordered.length === 0) {
      const similarity = await this.getFuzzyMatches(search, type, target);
      const fuzzy = similarity.size > 0;
      return {
        ids: [...similarity.keys()],
        similarity,
        fuzzy,
        short_term: false,
        tier: fuzzy ? 'fuzzy' : 'none',
      };
    }
    return { ids: ordered, similarity: new Map(), fuzzy: false, short_term: false, tier };
  }

  private async findWordsByIdsOrdered(
    ids: number[],
    relations: FindOptionsRelations<EnWord>,
  ): Promise<EnWord[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.wordRows.load(ids, relations);
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.map((id) => byId.get(id)).filter((row): row is EnWord => row !== undefined);
  }

  async searchFlat({ search: s, type, limit }: SearchReqDTO): Promise<SearchItemsT> {
    const search = s.trim().toLowerCase();
    const { ids, similarity, fuzzy, short_term, tier } = await this.collectOrderedIds(search, type, limit);
    this.metrics?.searchAnswered(tier, short_term);
    // the phrasal base too: the item type promises `base_phrasal` (issue #392)
    const words = await this.findWordsByIdsOrdered(ids, SEARCH_ITEM_RELATIONS);
    // a search answer shows what an entry says, so it says whether that was changed (issue #531)
    const modified = await this.wordRows.modifiedArticles(words);
    return {
      items: words.map((w) =>
        toPublicSearchWord(w, { similarity: similarity?.get(w.id), modified: modified.has(w) }),
      ),
      fuzzy,
      short_term,
    };
  }

  async searchDetailed({
    search: s,
    type,
    limit = 10,
    page = 1,
    with_meanings = false,
    with_translations = false,
    translation_languages,
  }: SearchDetailedReqDTO): Promise<SearchDetailedItemsT> {
    const search = s.trim().toLowerCase();
    // one id past the requested page tells whether the next page exists
    const { ids, similarity, fuzzy, short_term, tier } = await this.collectOrderedIds(
      search,
      type,
      page * limit + 1,
    );
    this.metrics?.searchAnswered(tier, short_term);
    const pageIds = ids.slice((page - 1) * limit, page * limit);

    const relations: FindOptionsRelations<EnWord> = { ...SEARCH_ITEM_RELATIONS };
    if (with_meanings) {
      relations.meanings = { translations: true, synonyms: true, antonyms: true };
    }
    if (with_translations) {
      relations.short_translations = true;
    }

    const words = await this.findWordsByIdsOrdered(pageIds, relations);
    const modified = await this.wordRows.modifiedArticles(words);
    return {
      items: words.map((w) =>
        toPublicWord(w, {
          with_meanings,
          with_translations,
          translation_languages,
          similarity: similarity?.get(w.id),
          modified: modified.has(w),
        }),
      ),
      page,
      limit,
      has_more: ids.length > page * limit,
      fuzzy,
      short_term,
    };
  }
}
