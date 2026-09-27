import { ConflictException, Injectable } from '@nestjs/common';
import { ErrorCodes } from '../../../../../core/constants/error_codes';
import { ImportDictionaryChunkT, ImportStatusT, ImportTriggerE } from '../../../../../types';
import { EnDictionaryImportPhasesE } from './constants';

/**
 * The one import slot of the process (issue #268). Two imports at once
 * would race each other in the database, so the admin endpoints and the
 * automatic import on first start all go through `begin()` / `end()`; what
 * is (or last was) running is read by the readiness probe, the admin banner
 * and `GET /api/en/dictionary/import/status`.
 */
@Injectable()
export class ImportStatusService {
  private status: ImportStatusT = { running: false };

  snapshot(): ImportStatusT {
    return { ...this.status };
  }

  get running(): boolean {
    return this.status.running;
  }

  /** Claims the slot; throws 409 `import_in_progress` when another import holds it */
  begin(trigger: ImportTriggerE, label: string, dataset?: string): void {
    if (this.status.running) {
      throw new ConflictException(ErrorCodes.import_in_progress);
    }
    this.status = {
      running: true,
      trigger,
      label,
      percent: 0,
      started_at: new Date().toISOString(),
      ...(dataset ? { dataset } : {}),
    };
  }

  progress(chunk: ImportDictionaryChunkT): void {
    if (!this.status.running) return;
    // the download stage reports bytes, the others the overall percent
    if (chunk.stage === EnDictionaryImportPhasesE.downloading_database) {
      this.status.stage = chunk.stage;
      return;
    }
    if (chunk.stage !== undefined) this.status.stage = chunk.stage;
    this.status.percent = Math.min(100, Math.max(0, chunk.percent));
    if (chunk.datasetVersion) this.status.dataset_version = chunk.datasetVersion;
  }

  /** Releases the slot; the outcome stays visible until the next import begins */
  end(outcome: { error?: string; dataset_version?: string | undefined }): void {
    this.status = {
      ...this.status,
      running: false,
      stage: outcome.error ? this.status.stage : EnDictionaryImportPhasesE.completed,
      percent: outcome.error ? this.status.percent : 100,
      finished_at: new Date().toISOString(),
      ...(outcome.error ? { error: outcome.error } : { dataset_version: outcome.dataset_version }),
    };
  }
}
