import { Injectable, Logger } from '@nestjs/common';
import { getVersion } from '../../../configuration';
import {
  DATASET_CATALOG,
  DatasetCatalogEntryT,
  DatasetUpdateCheckT,
} from '../../../core/constants/dataset_catalog';
import {
  editionOfTag,
  isComparableVersion,
  isUpdateWorthTelling,
  versionOfDay,
} from '../../../core/utils/dataset_updates';
import type { DatasetUpdateT, DatasetUpdatesT } from '../../../types';
import { isUpdateCheckEnabled } from '../../core/utils/update-check';
import { DatasetsService } from './datasets.service';

// A source publishes a file every few days at most, and GitHub allows an
// anonymous address 60 requests an hour: the answer of a source is kept for a
// day, a failure for half an hour so an outage is neither hammered nor
// remembered for long
export const DATASET_UPDATES_TTL_MS = 24 * 60 * 60 * 1000;
export const DATASET_UPDATES_FAILURE_TTL_MS = 30 * 60 * 1000;
export const DATASET_UPDATES_TIMEOUT_MS = 10_000;

type LatestT = { version: string; url: string | null };
type CacheT = { latest: LatestT | null; checkedAt: number; ok: boolean };

/** The page of the source its file is downloaded from, as the instruction of the dataset links it */
const downloadPageOf = (entry: DatasetCatalogEntryT): string | null =>
  entry.install.kind === 'convert' ? (entry.install.files[0]?.page_url ?? null) : null;

/**
 * Whether the source of an installed dataset has published a newer file
 * (issue #530). Notification only, like the update notice of the server
 * itself: the file is downloaded and installed by the admin. What is asked
 * is stated in the catalog; only the datasets the instance holds are asked
 * about, and `UPDATE_CHECK=false` keeps the instance silent. The answers
 * live in memory — the registry is not written, a restart asks again.
 */
@Injectable()
export class DatasetUpdatesService {
  private readonly logger = new Logger(DatasetUpdatesService.name);
  private readonly cache = new Map<string, CacheT>();
  private readonly inFlight = new Map<string, Promise<CacheT>>();

  constructor(private readonly datasets: DatasetsService) {}

  async check(): Promise<DatasetUpdatesT> {
    if (!isUpdateCheckEnabled()) return { enabled: false, datasets: [] };

    const installed = new Map((await this.datasets.installed()).map((dataset) => [dataset.name, dataset]));
    const asked = DATASET_CATALOG.filter(
      (entry) => entry.update_check.kind !== 'none' && installed.has(entry.name),
    );
    const datasets = await Promise.all(
      asked.map(async (entry): Promise<DatasetUpdateT> => {
        const version = installed.get(entry.name)?.version ?? null;
        const { latest, checkedAt } = await this.latestOf(entry);
        return {
          name: entry.name,
          installed: version,
          latest: latest?.version ?? null,
          url: latest?.url ?? null,
          comparable: isComparableVersion(entry.update_check, version),
          update_available: isUpdateWorthTelling(entry.update_check, version, latest?.version),
          checked_at: new Date(checkedAt).toISOString(),
        };
      }),
    );
    return { enabled: true, datasets };
  }

  /** Forgets the cached answers; the next check asks the sources again */
  reset(): void {
    this.cache.clear();
  }

  private async latestOf(entry: DatasetCatalogEntryT): Promise<CacheT> {
    const cached = this.cache.get(entry.name);
    if (cached) {
      const ttl = cached.ok ? DATASET_UPDATES_TTL_MS : DATASET_UPDATES_FAILURE_TTL_MS;
      if (Date.now() - cached.checkedAt < ttl) return cached;
    }
    // concurrent page loads share one request
    let asking = this.inFlight.get(entry.name);
    if (!asking) {
      asking = this.ask(entry).finally(() => this.inFlight.delete(entry.name));
      this.inFlight.set(entry.name, asking);
    }
    const answer = await asking;
    this.cache.set(entry.name, answer);
    return answer;
  }

  private async ask(entry: DatasetCatalogEntryT): Promise<CacheT> {
    try {
      const latest = await this.fetchLatest(entry.update_check, downloadPageOf(entry));
      return { latest, checkedAt: Date.now(), ok: true };
    } catch (error) {
      // logged once per failure period: the cache keeps the check from repeating
      this.logger.warn(
        `The source of "${entry.name}" could not be asked for a newer file, "unknown" for the next ${
          DATASET_UPDATES_FAILURE_TTL_MS / 60_000
        } min: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { latest: null, checkedAt: Date.now(), ok: false };
    }
  }

  private async fetchLatest(check: DatasetUpdateCheckT, page: string | null): Promise<LatestT | null> {
    if (check.kind === 'none') return null;
    const headers = { 'User-Agent': `vocab-bloom-hub/${getVersion() || 'unknown'}` };
    const signal = AbortSignal.timeout(DATASET_UPDATES_TIMEOUT_MS);

    if (check.kind === 'last_modified') {
      // the headers of the file: nothing of the file itself is downloaded
      const response = await fetch(check.url, { method: 'HEAD', headers, signal });
      if (!response.ok) throw new Error(`the source answered ${response.status}`);
      const modified = Date.parse(response.headers.get('last-modified') ?? '');
      if (Number.isNaN(modified)) throw new Error('the source did not say when its file was made');
      return { version: versionOfDay(new Date(modified)), url: page };
    }

    const response = await fetch(check.api_url, {
      headers: { ...headers, Accept: 'application/vnd.github+json' },
      signal,
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    const body = (await response.json()) as { tag_name?: unknown; html_url?: unknown };
    const tag = typeof body.tag_name === 'string' ? body.tag_name : '';
    const edition = editionOfTag(tag, check.tag_pattern);
    if (!edition) throw new Error(`the latest release is tagged "${tag}", not an edition`);
    return { version: edition, url: typeof body.html_url === 'string' && body.html_url ? body.html_url : page };
  }
}
