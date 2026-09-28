import { Injectable } from '@nestjs/common';
import { DatasetsService } from '../DatasetsModule/datasets.service';
import {
  LAST_MODIFIED_TTL_MS,
  newestChangeOn,
  newestOf,
  toHttpInstant,
} from './dictionary-last-modified.service';

/**
 * When what the instance holds last changed, every dataset counted (issue
 * #528): the `Last-Modified` of the reads that answer from all of them. The
 * newest change of any dataset, and the last change of their set — a
 * dataset that was installed, activated or deleted changes the answer
 * without touching a row of the others, and a deleted one takes its own
 * instants with it: the header would go back in time.
 */
@Injectable()
export class DatasetsLastModifiedService {
  private cache: { value: Date | null; fetchedAt: number } | null = null;

  constructor(private readonly datasets: DatasetsService) {
    this.datasets.onRegistryChanged(() => this.reset());
  }

  /** null for an instance whose datasets are all empty */
  async getLastModified(): Promise<Date | null> {
    if (this.cache && Date.now() - this.cache.fetchedAt < LAST_MODIFIED_TTL_MS) {
      return this.cache.value;
    }
    const installed = await this.datasets.installed();
    const dates = await Promise.all([
      this.datasets.changedAt(),
      ...installed.map(async (dataset) => newestChangeOn(await this.datasets.reader(dataset))),
    ]);
    const value = toHttpInstant(newestOf(dates));
    this.cache = { value, fetchedAt: Date.now() };
    return value;
  }

  /** Forgets the cached instant; the next read looks it up again */
  reset(): void {
    this.cache = null;
  }
}
