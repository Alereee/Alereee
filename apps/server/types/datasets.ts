import { ErrorResT } from './errors';

/**
 * A dictionary dataset an instance can hold (issue #527): an entry of the
 * catalog the code ships (core/constants/dataset_catalog.ts) with what the
 * instance knows about it — whether it is installed, which version, whether
 * it is the one being served. The terms are the catalog's, never typed by
 * an admin. On Postgres every installed dataset has a schema of its own; on
 * SQLite there is the default one only.
 */
export type DatasetT = {
  /** Lower-case identifier, `default` for the dataset the instance was born with */
  name: string;
  /** The name of the dataset for a reader */
  title: string;
  /** Whether the instance holds it: a schema with its tables exists */
  installed: boolean;
  /** What the data is: `vocab-bloom-hub`, `wiktionary`, `wordnet`, … */
  source: string;
  /** The language of the headwords */
  language: string;
  /** The version of the dataset last imported into it; null when nothing was */
  version: string | null;
  /** SPDX identifier of the data license */
  license: string;
  license_url: string;
  /** The attribution line a consumer has to show */
  attribution: string;
  /** Where the attribution leads, when the source asks for a link */
  attribution_url: string | null;
  /** The provenance notice to pass on to readers (e.g. machine-generated data); null when none applies */
  notice: string | null;
  active: boolean;
  is_default: boolean;
  /** When the dataset was installed; null while it is not */
  created_at: string | null;
  imported_at: string | null;
};

export type DatasetsListT = {
  /** false on SQLite: one dataset, no creating, switching or deleting */
  supported: boolean;
  active: string;
  datasets: DatasetT[];
};

/** Where the data of a dataset comes from and under which terms */
export type DatasetProvenanceT = Pick<
  DatasetT,
  'source' | 'language' | 'license' | 'license_url' | 'attribution' | 'attribution_url' | 'notice'
>;

export type GetDatasetsResT = DatasetsListT | ErrorResT;
export type DatasetResT = DatasetT | ErrorResT;
export type DeleteDatasetResT = { success: true } | ErrorResT;

/**
 * What the source of an installed dataset has published (issue #530): the
 * admin UI says on the card of the dataset when a newer file exists. A
 * notice for the owner — the installation stays manual, and nothing of this
 * is a part of the public API.
 */
export type DatasetUpdateT = {
  name: string;
  /** The version the dataset is installed with; null when it holds nothing yet */
  installed: string | null;
  /** The version the newest file of the source would be installed with; null when the source could not be asked */
  latest: string | null;
  /** The page of the source the newer file is downloaded from */
  url: string | null;
  /**
   * Whether the installed version says which file of the source the dataset
   * holds. False for a dataset recorded by the day of its installation where
   * the source counts editions: it has to be installed again to know
   */
  comparable: boolean;
  /**
   * The source has a file that is worth installing: a newer edition, or an
   * extract that is a month newer than the installed one. False when the
   * two versions cannot be compared
   */
  update_available: boolean;
  checked_at: string | null;
};

export type DatasetUpdatesT = {
  /** false when `UPDATE_CHECK` is off: no source is asked */
  enabled: boolean;
  /** The installed datasets whose source can be asked, in the order of the catalog */
  datasets: DatasetUpdateT[];
};

export type GetDatasetUpdatesResT = DatasetUpdatesT | ErrorResT;
