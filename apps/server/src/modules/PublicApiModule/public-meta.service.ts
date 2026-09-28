import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { EnStatisticsService } from '../EnModule/modules/EnStatistics/enStatistics.service';
import { SettingsService } from '../SettingsModule/settings.service';
import { DatasetsService } from '../DatasetsModule/datasets.service';
import { EnChangesService } from '../EnModule/modules/EnChanges/enChanges.service';
import { DATASET_VERSION_SETTINGS_FIELD } from '../EnModule/modules/EnImportDictionary/constants';
import { PUBLIC_API_VERSION } from '../../core/utils/public-api';
import { DATA_LICENSE } from '../../../core/constants/data_license';
import { findCatalogEntry, noticesText } from '../../../core/constants/dataset_catalog';
import { DEFAULT_DATASET_NAME, OWN_DATASET_SOURCE } from '../../../core/constants/datasets';
import { SOURCE_LANGUAGES } from '../../../core/constants/languages';
import { AvailableTranslationLanguagesE, PublicDatasetCountsV1T, PublicMetaV1T } from '../../../types';

// The counters are a dozen COUNT(*) queries over the whole dictionary; the
// public prefix may be polled by every consumer, so they are refreshed at
// most this often
export const META_COUNTS_TTL_MS = 60_000;

/** GET /api/v1/meta: what the instance serves (issue #272) */
@Injectable()
export class PublicMetaService {
  private countsCache: { counts: PublicDatasetCountsV1T; modified: number; fetchedAt: number } | null = null;

  constructor(
    private readonly enStatisticsService: EnStatisticsService,
    private readonly settingsService: SettingsService,
    // absent in the unit tests that build the service by hand
    @Optional() private readonly datasets?: DatasetsService,
    @Optional() private readonly changes?: EnChangesService,
  ) {
    // another dataset, other counts (issue #527)
    this.datasets?.onActiveChanged(() => {
      this.countsCache = null;
    });
  }

  // the counters, and with them how many headwords were changed or added on the instance (issue #531)
  private async getCounts(): Promise<{ counts: PublicDatasetCountsV1T; modified: number }> {
    if (this.countsCache && Date.now() - this.countsCache.fetchedAt < META_COUNTS_TTL_MS) {
      return this.countsCache;
    }
    const [{ totals }, modified] = await Promise.all([
      this.enStatisticsService.getStatistics(),
      this.changes?.countModifiedEntries() ?? 0,
    ]);
    this.countsCache = { counts: totals, modified, fetchedAt: Date.now() };
    return this.countsCache;
  }

  // the settings field mirrors the version of the active dataset (the import
  // and a switch write it) and stays what an admin may correct by hand
  private async getDatasetVersion(): Promise<string | null> {
    try {
      return await this.settingsService.findOne(DATASET_VERSION_SETTINGS_FIELD);
    } catch (error) {
      if (error instanceof NotFoundException) return null;
      throw error;
    }
  }

  // the notices of the source in full (issue #531): what the catalog keeps for the dataset
  private noticesOf(dataset: string): string {
    const entry = findCatalogEntry(dataset);
    return entry ? noticesText(entry) : '';
  }

  async getMeta(): Promise<PublicMetaV1T> {
    const [{ counts, modified }, dataset_version] = await Promise.all([
      this.getCounts(),
      this.getDatasetVersion(),
    ]);
    const active = this.datasets?.getActive();
    return {
      api_version: PUBLIC_API_VERSION,
      app_version: this.settingsService.getVersion() ?? '',
      dataset_version,
      // the terms of the dataset that is served (issue #527)
      license: active?.license ?? DATA_LICENSE.spdx,
      license_url: active?.license_url ?? DATA_LICENSE.url,
      attribution: active?.attribution ?? DATA_LICENSE.attribution,
      notice: active ? (active.notice ?? '') : DATA_LICENSE.notice,
      dataset: active?.name ?? DEFAULT_DATASET_NAME,
      source: active?.source ?? OWN_DATASET_SOURCE,
      attribution_url: active ? active.attribution_url : null,
      license_text: this.noticesOf(active?.name ?? DEFAULT_DATASET_NAME),
      modified_entries: modified,
      counts,
      // the schema, not the data: the languages a translation may carry on
      // this build, whether or not one has been imported yet (issue #394)
      available_languages: {
        source: [...SOURCE_LANGUAGES],
        translations: Object.values(AvailableTranslationLanguagesE),
      },
    };
  }
}
