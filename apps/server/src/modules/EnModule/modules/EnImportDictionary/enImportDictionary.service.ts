import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { AuditActionE, AuditEntityTypeE, AuditTriggerE } from '../../../../../types';
import { AuditService } from '../../../AuditModule/audit.service';
import { InjectRepository } from '@nestjs/typeorm';
import { MetricsService } from '../../../MetricsModule/metrics.service';
import { EntityManager, FindOptionsRelations, In, Repository } from 'typeorm';
import * as yazl from 'yazl';
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, WriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { stat, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as readline from 'node:readline';
import { type Response } from 'express';
import { EnWord } from '../../entities/en_word.entity';
import { EnEntry } from '../../entities/en_entry.entity';
import { EnMeaning } from '../../entities/en_meaning.entity';
import { EnMeaningTranslation } from '../../entities/en_meaning_translation.entity';
import { EnShortTranslation } from '../../entities/en_short_translation.entity';
import { WordRowsService } from '../../word-rows.service';
import { normalizeWordLinks, WORD_LINK_KINDS, WordLinkKindT } from '../../utils/normalizeWordLinks';
import { resolveBaseFormHeadwords } from '../../utils/findBaseFormHeadwords';
import { ImportDictionaryReq, ImportDictionarySourceDTO } from './dto/ImportDictionaryReq.dto';
import {
  AvailableTranslationLanguagesE,
  DatasetManifestT,
  EnEntryTypesE,
  EnPartOfSpeechE,
  EnWordFormsE,
  EnWordT,
  ImportDictionaryChunkT,
  ImportSourceKindE,
  ImportSourcesT,
  ImportTriggerE,
} from '../../../../../types';
import { SettingsService } from '../../../SettingsModule/settings.service';
import { ImportStatusService } from './importStatus.service';
import { HttpImportProgressSink, ImportProgressSink } from './progress';
import type { DatasetSourceFactoryT } from './sources';
import { ErrorCodes } from '../../../../../core/constants/error_codes';
import { DATA_LICENSE } from '../../../../../core/constants/data_license';
import { OWN_DATASET_SOURCE } from '../../../../../core/constants/datasets';
import { DatasetConnectionT, DatasetsService } from '../../../DatasetsModule/datasets.service';
import { getVersion } from '../../../../../configuration';
import {
  DATASET_FILE_NAMES,
  DATASET_VERSION_SETTINGS_FIELD,
  EnDictionaryImportPhasesE,
  LEGACY_DATASET_TOTAL_LINES,
  MANIFEST_FILE_NAME,
  translationFileName,
  translationFileNames,
} from './constants';
import {
  cleanEntity,
  compareExportLineKeys,
  ExportLineKeyT,
  mapGrammarPatternFromSetToDB,
  mapMeaningFromSetToDB,
  mapWordFromSetToDB,
  prepareGrammarPatternForDataSet,
  prepareMeaningsForDataSet,
  prepareMeaningTranslationsForDataSet,
  preparePhraseForDataSet,
  prepareShortTranslationsForDataSet,
  prepareWordForDataSet,
  sortStrings,
} from './utils';
import {
  DataSetGrammarPatternT,
  DataSetMeaningT,
  DataSetMeaningTranslationT,
  DataSetPhraseT,
  DataSetShortTranslationT,
  DataSetWordKeyT,
  DataSetWordT,
} from '../../../../../types/dictionaries/en/EnDataSetTypes';
import { mapPhraseFromSetToDB } from './utils/mapPhraseFromSetToDB';
import { PendingExport, PendingWordLinkT } from './types';
import {
  DatasetSource,
  fetchDatasetRevisions,
  fetchPublishedManifest,
  getImportDir,
  HuggingFaceDatasetSource,
  listImportDir,
  ManualManifestT,
  openImportDirSource,
  openUploadedDatasetSource,
  UploadedFilesByFieldT,
} from './sources';

type PendingWordLinksT = Record<WordLinkKindT, PendingWordLinkT[]>;

/**
 * Entry-level decisions of one update-mode import (issue #328), shared by
 * every chunk of every file: an entry is replaced at most once per run (a
 * later chunk with another part of speech must not wipe what an earlier
 * chunk just wrote), and the sets are the update summary at the end.
 */
type UpdateModeContextT = {
  replaced: Set<string>;
  added: Set<string>;
  kept: Set<string>;
};
const LINK_LABELS: Record<WordLinkKindT, string> = { synonyms: 'Synonym', antonyms: 'Antonym' };
const LINK_STAGES: Record<WordLinkKindT, EnDictionaryImportPhasesE> = {
  synonyms: EnDictionaryImportPhasesE.linking_synonyms,
  antonyms: EnDictionaryImportPhasesE.linking_antonyms,
};
const linkKey = (meaningId: number, word: string): string => `${meaningId}\u0000${word}`;
// the key of a meaning within its word, unique by construction of the export (issue #442)
const meaningKey = (wordId: number, sortOrder: number, title: string): string =>
  `${wordId}\u0000${sortOrder}\u0000${title}`;

/**
 * One file of the export (issue #442): the entries it walks, in the order
 * of the file, the relations each entry is loaded with and the lines one
 * entry contributes (none, one, or one per row of a collection)
 */
type ExportStageT = {
  stage: EnDictionaryImportPhasesE;
  keys: ExportLineKeyT[];
  relations: FindOptionsRelations<EnWord>;
  prepare: (word: EnWord) => unknown[];
  // the files the stage writes: a line goes to the first one whose `keep`
  // accepts it (the translations: one file per language); a file nothing
  // was written to is not created
  files: Array<{ path: string; keep: (line: unknown) => boolean }>;
};
const EVERY_LINE = () => true;

const EXPORT_TTL_MS = 15 * 60 * 1000;
// Entries are exported in batches of this size: one statement per relation
// over the batch's ids (WordRowsService), never a join across the collections
const EXPORT_BATCH_SIZE = 200;
// Dataset lines are imported in transactional chunks of this size; each chunk
// costs a handful of bulk queries instead of ~26 queries per line
const IMPORT_CHUNK_SIZE = 500;
// Keep IN (...) lists and multi-row VALUES well below the driver parameter
// limits (SQLite: 32766, Postgres: 65535)
const SQL_PARAMS_CHUNK = 500;
// The manifest endpoint proxies HuggingFace; cache it briefly so opening the
// import page repeatedly does not hammer the dataset host
const MANIFEST_CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class EnImportDictionaryService implements OnModuleDestroy {
  private readonly logger = new Logger(EnImportDictionaryService.name);

  // the audit journal records every import run as one summary row (issue #334)
  @Optional()
  @Inject(AuditService)
  private readonly auditService?: AuditService;

  private readonly pendingExports = new Map<string, PendingExport>();

  /**
   * A stop must not leave export archives behind in the temp directory (their
   * 15-minute cleanup timers die with the process), so every pending export
   * is cleaned up here; the timers are unref'd so a waiting archive never
   * keeps the process alive on its own (issue #315)
   */
  onModuleDestroy(): void {
    for (const exportId of [...this.pendingExports.keys()]) {
      const entry = this.pendingExports.get(exportId);
      if (entry) clearTimeout(entry.timeout);
      this.cleanupExport(exportId);
    }
  }

  private manifestCache: { manifest: DatasetManifestT; fetchedAt: number } | null = null;
  private revisionsCache: { revisions: string[]; fetchedAt: number } | null = null;

  constructor(
    @InjectRepository(EnWord)
    private readonly enWordsRep: Repository<EnWord>,
    // the export reads its entries the way every full read does (issue #424)
    private readonly wordRows: WordRowsService,

    private readonly settingsService: SettingsService,
    @Optional() private readonly metrics?: MetricsService,
    // the one import slot of the process (issue #268); absent in the unit tests
    @Optional() private readonly importStatus?: ImportStatusService,
    // the datasets of the instance (issue #527); absent in the unit tests
    @Optional() private readonly datasets?: DatasetsService,
  ) {}

  // The dataset the running import writes into (issue #527): the active one
  // through the application's connection, another one through a connection
  // on its schema. One import runs at a time, so one field is enough.
  private target: DatasetConnectionT | null = null;

  /** Where the import and the export read and write: the import's target, else the active dataset */
  private get db(): EntityManager {
    return this.target?.manager ?? this.enWordsRep.manager;
  }

  /**
   * The source a dataset names in its manifest. The published dataset of
   * the project named none before there were several: read from HuggingFace,
   * it is the project's own.
   */
  private sourceOf(manifest: DatasetManifestT | null, source: DatasetSource): string | undefined {
    if (manifest?.source) return manifest.source;
    return source instanceof HuggingFaceDatasetSource ? OWN_DATASET_SOURCE : undefined;
  }

  /**
   * Datasets are never mixed (issue #527): data that names its source goes
   * into the dataset of that source. The terms of a dataset are the ones
   * of the catalog, so an empty dataset takes no other data either.
   */
  private assertSameSource(manifest: DatasetManifestT | null, source: DatasetSource): void {
    const filled = this.target?.dataset;
    const named = this.sourceOf(manifest, source);
    if (!filled || !named || named === filled.source) return;
    this.logger.warn(
      `Import refused: the data comes from "${named}", the dataset "${filled.name}" holds data of "${filled.source}"`,
    );
    throw new ConflictException(ErrorCodes.dataset_source_mismatch);
  }

  /**
   * The version check the import UI runs before starting an import.
   * Serves a briefly cached copy of the published manifest.json.
   */
  async getManifest(): Promise<DatasetManifestT> {
    if (this.manifestCache && Date.now() - this.manifestCache.fetchedAt < MANIFEST_CACHE_TTL_MS) {
      return this.manifestCache.manifest;
    }

    const manifest = await fetchPublishedManifest(this.logger);
    if (!manifest) {
      throw new NotFoundException(ErrorCodes.dataset_manifest_not_found);
    }

    this.manifestCache = { manifest, fetchedAt: Date.now() };
    return manifest;
  }

  private async streamJsonlImport<T>(
    source: DatasetSource,
    progress: ImportProgressSink,
    fileName: string,
    stage: EnDictionaryImportPhasesE,
    allLength: number,
    plusCount: () => number,
    handleChunk: (lines: T[]) => Promise<void>,
  ): Promise<void> {
    const { path: filePath, temporary } = await source.acquireFile(fileName, progress);
    if (!filePath) {
      this.logger.warn(`Dataset file "${fileName}" is absent from the source, stage "${stage}" skipped`);
      return;
    }

    const startedAt = Date.now();
    this.logger.log(`Import stage "${stage}" started (file "${fileName}")`);

    try {
      const rl = readline.createInterface({
        input: createReadStream(filePath, { encoding: 'utf-8' }),
        crlfDelay: Infinity,
      });

      let lineNo = 0;
      let chunk: T[] = [];

      const flush = async () => {
        if (chunk.length === 0) return;
        const lines = chunk;
        chunk = [];
        await handleChunk(lines);
        let count = 0;
        for (let i = 0; i < lines.length; i++) count = plusCount();
        await this.reportImportProgress(progress, count + 1, allLength, stage);
      };

      for await (const l of rl) {
        lineNo++;
        if (!l.trim()) continue;
        chunk.push(JSON.parse(l) as T);
        if (chunk.length >= IMPORT_CHUNK_SIZE) await flush();
      }
      await flush();

      this.logger.log(
        `Import stage "${stage}" finished: ${lineNo} lines from "${fileName}" in ${Date.now() - startedAt}ms`,
      );
    } catch (error) {
      this.logger.error(`Import of "${fileName}" failed`, error instanceof Error ? error.stack : String(error));
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(ErrorCodes.internal_server_error);
    } finally {
      // downloads are deleted once imported; a user's own files never are
      if (temporary) await unlink(filePath).catch(() => {});
    }
  }

  // Called once per imported chunk; the tiny pause lets the progress stream flush
  private async reportImportProgress(
    progress: ImportProgressSink,
    count: number,
    allLength: number,
    stage: EnDictionaryImportPhasesE,
  ): Promise<void> {
    const chunk: ImportDictionaryChunkT = {
      percent: Math.min(100, (count / allLength) * 100),
      stage,
    };
    progress.write(chunk);
    this.metrics?.transferProgressed('import', EnDictionaryImportPhasesE[stage], chunk.percent);
    await new Promise((r) => setTimeout(r, 1));
  }

  private static chunked<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
  }

  private static wordKey(word: string, pos: string, form: string): string {
    return `${word}\u0000${pos}\u0000${form}`;
  }

  private static entryTypeOf(pos: EnPartOfSpeechE): EnEntryTypesE {
    if (pos === EnPartOfSpeechE.phrase) return EnEntryTypesE.phrase;
    if (pos === EnPartOfSpeechE.grammar_pattern) return EnEntryTypesE.grammar_pattern;
    return EnEntryTypesE.word;
  }

  // Loads the ids of base-form rows for the given entry spellings in bulk
  private async selectWordRows(
    em: EntityManager,
    names: string[],
  ): Promise<Array<{ id: number; word: string; pos: string; form: string }>> {
    const rows: Array<{ id: number; word: string; pos: string; form: string }> = [];
    for (const batch of EnImportDictionaryService.chunked(names, SQL_PARAMS_CHUNK)) {
      const raw = await em
        .getRepository(EnWord)
        .createQueryBuilder('w')
        .innerJoin('w.word', 'entry')
        .select('w.id', 'id')
        .addSelect('entry.word', 'word')
        .addSelect('w.part_of_speech', 'pos')
        .addSelect('w.form_of_word', 'form')
        .where('entry.word IN (:...batch)', { batch })
        .getRawMany<{ id: number; word: string; pos: string; form: string }>();
      rows.push(...raw);
    }
    return rows;
  }

  /**
   * Saves a chunk of dataset lines with bulk queries in one transaction.
   * Replays what EnService.addWord does per line — entry reuse, duplicate
   * skipping, base row + forms + meanings + translations — at a cost of a
   * handful of queries per chunk instead of ~26 per line.
   */
  private async bulkSaveWords(
    lines: EnWordT[],
    pendingLinks?: PendingWordLinksT,
    updateCtx?: UpdateModeContextT,
  ): Promise<void> {
    const { chunked, wordKey, entryTypeOf } = EnImportDictionaryService;

    await this.db.transaction(async (em) => {
      // 0. update mode (issue #328): entries the admin edited are kept, the
      // other existing entries have their content replaced by this dataset —
      // each at most once per run
      if (updateCtx) {
        lines = await this.applyUpdateMode(em, lines, updateCtx);
        if (lines.length === 0) return;
      }

      // 1. every entry spelling this chunk needs (base words + their forms)
      const entryTypes = new Map<string, EnEntryTypesE>();
      for (const line of lines) {
        if (!entryTypes.has(line.word)) entryTypes.set(line.word, entryTypeOf(line.part_of_speech));
        for (const f of line.forms ?? []) {
          if (!entryTypes.has(f.word)) entryTypes.set(f.word, EnEntryTypesE.word);
        }
      }
      const entryNames = [...entryTypes.keys()];

      // 2. reuse existing entries, insert the missing ones
      const existingEntries = new Set<string>();
      for (const batch of chunked(entryNames, SQL_PARAMS_CHUNK)) {
        const rows = await em.getRepository(EnEntry).find({ where: { word: In(batch) } });
        rows.forEach((r) => existingEntries.add(r.word));
      }
      const newEntries = entryNames
        .filter((w) => !existingEntries.has(w))
        .map((word) => ({ word, type: entryTypes.get(word) }));
      for (const batch of chunked(newEntries, SQL_PARAMS_CHUNK)) {
        await em.getRepository(EnEntry).insert(batch);
      }

      // 3. skip duplicates: rows with the same (word, pos, form) already in the DB
      const seen = new Set<string>();
      (await this.selectWordRows(em, entryNames)).forEach((r) => seen.add(wordKey(r.word, r.pos, r.form)));

      const toInsert: EnWordT[] = [];
      let skipped = 0;
      for (const line of lines) {
        const key = wordKey(line.word, line.part_of_speech, line.form_of_word);
        if (seen.has(key)) {
          skipped++;
          continue;
        }
        seen.add(key);
        toInsert.push(line);
      }
      if (skipped > 0) {
        this.logger.log(`Skipped ${skipped} duplicate dataset lines in this chunk`);
      }
      if (toInsert.length === 0) return;

      // 4. base rows in bulk (nested structures stripped, entry linked by its string PK)
      const toBaseRow = (line: EnWordT) => {
        const {
          id: _id,
          word,
          base_phrasal: _basePhrasal,
          base_form: _baseForm,
          forms: _forms,
          meanings: _meanings,
          short_translations: _shortTranslations,
          phrasal_variants: _phrasalVariants,
          ...rest
        } = line;
        return { ...rest, word: { word } as EnEntry };
      };
      for (const batch of chunked(toInsert, SQL_PARAMS_CHUNK)) {
        await em.getRepository(EnWord).insert(batch.map(toBaseRow));
      }

      // 5. fetch the generated ids back by natural key
      const idByKey = new Map<string, number>();
      const insertedNames = [...new Set(toInsert.map((l) => l.word))];
      (await this.selectWordRows(em, insertedNames)).forEach((r) =>
        idByKey.set(wordKey(r.word, r.pos, r.form), r.id),
      );

      // 6. forms in bulk, deduplicated the same way base rows are
      const formRows = [];
      for (const line of toInsert) {
        const baseId = idByKey.get(wordKey(line.word, line.part_of_speech, line.form_of_word));
        for (const f of line.forms ?? []) {
          const key = wordKey(f.word, line.part_of_speech, f.form_of_word);
          if (seen.has(key)) continue;
          seen.add(key);
          const { id: _fid, word: formWord, ...fRest } = f;
          formRows.push({
            ...fRest,
            word: { word: formWord } as EnEntry,
            part_of_speech: line.part_of_speech,
            base_form: { id: baseId } as EnWord,
          });
        }
      }
      for (const batch of chunked(formRows, SQL_PARAMS_CHUNK)) {
        await em.getRepository(EnWord).insert(batch);
      }

      // 7. meanings need their generated ids for the nested translations, so they
      // go one insert per meaning (still inside the chunk transaction); the
      // translations and short translations then go in bulk
      const translationRows = [];
      const shortTranslationRows = [];
      for (const line of toInsert) {
        const wordId = idByKey.get(wordKey(line.word, line.part_of_speech, line.form_of_word));
        for (const m of line.meanings ?? []) {
          const { id: _mid, translations, synonyms, antonyms, ...mRest } = m;
          const res = await em.getRepository(EnMeaning).insert({ ...mRest, word: { id: wordId } as EnWord });
          const meaningId = res.identifiers[0]?.id as number;
          // synonyms / antonyms link to entries that may only appear later in the
          // dataset (or in another file), so they are resolved once every file is in
          for (const kind of WORD_LINK_KINDS) {
            const words = normalizeWordLinks(kind === 'synonyms' ? synonyms : antonyms, line.word);
            if (pendingLinks && words.length > 0) {
              pendingLinks[kind].push({ meaningId, headword: line.word, words });
            }
          }
          for (const t of translations ?? []) {
            const { id: _tid, ...tRest } = t;
            translationRows.push({ ...tRest, meaning: { id: meaningId } as EnMeaning });
          }
        }
        for (const st of line.short_translations ?? []) {
          const { id: _stid, ...stRest } = st;
          shortTranslationRows.push({ ...stRest, word: { id: wordId } as EnWord });
        }
      }
      for (const batch of chunked(translationRows, SQL_PARAMS_CHUNK)) {
        await em.getRepository(EnMeaningTranslation).insert(batch);
      }
      for (const batch of chunked(shortTranslationRows, SQL_PARAMS_CHUNK)) {
        await em.getRepository(EnShortTranslation).insert(batch);
      }
    });
  }

  /**
   * The entry-level pass of an update-mode chunk (issue #328): drops the
   * lines of entries the admin edited (kept), deletes the current content of
   * the other existing entries so the dataset lines re-create it (replaced),
   * and records entries new to the dictionary (added). Entries this run has
   * already replaced or added are left alone — their content IS the new
   * dataset content.
   */
  private async applyUpdateMode(
    em: EntityManager,
    lines: EnWordT[],
    updateCtx: UpdateModeContextT,
  ): Promise<EnWordT[]> {
    const { chunked } = EnImportDictionaryService;

    const headwords = [...new Set(lines.map((l) => l.word))];
    const existing = new Set<string>();
    const flagged = new Set<string>();
    for (const batch of chunked(headwords, SQL_PARAMS_CHUNK)) {
      const rows = await em.getRepository(EnEntry).find({ where: { word: In(batch) } });
      for (const row of rows) {
        existing.add(row.word);
        if (row.user_modified) flagged.add(row.word);
      }
    }

    flagged.forEach((w) => updateCtx.kept.add(w));
    const kept = lines.filter((l) => !flagged.has(l.word));

    const toReplace = [...new Set(kept.map((l) => l.word))].filter(
      (w) => existing.has(w) && !updateCtx.replaced.has(w) && !updateCtx.added.has(w),
    );
    await this.deleteEntryContent(em, toReplace);
    toReplace.forEach((w) => updateCtx.replaced.add(w));
    for (const line of kept) {
      if (!existing.has(line.word)) updateCtx.added.add(line.word);
    }
    return kept;
  }

  /**
   * Deletes the base word rows of the given entries together with their form
   * rows; meanings, translations and outgoing synonym / antonym junction
   * rows die by FK cascade. The entry rows themselves stay, so links other
   * entries hold TO these words survive the replacement.
   */
  private async deleteEntryContent(em: EntityManager, headwords: string[]): Promise<void> {
    const { chunked } = EnImportDictionaryService;
    if (headwords.length === 0) return;

    // base rows only: a row of this entry that is a form of another base
    // word (e.g. "left" as the past of "leave") belongs to that word's
    // content and is replaced with it, not here
    const baseIds: number[] = [];
    for (const batch of chunked(headwords, SQL_PARAMS_CHUNK)) {
      const rows = await em
        .getRepository(EnWord)
        .createQueryBuilder('w')
        .innerJoin('w.word', 'entry')
        .select('w.id', 'id')
        .where('entry.word IN (:...batch)', { batch })
        .andWhere('w.base_form IS NULL')
        .getRawMany<{ id: number }>();
      rows.forEach((r) => baseIds.push(r.id));
    }
    if (baseIds.length === 0) return;

    // the forms of those base rows live under their own entries and would
    // survive the base delete as orphans (base_form is ON DELETE SET NULL)
    const formIds: number[] = [];
    for (const batch of chunked(baseIds, SQL_PARAMS_CHUNK)) {
      const rows = await em
        .getRepository(EnWord)
        .createQueryBuilder('w')
        .select('w.id', 'id')
        .where('w.base_form IN (:...batch)', { batch })
        .getRawMany<{ id: number }>();
      rows.forEach((r) => formIds.push(r.id));
    }

    for (const batch of chunked([...formIds, ...baseIds], SQL_PARAMS_CHUNK)) {
      await em.getRepository(EnWord).delete(batch);
    }
  }

  // Links phrasal variants to their base verbs with one lookup per chunk
  private async bulkLinkPhrasalVerbs(lines: DataSetWordT[]): Promise<void> {
    await this.db.transaction(async (em) => {
      const names = new Set<string>();
      for (const line of lines) {
        names.add(line.word);
        line.phrasal_variants.forEach((v) => names.add(v));
      }

      const idByName = new Map<string, number>();
      (await this.selectWordRows(em, [...names]))
        .filter((r) => r.pos === EnPartOfSpeechE.verb && r.form === EnWordFormsE.base_form)
        .forEach((r) => idByName.set(r.word, r.id));

      for (const line of lines) {
        const baseId = idByName.get(line.word);
        if (!baseId) {
          this.logger.warn(`Phrasal base verb "${line.word}" is missing in the dataset, skipping its variants`);
          continue;
        }
        for (const variant of line.phrasal_variants) {
          const variantId = idByName.get(variant);
          if (!variantId) {
            this.logger.warn(
              `Phrasal variant "${variant}" of "${line.word}" is missing in the dataset, skipping`,
            );
            continue;
          }
          await em.getRepository(EnWord).update(variantId, { base_phrasal: { id: baseId } as EnWord });
        }
      }
    });
  }

  /**
   * Links (synonyms or antonyms) the export writes: one per linked word of
   * every base-form meaning. Recorded in the manifest so the import can count
   * the linking stage into its progress total.
   */
  /** Translation rows per language (issue #410): the counts a consumer of the revision can expect */
  private async countTranslationsByLanguage(): Promise<NonNullable<DatasetManifestT['translations']>> {
    const manager = this.db;
    const count = async (entity: typeof EnMeaningTranslation | typeof EnShortTranslation) =>
      manager
        .getRepository(entity)
        .createQueryBuilder('t')
        .select('t.language', 'language')
        .addSelect('COUNT(*)', 'count')
        .groupBy('t.language')
        .getRawMany<{ language: string; count: string }>();
    const result: NonNullable<DatasetManifestT['translations']> = {};
    for (const row of await count(EnMeaningTranslation)) {
      result[row.language] = { meaning_translations: Number(row.count), short_translations: 0 };
    }
    for (const row of await count(EnShortTranslation)) {
      const entry = result[row.language] ?? { meaning_translations: 0, short_translations: 0 };
      entry.short_translations = Number(row.count);
      result[row.language] = entry;
    }
    return result;
  }

  private async countExportedLinks(kind: WordLinkKindT): Promise<number> {
    const row = await this.db
      .getRepository(EnMeaning)
      .createQueryBuilder('m')
      .innerJoin(`m.${kind}`, 'l')
      .innerJoin('m.word', 'w')
      .where('w.form_of_word = :baseForm', { baseForm: EnWordFormsE.base_form })
      .select('COUNT(*)', 'cnt')
      .getRawOne<{ cnt: unknown }>();
    return Number(row?.cnt) || 0;
  }

  /**
   * Inserts the meaning → entry links of one kind collected while saving the
   * dataset. Words the dictionary does not have are skipped with a warning,
   * the same way unknown phrasal variants are. A word already linked as a
   * synonym of the meaning is skipped as an antonym (the admin API rejects
   * such a pair; the dataset is assumed authored through it).
   */
  private async bulkLinkWords(
    kind: WordLinkKindT,
    pending: PendingWordLinkT[],
    onBatchDone?: (processedLinks: number) => Promise<void>,
  ): Promise<void> {
    const { chunked } = EnImportDictionaryService;
    if (pending.length === 0) return;

    // the junction table is owned by the ManyToMany relation, so its name is read from the metadata
    const junctionTable = this.db.connection.getMetadata(EnMeaning).findRelationWithPropertyPath(kind)
      ?.junctionEntityMetadata?.tableName;
    if (!junctionTable) {
      throw new InternalServerErrorException(ErrorCodes.internal_server_error);
    }

    let skipped = 0;
    for (const batch of chunked(pending, IMPORT_CHUNK_SIZE)) {
      await this.db.transaction(async (em) => {
        // only base-form headwords qualify (directly or through a spelling
        // variant), the same rule the admin API applies
        const names = [...new Set(batch.flatMap((p) => p.words))];
        const resolved = new Map<string, string>();
        for (const nameBatch of chunked(names, SQL_PARAMS_CHUNK)) {
          (await resolveBaseFormHeadwords(em, nameBatch)).forEach((headword, name) =>
            resolved.set(name, headword),
          );
        }
        const taken = kind === 'antonyms' ? await this.loadSynonymKeys(em, batch) : new Set<string>();

        const links: Array<{ meaning_id: number; word: string }> = [];
        const seen = new Set<string>();
        for (const p of batch) {
          for (const name of p.words) {
            const headword = resolved.get(name);
            if (headword === undefined) {
              skipped++;
              this.logger.debug(
                `${LINK_LABELS[kind]} "${name}" of "${p.headword}" is missing in the dictionary, skipping`,
              );
              continue;
            }
            // two spellings may resolve to one word; the headword itself is never its own link
            const key = linkKey(p.meaningId, headword);
            if (headword === p.headword || seen.has(key)) continue;
            if (taken.has(key)) {
              skipped++;
              this.logger.warn(
                `"${headword}" is already a synonym of "${p.headword}", skipping it as an antonym`,
              );
              continue;
            }
            seen.add(key);
            links.push({ meaning_id: p.meaningId, word: headword });
          }
        }
        for (const linkBatch of chunked(links, SQL_PARAMS_CHUNK)) {
          await em.createQueryBuilder().insert().into(junctionTable).values(linkBatch).execute();
        }
      });
      // every collected link counts as processed, resolved or skipped
      await onBatchDone?.(batch.reduce((n, p) => n + p.words.length, 0));
    }
    if (skipped > 0) {
      this.logger.warn(
        `Skipped ${skipped} ${LINK_LABELS[kind].toLowerCase()} that name words missing in the dictionary or already linked`,
      );
    }
  }

  /** `meaning\0word` keys of the synonym links already stored for the given meanings */
  private async loadSynonymKeys(em: EntityManager, batch: PendingWordLinkT[]): Promise<Set<string>> {
    const { chunked } = EnImportDictionaryService;
    const keys = new Set<string>();
    for (const ids of chunked(
      batch.map((p) => p.meaningId),
      SQL_PARAMS_CHUNK,
    )) {
      const rows = await em.getRepository(EnMeaning).find({
        where: { id: In(ids) },
        relations: { synonyms: true },
        select: { id: true, synonyms: { word: true } },
      });
      for (const m of rows) for (const e of m.synonyms) keys.add(linkKey(m.id, e.word));
    }
    return keys;
  }

  /** Writes the collected links of both kinds, each as its own progress stage */
  private async linkPendingWords(
    progress: ImportProgressSink,
    pendingLinks: PendingWordLinksT,
    allLength: number,
    getCount: () => number,
    addCount: (n: number) => void,
  ): Promise<void> {
    for (const kind of WORD_LINK_KINDS) {
      const pending = pendingLinks[kind];
      if (pending.length === 0) continue;
      const stage = LINK_STAGES[kind];
      const linkStartedAt = Date.now();
      await this.reportImportProgress(progress, getCount(), allLength, stage);
      await this.bulkLinkWords(kind, pending, async (processedLinks) => {
        addCount(processedLinks);
        await this.reportImportProgress(progress, getCount(), allLength, stage);
      });
      this.logger.log(`Linked ${kind} of ${pending.length} meanings in ${Date.now() - linkStartedAt}ms`);
    }
  }

  private async saveWords(
    source: DatasetSource,
    progress: ImportProgressSink,
    allLength: number,
    plusCount: () => number,
    pendingLinks: PendingWordLinksT,
    updateCtx?: UpdateModeContextT,
  ): Promise<void> {
    await this.streamJsonlImport<DataSetWordT>(
      source,
      progress,
      DATASET_FILE_NAMES.words,
      EnDictionaryImportPhasesE.saving_words,
      allLength,
      plusCount,
      async (lines) => {
        await this.bulkSaveWords(
          lines.map(mapWordFromSetToDB) as unknown as EnWordT[],
          pendingLinks,
          updateCtx,
        );
      },
    );
  }

  private async saveGrammarPatterns(
    source: DatasetSource,
    progress: ImportProgressSink,
    allLength: number,
    plusCount: () => number,
    pendingLinks: PendingWordLinksT,
    updateCtx?: UpdateModeContextT,
  ): Promise<void> {
    await this.streamJsonlImport<DataSetGrammarPatternT>(
      source,
      progress,
      DATASET_FILE_NAMES.grammarPatterns,
      EnDictionaryImportPhasesE.saving_grammar_patterns,
      allLength,
      plusCount,
      async (lines) => {
        await this.bulkSaveWords(lines.map(mapGrammarPatternFromSetToDB), pendingLinks, updateCtx);
      },
    );
  }

  private async savePhrases(
    source: DatasetSource,
    progress: ImportProgressSink,
    allLength: number,
    plusCount: () => number,
    pendingLinks: PendingWordLinksT,
    updateCtx?: UpdateModeContextT,
  ): Promise<void> {
    await this.streamJsonlImport<DataSetPhraseT>(
      source,
      progress,
      DATASET_FILE_NAMES.phrases,
      EnDictionaryImportPhasesE.saving_phrases,
      allLength,
      plusCount,
      async (lines) => {
        await this.bulkSaveWords(lines.map(mapPhraseFromSetToDB), pendingLinks, updateCtx);
      },
    );
  }

  private async savePhrasalVerbs(
    source: DatasetSource,
    progress: ImportProgressSink,
    allLength: number,
    plusCount: () => number,
  ): Promise<void> {
    await this.streamJsonlImport<DataSetWordT>(
      source,
      progress,
      DATASET_FILE_NAMES.phrasalVerbs,
      EnDictionaryImportPhasesE.saving_phrasal_verbs,
      allLength,
      plusCount,
      async (lines) => {
        await this.bulkLinkPhrasalVerbs(lines);
      },
    );
  }

  private async saveMeanings(
    source: DatasetSource,
    progress: ImportProgressSink,
    allLength: number,
    plusCount: () => number,
    pendingLinks: PendingWordLinksT,
    updateCtx?: UpdateModeContextT,
  ): Promise<void> {
    await this.streamJsonlImport<DataSetMeaningT>(
      source,
      progress,
      DATASET_FILE_NAMES.meanings,
      EnDictionaryImportPhasesE.saving_meanings,
      allLength,
      plusCount,
      async (lines) => {
        await this.bulkSaveMeanings(lines, pendingLinks, updateCtx);
      },
    );
  }

  private async saveMeaningTranslations(
    source: DatasetSource,
    progress: ImportProgressSink,
    allLength: number,
    plusCount: () => number,
    updateCtx?: UpdateModeContextT,
  ): Promise<void> {
    // the combined file of exports before the split, then one file per language
    for (const fileName of [
      DATASET_FILE_NAMES.meaningTranslations,
      ...translationFileNames('meaningTranslations'),
    ]) {
      await this.streamJsonlImport<DataSetMeaningTranslationT>(
        source,
        progress,
        fileName,
        EnDictionaryImportPhasesE.saving_meaning_translations,
        allLength,
        plusCount,
        async (lines) => {
          await this.bulkSaveMeaningTranslations(lines, updateCtx);
        },
      );
    }
  }

  private async saveShortTranslations(
    source: DatasetSource,
    progress: ImportProgressSink,
    allLength: number,
    plusCount: () => number,
    updateCtx?: UpdateModeContextT,
  ): Promise<void> {
    for (const fileName of [
      DATASET_FILE_NAMES.shortTranslations,
      ...translationFileNames('shortTranslations'),
    ]) {
      await this.streamJsonlImport<DataSetShortTranslationT>(
        source,
        progress,
        fileName,
        EnDictionaryImportPhasesE.saving_short_translations,
        allLength,
        plusCount,
        async (lines) => {
          await this.bulkSaveShortTranslations(lines, updateCtx);
        },
      );
    }
  }

  /**
   * The base-form ids of the entries a chunk of collection lines belongs to
   * (issue #442), keyed like the lines name them. Lines of entries the
   * dictionary does not have are skipped with a warning; in update mode the
   * entries the admin edited keep their content, so their lines are skipped
   * too (the same rule the entry files follow) and they count as kept.
   */
  private async resolveLineWords(
    em: EntityManager,
    lines: DataSetWordKeyT[],
    updateCtx: UpdateModeContextT | undefined,
    label: string,
  ): Promise<Map<string, number>> {
    const { chunked, wordKey } = EnImportDictionaryService;
    const names = [...new Set(lines.map((l) => l.word))];
    const idByKey = new Map<string, number>();
    (await this.selectWordRows(em, names))
      .filter((r) => r.form === EnWordFormsE.base_form)
      .forEach((r) => idByKey.set(wordKey(r.word, r.pos, r.form), r.id));

    if (updateCtx) {
      for (const batch of chunked(names, SQL_PARAMS_CHUNK)) {
        const rows = await em.getRepository(EnEntry).find({ where: { word: In(batch), user_modified: true } });
        for (const row of rows) {
          updateCtx.kept.add(row.word);
          for (const pos of Object.values(EnPartOfSpeechE)) {
            idByKey.delete(wordKey(row.word, pos, EnWordFormsE.base_form));
          }
        }
      }
    }

    let unknown = 0;
    for (const line of lines) {
      if (!idByKey.has(wordKey(line.word, line.part_of_speech, EnWordFormsE.base_form))) unknown++;
    }
    if (unknown > 0) {
      this.logger.warn(
        `Skipped ${unknown} ${label} of entries missing in the dictionary or kept as user-modified`,
      );
    }
    return idByKey;
  }

  private async selectMeaningRows(
    em: EntityManager,
    wordIds: number[],
  ): Promise<Array<{ id: number; word: number; sort_order: number; title: string }>> {
    const rows: Array<{ id: number; word: number; sort_order: number; title: string }> = [];
    for (const batch of EnImportDictionaryService.chunked(wordIds, SQL_PARAMS_CHUNK)) {
      const raw = await em
        .getRepository(EnMeaning)
        .createQueryBuilder('m')
        .select('m.id', 'id')
        .addSelect('m.word', 'word')
        .addSelect('m.sort_order', 'sort_order')
        .addSelect('m.title', 'title')
        .where('m.word IN (:...batch)', { batch })
        .getRawMany<{ id: number; word: number; sort_order: number; title: string }>();
      rows.push(...raw);
    }
    return rows;
  }

  /**
   * Saves a chunk of the meanings file (issue #442): every line goes to its
   * entry, a meaning the entry already has (same sort order and title) is
   * skipped like a duplicate entry line, the links are collected for the
   * linking stages the same way nested meanings collect them.
   */
  private async bulkSaveMeanings(
    lines: DataSetMeaningT[],
    pendingLinks: PendingWordLinksT,
    updateCtx?: UpdateModeContextT,
  ): Promise<void> {
    const { wordKey } = EnImportDictionaryService;
    await this.db.transaction(async (em) => {
      const idByKey = await this.resolveLineWords(em, lines, updateCtx, 'meanings');
      const seen = new Set<string>();
      (await this.selectMeaningRows(em, [...new Set(idByKey.values())])).forEach((r) =>
        seen.add(meaningKey(r.word, r.sort_order, r.title)),
      );

      let skipped = 0;
      for (const line of lines) {
        const wordId = idByKey.get(wordKey(line.word, line.part_of_speech, EnWordFormsE.base_form));
        if (wordId === undefined) continue;
        const { word: _word, part_of_speech: _pos, ...meaningLine } = line;
        const meaning = mapMeaningFromSetToDB(meaningLine);
        const key = meaningKey(wordId, meaning.sort_order, meaning.title);
        if (seen.has(key)) {
          skipped++;
          continue;
        }
        seen.add(key);

        const { id: _id, translations: _translations, synonyms, antonyms, ...rest } = meaning;
        const res = await em.getRepository(EnMeaning).insert({ ...rest, word: { id: wordId } as EnWord });
        const meaningId = res.identifiers[0]?.id as number;
        for (const kind of WORD_LINK_KINDS) {
          const words = normalizeWordLinks(kind === 'synonyms' ? synonyms : antonyms, line.word);
          if (words.length > 0) pendingLinks[kind].push({ meaningId, headword: line.word, words });
        }
      }
      if (skipped > 0) this.logger.log(`Skipped ${skipped} duplicate meaning lines in this chunk`);
    });
  }

  /**
   * Saves a chunk of the meaning-translations file (issue #442): a line is
   * matched to its meaning by the word key plus the meaning's sort order and
   * title; a translation the meaning already has in that language with that
   * title is skipped. A file of one language loads into a dictionary that
   * already holds the others.
   */
  private async bulkSaveMeaningTranslations(
    lines: DataSetMeaningTranslationT[],
    updateCtx?: UpdateModeContextT,
  ): Promise<void> {
    const { chunked, wordKey } = EnImportDictionaryService;
    await this.db.transaction(async (em) => {
      const idByKey = await this.resolveLineWords(em, lines, updateCtx, 'meaning translations');
      const wordIds = [...new Set(idByKey.values())];
      const meaningIdByKey = new Map<string, number>();
      (await this.selectMeaningRows(em, wordIds)).forEach((r) =>
        meaningIdByKey.set(meaningKey(r.word, r.sort_order, r.title), r.id),
      );

      const seen = new Set<string>();
      const meaningIds = [...meaningIdByKey.values()];
      for (const batch of chunked(meaningIds, SQL_PARAMS_CHUNK)) {
        const rows = await em
          .getRepository(EnMeaningTranslation)
          .createQueryBuilder('t')
          .select('t.meaning', 'meaning')
          .addSelect('t.language', 'language')
          .addSelect('t.title', 'title')
          .where('t.meaning IN (:...batch)', { batch })
          .getRawMany<{ meaning: number; language: string; title: string }>();
        rows.forEach((r) => seen.add(`${r.meaning}\u0000${r.language}\u0000${r.title}`));
      }

      const toInsert = [];
      let skipped = 0;
      let unknown = 0;
      for (const line of lines) {
        const wordId = idByKey.get(wordKey(line.word, line.part_of_speech, EnWordFormsE.base_form));
        if (wordId === undefined) continue;
        const meaningId = meaningIdByKey.get(meaningKey(wordId, line.meaning_sort_order, line.meaning_title));
        if (meaningId === undefined) {
          unknown++;
          continue;
        }
        const key = `${meaningId}\u0000${line.language}\u0000${line.title}`;
        if (seen.has(key)) {
          skipped++;
          continue;
        }
        seen.add(key);
        toInsert.push({
          language: line.language as AvailableTranslationLanguagesE,
          title: line.title,
          definition: line.definition,
          variants_of_words: line.variants_of_words ?? [],
          meaning: { id: meaningId } as EnMeaning,
        });
      }
      for (const batch of chunked(toInsert, SQL_PARAMS_CHUNK)) {
        await em.getRepository(EnMeaningTranslation).insert(batch);
      }
      if (unknown > 0)
        this.logger.warn(`Skipped ${unknown} meaning translations of meanings missing in the dictionary`);
      if (skipped > 0) this.logger.log(`Skipped ${skipped} duplicate meaning translation lines in this chunk`);
    });
  }

  /**
   * Saves a chunk of the short-translations file (issue #442): a line goes to
   * its entry; a short translation the entry already has in that language
   * with that description is skipped.
   */
  private async bulkSaveShortTranslations(
    lines: DataSetShortTranslationT[],
    updateCtx?: UpdateModeContextT,
  ): Promise<void> {
    const { chunked, wordKey } = EnImportDictionaryService;
    await this.db.transaction(async (em) => {
      const idByKey = await this.resolveLineWords(em, lines, updateCtx, 'short translations');
      const wordIds = [...new Set(idByKey.values())];

      const seen = new Set<string>();
      for (const batch of chunked(wordIds, SQL_PARAMS_CHUNK)) {
        const rows = await em
          .getRepository(EnShortTranslation)
          .createQueryBuilder('s')
          .select('s.word', 'word')
          .addSelect('s.language', 'language')
          .addSelect('s.description', 'description')
          .where('s.word IN (:...batch)', { batch })
          .getRawMany<{ word: number; language: string; description: string }>();
        rows.forEach((r) => seen.add(`${r.word}\u0000${r.language}\u0000${r.description}`));
      }

      const toInsert = [];
      let skipped = 0;
      for (const line of lines) {
        const wordId = idByKey.get(wordKey(line.word, line.part_of_speech, EnWordFormsE.base_form));
        if (wordId === undefined) continue;
        const key = `${wordId}\u0000${line.language}\u0000${line.description}`;
        if (seen.has(key)) {
          skipped++;
          continue;
        }
        seen.add(key);
        toInsert.push({
          language: line.language as AvailableTranslationLanguagesE,
          description: line.description,
          variants_of_words: line.variants_of_words ?? [],
          word: { id: wordId } as EnWord,
        });
      }
      for (const batch of chunked(toInsert, SQL_PARAMS_CHUNK)) {
        await em.getRepository(EnShortTranslation).insert(batch);
      }
      if (skipped > 0) this.logger.log(`Skipped ${skipped} duplicate short translation lines in this chunk`);
    });
  }

  /**
   * Opens the dataset source named by the request. Every check that can
   * reject the request (unknown path, malformed dataset) runs here, before
   * the progress stream starts, so the client still gets a plain 4xx.
   */
  private async openSource(source: ImportDictionarySourceDTO | undefined): Promise<DatasetSource> {
    if (!source || source.kind === ImportSourceKindE.huggingface) {
      return new HuggingFaceDatasetSource(this.logger, { revision: source?.revision });
    }
    if (source.kind === ImportSourceKindE.file) {
      return openImportDirSource(source.path ?? '', this.logger);
    }
    throw new BadRequestException(ErrorCodes.dataset_file_not_found);
  }

  /** What the import page can offer: server-side datasets and the published revisions */
  async getImportSources(): Promise<ImportSourcesT> {
    return {
      import_dir_configured: getImportDir() !== null,
      files: await listImportDir(),
      revisions: await this.getRevisions(),
    };
  }

  /** The dataset repo's version tags, briefly cached like the manifest (issue #322) */
  private async getRevisions(): Promise<string[]> {
    if (this.revisionsCache && Date.now() - this.revisionsCache.fetchedAt < MANIFEST_CACHE_TTL_MS) {
      return this.revisionsCache.revisions;
    }
    const revisions = await fetchDatasetRevisions(this.logger);
    // an unreachable refs API is not cached: the next request retries
    if (revisions.length > 0) this.revisionsCache = { revisions, fetchedAt: Date.now() };
    return revisions;
  }

  async importDictionary(body: ImportDictionaryReq, res: Response): Promise<void> {
    const source = await this.openSource(body.source);
    const sourceLabel =
      body.source?.kind === ImportSourceKindE.file
        ? `file "${body.source.path}"`
        : `HuggingFace${body.source?.revision ? ` @ ${body.source.revision}` : ''}`;
    const label = body.update ? `${sourceLabel} (update)` : sourceLabel;
    await this.importFrom(source, label, new HttpImportProgressSink(res), ImportTriggerE.manual, {
      update: body.update === true,
      dataset: body.dataset,
    });
  }

  /**
   * Imports what the multipart endpoint received: one archive, or the dataset
   * files one by one. The uploads are deleted afterwards whether or not the
   * import succeeded.
   */
  async importUploadedDictionary(
    files: UploadedFilesByFieldT,
    manual: ManualManifestT,
    res: Response,
    dataset?: string,
  ): Promise<void> {
    const source = await openUploadedDatasetSource(files, manual, this.logger);
    const names = Object.values(files)
      .flat()
      .filter((f) => f !== undefined)
      .map((f) => `"${f.originalname}"`);
    await this.importFrom(
      source,
      `upload ${names.join(', ')}`,
      new HttpImportProgressSink(res),
      ImportTriggerE.manual,
      { dataset },
    );
  }

  /**
   * The import pipeline behind every entry point — the admin endpoints and
   * the automatic import on first start (issue #268). Claims the process's
   * single import slot first: a second import while one runs is refused
   * with 409 `import_in_progress` before anything is downloaded or written.
   */
  async importFrom(
    source: DatasetSource | DatasetSourceFactoryT,
    label: string,
    progress: ImportProgressSink,
    trigger: ImportTriggerE,
    options?: { update?: boolean; dataset?: string | undefined },
  ): Promise<void> {
    // a dataset that is not the active one needs a driver with schemas: refused
    // before the slot is taken, like a bad source
    if (options?.dataset && this.datasets && options.dataset !== this.datasets.getActive().name) {
      if (!this.datasets.supported) throw new ConflictException(ErrorCodes.datasets_not_supported);
    }
    this.importStatus?.begin(trigger, label, options?.dataset ?? this.datasets?.getActive().name);
    const tracked: ImportProgressSink = {
      start: () => progress.start(),
      write: (chunk) => {
        this.importStatus?.progress(chunk);
        progress.write(chunk);
      },
      end: () => progress.end(),
    };
    const updateCtx: UpdateModeContextT | undefined = options?.update
      ? { replaced: new Set(), added: new Set(), kept: new Set() }
      : undefined;
    try {
      // the dataset the import names is created on first use — a schema of
      // its own — and filled through a connection of its own (issue #527)
      const dataset = await this.datasets?.resolveTarget(options?.dataset);
      this.target = dataset && this.datasets ? await this.datasets.connect(dataset) : null;
      const datasetVersion = await this.runImport(source, label, tracked, updateCtx);
      this.importStatus?.end({ dataset_version: datasetVersion });
      await this.auditService?.record({
        trigger: AuditTriggerE.import,
        action: AuditActionE.import,
        entityType: AuditEntityTypeE.dictionary,
        diff: {
          source: { before: null, after: label },
          ...(dataset ? { dataset: { before: null, after: dataset.name } } : {}),
          ...(datasetVersion ? { dataset_version: { before: null, after: datasetVersion } } : {}),
          ...(updateCtx
            ? {
                updated_entries: { before: null, after: updateCtx.replaced.size },
                added_entries: { before: null, after: updateCtx.added.size },
                kept_user_modified: { before: null, after: updateCtx.kept.size },
              }
            : {}),
        },
      });
    } catch (error) {
      const message =
        error instanceof HttpException
          ? String((error.getResponse() as { message?: unknown }).message ?? error.message)
          : error instanceof Error
            ? error.message
            : String(error);
      this.importStatus?.end({ error: message });
      throw error;
    } finally {
      const target = this.target;
      this.target = null;
      await target?.close().catch(() => undefined);
    }
  }

  /** The import pipeline shared by every source; the source is disposed at the end */
  private async runImport(
    given: DatasetSource | DatasetSourceFactoryT,
    label: string,
    progress: ImportProgressSink,
    updateCtx?: UpdateModeContextT,
  ): Promise<string | undefined> {
    // a source that has to be made first — a file of a public source being
    // converted — is made inside the import slot and reports its progress:
    // the stream opens before it
    const made = typeof given === 'function';
    if (made) progress.start();
    const source = made ? await given(progress) : given;
    let manifest: DatasetManifestT | null;
    try {
      // the manifest is read before the stream opens: a local source has
      // already validated it, HuggingFace may be unreachable
      manifest = await source.readManifest();
      this.assertSameSource(manifest, source);
    } catch (error) {
      await source.dispose().catch(() => undefined);
      throw error;
    }
    if (!made) progress.start();

    const startedAt = Date.now();
    this.logger.log(`Dictionary import from ${label} started`);

    if (!manifest) {
      this.logger.warn('Dataset manifest is missing — progress totals fall back to the legacy line counts');
    }

    let count = 0;
    const plusCount = () => count++;
    // the linking stages count one unit per synonym / antonym link named in
    // the dataset; manifests published before #259 / #266 carry no link counts
    // and fall back to a single progress chunk for that stage
    const allLength = manifest
      ? Object.values(manifest.files).reduce((sum, f) => sum + f.lines, 0) +
        (manifest.synonym_links ?? 0) +
        (manifest.antonym_links ?? 0)
      : LEGACY_DATASET_TOTAL_LINES;

    // a local dataset has nothing to download: its first stage is the words
    // file; a dataset without a manifest has no version to report
    const datasetVersion = manifest?.version || undefined;
    const firstChunk: ImportDictionaryChunkT = {
      percent: 0,
      stage:
        source instanceof HuggingFaceDatasetSource
          ? EnDictionaryImportPhasesE.downloading_database
          : EnDictionaryImportPhasesE.saving_words,
      ...(datasetVersion && { datasetVersion }),
    };
    progress.write(firstChunk);
    this.metrics?.transferStarted('import');

    try {
      // meaning → synonym / antonym links are collected across every file and
      // written last, once all the entries they can point at exist
      const pendingLinks: PendingWordLinksT = { synonyms: [], antonyms: [] };
      await this.saveWords(source, progress, allLength, plusCount, pendingLinks, updateCtx);
      await this.savePhrasalVerbs(source, progress, allLength, plusCount);
      await this.saveGrammarPatterns(source, progress, allLength, plusCount, pendingLinks, updateCtx);
      await this.savePhrases(source, progress, allLength, plusCount, pendingLinks, updateCtx);
      // the collection files (issue #442) come after every entry file: a
      // meaning may belong to a phrase, a translation to a meaning of any file
      await this.saveMeanings(source, progress, allLength, plusCount, pendingLinks, updateCtx);
      await this.saveMeaningTranslations(source, progress, allLength, plusCount, updateCtx);
      await this.saveShortTranslations(source, progress, allLength, plusCount, updateCtx);
      await this.linkPendingWords(
        progress,
        pendingLinks,
        allLength,
        () => count,
        (n) => {
          count += n;
        },
      );
    } catch (error) {
      this.metrics?.transferFinished('import', 'failure');
      throw error;
    } finally {
      await source.dispose().catch((error) => {
        this.logger.warn(
          `Failed to clean up the dataset source: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }

    // What the import left on the dataset it filled (issue #527): the
    // version — before the last chunk, so a client that reads the registry
    // on it finds it
    const filled = this.target?.dataset;
    if (filled && this.datasets) {
      await this.datasets.recordImport(filled.name, { version: datasetVersion }).catch((error) => {
        this.logger.warn(
          `Failed to record the import on dataset "${filled.name}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }

    const intoActive = !filled || !this.datasets || filled.name === this.datasets.getActive().name;
    if (datasetVersion && intoActive) {
      // Remember which dataset version the served dictionary now holds (the
      // registry keeps it for every dataset); a failure here must not fail
      // an already completed import
      await this.settingsService.upsert(DATASET_VERSION_SETTINGS_FIELD, datasetVersion).catch((error) => {
        this.logger.warn(
          `Failed to store the imported dataset version: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }

    const finalChunk: ImportDictionaryChunkT = {
      percent: 100,
      stage: EnDictionaryImportPhasesE.completed,
      ...(datasetVersion && { datasetVersion }),
      ...(updateCtx && {
        updated_entries: updateCtx.replaced.size,
        added_entries: updateCtx.added.size,
        kept_user_modified: updateCtx.kept.size,
      }),
    };
    progress.write(finalChunk);
    this.metrics?.transferFinished('import', 'success');
    progress.end();

    this.logger.log(
      `Dictionary import from ${label} completed: ${count} records in ${Date.now() - startedAt}ms` +
        (updateCtx
          ? ` (update: ${updateCtx.replaced.size} entries replaced, ${updateCtx.added.size} added, ` +
            `${updateCtx.kept.size} kept as user-modified)`
          : ''),
    );
    return datasetVersion;
  }

  private getExportTmpDir(): string {
    const dir = path.join(os.tmpdir(), 'vocab-bloom-export');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }

  /**
   * The natural key of every base-form entry, in the order the files list
   * their lines: (word, part of speech, area variant), sorted in JS so the
   * order depends neither on the ids nor on the database collation (issue
   * #247). Loaded once per export as plain rows; every stage walks a subset.
   */
  private async loadExportKeys(): Promise<ExportLineKeyT[]> {
    const keys = await this.enWordsRep
      .createQueryBuilder('w')
      .innerJoin('w.word', 'entry')
      .select('w.id', 'id')
      .addSelect('entry.word', 'word')
      .addSelect('w.part_of_speech', 'part_of_speech')
      .addSelect('w.area_variant', 'area_variant')
      .where('w.form_of_word = :baseForm', { baseForm: EnWordFormsE.base_form })
      .getRawMany<ExportLineKeyT>();
    return keys.map((k) => ({ ...k, id: Number(k.id) })).sort(compareExportLineKeys);
  }

  /**
   * Writes one file of the export: the entries of the stage in batches, each
   * batch loaded with the stage's relations through WordRowsService — one
   * statement per relation over the batch's ids, no join across collections
   * and no entity hydration (issue #442) — and every line `prepare` derives
   * from an entry, cleaned of the system fields. Returns the line count.
   */
  private async exportEntities(
    stage: ExportStageT,
    total: number,
    processedSoFar: () => number,
    addProcessed: (n: number) => void,
    onProgress: (percent: number, stage: EnDictionaryImportPhasesE) => void,
  ): Promise<Map<string, number>> {
    const streams = new Map<string, WriteStream>();
    const written = new Map<string, number>();
    const streamOf = (filePath: string): WriteStream => {
      let stream = streams.get(filePath);
      if (!stream) {
        stream = createWriteStream(filePath, { encoding: 'utf-8' });
        streams.set(filePath, stream);
        written.set(filePath, 0);
      }
      return stream;
    };

    try {
      for (let offset = 0; offset < stage.keys.length; offset += EXPORT_BATCH_SIZE) {
        const chunk = stage.keys.slice(offset, offset + EXPORT_BATCH_SIZE);
        const rows = await this.wordRows.load(
          chunk.map((k) => k.id),
          stage.relations,
        );
        const rowsById = new Map(rows.map((row) => [row.id, row]));

        for (const key of chunk) {
          const word = rowsById.get(key.id);
          if (!word) continue;
          for (const line of stage.prepare(word)) {
            const file = stage.files.find((candidate) => candidate.keep(line));
            if (!file) continue;
            streamOf(file.path).write(JSON.stringify(cleanEntity(line)) + '\n');
            written.set(file.path, (written.get(file.path) ?? 0) + 1);
          }
        }

        addProcessed(chunk.length);
        onProgress(total > 0 ? Math.min(100, (processedSoFar() / total) * 100) : 100, stage.stage);
        // the tiny pause lets the progress stream flush
        await new Promise((r) => setTimeout(r, 1));
      }
    } catch (error) {
      this.logger.error(
        `Export stage "${stage.stage}" failed`,
        error instanceof Error ? error.stack : String(error),
      );
      for (const stream of streams.values()) stream.close();
      throw new InternalServerErrorException(ErrorCodes.internal_server_error);
    }

    for (const stream of streams.values()) {
      await new Promise<void>((resolve, reject) => {
        stream.end((err?: Error) => (err ? reject(err) : resolve()));
      });
    }

    return written;
  }

  /**
   * The files of one export (issue #442), each with the entries it walks:
   * the entry files (words, phrases, grammar patterns) carry the entries
   * themselves and the forms; the phrasal-verbs file the linking map the
   * import replays; the meanings, meaning translations and short translations
   * are one line per row next to the key of their entry, so no stage assembles
   * the whole tree of a word and the cost of every file is linear in its rows,
   * whatever the number of translation languages.
   */
  private exportStages(runDir: string, keys: ExportLineKeyT[]): ExportStageT[] {
    const isEntryOf = (parts: EnPartOfSpeechE[]) => (k: ExportLineKeyT) =>
      parts.includes(k.part_of_speech as EnPartOfSpeechE);
    const phrases = isEntryOf([EnPartOfSpeechE.phrase]);
    const grammarPatterns = isEntryOf([EnPartOfSpeechE.grammar_pattern]);
    const verbs = isEntryOf([EnPartOfSpeechE.verb]);
    const words = (k: ExportLineKeyT) => !phrases(k) && !grammarPatterns(k);
    const file = (name: string) => path.join(runDir, name);
    const perLanguage = (kind: 'meaningTranslations' | 'shortTranslations') =>
      Object.values(AvailableTranslationLanguagesE).map((language) => ({
        path: file(translationFileName(kind, language)),
        keep: (line: unknown) => (line as { language?: string }).language === language,
      }));

    return [
      {
        files: [{ path: file(DATASET_FILE_NAMES.words), keep: EVERY_LINE }],
        stage: EnDictionaryImportPhasesE.saving_words,
        keys: keys.filter(words),
        relations: {
          base_phrasal: { word: true },
          phrasal_variants: { word: true },
          word: true,
          forms: { word: true },
        },
        prepare: (w) => [prepareWordForDataSet(w)],
      },
      // the linking map the import replays in savePhrasalVerbs: one line per
      // base verb that has phrasal variants
      {
        files: [{ path: file(DATASET_FILE_NAMES.phrasalVerbs), keep: EVERY_LINE }],
        stage: EnDictionaryImportPhasesE.saving_phrasal_verbs,
        keys: keys.filter(verbs),
        relations: { word: true, phrasal_variants: { word: true } },
        prepare: (w) =>
          w.phrasal_variants?.length
            ? [{ word: w.word.word, phrasal_variants: sortStrings(w.phrasal_variants.map((v) => v.word.word)) }]
            : [],
      },
      {
        files: [{ path: file(DATASET_FILE_NAMES.phrases), keep: EVERY_LINE }],
        stage: EnDictionaryImportPhasesE.saving_phrases,
        keys: keys.filter(phrases),
        relations: { word: true },
        prepare: (w) => [preparePhraseForDataSet(w)],
      },
      {
        files: [{ path: file(DATASET_FILE_NAMES.grammarPatterns), keep: EVERY_LINE }],
        stage: EnDictionaryImportPhasesE.saving_grammar_patterns,
        keys: keys.filter(grammarPatterns),
        relations: { word: true },
        prepare: (w) => [prepareGrammarPatternForDataSet(w)],
      },
      {
        files: [{ path: file(DATASET_FILE_NAMES.meanings), keep: EVERY_LINE }],
        stage: EnDictionaryImportPhasesE.saving_meanings,
        keys,
        relations: { word: true, meanings: { synonyms: { entries: true }, antonyms: { entries: true } } },
        prepare: prepareMeaningsForDataSet,
      },
      // the translations: one file per language of the enum, a line goes to
      // the file of its language; a language without rows leaves no file
      {
        files: perLanguage('meaningTranslations'),
        stage: EnDictionaryImportPhasesE.saving_meaning_translations,
        keys,
        relations: { word: true, meanings: { translations: true } },
        prepare: prepareMeaningTranslationsForDataSet,
      },
      {
        files: perLanguage('shortTranslations'),
        stage: EnDictionaryImportPhasesE.saving_short_translations,
        keys,
        relations: { word: true, short_translations: true },
        prepare: prepareShortTranslationsForDataSet,
      },
    ];
  }

  /**
   * Writes the dataset files and manifest.json into a temporary folder,
   * packs them into a zip, registers the archive under an exportId and
   * reports it. The run streams NDJSON progress through `res`; the download
   * is a separate GET on /export/download/:exportId.
   */
  async exportDictionary(res: Response): Promise<void> {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('X-Accel-Buffering', 'no');

    const exportId = randomUUID();
    const tmpDir = this.getExportTmpDir();
    const runDir = path.join(tmpDir, exportId);
    mkdirSync(runDir, { recursive: true });
    const manifestPath = path.join(runDir, MANIFEST_FILE_NAME);
    const zipPath = path.join(tmpDir, `${exportId}.zip`);

    const startedAt = Date.now();
    const keys = await this.loadExportKeys();
    const stages = this.exportStages(runDir, keys);
    // every stage walks its entries once; the total is what the progress counts
    const total = stages.reduce((sum, stage) => sum + stage.keys.length, 0);
    this.logger.log(`Dictionary export ${exportId} started: ${keys.length} base records to export`);

    let processed = 0;
    const addProcessed = (n: number) => (processed += n);
    const emit = (percent: number, stage: EnDictionaryImportPhasesE) => {
      const chunk: ImportDictionaryChunkT = { percent, stage };
      res.write(JSON.stringify(chunk) + '\n');
      this.metrics?.transferProgressed('export', EnDictionaryImportPhasesE[stage], percent);
    };
    this.metrics?.transferStarted('export');

    try {
      const files: DatasetManifestT['files'] = {};
      for (const stage of stages) {
        const stageStartedAt = Date.now();
        const written = await this.exportEntities(stage, total, () => processed, addProcessed, emit);
        let lines = 0;
        for (const [filePath, count] of written) {
          files[path.basename(filePath)] = { lines: count };
          lines += count;
        }
        this.logger.log(
          `Export stage "${EnDictionaryImportPhasesE[stage.stage]}" wrote ${lines} lines into ${written.size} file(s) in ${Date.now() - stageStartedAt}ms`,
        );
      }

      // The manifest travels inside the archive, so the published dataset
      // always carries line counts matching its jsonl files (issue #159)
      // the terms of the dataset that is exported (issue #527): the active
      // one. The project's own dataset is published under the version of the
      // build that exports it; a dataset of another source keeps its own
      const exported = this.datasets?.getActive();
      const isOwn = !exported || exported.source === OWN_DATASET_SOURCE;
      const manifest: DatasetManifestT = {
        version: isOwn ? getVersion() : (exported.version ?? getVersion()),
        generatedAt: new Date().toISOString(),
        license: exported?.license ?? DATA_LICENSE.spdx,
        attribution: exported?.attribution ?? DATA_LICENSE.attribution,
        ...(exported && {
          source: exported.source,
          license_url: exported.license_url,
          attribution_url: exported.attribution_url ?? '',
          notice: exported.notice ?? '',
        }),
        synonym_links: await this.countExportedLinks('synonyms'),
        antonym_links: await this.countExportedLinks('antonyms'),
        translations: await this.countTranslationsByLanguage(),
        files,
      };
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

      emit(100, EnDictionaryImportPhasesE.packing_archive);
      await this.zipFiles(zipPath, [
        ...Object.keys(files).map((name) => path.join(runDir, name)),
        manifestPath,
      ]);

      const timeout = setTimeout(() => this.cleanupExport(exportId), EXPORT_TTL_MS);
      timeout.unref();
      this.pendingExports.set(exportId, { filePath: zipPath, createdAt: Date.now(), timeout });

      this.logger.log(
        `Dictionary export ${exportId} completed: ${processed} records in ${Date.now() - startedAt}ms, archive registered for ${EXPORT_TTL_MS / 1000}s`,
      );

      const finalChunk: ImportDictionaryChunkT = {
        percent: 100,
        stage: EnDictionaryImportPhasesE.completed,
        exportId,
      } as ImportDictionaryChunkT;
      res.write(JSON.stringify(finalChunk) + '\n');
      this.metrics?.transferFinished('export', 'success');
    } catch (error) {
      this.metrics?.transferFinished('export', 'failure');
      throw error;
    } finally {
      await Promise.allSettled([
        ...stages.flatMap((stage) => stage.files.map((file) => unlink(file.path))),
        unlink(manifestPath),
      ]);
      res.end();
    }
  }

  private zipFiles(zipPath: string, files: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const zipFile = new yazl.ZipFile();
      for (const file of files) {
        zipFile.addFile(file, path.basename(file));
      }
      const output = createWriteStream(zipPath);
      output.on('close', resolve);
      output.on('error', reject);
      zipFile.outputStream.pipe(output);
      zipFile.end();
    });
  }

  private cleanupExport(exportId: string): void {
    const entry = this.pendingExports.get(exportId);
    if (!entry) return;
    this.pendingExports.delete(exportId);
    unlink(entry.filePath).catch(() => {});
    this.logger.log(`Export archive ${exportId} cleaned up`);
  }

  /**
   * Вызывается из контроллера отдельным GET-эндпоинтом для скачивания архива.
   */
  async streamExportFile(exportId: string, res: Response): Promise<void> {
    const entry = this.pendingExports.get(exportId);
    if (!entry || !existsSync(entry.filePath)) {
      this.logger.warn(`Download requested for missing or expired export ${exportId}`);
      throw new NotFoundException(ErrorCodes.internal_server_error);
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="vocab-bloom-hub-en-export.zip"`);
    const { size } = await stat(entry.filePath);
    res.setHeader('Content-Length', size);

    const fileStream = createReadStream(entry.filePath);
    try {
      await pipeline(fileStream, res);
      this.logger.log(`Export archive ${exportId} downloaded (${size} bytes)`);
    } finally {
      clearTimeout(entry.timeout);
      this.cleanupExport(exportId);
    }
  }
}
