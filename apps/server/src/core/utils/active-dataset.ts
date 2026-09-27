import { DEFAULT_DATASET_NAME, OWN_DATASET_SOURCE } from '../../../core/constants/datasets';

// What the process serves right now (issue #527), for the places that need
// the name or the source of the active dataset and cannot depend on
// DatasetsService — the audit journal it writes into, the pure projections.
// DatasetsService sets it at start and on every switch.
let active: { name: string; source: string } = { name: DEFAULT_DATASET_NAME, source: OWN_DATASET_SOURCE };

export const setActiveDataset = (dataset: { name: string; source: string }): void => {
  active = { name: dataset.name, source: dataset.source };
};

export const getActiveDatasetName = (): string => active.name;
export const getActiveDatasetSource = (): string => active.source;
