import { DatasetManifestT } from '../../../../../../types';
import type { ImportProgressSink } from '../progress';

/**
 * Where the dataset files come from. The import pipeline only ever sees
 * local file paths: a source makes each jsonl file available on disk and
 * says whether the pipeline may delete it afterwards.
 */
export interface DatasetSource {
  /** The dataset manifest, or null when the source has none (HuggingFace may be unreachable) */
  readManifest(): Promise<DatasetManifestT | null>;
  /**
   * Makes the given dataset file available locally, reporting download
   * progress to `progress` when it has to be fetched first
   */
  acquireFile(fileName: string, progress: ImportProgressSink): Promise<AcquiredFileT>;
  /** Releases everything the source holds on disk (extracted archives, uploads) */
  dispose(): Promise<void>;
}

export type AcquiredFileT = {
  path: string;
  // true for files the source created itself (downloads); the pipeline
  // deletes those once they are imported, never the user's own files
  temporary: boolean;
};

/**
 * A source that does not exist yet when the import is asked for: made inside
 * the import slot, with the progress of its making on the import's stream
 */
export type DatasetSourceFactoryT = (progress: ImportProgressSink) => Promise<DatasetSource>;
