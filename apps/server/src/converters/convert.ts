import { DatasetWriter, WriterSummaryT } from './writer';
import { SkipReasonT, SourceAdapterT } from './types';

export type ConvertOptionsT = {
  source: SourceAdapterT;
  input: string;
  outDir: string;
  version?: string | undefined;
  limit?: number | undefined;
  /** What follows the known flags on the command line, for the source: --cmudict, --edition */
  sourceOptions?: Record<string, string>;
  log?: (message: string) => void;
  /** Bytes of the input read so far, of how many */
  onProgress?: ((read: number, total: number) => void) | undefined;
};

export type ConvertSummaryT = WriterSummaryT & { skipped: Partial<Record<SkipReasonT, number>> };

/** The day of the conversion, as the version of a dataset whose source has none: 2026.09.27 */
export const versionOfToday = (now: Date = new Date()): string =>
  now.toISOString().slice(0, 10).replace(/-/g, '.');

/** Runs a source adapter into a dataset of the project's format (issue #527) */
export const convert = async (options: ConvertOptionsT): Promise<ConvertSummaryT> => {
  const sourceOptions = options.sourceOptions ?? {};
  const writer = new DatasetWriter({
    outDir: options.outDir,
    version: options.version || versionOfToday(),
    provenance: options.source.provenance(sourceOptions),
  });
  const skipped: Partial<Record<SkipReasonT, number>> = {};
  await options.source.convert(options.input, sourceOptions, {
    emit: (entry) => writer.add(entry),
    skip: (reason) => {
      skipped[reason] = (skipped[reason] ?? 0) + 1;
    },
    limit: options.limit,
    log: options.log ?? (() => undefined),
    progress: options.onProgress,
  });
  return { ...(await writer.close()), skipped };
};
