import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { EnEntry } from '../EnModule/entities/en_entry.entity';
import { EnWord } from '../EnModule/entities/en_word.entity';
import { EnMeaning } from '../EnModule/entities/en_meaning.entity';
import { EnMeaningTranslation } from '../EnModule/entities/en_meaning_translation.entity';
import { EnShortTranslation } from '../EnModule/entities/en_short_translation.entity';
import { DatasetsService } from '../DatasetsModule/datasets.service';

// The newest change is looked up at most this often: every public GET asks
// for it, and a value a minute old only delays a Last-Modified bump — the
// content ETag still changes with the first response after an edit
export const LAST_MODIFIED_TTL_MS = 60_000;

type TimestampedT = { updateAt: Date };

const TIMESTAMPED_ENTITIES = [EnEntry, EnWord, EnMeaning, EnMeaningTranslation, EnShortTranslation];

const newestUpdateAt = async (repository: Repository<TimestampedT>): Promise<Date | null> => {
  // loaded through the entity so every driver hydrates the column as a Date
  const [row] = await repository.find({ select: { updateAt: true }, order: { updateAt: 'DESC' }, take: 1 });
  return row?.updateAt ?? null;
};

export const newestOf = (dates: ReadonlyArray<Date | null | undefined>): Date | null =>
  dates.reduce<Date | null>((max, date) => (date && (!max || date > max) ? date : max), null);

// HTTP dates have a one-second resolution; truncated so the header and a
// client's If-Modified-Since compare equal after a round trip
export const toHttpInstant = (date: Date | null): Date | null =>
  date ? new Date(Math.floor(date.getTime() / 1000) * 1000) : null;

/** The newest change of the dictionary tables behind the repositories; null for an empty dictionary */
export const newestChange = async (
  repositories: ReadonlyArray<Repository<TimestampedT>>,
): Promise<Date | null> =>
  newestOf(await Promise.all(repositories.map((repository) => newestUpdateAt(repository))));

/** The newest change of the dataset a connection is on (issue #528) */
export const newestChangeOn = (dataSource: DataSource): Promise<Date | null> =>
  newestChange(TIMESTAMPED_ENTITIES.map((entity) => dataSource.getRepository<TimestampedT>(entity)));

/**
 * When the dictionary last changed (issue #274): the newest `updateAt`
 * across the entry, word, meaning and translation tables. Every table gets
 * that column bumped on insert and update, so a single instant covers the
 * whole public read surface — a `Last-Modified` for every public answer.
 *
 * A switch of the active dataset (issue #527) changes everything the public
 * API serves at once, and the newly active data may be older than what was
 * served a minute ago: the instant of the switch counts as a change, so the
 * header never goes back in time.
 */
@Injectable()
export class DictionaryLastModifiedService {
  private cache: { value: Date | null; fetchedAt: number } | null = null;

  private readonly repositories: Repository<TimestampedT>[];

  constructor(
    @InjectRepository(EnEntry) entries: Repository<EnEntry>,
    @InjectRepository(EnWord) words: Repository<EnWord>,
    @InjectRepository(EnMeaning) meanings: Repository<EnMeaning>,
    @InjectRepository(EnMeaningTranslation) meaningTranslations: Repository<EnMeaningTranslation>,
    @InjectRepository(EnShortTranslation) shortTranslations: Repository<EnShortTranslation>,
    // absent in the unit tests that build the service by hand
    @Optional() private readonly datasets?: DatasetsService,
  ) {
    this.repositories = [entries, words, meanings, meaningTranslations, shortTranslations];
    this.datasets?.onActiveChanged(() => this.reset());
  }

  /** null for an empty dictionary */
  async getLastModified(): Promise<Date | null> {
    if (this.cache && Date.now() - this.cache.fetchedAt < LAST_MODIFIED_TTL_MS) {
      return this.cache.value;
    }
    const activatedAt = this.datasets?.getActive()?.activated_at;
    const value = toHttpInstant(
      newestOf([await newestChange(this.repositories), activatedAt ? new Date(activatedAt) : null]),
    );
    this.cache = { value, fetchedAt: Date.now() };
    return value;
  }

  /** Forgets the cached instant; the next read looks it up again */
  reset(): void {
    this.cache = null;
  }
}
