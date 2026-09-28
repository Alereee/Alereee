import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityMetadata, FindOptionsRelations, SelectQueryBuilder } from 'typeorm';
import { EnWord } from './entities/en_word.entity';
import { EnChange } from './entities/en_change.entity';
import { EnEntry } from './entities/en_entry.entity';
import { EnMeaning } from './entities/en_meaning.entity';
import { EnMeaningTranslation } from './entities/en_meaning_translation.entity';
import { EnShortTranslation } from './entities/en_short_translation.entity';
import { EnWordFormsE } from '../../../types';

type PlainT = Record<string, unknown>;
type RelationsT = FindOptionsRelations<EnWord>;

/**
 * Loads dictionary entries with their relations as plain objects shaped like
 * the entities (issue #424). `find({ relations, relationLoadStrategy: 'query' })`
 * sends the same statements — one per relation, `WHERE fk IN (...)` over the id
 * list — but then spends four times the database's time turning the rows into
 * entity instances (~220 ms of a 275 ms batch of 50 headwords). Here each
 * statement selects its columns explicitly, the driver converts the raw values
 * (booleans, enums, arrays, JSON, dates — `prepareHydratedValue`, the same
 * conversion hydration applies) and the collections are grouped by foreign key
 * in one pass. The result is what the mappers (`prepareWordFromDB`,
 * `toPublicWord`) read: the scalar columns of every row and the relations asked
 * for, each collection ordered by its natural key.
 */
/** Answers whether a row belongs to an article with edits that still show */
export type ModifiedArticlesT = { has: (row: EnWord) => boolean };

const articleKey = (headword: string, partOfSpeech: string | null): string =>
  `${headword}\u0000${partOfSpeech ?? ''}`;

@Injectable()
export class WordRowsService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  private get escape(): (name: string) => string {
    return (name) => this.dataSource.driver.escape(name);
  }

  private column(alias: string, databaseName: string): string {
    return `${this.escape(alias)}.${this.escape(databaseName)}`;
  }

  /** The scalar (non-foreign-key) columns of an entity, selected under `alias_<column>` */
  private selectScalars<T extends object>(
    qb: SelectQueryBuilder<T>,
    meta: EntityMetadata,
    alias: string,
  ): void {
    for (const col of meta.columns) {
      if (col.relationMetadata) continue;
      qb.addSelect(this.column(alias, col.databaseName), `${alias}_${col.databaseName}`);
    }
  }

  /** A foreign-key column, selected under `alias_<column>` */
  private selectKey<T extends object>(qb: SelectQueryBuilder<T>, alias: string, databaseName: string): void {
    qb.addSelect(this.column(alias, databaseName), `${alias}_${databaseName}`);
  }

  private hydrate(meta: EntityMetadata, raw: PlainT, alias: string): PlainT {
    const row: PlainT = {};
    for (const col of meta.columns) {
      if (col.relationMetadata) continue;
      const value = raw[`${alias}_${col.databaseName}`];
      row[col.propertyName] =
        value === undefined ? undefined : this.dataSource.driver.prepareHydratedValue(value, col);
    }
    return row;
  }

  private fk(meta: EntityMetadata, relation: string): string {
    const found = meta.findRelationWithPropertyPath(relation);
    if (!found || found.joinColumns.length !== 1) throw new Error(`no single join column for ${relation}`);
    return found.joinColumns[0].databaseName;
  }

  private junction(meta: EntityMetadata, relation: string): { table: string; owner: string; inverse: string } {
    const found = meta.findRelationWithPropertyPath(relation);
    const junction = found?.junctionEntityMetadata;
    if (!found || !junction) throw new Error(`no junction table for ${relation}`);
    return {
      table: junction.tableName,
      owner: found.joinColumns[0].databaseName,
      inverse: found.inverseJoinColumns[0].databaseName,
    };
  }

  // whether a relation option asks for the headword row (`{ word: true }`) of its rows
  private wantsEntry(option: unknown): boolean {
    return typeof option === 'object' && option !== null && Boolean((option as { word?: unknown }).word);
  }

  // whether a link option asks for the entry's word rows (`{ entries: true }`)
  private wantsEntries(option: unknown): boolean {
    return typeof option === 'object' && option !== null && Boolean((option as { entries?: unknown }).entries);
  }

  private groupBy<T>(rows: T[], key: (row: T) => unknown): Map<unknown, T[]> {
    const groups = new Map<unknown, T[]>();
    for (const row of rows) {
      const k = key(row);
      const group = groups.get(k);
      if (group) group.push(row);
      else groups.set(k, [row]);
    }
    return groups;
  }

  /**
   * The entries with the given ids, in the order of `ids`, carrying the
   * relations of `relations` (the keys of FULL_WORD_RELATIONS are understood);
   * an unknown id is skipped
   */
  /**
   * The articles among the given rows that were changed or added on this
   * instance (issue #531): the ones with an edit that still shows in what is
   * served. One statement for the whole answer, by the index of the
   * headword; an edit without a part of speech is about every article of
   * its headword. A form row answers for its own spelling.
   */
  async modifiedArticles(rows: readonly EnWord[]): Promise<ModifiedArticlesT> {
    const headwords = [...new Set(rows.map((row) => row.word?.word).filter(Boolean))];
    const found = new Set<string>();
    if (headwords.length > 0) {
      const edits = await this.dataSource
        .getRepository(EnChange)
        .createQueryBuilder('c')
        .select(['c.headword AS headword', 'c.part_of_speech AS part_of_speech'])
        .distinct(true)
        .where('c.headword IN (:...headwords)', { headwords })
        .andWhere('c.superseded_at IS NULL')
        .getRawMany<{ headword: string; part_of_speech: string | null }>();
      for (const edit of edits) found.add(articleKey(edit.headword, edit.part_of_speech));
    }
    return {
      has: (row) =>
        found.has(articleKey(row.word.word, row.part_of_speech)) || found.has(articleKey(row.word.word, null)),
    };
  }

  async load(ids: number[], relations: RelationsT): Promise<EnWord[]> {
    if (ids.length === 0) return [];
    const words = this.dataSource.getMetadata(EnWord);
    const entries = this.dataSource.getMetadata(EnEntry);
    const meanings = this.dataSource.getMetadata(EnMeaning);
    const translations = this.dataSource.getMetadata(EnMeaningTranslation);
    const shorts = this.dataSource.getMetadata(EnShortTranslation);
    const wordFk = this.fk(words, 'word');
    const baseFormFk = this.fk(words, 'base_form');
    const basePhrasalFk = this.fk(words, 'base_phrasal');

    // ---- the entries themselves, with the headword row and the phrasal base
    const qb = this.dataSource.createQueryBuilder(EnWord, 'w').select([]);
    this.selectScalars(qb, words, 'w');
    this.selectKey(qb, 'w', wordFk);
    if (relations.word) {
      qb.leftJoin('w.word', 'entry');
      this.selectScalars(qb, entries, 'entry');
    }
    const basePhrasalEntry = this.wantsEntry(relations.base_phrasal);
    if (relations.base_phrasal) {
      qb.leftJoin('w.base_phrasal', 'bp');
      this.selectScalars(qb, words, 'bp');
      this.selectKey(qb, 'bp', wordFk);
      if (basePhrasalEntry) {
        qb.leftJoin('bp.word', 'bpe');
        this.selectScalars(qb, entries, 'bpe');
      }
    }
    const rawWords = (await qb
      .where(`${this.column('w', 'id')} IN (:...ids)`, { ids })
      .getRawMany()) as PlainT[];
    const byId = new Map<number, PlainT>();
    for (const raw of rawWords) {
      const row = this.hydrate(words, raw, 'w');
      row.word = relations.word ? this.hydrate(entries, raw, 'entry') : { word: raw[`w_${wordFk}`] };
      if (relations.base_phrasal) {
        const id = raw['bp_id'];
        row.base_phrasal =
          id === null || id === undefined
            ? null
            : {
                ...this.hydrate(words, raw, 'bp'),
                word: basePhrasalEntry ? this.hydrate(entries, raw, 'bpe') : { word: raw[`bp_${wordFk}`] },
              };
      }
      byId.set(row.id as number, row);
    }
    const found = ids.map((id) => byId.get(id)).filter((row): row is PlainT => row !== undefined);
    const foundIds = found.map((row) => row.id as number);
    if (foundIds.length === 0) return [];

    // ---- the collections hang off the entries (wave 1) and off the meanings
    // (wave 2); each wave runs its statements concurrently — a full read
    // costs two round-trips after the entries, not seven in a row
    const [formsOf, meaningRows, shortsOf, variantsOf] = await Promise.all([
      relations.forms
        ? this.loadForms(words, entries, foundIds, wordFk, baseFormFk, this.wantsEntry(relations.forms))
        : null,
      relations.meanings ? this.loadMeanings(meanings, foundIds) : null,
      relations.short_translations ? this.loadShortTranslations(shorts, foundIds) : null,
      relations.phrasal_variants
        ? this.loadVariants(
            words,
            entries,
            foundIds,
            wordFk,
            basePhrasalFk,
            this.wantsEntry(relations.phrasal_variants),
          )
        : null,
    ]);
    if (formsOf) for (const row of found) row.forms = formsOf.get(row.id) ?? [];
    if (shortsOf) for (const row of found) row.short_translations = shortsOf.get(row.id) ?? [];
    if (variantsOf) for (const row of found) row.phrasal_variants = variantsOf.get(row.id) ?? [];

    if (meaningRows) {
      const nested = typeof relations.meanings === 'object' ? relations.meanings : {};
      const meaningIds = meaningRows.map((row) => row.id as number);
      const [translationsOf, synonymsOf, antonymsOf] = await Promise.all([
        nested.translations && meaningIds.length > 0 ? this.loadTranslations(translations, meaningIds) : null,
        nested.synonyms && meaningIds.length > 0
          ? this.loadLinks(meanings, entries, words, 'synonyms', meaningIds, this.wantsEntries(nested.synonyms))
          : null,
        nested.antonyms && meaningIds.length > 0
          ? this.loadLinks(meanings, entries, words, 'antonyms', meaningIds, this.wantsEntries(nested.antonyms))
          : null,
      ]);
      const groups = this.groupBy(meaningRows, (row) => row.owner);
      for (const row of found) {
        row.meanings = (groups.get(row.id) ?? []).map(({ owner: _owner, ...meaning }) => ({
          ...meaning,
          ...(nested.translations && { translations: translationsOf?.get(meaning.id) ?? [] }),
          ...(nested.synonyms && { synonyms: synonymsOf?.get(meaning.id) ?? [] }),
          ...(nested.antonyms && { antonyms: antonymsOf?.get(meaning.id) ?? [] }),
        }));
      }
    }

    return found as unknown as EnWord[];
  }

  private async loadForms(
    words: EntityMetadata,
    entries: EntityMetadata,
    ids: number[],
    wordFk: string,
    baseFormFk: string,
    withEntry: boolean,
  ): Promise<Map<unknown, PlainT[]>> {
    const fq = this.dataSource.createQueryBuilder(EnWord, 'f').select([]);
    this.selectScalars(fq, words, 'f');
    this.selectKey(fq, 'f', wordFk);
    this.selectKey(fq, 'f', baseFormFk);
    if (withEntry) {
      fq.leftJoin('f.word', 'fe');
      this.selectScalars(fq, entries, 'fe');
    }
    const raw = (await fq
      .where(`${this.column('f', baseFormFk)} IN (:...ids)`, { ids })
      .orderBy(this.column('f', 'id'), 'ASC')
      .getRawMany()) as PlainT[];
    const groups = new Map<unknown, PlainT[]>();
    for (const r of raw) {
      const form = {
        ...this.hydrate(words, r, 'f'),
        word: withEntry ? this.hydrate(entries, r, 'fe') : { word: r[`f_${wordFk}`] },
      };
      const base = r[`f_${baseFormFk}`];
      groups.set(base, [...(groups.get(base) ?? []), form]);
    }
    return groups;
  }

  private async loadMeanings(
    meanings: EntityMetadata,
    ids: number[],
  ): Promise<Array<PlainT & { owner: unknown }>> {
    const meaningFk = this.fk(meanings, 'word');
    const mq = this.dataSource.createQueryBuilder(EnMeaning, 'm').select([]);
    this.selectScalars(mq, meanings, 'm');
    this.selectKey(mq, 'm', meaningFk);
    const raw = (await mq
      .where(`${this.column('m', meaningFk)} IN (:...ids)`, { ids })
      .orderBy(this.column('m', 'sort_order'), 'ASC')
      .addOrderBy(this.column('m', 'id'), 'ASC')
      .getRawMany()) as PlainT[];
    return raw.map((r) => ({ ...this.hydrate(meanings, r, 'm'), owner: r[`m_${meaningFk}`] }));
  }

  private async loadTranslations(
    translations: EntityMetadata,
    meaningIds: number[],
  ): Promise<Map<unknown, PlainT[]>> {
    const translationFk = this.fk(translations, 'meaning');
    const tq = this.dataSource.createQueryBuilder(EnMeaningTranslation, 't').select([]);
    this.selectScalars(tq, translations, 't');
    this.selectKey(tq, 't', translationFk);
    const raw = (await tq
      .where(`${this.column('t', translationFk)} IN (:...ids)`, { ids: meaningIds })
      .orderBy(this.column('t', 'id'), 'ASC')
      .getRawMany()) as PlainT[];
    const groups = new Map<unknown, PlainT[]>();
    for (const r of raw) {
      const owner = r[`t_${translationFk}`];
      groups.set(owner, [...(groups.get(owner) ?? []), this.hydrate(translations, r, 't')]);
    }
    return groups;
  }

  // the junction rows joined with the linked headword's entry row; with
  // `withEntries` each entry also carries its base-form word rows (`entries`),
  // what the dataset export derives a link's part of speech from
  private async loadLinks(
    meanings: EntityMetadata,
    entries: EntityMetadata,
    words: EntityMetadata,
    kind: 'synonyms' | 'antonyms',
    meaningIds: number[],
    withEntries: boolean,
  ): Promise<Map<unknown, PlainT[]>> {
    const { table, owner, inverse } = this.junction(meanings, kind);
    const lq = this.dataSource
      .createQueryBuilder()
      .select(this.column('j', owner), 'owner')
      .from(table, 'j')
      .leftJoin(entries.tableName, 'le', `${this.column('le', 'word')} = ${this.column('j', inverse)}`);
    this.selectScalars(lq, entries, 'le');
    const raw = (await lq
      .where(`${this.column('j', owner)} IN (:...ids)`, { ids: meaningIds })
      .orderBy(this.column('j', inverse), 'ASC')
      .getRawMany()) as PlainT[];
    const linked = raw.map((r) => ({ owner: r.owner, entry: this.hydrate(entries, r, 'le') }));

    if (withEntries && linked.length > 0) {
      const wordFk = this.fk(words, 'word');
      const names = [...new Set(linked.map((l) => l.entry.word as string))];
      const bq = this.dataSource.createQueryBuilder(EnWord, 'lw').select([]);
      this.selectScalars(bq, words, 'lw');
      this.selectKey(bq, 'lw', wordFk);
      const baseRows = (await bq
        .where(`${this.column('lw', wordFk)} IN (:...names)`, { names })
        .andWhere(`${this.column('lw', 'form_of_word')} = :baseForm`, { baseForm: EnWordFormsE.base_form })
        .orderBy(this.column('lw', 'id'), 'ASC')
        .getRawMany()) as PlainT[];
      // the rows carry no `word` relation, exactly as find() leaves them
      const rowsOf = this.groupBy(
        baseRows.map((r) => ({ headword: r[`lw_${wordFk}`], row: this.hydrate(words, r, 'lw') })),
        (r) => r.headword,
      );
      for (const l of linked) l.entry.entries = (rowsOf.get(l.entry.word) ?? []).map((r) => r.row);
    }

    const groups = new Map<unknown, PlainT[]>();
    for (const l of linked) groups.set(l.owner, [...(groups.get(l.owner) ?? []), l.entry]);
    return groups;
  }

  private async loadShortTranslations(shorts: EntityMetadata, ids: number[]): Promise<Map<unknown, PlainT[]>> {
    const shortFk = this.fk(shorts, 'word');
    const sq = this.dataSource.createQueryBuilder(EnShortTranslation, 's').select([]);
    this.selectScalars(sq, shorts, 's');
    this.selectKey(sq, 's', shortFk);
    const raw = (await sq
      .where(`${this.column('s', shortFk)} IN (:...ids)`, { ids })
      .orderBy(this.column('s', 'id'), 'ASC')
      .getRawMany()) as PlainT[];
    const groups = new Map<unknown, PlainT[]>();
    for (const r of raw) {
      const owner = r[`s_${shortFk}`];
      groups.set(owner, [...(groups.get(owner) ?? []), this.hydrate(shorts, r, 's')]);
    }
    return groups;
  }

  // the rows whose phrasal base is one of the entries
  private async loadVariants(
    words: EntityMetadata,
    entries: EntityMetadata,
    ids: number[],
    wordFk: string,
    basePhrasalFk: string,
    withEntry: boolean,
  ): Promise<Map<unknown, PlainT[]>> {
    const vq = this.dataSource.createQueryBuilder(EnWord, 'v').select([]);
    this.selectScalars(vq, words, 'v');
    this.selectKey(vq, 'v', wordFk);
    this.selectKey(vq, 'v', basePhrasalFk);
    if (withEntry) {
      vq.leftJoin('v.word', 've');
      this.selectScalars(vq, entries, 've');
    }
    const raw = (await vq
      .where(`${this.column('v', basePhrasalFk)} IN (:...ids)`, { ids })
      .orderBy(this.column('v', 'id'), 'ASC')
      .getRawMany()) as PlainT[];
    const groups = new Map<unknown, PlainT[]>();
    for (const r of raw) {
      const variant = {
        ...this.hydrate(words, r, 'v'),
        word: withEntry ? this.hydrate(entries, r, 've') : { word: r[`v_${wordFk}`] },
      };
      const base = r[`v_${basePhrasalFk}`];
      groups.set(base, [...(groups.get(base) ?? []), variant]);
    }
    return groups;
  }
}
