import { Injectable, NotFoundException } from '@nestjs/common';
import { ErrorCodes } from '../../../core/constants/error_codes';
import { PublicHeadwordHistoryV1ResT, PublicWordDatasetV1T, PublicWordDatasetsV1ResT } from '../../../types';
import { DatasetsService } from '../DatasetsModule/datasets.service';
import { Dataset } from '../DatasetsModule/entities/dataset.entity';
import { PublicMetaService } from './public-meta.service';
import { HeadwordReader } from './utils/headword-reader';

/**
 * A headword as every dataset of the instance has it (issue #528). Each
 * dataset is read on its own connection, by the reads the served dataset is
 * answered with, and answers a group of its own under its own terms: no
 * statement names two schemas, no entry leaves the group of its dataset.
 */
@Injectable()
export class PublicWordDatasetsService {
  constructor(
    private readonly datasets: DatasetsService,
    private readonly meta: PublicMetaService,
  ) {}

  private async readerOf(dataset: Dataset): Promise<HeadwordReader> {
    return HeadwordReader.on(await this.datasets.reader(dataset), dataset.source);
  }

  private async groupOf(dataset: Dataset, word: string): Promise<PublicWordDatasetV1T> {
    const [terms, reader] = await Promise.all([this.meta.termsOf(dataset), this.readerOf(dataset)]);
    const resolved = await reader.resolve(word);
    const entries = resolved ? await reader.loadFull(resolved.ids) : [];
    return {
      ...terms,
      word: resolved?.word ?? word.toLowerCase(),
      variants: resolved?.variants ?? [],
      count: entries.length,
      entries,
    };
  }

  async getByHeadword(raw: string): Promise<PublicWordDatasetsV1ResT> {
    const word = raw.trim();
    const installed = await this.datasets.installed();
    const data = await Promise.all(installed.map((dataset) => this.groupOf(dataset, word)));
    const found = data.filter((group) => group.count > 0).length;
    if (found === 0) {
      throw new NotFoundException(ErrorCodes.word_doesnt_found);
    }
    return { data, meta: { word, datasets: data.length, found } };
  }

  /** What was changed in the entries of a headword in one dataset: the history read of that dataset */
  async getHistory(raw: string, name: string): Promise<PublicHeadwordHistoryV1ResT> {
    const dataset = (await this.datasets.installed()).find((installed) => installed.name === name);
    if (!dataset) {
      throw new NotFoundException(ErrorCodes.dataset_not_found);
    }
    const reader = await this.readerOf(dataset);
    const resolved = await reader.resolve(raw);
    if (!resolved) {
      throw new NotFoundException(ErrorCodes.word_doesnt_found);
    }
    const data = await reader.history(resolved);
    return { data, meta: { word: resolved.word, count: data.length, variants: resolved.variants } };
  }
}
