import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { rm, unlink } from 'node:fs/promises';
import * as path from 'node:path';
import type { Response } from 'express';
import { DatasetCatalogEntryT, findCatalogEntry } from '../../../../../core/constants/dataset_catalog';
import { ErrorCodes } from '../../../../../core/constants/error_codes';
import { ImportTriggerE } from '../../../../../types';
import { convert } from '../../../../converters/convert';
import { findSource } from '../../../../converters/sources';
import { firstLineOf, packingOf, unpackFiles, WORDNET_FILES } from '../../../../converters/unpack';
import { DatasetsService } from '../../../DatasetsModule/datasets.service';
import { EnDictionaryImportPhasesE } from '../EnImportDictionary/constants';
import { EnImportDictionaryService } from '../EnImportDictionary/enImportDictionary.service';
import { ImportStatusService } from '../EnImportDictionary/importStatus.service';
import { HttpImportProgressSink, ImportProgressSink } from '../EnImportDictionary/progress';
import { DatasetSource, DirectoryDatasetSource, getImportTmpDir } from '../EnImportDictionary/sources';

export type SourceUploadT = { path: string; originalname: string };
export type SourceUploadsT = { file?: SourceUploadT | undefined; pronunciations?: SourceUploadT | undefined };

// the conversion of the largest source reads half a gigabyte: a chunk per percent is plenty
const PROGRESS_STEP_PERCENT = 1;

/**
 * Installs a dataset of the catalog from the file its source distributes
 * (issue #527): the admin downloads the file and attaches it, the server
 * converts it into the project's format and imports the result into the
 * dataset's own schema — while the active dataset keeps serving. A dataset
 * that is installed already is updated: its entries are replaced with the
 * ones of the newer file, the ones the admin edited are kept.
 */
@Injectable()
export class EnDatasetInstallService {
  private readonly logger = new Logger(EnDatasetInstallService.name);

  constructor(
    private readonly importService: EnImportDictionaryService,
    private readonly datasets: DatasetsService,
    private readonly importStatus: ImportStatusService,
  ) {}

  async install(name: string, uploads: SourceUploadsT, res: Response): Promise<void> {
    const work: string[] = [];
    try {
      const entry = findCatalogEntry(name);
      if (!entry) throw new NotFoundException(ErrorCodes.dataset_not_found);
      if (entry.install.kind !== 'convert') throw new BadRequestException(ErrorCodes.dataset_not_installable);
      if (!this.datasets.supported) throw new ConflictException(ErrorCodes.datasets_not_supported);
      if (!uploads.file) throw new BadRequestException(ErrorCodes.dataset_upload_missing);
      // refused before the file is looked at; the import claims the slot itself
      if (this.importStatus.running) throw new ConflictException(ErrorCodes.import_in_progress);

      const input = await this.inputOf(entry, uploads.file, work);
      if (uploads.pronunciations) await this.assertPronunciations(uploads.pronunciations);

      const installed = (await this.datasets.list()).datasets.find((dataset) => dataset.name === name);
      await this.importService.importFrom(
        (progress) => this.convert(entry, input, uploads.pronunciations?.path, progress),
        `${entry.title}, "${uploads.file.originalname}"`,
        new HttpImportProgressSink(res),
        ImportTriggerE.manual,
        { dataset: name, update: Boolean(installed?.imported_at) },
      );
    } finally {
      await Promise.allSettled([
        ...[uploads.file, uploads.pronunciations].map((upload) => (upload ? unlink(upload.path) : undefined)),
        ...work.map((dir) => rm(dir, { recursive: true, force: true })),
      ]);
    }
  }

  private reject(entry: DatasetCatalogEntryT, upload: SourceUploadT, reason: string): never {
    this.logger.warn(`"${upload.originalname}" rejected as the source of "${entry.name}": ${reason}`);
    throw new BadRequestException(ErrorCodes.dataset_source_invalid);
  }

  /**
   * What the adapter reads, checked to be what the source distributes before
   * anything is converted: a wrong file is refused as a plain HTTP error.
   * A packed release is unpacked here, into a folder `work` remembers.
   */
  private async inputOf(entry: DatasetCatalogEntryT, upload: SourceUploadT, work: string[]): Promise<string> {
    if (entry.install.kind !== 'convert') throw new BadRequestException(ErrorCodes.dataset_not_installable);
    if (entry.install.adapter === 'wordnet') {
      const dir = path.join(getImportTmpDir(), `source-${randomUUID()}`);
      work.push(dir);
      const found = await unpackFiles(upload.path, dir, WORDNET_FILES).catch((error: unknown) =>
        this.reject(entry, upload, error instanceof Error ? error.message : String(error)),
      );
      if (!found.includes('data.noun') || !found.includes('index.noun')) {
        this.reject(entry, upload, 'no data.noun and index.noun in the archive');
      }
      return dir;
    }
    if ((await packingOf(upload.path)) === 'zip') this.reject(entry, upload, 'a zip archive, not the extract');
    const line = await firstLineOf(upload.path).catch(() => '');
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      this.reject(entry, upload, 'the first line is not JSON');
    }
    const { word, pos } = (record ?? {}) as { word?: unknown; pos?: unknown };
    if (typeof word !== 'string' || typeof pos !== 'string') {
      this.reject(entry, upload, 'the first line is not an entry of the extract');
    }
    return upload.path;
  }

  /** `word PHONE PHONE …` with the stress on the vowels, comments behind `;;;` or `#` */
  private async assertPronunciations(upload: SourceUploadT): Promise<void> {
    const plain = (await packingOf(upload.path)) === 'plain';
    const line = plain ? await firstLineOf(upload.path, 64 * 1024).catch(() => '') : '';
    if (!/^(;;;|#)|^\S+\s+[A-Z]+[0-2]?(\s+[A-Z]+[0-2]?)*\s*(#.*)?$/.test(line)) {
      this.logger.warn(`"${upload.originalname}" rejected: not a CMUdict file`);
      throw new BadRequestException(ErrorCodes.dataset_source_invalid);
    }
  }

  /** Converts the source into a dataset in a folder of its own, removed when the import lets go of it */
  private async convert(
    entry: DatasetCatalogEntryT,
    input: string,
    pronunciations: string | undefined,
    progress: ImportProgressSink,
  ): Promise<DatasetSource> {
    if (entry.install.kind !== 'convert') throw new BadRequestException(ErrorCodes.dataset_not_installable);
    const adapter = findSource(entry.install.adapter);
    if (!adapter) throw new Error(`No converter "${entry.install.adapter}" for the dataset "${entry.name}"`);

    const outDir = path.join(getImportTmpDir(), `converted-${randomUUID()}`);
    const startedAt = Date.now();
    let reported = -PROGRESS_STEP_PERCENT;
    progress.write({ percent: 0, stage: EnDictionaryImportPhasesE.converting_source });
    try {
      const summary = await convert({
        source: adapter,
        input,
        outDir,
        sourceOptions: { ...entry.install.options, ...(pronunciations ? { cmudict: pronunciations } : {}) },
        log: (message) => this.logger.log(`${entry.title}: ${message}`),
        onProgress: (read, total) => {
          const percent = total > 0 ? Math.min(100, (read / total) * 100) : 0;
          if (percent < reported + PROGRESS_STEP_PERCENT) return;
          reported = percent;
          progress.write({
            percent,
            stage: EnDictionaryImportPhasesE.converting_source,
            downloaded: read,
            total,
          });
        },
      });
      if (summary.entries === 0) throw new BadRequestException(ErrorCodes.dataset_source_invalid);
      this.logger.log(
        `${entry.title} converted in ${Date.now() - startedAt}ms: ${summary.entries} entries, ` +
          `${summary.meanings} meanings`,
      );
      progress.write({ percent: 100, stage: EnDictionaryImportPhasesE.converting_source });
      return await DirectoryDatasetSource.open(outDir, this.logger, true);
    } catch (error) {
      await rm(outDir, { recursive: true, force: true });
      throw error;
    }
  }
}
