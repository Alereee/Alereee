import { Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { SettingsService } from '../../../SettingsModule/settings.service';
import { ImportTriggerE } from '../../../../../types';
import { DEFAULT_DATASET_NAME } from '../../../../../core/constants/datasets';
import { getActiveDatasetName } from '../../../../core/utils/active-dataset';
import { DATASET_VERSION_SETTINGS_FIELD } from './constants';
import { EnImportDictionaryService } from './enImportDictionary.service';
import { ImportStatusService } from './importStatus.service';
import { LogImportProgressSink } from './progress';
import { HuggingFaceDatasetSource, listImportDir, openImportDirSource } from './sources';

/** DICTIONARY_AUTO_IMPORT: load the published dictionary on first start (issue #268) */
export const isAutoImportEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  ['1', 'true', 'yes', 'on'].includes((env.DICTIONARY_AUTO_IMPORT ?? '').trim().toLowerCase());

/**
 * Fills an empty instance with the dictionary on first start, so that
 * `docker compose up` yields a usable service without a visit to the admin
 * UI (issue #268). Runs after the modules are up, in the background: the
 * HTTP listener opens meanwhile and the readiness probe reports
 * `importing` until the import is done.
 *
 * "First start" means no dataset version is recorded in the settings —
 * the version is written only by a completed import, so an interrupted one
 * is resumed on the next start (records already in place are skipped by
 * the import) and a completed one is never repeated. A database filled
 * before the version was tracked is imported once more, which merges.
 *
 * Only the dataset the instance was born with is filled this way (issue
 * #527): when another dataset is active, the project's own data has no
 * business in it, whatever its version says.
 *
 * The source is a dataset in DICTIONARY_IMPORT_DIR when there is one (the
 * newest, for installations without internet access), otherwise the
 * published dataset on HuggingFace.
 */
@Injectable()
export class DictionaryBootstrapService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DictionaryBootstrapService.name);
  private stopped = false;

  constructor(
    private readonly importService: EnImportDictionaryService,
    private readonly importStatus: ImportStatusService,
    private readonly settingsService: SettingsService,
  ) {}

  onApplicationBootstrap(): void {
    if (!isAutoImportEnabled()) return;
    // not awaited: the application start must not wait for a ten-minute import
    setImmediate(() => {
      this.run().catch((error) => {
        this.logger.error(
          `Automatic dictionary import crashed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    });
  }

  onModuleDestroy(): void {
    this.stopped = true;
  }

  /** Decides whether an import is due and runs it; exposed for the tests */
  async run(): Promise<'skipped' | 'completed' | 'failed'> {
    const active = getActiveDatasetName();
    if (active !== DEFAULT_DATASET_NAME) {
      this.logger.log(`Automatic dictionary import: the active dataset is "${active}", nothing to do`);
      return 'skipped';
    }
    const installed = await this.installedDatasetVersion();
    if (installed) {
      this.logger.log(`Automatic dictionary import: dataset ${installed} is already installed, nothing to do`);
      return 'skipped';
    }
    if (this.importStatus.running) {
      this.logger.log('Automatic dictionary import: an import is already running, nothing to do');
      return 'skipped';
    }
    if (this.stopped) return 'skipped';

    const { source, label } = await this.chooseSource();
    const progress = new LogImportProgressSink(
      this.logger,
      `Automatic dictionary import from ${label}`,
      (chunk) => this.importStatus.progress(chunk),
    );
    try {
      await this.importService.importFrom(source, label, progress, ImportTriggerE.auto);
      return 'completed';
    } catch (error) {
      this.logger.error(
        `Automatic dictionary import from ${label} failed: ${error instanceof Error ? error.message : String(error)}. ` +
          'It runs again on the next start; the admin UI can import from a file meanwhile.',
      );
      return 'failed';
    }
  }

  private async installedDatasetVersion(): Promise<string | null> {
    try {
      const version = await this.settingsService.findOne(DATASET_VERSION_SETTINGS_FIELD);
      return version || null;
    } catch (error) {
      if (error instanceof NotFoundException) return null;
      throw error;
    }
  }

  private async chooseSource() {
    const files = await listImportDir();
    if (files.length > 0) {
      // the newest dataset in the import directory wins
      const newest = [...files].sort((a, b) => (b.modified_at ?? '').localeCompare(a.modified_at ?? ''))[0];
      return {
        source: await openImportDirSource(newest.path, this.logger),
        label: `file "${newest.path}"`,
      };
    }
    // DICTIONARY_DATASET_VERSION pins the first-start import to one revision
    // of the dataset repo (a version tag, issue #322); unset means `main`
    const revision = (process.env.DICTIONARY_DATASET_VERSION ?? '').trim() || undefined;
    return {
      source: new HuggingFaceDatasetSource(this.logger, { revision }),
      label: `HuggingFace${revision ? ` @ ${revision}` : ''}`,
    };
  }
}
